import * as THREE from 'three';
import { glow } from '../core/additive.js';

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
export const BALL_S = 0.55;      // how long the fireball is on screen
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
  constructor(scene, flashLight = null) {
    this.scene = scene;
    this.count = START_COUNT;
    this.live = [];
    this.geo = new THREE.SphereGeometry(0.075, 10, 7);
    this.mat = new THREE.MeshStandardMaterial({ color: 0x2f3a2a, roughness: 0.55, metalness: 0.3 });
    /* The blast flash borrows the muzzle-flash light rather than adding a
       seventh point light to every lit fragment for a 0.18 s effect. */
    this.flash = flashLight;
    this.ownsFlash = !flashLight;
    if (!flashLight) { this.flash = new THREE.PointLight(0xffb060, 0, 22, 2); scene.add(this.flash); }
    this.flashT = 0;
    /* The blast you SEE: one additive sphere that swells 0.6 -> 7 m and fades
       over BALL_S, routed into the bloom channel. The point light was the
       whole effect before; a grenade with no fireball read as a firecracker. */
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), glow(new THREE.MeshBasicMaterial({
      color: 0xffa040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }), 1.2));
    this.ball.visible = false;
    scene.add(this.ball);
    this.ballT = 0;
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
        this.flash.intensity = 60; this.flash.distance = 22; this.flashT = 0.18;
        this.ball.position.set(b.x, b.y + 0.9, b.z); this.ball.visible = true; this.ballT = BALL_S;
        this.onBlast?.(b.x, b.y, b.z);
      }
    }
    if (this.ballT > 0) {
      this.ballT -= dt;
      const k = 1 - Math.max(0, this.ballT) / BALL_S;          // 0 at the bang, 1 when gone
      this.ball.scale.setScalar(0.6 + 6.4 * Math.sqrt(k));      // fast out, then it hangs
      this.ball.material.opacity = 0.95 * (1 - k) * (1 - k);
      if (this.ballT <= 0) this.ball.visible = false;
    }
    if (this.flashT > 0) { this.flashT -= dt; this.flash.intensity = Math.max(0, 60 * (this.flashT / 0.18)); if (this.flashT <= 0) this.flash.distance = 16; }
  }

  dispose() { for (const b of this.live) this.scene.remove(b.mesh); this.live.length = 0; this.geo.dispose(); this.mat.dispose(); this.scene.remove(this.ball); this.ball.geometry.dispose(); this.ball.material.dispose(); if (this.ownsFlash) this.scene.remove(this.flash); }
}
