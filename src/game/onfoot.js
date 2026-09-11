import * as THREE from 'three';
import { personGeometry } from '../world/beach.js';
import { Character, CHARACTERS } from '../game/character.js';

/**
 * The player, out of the car.
 *
 * This is the gate everything else in the game design sits behind: you cannot
 * steal a car you cannot walk up to, and a gun is only worth building once
 * there is someone holding it. So it stays deliberately small -- walk, look,
 * and be solid against the same world the car collides with. No animation
 * system, no ragdoll, no inventory.
 *
 * Movement is camera-relative because that is what every third-person game
 * trains people to expect: push forward, go where you are looking.
 */

const WALK = 3.2;
const RUN = 7.0;
const ACCEL = 32;
const RADIUS = 0.42;
const GRAVITY = 18.0;
const JUMP_VELOCITY = 5.6;

export class OnFoot {
  constructor(scene) {
    this.x = 0; this.y = 0; this.z = 0;
    this.yaw = 0;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.groundY = 0;
    this.isGrounded = true;
    this.jumpCooldown = 0;
    this.active = false;
    this.bob = 0;
    this.camYaw = 0;
    this.camPitch = 0.08;
    this.camPos = new THREE.Vector3();
    /* The camera eases toward its over-the-shoulder target with a 0.002^dt
       lag, which is right while you walk and wrong the moment you step out:
       camPos was never reset, so the first frames on foot flew in from the
       origin (or from wherever you last got out) -- at low frame rates the
       whole street swooped past and the hero was nowhere in frame. exit()
       arms this and the next update() lands the camera on its target. */
    this.camSnap = true;
    /* Set by main.js each frame from the shooting layer. ads is 0..1 (the
       sights coming up over ADS_BLEND_S), crouch is a toggle. Both only change
       the camera and the feet; the gun reads them separately. */
    this.ads = 0; this.adsFov = 42; this.adsBack = 2.2; this.adsSpeed = 0.5;
    this.crouch = false; this.speed = 0; this.lean = 0;

    const body = new THREE.Mesh(
      personGeometry(),
      new THREE.MeshStandardMaterial({ color: 0x232c3c, roughness: 0.7 }),
    );
    const head = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.135, 1),
      new THREE.MeshStandardMaterial({ color: 0xe0b48c, roughness: 0.8 }),
    );
    head.position.y = 1.53;
    const g = new THREE.Group();
    g.add(body, head);
    g.castShadow = true;
    body.castShadow = true;
    g.visible = false;
    scene.add(g);
    this.group = g;

    /* The blocks above stay as the fallback. If the rigged model loads they
       are hidden and never used again; if it fails you still have a body. */
    /* Which of the characters you are. ?me= picks one; default is Valerie Cross (index 9).
       K cycles in play. */
    const want = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('me') : null;
    const defaultIdx = 2; // MAYA LIN (featured pretty street racer with native animations)
    const charIdx = (want !== null && Number.isFinite(Number(want)))
      ? (((Number(want) % CHARACTERS.length) + CHARACTERS.length) % CHARACTERS.length)
      : defaultIdx;
    this.character = new Character(scene, CHARACTERS[charIdx]);
    this.character.onReady = () => { this.group.visible = false; this.character.show(this.active); };
  }

  /** Step out of the car, standing at the driver's door. */
  exit(car, elevationAt = null) {
    const side = car.yaw + Math.PI / 2;     // left of travel
    this.x = car.x + Math.cos(side) * 1.85;
    this.z = car.z - Math.sin(side) * 1.85;
    this.groundY = elevationAt ? elevationAt(this.x, this.z) : (car.y !== undefined ? car.y - 0.62 : 0);
    this.y = this.groundY;
    this.vy = 0;
    this.isGrounded = true;
    this.yaw = car.yaw;
    this.camYaw = car.yaw;
    this.camPitch = 0.08;
    this.vx = 0; this.vz = 0;
    this.active = true;
    this.camSnap = true;
    if (this.character.ready) this.character.show(true);
    else this.group.visible = true;
  }

  /** Mouse delta, in pixels -- the same free look the chase camera has. */
  look(dx, dy) {
    this.camYaw -= dx * 0.0032;
    this.camPitch = Math.max(-0.6, Math.min(0.9, this.camPitch - dy * 0.0026));
  }

  enter() {
    this.active = false;
    this.vy = 0;
    this.group.visible = false;
    this.character.show(false);
  }

  /**
   * `c` is the shared control read:
   * W/S drive forward/backward along camera look.
   * A/D strafe left/right perpendicular to camera look.
   * Space triggers jump.
   * Shift sprints.
   */
  update(c, dt, camera, solid, elevationAt = null) {
    if (!this.active) return;

    // Movement intent:
    // W/S drive forward/backward along camera look
    // A/D strafe left/right perpendicular to camera look
    const fwd = (c.throttle || 0) - (c.brake || 0);
    const strafe = -(c.steer || 0); // A has c.steer = +1 -> strafe left (-1); D has c.steer = -1 -> strafe right (+1)

    // Camera look vectors in the XZ plane
    const camFwdX = Math.cos(this.camYaw);
    const camFwdZ = -Math.sin(this.camYaw);
    const camRightX = Math.sin(this.camYaw);
    const camRightZ = Math.cos(this.camYaw);

    const inputMag = Math.hypot(fwd, strafe);
    let wantX = 0, wantZ = 0;
    if (inputMag > 0.05) {
      const invMag = 1 / inputMag;
      // sights up or crouched: slower feet, so aiming is a decision
      const gait = (1 - this.ads * (1 - this.adsSpeed)) * (this.crouch ? 0.55 : 1);
      const speedTarget = (c.hold ? RUN : WALK) * Math.min(1, inputMag) * gait;
      wantX = (camFwdX * fwd + camRightX * strafe) * invMag * speedTarget;
      wantZ = (camFwdZ * fwd + camRightZ * strafe) * invMag * speedTarget;
    }

    const accelRate = this.isGrounded ? ACCEL : (ACCEL * 0.45);
    this.vx += (wantX - this.vx) * Math.min(1, dt * accelRate);
    this.vz += (wantZ - this.vz) * Math.min(1, dt * accelRate);

    const nx = this.x + this.vx * dt;
    const nz = this.z + this.vz * dt;
    const [px, pz] = solid ? solid(nx, nz, RADIUS) : [nx, nz];
    this.x = px; this.z = pz;

    // Elevation & ground tracking
    this.groundY = elevationAt ? elevationAt(this.x, this.z) : 0;
    /* Fell through: more than 2.5 m under the ground the sampler reports
       (a hill edge, a quay lip, an elevation seam) and gravity would only
       take you further. Put you back on it. */
    if (this.y < this.groundY - 2.5) { this.y = this.groundY; this.vy = 0; this.isGrounded = true; }

    // Jump trigger
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    if (c.handbrake && this.isGrounded && this.jumpCooldown <= 0) {
      this.vy = JUMP_VELOCITY;
      this.isGrounded = false;
      this.jumpCooldown = 0.35;
    }

    // Vertical airborne dynamics & gravity
    if (!this.isGrounded) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= this.groundY) {
        this.y = this.groundY;
        this.vy = 0;
        this.isGrounded = true;
      }
    } else {
      if (this.y > this.groundY + 0.22) {
        this.isGrounded = false;
        this.vy = 0;
      } else {
        this.y += (this.groundY - this.y) * Math.min(1, dt * 24);
      }
    }

    const speed = Math.hypot(this.vx, this.vz);
    this.speed = speed;                       // read by the weapon sway in main.js
    if (speed > 0.2) {
      const targetYaw = Math.atan2(-this.vz, this.vx);
      let diff = targetYaw - this.yaw;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      this.yaw += diff * Math.min(1, dt * 14);
    }
    this.bob += dt * speed * 2.1;

    if (this.character.ready) {
      this.character.update(dt, this.x, this.y, this.z, this.yaw, speed, this.isGrounded);
    } else {
      this.group.position.set(this.x, this.y + Math.abs(Math.sin(this.bob)) * 0.055, this.z);
      this.group.rotation.y = -this.yaw + Math.PI / 2;
    }

    // Camera: over the shoulder, smoothly tracking position and elevation
    if (camera) {
      // Q leans you out to the right: camera and aim origin slide half a metre,
      // which is what lets you fire round a corner without stepping into the road
      this.lean += (((c.lookBack ? 1 : 0) - this.lean)) * Math.min(1, dt * 10);
      const hipBack = c.hold ? 5.2 : 4.6;
      const back = hipBack + (this.adsBack - hipBack) * this.ads;   // over the shoulder when aiming
      const up = (2.15 - (this.crouch ? 0.45 : 0)) - 0.35 * this.ads;
      const flat = Math.cos(this.camPitch);
      const lx = Math.sin(this.camYaw) * 0.55 * this.lean, lz = Math.cos(this.camYaw) * 0.55 * this.lean;   // right of the look
      const tx = this.x - Math.cos(this.camYaw) * back * flat + lx;
      const tz = this.z + Math.sin(this.camYaw) * back * flat + lz;
      const ty = this.y + up + Math.sin(this.camPitch) * back;
      if (this.camSnap) { this.camPos.set(tx, ty, tz); this.camSnap = false; }
      const k = 1 - Math.pow(0.002, dt);
      this.camPos.x += (tx - this.camPos.x) * k;
      this.camPos.y += (ty - this.camPos.y) * k;
      this.camPos.z += (tz - this.camPos.z) * k;
      camera.position.copy(this.camPos);
      camera.lookAt(
        this.x + Math.cos(this.camYaw) * 6 * flat,
        this.y + 1.35 - Math.sin(this.camPitch) * 3,
        this.z - Math.sin(this.camYaw) * 6 * flat,
      );
      const hipFov = c.hold && speed > 4.8 ? 66 : 60;
      const targetFov = hipFov + (this.adsFov - hipFov) * this.ads;
      if (camera.fov !== undefined && Math.abs(camera.fov - targetFov) > 0.05) {
        camera.fov += (targetFov - camera.fov) * Math.min(1, dt * (this.ads > 0 ? 14 : 8));
        camera.updateProjectionMatrix();
      }
    }
  }
}

