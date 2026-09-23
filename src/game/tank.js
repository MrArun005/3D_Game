import * as THREE from 'three';
import { Vehicle } from './vehicle.js';
import { resolveBoxes } from '../vehicle/collision.js';
import { buildTankModel, rollTracks, BARREL_AT, MUZZLE_X, HALF_TRACK } from '../world/tankModel.js';

/* One tracer for every shell of every tank: a new geometry + material per shot
   was an allocation and (for the first) a pipeline compile mid-fight. */
const TRACER_GEO = new THREE.SphereGeometry(0.22, 8, 6);
const TRACER_MAT = new THREE.MeshBasicMaterial({ color: 0xffdd44 });
const _muzzle = new THREE.Vector3();

/**
 * 55-tonne Rhino Heavy Tank.
 * 
 * Features:
 * - Skid-steering dynamics (pivot turning in place)
 * - Heavy mass momentum & crush physics (crushes traffic and smashes props)
 * - Independent 360-degree mouse-aimed turret
 * - 120mm cannon ballistics with recoil kick and radial blast shockwaves
 * - 3-second reload cooldown
 */
export class TankVehicle extends Vehicle {
  constructor(scene, world, traffic, debris, options = {}) {
    super('tank');
    this.scene = scene;
    this.world = world;
    this.traffic = traffic;
    this.debris = debris;

    // Position & Orientation
    this.x = options.x || 0;
    this.y = options.y || 0.65;
    this.z = options.z || 0;
    this.yaw = options.yaw || 0;
    this.pitch = 0;
    this.roll = 0;

    // Velocities
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.yawRate = 0;
    this.speed = 0;
    this.fwdSpeed = 0;

    // Turret & Cannon
    this.turretYaw = 0;
    this.barrelPitch = 0.05;
    this.reloadTime = 0;
    this.reloadCooldown = 3.0; // 3 seconds
    this.recoil = 0;
    this.projectiles = [];

    // Tank specs
    this.maxSpeed = 19.0;      // ~68 km/h
    this.accel = 18.0;
    this.turnRate = 1.6;       // skid steer pivot rate
    this.mass = 55000;         // kg
    this.health = 500;
    this.impact = 0;

    // Custom Chase Camera Rig
    this.customRig = {
      back: 13.5,
      up: 5.2,
      aim: 15.0,
      fov: 62,
      lag: 3.5,
      tilt: 0,
    };

    this.#buildModel(options.flash);
  }

  /* The model is world/tankModel.js: ~13.5k triangles in five draws (hull,
     wheels, tracks, turret, barrel), geometry and materials shared by every
     tank. The hierarchy is the old one -- group > turretGroup > barrelGroup --
     so the turret aim and the recoil below drive it unchanged. */
  #buildModel(sharedFlash) {
    const model = buildTankModel();
    this.model = model;
    this.turretGroup = model.turretGroup;
    this.barrelGroup = model.barrelGroup;
    // Muzzle flash light, at the muzzle: it turns with the turret now (it used to sit 6 m ahead of the HULL)
    // shared with DispatchService when given: a new scene light recompiles every pipeline (see flight.js)
    const flash = sharedFlash || new THREE.PointLight(0xffaa33, 0, 16);
    flash.position.set(MUZZLE_X + 0.4, 0, 0);
    this.barrelGroup.add(flash);
    this.muzzleFlash = flash;

