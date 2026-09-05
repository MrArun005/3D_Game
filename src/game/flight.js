import * as THREE from 'three';
import { Vehicle } from './vehicle.js';
import { M4, mergeGeos } from '../core/geometry.js';

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

    this.#buildModel();
  }

  #buildModel() {
    const group = new THREE.Group();
    group.name = 'Helicopter';

    // ── Materials ──
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x16202c, roughness: 0.38, metalness: 0.42,
    });
    const canopyMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a3a5c, roughness: 0.05, metalness: 0.1,
      transmission: 0.6, thickness: 0.3, ior: 1.5,
      transparent: true, opacity: 0.72, side: THREE.DoubleSide,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xc0c8d4, roughness: 0.15, metalness: 0.92,
    });
    const rotorMat = new THREE.MeshStandardMaterial({
      color: 0x0f151c, roughness: 0.3, metalness: 0.6,
    });
    const hazardMat = new THREE.MeshStandardMaterial({
      color: 0xf0a818, roughness: 0.4, metalness: 0.2,
    });
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xe6eef8, roughness: 0.5,
    });
    const navRedMat = new THREE.MeshStandardMaterial({
      color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 2.0,
    });
    const navGreenMat = new THREE.MeshStandardMaterial({
      color: 0x20ff40, emissive: 0x20ff40, emissiveIntensity: 2.0,
    });
    const beaconMat = new THREE.MeshStandardMaterial({
      color: 0xff3030, emissive: 0xff3030, emissiveIntensity: 3.0,
    });

    // ── Fuselage (merged hull) ──
    const hull = new THREE.Mesh(createHeliHullGeometry(), bodyMat);
    hull.castShadow = true;
    hull.receiveShadow = true;
    group.add(hull);

    // ── Cockpit canopy glass (wrap-around tinted) ──
    const canopyGeo = new THREE.SphereGeometry(
      1.25, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55,
    );
    canopyGeo.applyMatrix4(M4(1.1, 0.28, 0, 0, 0, 0, 1.35, 0.88, 1.06));
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    group.add(canopy);

    // ── Decorative side stripes ──
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.35, 0.06), stripeMat);
    stripe.position.set(-0.2, 0.1, 1.06);
    group.add(stripe);
    const stripe2 = stripe.clone();
    stripe2.position.z = -1.06;
    group.add(stripe2);

    // ── Twin turboshaft engine nacelles ──
    for (const side of [-1, 1]) {
      const nacelle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.32, 1.6, 10),
        bodyMat,
      );
      nacelle.rotation.z = Math.PI / 2;
      nacelle.position.set(-0.8, 1.08, side * 0.52);
      nacelle.castShadow = true;
      group.add(nacelle);

      // Chrome exhaust nozzle
      const exhaust = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.19, 0.28, 8),
        chromeMat,
      );
      exhaust.rotation.z = Math.PI / 2;
      exhaust.position.set(-1.65, 1.08, side * 0.52);
      group.add(exhaust);
    }

    // ── FLIR camera pod (under nose) ──
    const flir = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), chromeMat);
    flir.position.set(2.15, -0.78, 0);
    group.add(flir);

    // ── Landing skids (curved aluminum) ──
    for (const side of [-1, 1]) {
      // Main skid runner
      const skid = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 4.2, 6),
        chromeMat,
      );
      skid.rotation.z = Math.PI / 2;
      skid.position.set(-0.1, -1.4, side * 0.9);
      skid.castShadow = true;
      group.add(skid);

      // Front curve (toe)
      const toe = new THREE.Mesh(
        new THREE.TorusGeometry(0.32, 0.06, 6, 6, Math.PI * 0.5),
        chromeMat,
      );
      toe.position.set(2.0, -1.08, side * 0.9);
      toe.rotation.z = Math.PI * 0.5;
      group.add(toe);

      // Cross-struts
      for (const at of [-0.9, 0.85]) {
        const strut = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.06, 0.8, 6),
          chromeMat,
        );
        strut.position.set(at, -1.0, side * 0.9);
        strut.castShadow = true;
        group.add(strut);
      }
    }

    // ── Main rotor assembly ──
    const rotor = new THREE.Group();

    // Swashplate hub
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.35, 0.18, 12),
      chromeMat,
    );
    rotor.add(hub);

    // 4 composite blades with yellow hazard tips
    for (let i = 0; i < 4; i++) {
      const bg = new THREE.Group();
      bg.rotation.y = (i / 4) * Math.PI * 2;

      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(10.4, 0.08, 0.46), rotorMat,
      );
      blade.castShadow = true;
      bg.add(blade);

      // Yellow hazard tip at each end of the blade
      const tipA = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.09, 0.47), hazardMat,
      );
      tipA.position.x = 5.55;
      bg.add(tipA);
      const tipB = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.09, 0.47), hazardMat,
      );
      tipB.position.x = -5.55;
      bg.add(tipB);

      rotor.add(bg);
    }

    // Translucent rotor disc
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(6.1, 28),
      new THREE.MeshBasicMaterial({
        color: 0xa0b4c8, transparent: true, opacity: 0.12,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    rotor.add(disc);
    rotor.position.set(-0.1, 1.55, 0);
    group.add(rotor);
    this.rotor = rotor;
    this.disc = disc;

    // ── Tail rotor with fenestron ring ──
    const tailGroup = new THREE.Group();
    const fenestron = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.1, 8, 16),
      bodyMat,
    );
    fenestron.rotation.y = Math.PI / 2;
    tailGroup.add(fenestron);

    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 1.05, 0.2), rotorMat,
      );
      blade.rotation.x = (i / 4) * Math.PI * 2;
      tailGroup.add(blade);
    }
    tailGroup.position.set(-5.35, 0.55, 0.24);
    group.add(tailGroup);
    this.tail = tailGroup;

    // ── Navigation lights ──
    // Port (left) – red
    const navRed = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.08, 0.08), navRedMat,
    );
    navRed.position.set(0.5, 0.0, -1.12);
    group.add(navRed);

    // Starboard (right) – green
    const navGreen = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.08, 0.08), navGreenMat,
    );
    navGreen.position.set(0.5, 0.0, 1.12);
    group.add(navGreen);

    // Anti-collision beacon (top of mast)
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 6, 4), beaconMat,
    );
    beacon.position.set(-0.1, 1.72, 0);
    group.add(beacon);
    this.beacon = beacon;

    // White tail strobe
    const tailStrobe = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.08, 0.08),
      new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.0,
      }),
    );
    tailStrobe.position.set(-5.5, 1.6, 0);
    group.add(tailStrobe);
    this.tailStrobe = tailStrobe;

    // ── Searchlight ──
    const spot = new THREE.SpotLight(0xf4f8ff, 800, 160, 0.24, 0.5, 1.2);
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

