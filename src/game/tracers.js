import * as THREE from 'three';
import { glow } from '../core/additive.js';

/**
 * Incoming fire you can see. The player's weapon draws its own one-frame line
 * (weapon.js); this is the pool for everyone shooting AT you -- door officers,
 * rooftop rifles, the door gunner -- so a firefight reads from where the
 * streaks come from before the hit wedge tells you.
 *
 * One LineSegments, MAX pairs of vertices, vertex colours carrying the fade
 * (bright head, dim tail), additive, and the same `mrtNode` the rain uses so
 * an additive streak does not smear the normal target GTAO reads. One draw.
 * A streak is a moving segment along the ray, not the whole ray: STREAK m
 * long, moving at SPEED m/s -- slower than a bullet, fast enough to read.
 */
export const SPEED = 320;
export const STREAK = 7;
export const MAX = 48;

/** Head/tail distance along a ray of length `len` at `age` seconds; null when the streak has left the far end. */
export function streakAt(age, len, speed = SPEED, streak = STREAK) {
  const front = age * speed;
  const tail = Math.max(0, front - streak);
  if (tail >= len) return null;
  return { head: Math.min(len, front), tail };
}

export const TINT = { police: [1.0, 0.62, 0.28], player: [1.0, 0.9, 0.5] };

export class Tracers {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 6);
    this.col = new Float32Array(MAX * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    glow(m, 1.6);   // a streak that blooms is a streak you see at 60 m
    this.mesh = new THREE.LineSegments(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.live = [];
  }

  get material() { return this.mesh.material; }

  /** A round from (ox,oy,oz) toward (tx,ty,tz). The oldest streak makes room when the pool is full. */
  add(ox, oy, oz, tx, ty, tz, tint = 'police') {
    const dx = tx - ox, dy = ty - oy, dz = tz - oz;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1) return;
    if (this.live.length >= MAX) this.live.shift();
    this.live.push({ ox, oy, oz, dx: dx / len, dy: dy / len, dz: dz / len, len, age: 0, c: TINT[tint] ?? TINT.police });
  }

  update(dt) {
    if (!this.live.length) { if (this.mesh.visible) { this.mesh.visible = false; } return; }
    const P = this.pos, C = this.col;
    let n = 0;
    for (let i = 0; i < this.live.length; i++) {
      const s = this.live[i];
      s.age += dt;
      const k = streakAt(s.age, s.len);
      if (!k) continue;
      this.live[n] = s;
      const o = n * 6;
      P[o] = s.ox + s.dx * k.tail; P[o + 1] = s.oy + s.dy * k.tail; P[o + 2] = s.oz + s.dz * k.tail;
      P[o + 3] = s.ox + s.dx * k.head; P[o + 4] = s.oy + s.dy * k.head; P[o + 5] = s.oz + s.dz * k.head;
      C[o] = s.c[0] * 0.12; C[o + 1] = s.c[1] * 0.12; C[o + 2] = s.c[2] * 0.12;
      C[o + 3] = s.c[0]; C[o + 4] = s.c[1]; C[o + 5] = s.c[2];
      n++;
    }
    this.live.length = n;
    // unused pairs collapse to a point: nothing drawn, no per-frame draw range bookkeeping
    for (let o = n * 6; o < MAX * 6; o++) P[o] = 0;
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
    this.mesh.visible = n > 0;
  }

  dispose() { this.mesh.parent?.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.live.length = 0; }
}
