import * as THREE from 'three';
import { Vehicle } from './vehicle.js';
import { buildHeliModel } from '../world/heliModel.js';

/**
 * Arcade Helicopter Flight Model.
 *
 * Controls:
 *   W          — pitch nose down, fly forward (auto-cruise altitude hold)
 *   S          — flare nose up, aerodynamic brake / gentle descent when slow
 *   SPACE      — dedicated rapid vertical climb
 *   SHIFT / C  — dedicated descent / landing
 *   A / D      — yaw turn with coordinated banking
 *   Q / E      — lateral strafe
 *   NOS        — turbo boost
 *
 * Features:
 * - 3-axis arcade aerodynamics (collective climb/pitch, cyclic bank/strafe, rudder yaw)
 * - Turbine boost surge
 * - Auto-leveling attitude stabilization
 * - Ground cushion effect (< 8m) for silky smooth landings
 * - Cruise altitude hold when flying forward
 * - Rotor spool-up / spool-down dynamics
 * - Full 3D rooftop, building, and ground collision
 * - Dedicated downwash dust ring on ground / roofs
 * - Premium 3D model: cockpit canopy glass, twin turbines, fenestron, nav lights
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
    this.maxSpeed = 52;           // m/s (~190 km/h)
    this.boostSpeed = 68;         // m/s
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

    this.#buildModel(options.spot);
  }

  #buildModel(sharedSpot) {
    /* The machine is world/heliModel.js, in civil livery -- the same H135-mould
       model the police fly. The old one was ~30 meshes and a transmission
       canopy (a second opaque-scene render every frame it was on screen). */
    const model = buildHeliModel({ livery: 'civil' });
    const group = model.group;
    this.rotor = model.rotor;
    this.disc = model.disc;
    this.tail = model.tail;          // the fenestron fan: spins about Z (lateral)
    this.beacon = model.beacon;
    this.tailStrobe = model.tailStrobe;

    // ── Searchlight ──
    /* Shared with DispatchService when it hands one over: a light ADDED to the
       scene at runtime changes every material's light count, and the WebGPU
       backend recompiles every pipeline -- measured 2 s of zero frames the
       moment a helicopter was dispatched (2026-09-12). The dispatcher's light
       has been in the scene since boot, so borrowing it costs nothing. */
    const spot = sharedSpot || new THREE.SpotLight(0xf4f8ff, 800, 160, 0.24, 0.5, 1.2);
    spot.position.set(1.2, -0.6, 0);
    spot.target.position.set(1.2, -50, 0);
    group.add(spot, spot.target);
    this.spot = spot;

    // Ground downwash dust ring
    const downwash = new THREE.Mesh(
      new THREE.RingGeometry(2.0, 5.5, 24),
      new THREE.MeshBasicMaterial({
        color: 0xd8e4f0, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false,
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
    if (this.spot) { this.mesh?.add(this.spot, this.spot.target); this.spot.intensity = 800; }   // a shared searchlight follows whichever helicopter is flown
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
    if (this.tail) this.tail.rotation.z = this.tailRotorAngle;
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
        // SPACE: dedicated rapid vertical climb
        collectiveClimb = 1.0;
        this.landed = false;
      } else if (input.hold || context.keys?.KeyC) {
        // SHIFT / C: dedicated descent
        collectiveClimb = -1.0;
      } else if ((input.throttle || 0) > 0.08) {
        // W: forward flight with automatic altitude hold.
        // Near ground or landed, W also lifts off gently.
        if (this.landed || this.altitudeAboveGround < 5.0) {
          collectiveClimb = 0.6;
          this.landed = false;
        }
        // When aloft (> 5m), collectiveClimb stays 0:
        // pure forward cruise with strong vertical damping holds altitude.
      } else if ((input.brake || 0) > 0.1 && Math.abs(this.fwdSpeed) < 8.0) {
        // S while hovering or slow: smooth landing descent
        collectiveClimb = -0.4;
      }
    }

    // 3. Flight dynamics
    const pwr = Math.min(1, this.rotorRpm / 0.65);

    // Yaw dynamics
    const wantYawRate = pedalYaw * this.yawSpeed * pwr;
    this.yawRate += (wantYawRate - this.yawRate) * Math.min(1, dt * 5.0);
    this.yaw += this.yawRate * dt;

    // Pitch attitude:
    // At altitude, deep nose-down tilt (0.44 rad) for fast forward flight (~190 km/h).
    // Near ground, limited pitch to prevent skids digging in during takeoff.
    const pitchLimit = this.altitudeAboveGround < 3.0 ? 0.15 : 0.44;
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
      // Stronger vertical damping during cruise (collectiveClimb ≈ 0) gives
      // rock-solid altitude hold while flying forward with W.
      const vertDrag = collectiveClimb === 0 ? 2.2 : 0.85;
      const netVerticalAcc = baseLift + verticalThrust + cushion - 9.8 - this.vy * vertDrag;
      this.vy += netVerticalAcc * dt;
    }

    // 6. Horizontal Aerodynamics & Thrust
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const fwdX = cy, fwdZ = -sy;
    const rgtX = sy, rgtZ = cy;

    const fwdThrustMult = boost ? 1.45 : 1.0;
    // Pitch-based aerodynamic thrust (main source of forward speed)
    // plus a direct forward impulse when W is held for snappy response.
    const directFwd = (input?.throttle || 0) > 0.08 && !this.landed ? 8.0 : 0;
    const fwdForce = -this.pitch * 48.0 * pwr * fwdThrustMult + directFwd * pwr;
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

    // 9. Nav beacon strobe (uses rotor angle as clock, zero allocations)
    if (this.beacon) {
      const flash = (this.rotorAngle * 0.3) % 6.28;
      this.beacon.material.emissiveIntensity = flash < 0.5 ? 5.0 : 0.3;
    }
    if (this.tailStrobe) {
      const flash2 = ((this.rotorAngle * 0.3) + 3.14) % 6.28;
      this.tailStrobe.material.emissiveIntensity = flash2 < 0.4 ? 4.0 : 0.2;
    }

    // 10. Downwash Particle FX
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