/** Premium fuselage geometry: aerodynamic nose, sculpted cabin, chin fairing,
 *  tail boom, vertical & horizontal stabilizers, engine deck, and rotor mast. */
function createHeliHullGeometry() {
  const parts = [];

  // Main cabin – wide sculpted body
  const cabin = new THREE.SphereGeometry(1.55, 14, 10);
  cabin.applyMatrix4(M4(0, 0, 0, 0, 0, 0, 1.6, 0.98, 1.08));
  parts.push(cabin);

  // Nose – sharper aerodynamic profile
  const nose = new THREE.SphereGeometry(1.1, 12, 10);
  nose.applyMatrix4(M4(2.0, -0.18, 0, 0, 0, 0, 1.3, 0.78, 0.92));
  parts.push(nose);

  // Chin (ventral fairing under nose for avionics)
  const chin = new THREE.SphereGeometry(0.48, 8, 6);
  chin.applyMatrix4(M4(1.4, -0.65, 0, 0, 0, 0, 0.9, 0.5, 0.7));
  parts.push(chin);

  // Tail boom – long tapering cylinder
  const boom = new THREE.CylinderGeometry(0.2, 0.46, 5.0, 8);
  boom.applyMatrix4(M4(-3.5, 0.48, 0, 0, 0, Math.PI / 2));
  parts.push(boom);

  // Vertical fin (stabilizer)
  const fin = new THREE.BoxGeometry(1.2, 1.8, 0.14);
  fin.applyMatrix4(M4(-5.4, 1.15, 0));
  parts.push(fin);

  // Horizontal stabilizer wings
  const hstab = new THREE.BoxGeometry(0.6, 0.1, 2.2);
  hstab.applyMatrix4(M4(-5.0, 0.72, 0));
  parts.push(hstab);

  // Rotor mast
  const mast = new THREE.CylinderGeometry(0.18, 0.24, 0.95, 8);
  mast.applyMatrix4(M4(-0.1, 1.14, 0));
  parts.push(mast);

  // Engine deck fairing (between nacelles)
  const deck = new THREE.BoxGeometry(1.8, 0.22, 1.0);
  deck.applyMatrix4(M4(-0.6, 0.98, 0));
  parts.push(deck);

  return mergeGeos(parts);
}
