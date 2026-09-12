import * as THREE from 'three';
import { Vehicle } from './vehicle.js';
import { M4, mergeGeos } from '../core/geometry.js';

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

  #buildModel(sharedFlash) {
    const group = new THREE.Group();
    group.name = 'RhinoTank';

    const armorMat = new THREE.MeshStandardMaterial({
      color: 0x364032, // Military Olive Drab
      roughness: 0.8,
      metalness: 0.22,
    });
    const darkSteel = new THREE.MeshStandardMaterial({
      color: 0x1a1e22,
      roughness: 0.65,
      metalness: 0.5,
    });
    const treadMat = new THREE.MeshStandardMaterial({
      color: 0x111417,
      roughness: 0.9,
      metalness: 0.2,
    });

    // Lower & upper hull
    const hullGeo = createTankHullGeometry();
    const hullMesh = new THREE.Mesh(hullGeo, armorMat);
    hullMesh.castShadow = true;
    hullMesh.receiveShadow = true;
    group.add(hullMesh);

    // Left and right track assemblies
    for (const side of [-1, 1]) {
      const track = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.95, 0.72), treadMat);
      track.position.set(0, 0.48, side * 1.65);
      track.castShadow = true;
      group.add(track);

      // Track skirt armor plates
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.55, 0.08), armorMat);
      skirt.position.set(0, 0.68, side * 2.05);
      skirt.castShadow = true;
      group.add(skirt);
    }

    // Rotating Turret Group
    const turretGroup = new THREE.Group();
    turretGroup.position.set(-0.2, 1.35, 0);

    const turretMesh = new THREE.Mesh(createTurretGeometry(), armorMat);
    turretMesh.castShadow = true;
    turretGroup.add(turretMesh);

    // Cannon Mantlet and Barrel
    const mantlet = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.65, 0.95), darkSteel);
    mantlet.position.set(1.4, 0.15, 0);
    turretGroup.add(mantlet);

    const barrelGroup = new THREE.Group();
    barrelGroup.position.set(1.6, 0.15, 0);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 4.4, 10), darkSteel);
    barrel.rotation.z = -Math.PI / 2;
    barrel.position.set(2.2, 0, 0);
    barrel.castShadow = true;
    barrelGroup.add(barrel);

    // Muzzle brake
    const brake = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.44), darkSteel);
    brake.position.set(4.35, 0, 0);
    barrelGroup.add(brake);

    turretGroup.add(barrelGroup);
    this.barrelGroup = barrelGroup;

    group.add(turretGroup);
    this.turretGroup = turretGroup;

    // Muzzle flash light
    // shared with DispatchService when given: a new scene light recompiles every pipeline (see flight.js)
    const flash = sharedFlash || new THREE.PointLight(0xffaa33, 0, 16);
    flash.position.set(6.0, 1.5, 0);
    group.add(flash);
    this.muzzleFlash = flash;

    group.position.set(this.x, this.y, this.z);
    this.scene.add(group);
    this.mesh = group;
  }

  enter(player) {
    super.enter(player);
    if (this.muzzleFlash && this.mesh) this.mesh.add(this.muzzleFlash);   // the shared flash rides the tank being driven
  }

  update(input, dt, context = {}) {
    if (this.reloadTime > 0) {
      this.reloadTime = Math.max(0, this.reloadTime - dt);
    }
    if (this.recoil > 0) {
      this.recoil = Math.max(0, this.recoil - dt * 4.5);
      if (this.barrelGroup) this.barrelGroup.position.x = 1.6 - this.recoil * 0.45;
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

    // Cannon muzzle world position and trajectory
    const totalYaw = this.yaw + this.turretYaw;
    const dirX = Math.cos(totalYaw), dirZ = -Math.sin(totalYaw);
    const muzzleX = this.x + dirX * 5.8;
    const muzzleY = this.y + 1.5;
    const muzzleZ = this.z + dirZ * 5.8;

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

    // Create glowing tracer shell mesh
    const tracer = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffdd44 }),
    );
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
        if (p.mesh) {
          this.scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
        }
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

function createTankHullGeometry() {
  const parts = [];
  // Main lower hull
  const lower = new THREE.BoxGeometry(6.2, 0.8, 3.2);
  lower.applyMatrix4(M4(0, 0.5, 0));
  parts.push(lower);

  // Sloped glacis front
  const front = new THREE.BoxGeometry(1.6, 0.6, 3.1);
  front.applyMatrix4(M4(2.6, 0.65, 0, 0, 0, -0.35));
  parts.push(front);

  // Rear engine deck
  const rear = new THREE.BoxGeometry(2.0, 0.75, 3.1);
  rear.applyMatrix4(M4(-2.0, 0.75, 0));
  parts.push(rear);

  return mergeGeos(parts);
}

function createTurretGeometry() {
  const parts = [];
  // Faceted turret body
  const base = new THREE.BoxGeometry(2.8, 0.85, 2.4);
  base.applyMatrix4(M4(0, 0.42, 0));
  parts.push(base);

  // Sloped turret cheeks
  const cheek = new THREE.BoxGeometry(1.4, 0.7, 1.8);
  cheek.applyMatrix4(M4(0.8, 0.45, 0, 0, 0, -0.2));
  parts.push(cheek);

  // Commander cupola
  const cupola = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 8);
  cupola.applyMatrix4(M4(-0.4, 0.95, 0.55));
  parts.push(cupola);

  return mergeGeos(parts);
}