    model.group.position.set(this.x, this.y, this.z);
    this.scene.add(model.group);
    this.mesh = model.group;
  }

  enter(player) {
    super.enter(player);
    if (this.muzzleFlash && this.barrelGroup) { this.barrelGroup.add(this.muzzleFlash); this.muzzleFlash.position.set(MUZZLE_X + 0.4, 0, 0); }   // the shared flash rides the tank being driven, at its muzzle
  }

  update(input, dt, context = {}) {
    if (this.reloadTime > 0) {
      this.reloadTime = Math.max(0, this.reloadTime - dt);
    }
    if (this.recoil > 0) {
      this.recoil = Math.max(0, this.recoil - dt * 4.5);
      if (this.barrelGroup) this.barrelGroup.position.x = BARREL_AT.x - this.recoil * 0.45;
    }
    if (this.muzzleFlash && this.muzzleFlash.intensity > 0) {
      this.muzzleFlash.intensity = Math.max(0, this.muzzleFlash.intensity - dt * 2500);
    }

    // 1. Controls
    let throttle = 0;
    let steer = 0;
    let hand = false;

    if (this.driver && input) {
      throttle = (input.throttle || 0) - (input.brake || 0); // W/S
      steer = -(input.steer || 0);                           // A/D
      hand = !!input.handbrake;

      // Cannon trigger
      if (context.firing && this.reloadTime <= 0) {
        this.fire();
      }
    }

    // 2. Skid Steering Physics
    // Pivot turning: A/D rotates tank even when throttle is 0
    const turnMult = throttle === 0 ? 1.4 : 1.0;
    this.yawRate += (steer * this.turnRate * turnMult - this.yawRate) * Math.min(1, dt * 5.0);
    this.yaw += this.yawRate * dt;

    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const fwdX = cy, fwdZ = -sy;

    // Forward drive
    const targetFwd = throttle * this.maxSpeed * (hand ? 0 : 1);
    this.fwdSpeed += (targetFwd - this.fwdSpeed) * Math.min(1, dt * (throttle !== 0 ? 3.2 : 4.5));

    this.vx = fwdX * this.fwdSpeed;
    this.vz = fwdZ * this.fwdSpeed;

    this.x += this.vx * dt;
    this.z += this.vz * dt;

    /* Buildings. The car's hull collider (8 probes vs oriented footprints)
       reads x/z/yaw/vx/vz/yawRate and writes them back, which is all this
       body has; it had no building collision at all before (review
       2026-09-09). The velocity it hands back is re-projected onto the
       tracks so the next frame's drive picks up from the wall, not through it. */
    const boxes = this.world?.nearbyBuildings?.(this.x, this.z);
    if (boxes && boxes.length) {
      resolveBoxes(this, boxes);
      this.fwdSpeed = this.vx * fwdX + this.vz * fwdZ;
    }

    // Ground elevation
    const groundY = this.world?.district?.elevationAt?.(this.x, this.z) ?? 0;
    this.y = groundY + 0.65;
    this.speed = Math.abs(this.fwdSpeed);

    // 3. Turret Aiming (tracks mouse look direction)
    if (context.chase) {
      const aimYaw = this.yaw - (context.chase.lookYaw || 0);
      this.turretYaw = -context.chase.lookYaw || 0;
      if (this.turretGroup) {
        this.turretGroup.rotation.y = this.turretYaw;
      }
    }

    // 4. Update Pose
    if (this.mesh) {
      this.mesh.position.set(this.x, this.y, this.z);
      this.mesh.rotation.set(0, this.yaw, 0);
    }
    /* The tracks roll with the ground they lie on: each side covers the hull's
       speed plus or minus the turn (skid steer: yawRate > 0 turns the nose to
       -Z, the tank's right, so the LEFT track runs the outside of the turn).
       Wheels and links move on the GPU from these two numbers. */
    if (this.model) rollTracks(this.model, (this.fwdSpeed + this.yawRate * HALF_TRACK) * dt, (this.fwdSpeed - this.yawRate * HALF_TRACK) * dt);

    // 5. Crush Physics (Traffic vehicles & Props)
    this.#applyCrushPhysics(dt);

    // 6. Update Cannon Shell Projectiles
    this.#updateProjectiles(dt);
  }

  fire() {
    this.reloadTime = this.reloadCooldown;
    this.recoil = 1.0;

    if (this.muzzleFlash) {
      this.muzzleFlash.intensity = 500;
    }

    // Cannon muzzle world position and trajectory: from the barrel itself, so the shell leaves the muzzle you can see
    const totalYaw = this.yaw + this.turretYaw;
    const dirX = Math.cos(totalYaw), dirZ = -Math.sin(totalYaw);
    this.mesh.updateMatrixWorld(true);
    this.barrelGroup.localToWorld(_muzzle.set(MUZZLE_X + 0.1, 0, 0));
    const muzzleX = _muzzle.x, muzzleY = _muzzle.y, muzzleZ = _muzzle.z;

    const shellSpeed = 120.0; // m/s
    const shell = {
      x: muzzleX,
      y: muzzleY,
      z: muzzleZ,
      vx: dirX * shellSpeed,
      vy: 1.5,
      vz: dirZ * shellSpeed,
      life: 2.5,
    };

    // Glowing tracer shell (shared geometry and material)
    const tracer = new THREE.Mesh(TRACER_GEO, TRACER_MAT);
    tracer.position.set(shell.x, shell.y, shell.z);
    this.scene.add(tracer);
    shell.mesh = tracer;

    this.projectiles.push(shell);

    // Tank hull recoil impulse
    this.fwdSpeed -= 2.2;
    this.impact = 0.8;
  }

  #updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.vy -= 9.8 * dt; // shell gravity drop
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      if (p.mesh) {
        p.mesh.position.set(p.x, p.y, p.z);
      }

      // Check impact with ground
      const groundY = this.world?.district?.elevationAt?.(p.x, p.z) ?? 0;
      const hitGround = p.y <= groundY + 0.2;

      // Check impact with buildings
      let hitBuilding = false;
      const buildings = this.world?.nearbyBuildings ? this.world.nearbyBuildings(p.x, p.z) : [];
      for (const b of buildings) {
        const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
        const rx = p.x - b.x, rz = p.z - b.z;
        const lx = rx * ca + rz * sa, lz = -rx * sa + rz * ca;
        if (Math.abs(lx) < b.hw && Math.abs(lz) < b.hd && p.y < (b.height ?? 30)) {
          hitBuilding = true;
          break;
        }
      }

      if (hitGround || hitBuilding || p.life <= 0) {
        this.#detonateShell(p.x, p.y, p.z);
        if (p.mesh) this.scene.remove(p.mesh);   // geometry and material are shared: nothing to dispose
        this.projectiles.splice(i, 1);
      }
    }
  }

  #detonateShell(x, y, z) {
    // Blast shockwave pushing away vehicles and smashing objects
    if (this.debris?.breakNear) {
      this.debris.breakNear(x, z, 7.5, this, 35);
    }

    if (this.traffic?.cars) {
      const blastRadius = 14.0;
      for (const car of this.traffic.cars) {
        if (!car.live) continue;
        const dx = car.x - x, dz = car.z - z;
        const dist = Math.hypot(dx, dz);
        if (dist < blastRadius && dist > 0.1) {
          const force = (1.0 - dist / blastRadius) * 45.0;
          car.vx = (car.vx || 0) + (dx / dist) * force;
          car.vz = (car.vz || 0) + (dz / dist) * force;
          car.health = Math.max(0, (car.health || 100) - 80);
          if (car.health <= 0 && car.explode) car.explode();
        }
      }
    }
  }

  #applyCrushPhysics(dt) {
    // 1. Smash breakable props directly in front
    if (this.debris?.breakNear && this.speed > 1.5) {
      this.debris.breakNear(this.x, this.z, 3.8, this, Math.max(12, this.speed));
    }

    // 2. Crush traffic vehicles under 55-ton tracks
    if (this.traffic?.cars) {
      for (const car of this.traffic.cars) {
        if (!car.live) continue;
        const dx = car.x - this.x, dz = car.z - this.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 3.8) {
          // Push car violently and squash it
          const pushAngle = Math.atan2(dz, dx);
          const pushForce = Math.max(12, this.speed * 2.5);
          car.vx = (car.vx || 0) + Math.cos(pushAngle) * pushForce;
          car.vz = (car.vz || 0) + Math.sin(pushAngle) * pushForce;
          if (car.mesh) {
            car.mesh.scale.y = Math.max(0.35, (car.mesh.scale.y || 1) - 0.15);
          }
          this.impact = 0.5;
        }
      }
    }
  }

  solid() {
    return {
      x: this.x,
      z: this.z,
      yaw: this.yaw,
      radius: 3.5,
      reach: 6.8,
      vx: this.vx,
      vz: this.vz,
      tag: 'tank',
    };
  }

  onMap() {
    return {
      x: this.x,
      z: this.z,
      yaw: this.yaw,
      type: 'tank',
      icon: 'tank',
    };
  }
}
