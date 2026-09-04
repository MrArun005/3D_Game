import * as THREE from 'three';
import { Vehicle } from './vehicle.js';
import { M4, mergeGeos } from '../core/geometry.js';

/**
 * Arcade Helicopter Flight Model.
 * 
 * Features:
 * - 3-axis arcade aerodynamics (collective climb/pitch, cyclic bank/strafe, rudder yaw)
 * - Turbine boost surge (Shift / NOS)
 * - Auto-leveling attitude stabilization
 * - Ground cushion effect (< 8m) for silky smooth landings
 * - Rotor spool-up / spool-down dynamics
 * - Full 3D rooftop, building, and ground collision
 * - Dedicated downwash dust ring on ground / roofs
 * - Custom chase camera rig with look-down angle
 */
export class HelicopterVehicle extends Vehicle {
  constructor(scene, world, options = {}) {
    super('helicopter');
    this.scene = scene;
    this.world = world;

    // Position & Orientation
    this.x = options.x || 0;
    this.y = options.y || 1.2;
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

    // Flight parameters
    this.maxSpeed = 48;           // m/s
    this.boostSpeed = 66;         // m/s
    this.climbRate = 16;          // m/s max vertical rate
    this.yawSpeed = 2.2;          // rad/s
    this.autoLevelRate = 4.2;     // restoring rate
    this.cushionHeight = 8.0;     // ground effect altitude
    this.minGroundClearance = 1.25;

    // Rotor spool
    this.rotorRpm = options.running ? 1.0 : 0.0;
    this.rotorTargetRpm = options.running ? 1.0 : 0.0;
    this.rotorAngle = 0;
    this.tailRotorAngle = 0;

    this.landed = true;
    this.altitudeAboveGround = 0;
    this.health = 100;
    this.impact = 0;

    // Custom Chase Camera Rig for Helicopter
    this.customRig = {
      back: 18.0,
      up: 6.2,
      aim: 14.0,
      fov: 65,
      lag: 4.0,
      tilt: 1,
    };

    this.#buildModel();
  }

  #buildModel() {
    const group = new THREE.Group();
    group.name = 'Helicopter';