/**
 * Push a point out of anything solid. Shares the car's own collision sources,
 * so a wall that stops the car stops you -- there is no second notion of what
 * the world is made of.
 */
export function makeSolver(getBoxes, getBodies) {
  return (x, z, r) => {
    let px = x, pz = z;
    const boxes = getBoxes(px, pz) || [];
    for (const b of boxes) {
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
      const hw = b.hw + r, hd = b.hd + r;
      const dx = px - b.x, dz = pz - b.z;
      const lx = dx * ca + dz * sa, lz = -dx * sa + dz * ca;
      if (Math.abs(lx) >= hw || Math.abs(lz) >= hd) continue;
      const ox = hw - Math.abs(lx), oz = hd - Math.abs(lz);
      let nlx = 0, nlz = 0, pen;
      if (ox < oz) { nlx = lx < 0 ? -1 : 1; pen = ox; } else { nlz = lz < 0 ? -1 : 1; pen = oz; }
      px += (nlx * ca - nlz * sa) * pen;
      pz += (nlx * sa + nlz * ca) * pen;
    }
    for (const o of getBodies(px, pz) || []) {
      const ofx = Math.cos(o.yaw), ofz = -Math.sin(o.yaw);
      for (const oo of o.offsets) {
        const ox = o.x + ofx * oo, oz = o.z + ofz * oo;
        const dx = px - ox, dz = pz - oz;
        const d = Math.hypot(dx, dz);
        const min = r + o.radius;
        if (d >= min || d < 1e-4) continue;
        px += (dx / d) * (min - d);
        pz += (dz / d) * (min - d);
      }
    }
    return [px, pz];
  };
}
