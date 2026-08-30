import * as THREE from 'three';
import { personGeometry } from '../world/beach.js';
import { Character } from '../game/character.js';

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

const WALK = 3.1;
const RUN = 6.4;
const ACCEL = 26;
const RADIUS = 0.42;

export class OnFoot {
  constructor(scene) {
    this.x = 0; this.z = 0; this.yaw = 0;
    this.vx = 0; this.vz = 0;
    this.active = false;
    this.bob = 0;
    this.camYaw = 0;
    this.camPitch = 0;
    this.camPos = new THREE.Vector3();

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
    this.character = new Character(scene);
    this.character.onReady = () => { this.group.visible = false; this.character.show(this.active); };
  }

  /** Step out of the car, standing at the driver's door. */
  exit(car) {
    const side = car.yaw + Math.PI / 2;     // left of travel
    this.x = car.x + Math.cos(side) * 1.85;
    this.z = car.z - Math.sin(side) * 1.85;
    this.yaw = car.yaw;
    this.camYaw = car.yaw;
    this.vx = 0; this.vz = 0;
    this.active = true;
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
    this.group.visible = false;
    this.character.show(false);
  }

  /**
   * `c` is the shared control read: throttle/brake drive forward/back and
   * steer turns the camera, so the same keys work in both modes without a
   * second binding scheme.
   */
  update(c, dt, camera, solid) {
    if (!this.active) return;

    // A/D swing the view; W/S move along it
    this.camYaw += c.steer * dt * 2.6;
    const fwd = (c.throttle || 0) - (c.brake || 0);
    const run = c.hold ? RUN : WALK;
    const wantX = Math.cos(this.camYaw) * fwd * run;
    const wantZ = -Math.sin(this.camYaw) * fwd * run;
    this.vx += (wantX - this.vx) * Math.min(1, dt * ACCEL / 4);
    this.vz += (wantZ - this.vz) * Math.min(1, dt * ACCEL / 4);

    const nx = this.x + this.vx * dt;
    const nz = this.z + this.vz * dt;
    const [px, pz] = solid ? solid(nx, nz, RADIUS) : [nx, nz];
    this.x = px; this.z = pz;

    const speed = Math.hypot(this.vx, this.vz);
    if (speed > 0.2) this.yaw = Math.atan2(-this.vz, this.vx);
    this.bob += dt * speed * 2.1;

    if (this.character.ready) {
      this.character.update(dt, this.x, 0, this.z, this.yaw, speed);
    } else {
      this.group.position.set(this.x, Math.abs(Math.sin(this.bob)) * 0.055, this.z);
      this.group.rotation.y = -this.yaw + Math.PI / 2;
    }

    // camera: over the shoulder, lagging the look direction
    const back = 5.2, up = 2.35;
    const flat = Math.cos(this.camPitch);
    const tx = this.x - Math.cos(this.camYaw) * back * flat;
    const tz = this.z + Math.sin(this.camYaw) * back * flat;
    const k = 1 - Math.pow(0.0025, dt);
    this.camPos.x += (tx - this.camPos.x) * k;
    this.camPos.y += (up + Math.sin(this.camPitch) * back - this.camPos.y) * k;
    this.camPos.z += (tz - this.camPos.z) * k;
    camera.position.copy(this.camPos);
    camera.lookAt(
      this.x + Math.cos(this.camYaw) * 6 * flat,
      1.35 - Math.sin(this.camPitch) * 3,
      this.z - Math.sin(this.camYaw) * 6 * flat,
    );
    if (Math.abs(camera.fov - 62) > 0.01) { camera.fov = 62; camera.updateProjectionMatrix(); }
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
