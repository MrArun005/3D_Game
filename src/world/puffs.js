import * as THREE from 'three';
import { toTex } from './textures.js';
import { additive } from '../core/additive.js';
import { spriteCloud } from '../core/spriteCloud.js';

/**
 * Smoke and dust, one draw. A pool of N soft-disc points: each puff has a
 * position, a drift, a life and a base colour, and fades by darkening -- the
 * pool is additive, so black is transparent (the same trick damage.js's fire
 * uses). Callers: a disabled car's bonnet (traffic), the grenade blast and
 * the muzzle (main). Dead puffs sit at y = -100.
 */
const N = 128;

function discTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  r.addColorStop(0, 'rgba(255,255,255,0.85)'); r.addColorStop(0.5, 'rgba(255,255,255,0.28)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return toTex(c);
}

export class Puffs {
  constructor(scene, size = 1.15) {
    this.pos = new Float32Array(N * 3).fill(0); for (let i = 0; i < N; i++) this.pos[i * 3 + 1] = -100;
    this.col = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.life = new Float32Array(N); this.max = new Float32Array(N); this.base = new Float32Array(N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mesh = new THREE.Points(g, additive(new THREE.PointsMaterial({
      map: discTex(), size, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    })));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
    spriteCloud(this.mesh);   // sized puffs: WebGPU draws Points at 1 px
    scene.add(this.mesh);
    this.next = 0; this.any = false;
  }

  /** One puff. Colour is the peak brightness (keep it low: 0.10-0.25 reads as smoke, 0.5 as steam). */
  puff(x, y, z, { r = 0.16, g = 0.16, b = 0.17, life = 1.6, vx = 0, vy = 0.9, vz = 0 } = {}) {
    const i = this.next; this.next = (this.next + 1) % N;
    const o = i * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.vel[o] = vx + (Math.random() - 0.5) * 0.5; this.vel[o + 1] = vy; this.vel[o + 2] = vz + (Math.random() - 0.5) * 0.5;
    this.base[o] = r; this.base[o + 1] = g; this.base[o + 2] = b;
    this.life[i] = life; this.max[i] = life;
    this.any = true;
  }

  update(dt) {
    if (!this.any) return;
    let live = 0;
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) continue;
      const o = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[o + 1] = -100; this.col[o] = this.col[o + 1] = this.col[o + 2] = 0; continue; }
      live++;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      this.vel[o + 1] *= 1 - dt * 0.6;                                   // the rise slows
      const t = this.life[i] / this.max[i], k = t < 0.85 ? t / 0.85 : (1 - t) / 0.15;   // in fast, out slow
      this.col[o] = this.base[o] * k; this.col[o + 1] = this.base[o + 1] * k; this.col[o + 2] = this.base[o + 2] * k;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
    this.any = live > 0;
  }

  dispose() { this.mesh.parent?.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.map?.dispose(); this.mesh.material.dispose(); }
}