    const dark = new THREE.MeshStandardMaterial({
      color: 0x16202c,
      roughness: 0.45,
      metalness: 0.35,
    });
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xe6eef8,
      roughness: 0.5,
    });
    const rotorMat = new THREE.MeshStandardMaterial({
      color: 0x0f151c,
      roughness: 0.3,
      metalness: 0.6,
    });

    // Fuselage
    const hull = new THREE.Mesh(createHeliHullGeometry(), dark);
    hull.castShadow = true;
    hull.receiveShadow = true;
    group.add(hull);

    // Decorative side stripes
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.35, 0.06), stripeMat);
    stripe.position.set(-0.2, 0.1, 1.04);
    group.add(stripe);
    const stripe2 = stripe.clone();
    stripe2.position.z = -1.04;
    group.add(stripe2);

    // Skids
    for (const side of [-1, 1]) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.12, 0.14), dark);
      skid.position.set(-0.1, -1.35, side * 0.88);
      skid.castShadow = true;
      group.add(skid);
      for (const at of [-1.0, 0.8]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.75, 0.12), dark);
        leg.position.set(at, -0.98, side * 0.88);
        leg.castShadow = true;
        group.add(leg);
      }
    }

    // Main rotor: 4 blades + translucent disc
    const rotor = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(11.8, 0.08, 0.44), rotorMat);
      blade.rotation.y = (i / 4) * Math.PI * 2;
      blade.castShadow = true;
      rotor.add(blade);
    }
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(6.1, 28),
      new THREE.MeshBasicMaterial({
        color: 0xa0b4c8,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    rotor.add(disc);
    rotor.position.set(-0.1, 1.52, 0);
    group.add(rotor);
    this.rotor = rotor;
    this.disc = disc;

    // Tail rotor
    const tail = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.0, 0.24), rotorMat);
      blade.rotation.x = (i / 3) * Math.PI * 2;
      tail.add(blade);
    }
    tail.position.set(-5.3, 0.55, 0.24);
    group.add(tail);
    this.tail = tail;

    // Searchlight
    const spot = new THREE.SpotLight(0xf4f8ff, 800, 160, 0.24, 0.5, 1.2);
    spot.position.set(1.2, -0.6, 0);
    spot.target.position.set(1.2, -50, 0);
    group.add(spot, spot.target);
    this.spot = spot;

    // Ground downwash dust ring
    const downwash = new THREE.Mesh(
      new THREE.RingGeometry(2.0, 5.5, 24),
      new THREE.MeshBasicMaterial({
        color: 0xd8e4f0,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    downwash.rotation.x = -Math.PI / 2;
    downwash.visible = false;
    this.scene.add(downwash);
    this.downwash = downwash;

    group.position.set(this.x, this.y, this.z);
    this.scene.add(group);
    this.mesh = group;
  }

  enter(player) {
    super.enter(player);
    this.rotorTargetRpm = 1.0;
    if (this.spot) this.spot.intensity = 800;
  }

  exit() {
    super.exit();
    this.rotorTargetRpm = 0.0;
    if (this.spot) this.spot.intensity = 0;
  }

  update(input, dt, context = {}) {
    const isPiloted = !!this.driver;
    if (isPiloted) {
      this.rotorTargetRpm = 1.0;
    }

    // 1. Rotor spool-up / spool-down
    const spoolRate = this.rotorTargetRpm > this.rotorRpm ? 0.65 : 0.35;
    this.rotorRpm += (this.rotorTargetRpm - this.rotorRpm) * Math.min(1, dt * spoolRate);
    this.rotorAngle += dt * 38 * this.rotorRpm;
    this.tailRotorAngle += dt * 56 * this.rotorRpm;

    if (this.rotor) this.rotor.rotation.y = this.rotorAngle;
    if (this.tail) this.tail.rotation.x = this.tailRotorAngle;
    if (this.disc) this.disc.material.opacity = 0.16 * this.rotorRpm;

    // Ground elevation & surface
    const groundElev = this.world?.district?.elevationAt?.(this.x, this.z) ?? 0;
    const roofSurface = this.#getSurfaceUnderneath(this.x, this.z, this.y, groundElev);
    const groundLevel = roofSurface.y;
    this.altitudeAboveGround = Math.max(0, this.y - groundLevel);

    // If unpiloted, helicopter stays firmly grounded on its skids (zero phantom hover)
    if (!isPiloted) {
      const restingY = groundLevel + this.minGroundClearance;
      if (this.y <= restingY + 0.5) {
        this.y = restingY;
        this.vy = 0;
        this.vx = 0;
        this.vz = 0;
        this.landed = true;
      } else {
        // Fall under gravity to ground if spawned in air
        this.vy -= 9.8 * dt;
        this.y += this.vy * dt;
        if (this.y <= restingY) {
          this.y = restingY;
          this.vy = 0;
          this.landed = true;
        }
      }
      this.pitch = 0;
      this.roll = 0;
      this.yawRate = 0;
      if (this.mesh) {
        this.mesh.position.set(this.x, this.y, this.z);
        this.mesh.rotation.set(0, this.yaw, 0);
      }
      if (this.downwash) this.downwash.visible = false;
      return;
    }

    // 2. Control inputs for piloted flight
    let throttleFwd = 0;
    let pedalYaw = 0;
    let collectiveClimb = 0;
    let strafeRoll = 0;
    let boost = false;

    if (input && this.rotorRpm > 0.25) {
      throttleFwd = (input.throttle || 0) - (input.brake || 0); // W/S or ArrowUp/ArrowDown
      pedalYaw = -(input.steer || 0);                           // A/D or ArrowLeft/ArrowRight
      boost = !!input.nos;

      // Secondary strafe roll with Q / E
      if (context.keys?.KeyQ) strafeRoll -= 1;
      if (context.keys?.KeyE) strafeRoll += 1;

      // Collective vertical climb / descend logic:
      if (input.handbrake) {
        // Dedicated rapid vertical climb (SPACE)
        collectiveClimb = 1.0;
        this.landed = false;
      } else if (input.hold || context.keys?.KeyC) {
        // Dedicated descent (SHIFT or C)
        collectiveClimb = -1.0;
      } else if ((input.throttle || 0) > 0.08) {
        // Forward key (W or ArrowUp):
        // When landed or near ground (< 10m), holding W lifts off and climbs smoothly!
        // When cruising aloft, holding W provides positive climb assist (0.45)
        // so forward flight effortlessly gains altitude over city buildings!
        if (this.landed || this.altitudeAboveGround < 10.0) {
          collectiveClimb = 1.0;
          this.landed = false;
        } else {
          collectiveClimb = 0.45;
        }
      } else if ((input.brake || 0) > 0.1 && Math.abs(this.fwdSpeed) < 8.0) {
        // Brake / Reverse key (S) while hovering or slow: smooth landing descent
        collectiveClimb = -0.6;
      }
    }

    // 3. Flight dynamics
    const pwr = Math.min(1, this.rotorRpm / 0.65);

    // Yaw dynamics
    const wantYawRate = pedalYaw * this.yawSpeed * pwr;
    this.yawRate += (wantYawRate - this.yawRate) * Math.min(1, dt * 5.0);
    this.yaw += this.yawRate * dt;

    // Pitch attitude:
    // Limit forward pitch near ground so skids don't dig into pavement during takeoff
    const pitchLimit = this.altitudeAboveGround < 3.0 ? 0.14 : 0.35;
    const targetPitch = -throttleFwd * pitchLimit * pwr;
    if (throttleFwd !== 0) {
      this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 4.0);
    } else {
      this.pitch += (0 - this.pitch) * Math.min(1, dt * this.autoLevelRate);
    }

    // Roll attitude: rudder yaw and strafe bank into turns
    const targetRoll = -this.yawRate * 0.22 + strafeRoll * 0.28 * pwr;
    if (pedalYaw !== 0 || strafeRoll !== 0) {
      this.roll += (targetRoll - this.roll) * Math.min(1, dt * 4.2);
    } else {
      this.roll += (0 - this.roll) * Math.min(1, dt * this.autoLevelRate);
    }

    // 4. Ground Cushion (Ground Effect)
    const cushion = (this.altitudeAboveGround < this.cushionHeight && !this.landed)
      ? Math.pow((this.cushionHeight - this.altitudeAboveGround) / this.cushionHeight, 2) * 6.0 * pwr
      : 0;

    // 5. Vertical Lift & Gravity
    const baseLift = this.landed ? 0 : 9.8 * pwr;
    const climbMult = boost ? 1.35 : 1.0;
    const verticalThrust = collectiveClimb * this.climbRate * pwr * climbMult;

    if (this.landed && collectiveClimb <= 0.05) {
      this.vy = 0;
    } else {
      this.landed = false;
      const netVerticalAcc = baseLift + verticalThrust + cushion - 9.8 - this.vy * 0.85;
      this.vy += netVerticalAcc * dt;
    }

    // 6. Horizontal Aerodynamics & Thrust
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const fwdX = cy, fwdZ = -sy;
    const rgtX = sy, rgtZ = cy;

    const fwdThrustMult = boost ? 1.45 : 1.0;
    const fwdForce = -this.pitch * 60.0 * pwr * fwdThrustMult;
    const rgtForce = -this.roll * 38.0 * pwr;

    const ax = fwdX * fwdForce + rgtX * rgtForce - this.vx * 0.55;
    const az = fwdZ * fwdForce + rgtZ * rgtForce - this.vz * 0.55;

    this.vx += ax * dt;
    this.vz += az * dt;

    // Update positions
    const nextX = this.x + this.vx * dt;
    const nextY = this.y + this.vy * dt;
    const nextZ = this.z + this.vz * dt;

    // 7. Collision Resolution
    this.#resolveCollisions(nextX, nextY, nextZ, groundLevel, roofSurface, dt);

    this.speed = Math.hypot(this.vx, this.vy, this.vz);
    this.fwdSpeed = this.vx * fwdX + this.vz * fwdZ;

    // 8. Pose Mesh
    if (this.mesh) {
      this.mesh.position.set(this.x, this.y, this.z);
      this.mesh.rotation.set(0, this.yaw, 0);
      this.mesh.rotateZ(-this.roll);
      this.mesh.rotateX(this.pitch);
    }

    // 9. Downwash Particle FX
    if (this.downwash) {
      if (this.rotorRpm > 0.25 && this.altitudeAboveGround < 18) {
        this.downwash.visible = true;
        this.downwash.position.set(this.x, groundLevel + 0.08, this.z);
        const s = 1.0 + (18 - this.altitudeAboveGround) * 0.45;
        this.downwash.scale.set(s, s, 1);
        this.downwash.material.opacity = (1 - this.altitudeAboveGround / 18) * 0.35 * this.rotorRpm;
      } else {
        this.downwash.visible = false;
      }
    }

    // Decay impact
    if (this.impact > 0) this.impact = Math.max(0, this.impact - dt * 4);
  }

  #getSurfaceUnderneath(x, z, currentY, groundElev) {
    let highestY = groundElev;
    let surfaceType = 'ground';

    // Check buildings for open rooftops / helipads
    const buildings = this.world?.nearbyBuildings ? this.world.nearbyBuildings(x, z) : [];
    for (const b of buildings) {
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
      const rx = x - b.x, rz = z - b.z;
      const lx = rx * ca + rz * sa, lz = -rx * sa + rz * ca;
      if (Math.abs(lx) < b.hw && Math.abs(lz) < b.hd) {
        const roofH = (b.height ?? 30);
        if (roofH > highestY && currentY >= roofH - 1.5) {
          highestY = roofH;
          surfaceType = 'roof';
        }
      }
    }

    return { y: highestY, type: surfaceType };
  }

  #resolveCollisions(nx, ny, nz, groundLevel, surface, dt) {
    const minY = groundLevel + this.minGroundClearance;

    // Building side wall collision
    const buildings = this.world?.nearbyBuildings ? this.world.nearbyBuildings(nx, nz) : [];
    let hitBuilding = false;
    for (const b of buildings) {
      const roofH = b.height ?? 30;
      if (ny < roofH - 0.5) {
        // Horizontal box collision
        const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
        const rx = nx - b.x, rz = nz - b.z;
        const lx = rx * ca + rz * sa, lz = -rx * sa + rz * ca;
        const hw = b.hw + 2.6, hd = b.hd + 2.6; // helicopter clearance radius
        if (Math.abs(lx) < hw && Math.abs(lz) < hd) {
          // Push out along shortest axis
          const ox = hw - Math.abs(lx);
          const oz = hd - Math.abs(lz);
          if (ox < oz) {
            const push = Math.sign(lx) * ox;
            nx += ca * push;
            nz += sa * push;
            this.vx *= -0.3;
          } else {
            const push = Math.sign(lz) * oz;
            nx -= sa * push;
            nz += ca * push;
            this.vz *= -0.3;
          }
          this.impact = 1.0;
          hitBuilding = true;
          break;
        }
      }
    }

    this.x = nx;
    this.z = nz;

    // Ground / Roof floor landing
    if (ny <= minY) {
      this.y = minY;
      if (this.vy < -5.5) {
        this.impact = Math.min(1.0, Math.abs(this.vy) * 0.15);
      }
      this.vy = 0;
      this.vx *= Math.max(0, 1 - dt * 4.0);
      this.vz *= Math.max(0, 1 - dt * 4.0);
      this.landed = true;
    } else {
      this.y = ny;
      this.landed = false;
    }
  }

  solid() {
    return {
      x: this.x,
      z: this.z,
      yaw: this.yaw,
      radius: 3.2,
      reach: 6.5,
      vx: this.vx,
      vz: this.vz,
      tag: 'helicopter',
    };
  }

  onMap() {
    return {
      x: this.x,
      z: this.z,
      yaw: this.yaw,
      type: 'helicopter',
      icon: 'helicopter',
    };
  }
}

/** Fuselage geometry: aerodynamic nose, cabin, boom, vertical stabilizer, and rotor mast. */
function createHeliHullGeometry() {
  const parts = [];
  const cabin = new THREE.SphereGeometry(1.5, 12, 9);
  cabin.applyMatrix4(M4(0, 0, 0, 0, 0, 0, 1.5, 0.95, 1.05));
  parts.push(cabin);

  const nose = new THREE.SphereGeometry(1.05, 10, 8);
  nose.applyMatrix4(M4(1.85, -0.16, 0, 0, 0, 0, 1.25, 0.82, 0.94));
  parts.push(nose);

  const boom = new THREE.CylinderGeometry(0.22, 0.44, 4.5, 8);
  boom.applyMatrix4(M4(-3.25, 0.45, 0, 0, 0, Math.PI / 2));
  parts.push(boom);

  const fin = new THREE.BoxGeometry(1.0, 1.6, 0.14);
  fin.applyMatrix4(M4(-5.35, 1.05, 0));
  parts.push(fin);

  const mast = new THREE.CylinderGeometry(0.18, 0.22, 0.92, 8);
  mast.applyMatrix4(M4(-0.1, 1.12, 0));
  parts.push(mast);

  return mergeGeos(parts);
}
