import * as THREE from 'three';

/**
 * Grenades: slot 5. A thrown body on a real arc, a 2.2 s fuse, a blast that
 * breaks street furniture through the debris system, knocks officers down
 * inside 5 m and hurts you inside 4 m, and a flash the grade can sell.
 *
 * The trajectory is pure maths (tested): launch speed and angle from the
 * camera pitch, gravity, a bounce that keeps a third of the speed, a roll
 * that stops. One shared sphere geometry, at most three live bodies, no
 * allocation per frame -- positions are integrated in place.
 */

export const FUSE_S = 2.2;
export const BLAST_R = 6.0;      // props and cars
export const KILL_R = 5.0;       // officers go down
export const HURT_R = 4.0;       // you
export const MAX_LIVE = 3;
export const START_COUNT = 3;
const G = 9.8;

/** Launch velocity from a look direction: 14 m/s, pitched up 12 degrees beyond the look. */
export function launchVelocity(dx, dy, dz, speed = 14) {
  const len = Math.hypot(dx, dy, dz) || 1;
  const fx = dx / len, fy = dy / len, fz = dz / len;
  const up = 0.21;                                   // ~12 degrees
  const vx = fx * speed, vz = fz * speed, vy = (fy + up) * speed;
  return { vx, vy, vz };
}

/** One integration step: gravity, ground bounce keeping 35% and 60% lateral, roll friction. Mutates b. */
export function stepBody(b, dt, groundY) {
  b.vy -= G * dt;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  if (b.y <= groundY + 0.08) {
    b.y = groundY + 0.08;
    if (b.vy < -0.8) { b.vy = -b.vy * 0.35; b.vx *= 0.6; b.vz *= 0.6; }
    else { b.vy = 0; const f = Math.max(0, 1 - dt * 2.5); b.vx *= f; b.vz *= f; }
  }
  b.t += dt;
  return b.t >= FUSE_S;
}

/** Damage fraction at a distance from the blast, 1 at the centre, 0 at the edge, quadratic falloff. */
export function blastFalloff(d, r) {
  if (d >= r) return 0;
  const k = 1 - d / r;
  return k * k;
}

export class Grenades {
  constructor(scene) {
    this.scene = scene;
    this.count = START_COUNT;
    this.live = [];
    this.geo = new THREE.SphereGeometry(0.075, 10, 7);
    this.mat = new THREE.MeshStandardMaterial({ color: 0x2f3a2a, roughness: 0.55, metalness: 0.3 });
    this.flash = new THREE.PointLight(0xffb060, 0, 22, 2);
    scene.add(this.flash);
    this.flashT = 0;
    this.onBlast = null;   // (x, y, z) => void, wired by main
  }

  get ready() { return this.count > 0 && this.live.length < MAX_LIVE; }

  throw(x, y, z, dx, dy, dz) {
    if (!this.ready) return false;
    this.count--;
    const v = launchVelocity(dx, dy, dz);
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.castShadow = true;
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.live.push({ x, y, z, vx: v.vx, vy: v.vy, vz: v.vz, t: 0, mesh });
    return true;
  }

  update(dt, groundHeightAt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const b = this.live[i];
      const done = stepBody(b, dt, groundHeightAt(b.x, b.z));
      b.mesh.position.set(b.x, b.y, b.z);
      b.mesh.rotation.x += b.vx * dt * 6; b.mesh.rotation.z += b.vz * dt * 6;
      if (done) {
        this.scene.remove(b.mesh);
        this.live.splice(i, 1);
        this.flash.position.set(b.x, b.y + 0.6, b.z);
        this.flash.intensity = 60; this.flashT = 0.18;
        this.onBlast?.(b.x, b.y, b.z);
      }
    }
    if (this.flashT > 0) { this.flashT -= dt; this.flash.intensity = Math.max(0, 60 * (this.flashT / 0.18)); }
  }

  dispose() { for (const b of this.live) this.scene.remove(b.mesh); this.live.length = 0; this.geo.dispose(); this.mat.dispose(); this.scene.remove(this.flash); }
}
