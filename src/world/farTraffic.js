/**
 * Distant headlights -- the second half of GTA V's far-light trick (research
 * doc item 2). Beyond the detailed chunk ring no traffic exists, so at night
 * the streets read dead to the horizon. GTA drives pairs of light sprites
 * along the far road graph and streams the car in later. Here: N phantom
 * cars, each a point sliding along one of `district.segments` in the right-
 * hand lane, drawn as FOUR quads in ONE instanced Sprite (two warm headlamps,
 * two dim red tails) -- one draw call for the whole horizon, an empty one by
 * day (count 0 at nightK 0). Same node pattern as world/glare.js: an
 * additive SpriteNodeMaterial, positions/colours/scales as
 * InstancedBufferAttributes (WebGPU draws THREE.Points at one pixel), a soft
 * disc from uv(), glow() so the cores bloom. No texture: nothing to fetch.
 *
 * The CPU side is plain arithmetic over typed arrays (no per-frame
 * allocation) and runs without a renderer: pass `scene = null` and the class
 * is the pure simulation the test drives.
 */
import * as THREE from 'three';
import { uv, uniform, vec4, instancedBufferAttribute, smoothstep, length, float } from 'three/tsl';
import { glow } from '../core/additive.js';
import { mulberry32 } from '../core/rng.js';

const PER_CAR = 4;            // head L, head R, tail L, tail R
const HEAD_GAP = 0.7;         // 1.4 m between the lamps
const TAIL_GAP = 0.65;
const NOSE = 2.1, BOOT = -2.1;   // lamp offsets along the travel direction (metres)
const LAMP_Y = 0.75;          // headlamp height over the tarmac
const FAR = 1500;             // beyond this a phantom is re-seeded
const SEED_TRIES = 24;        // rejection-sampling cap per re-seed

export class FarTraffic {
  /**
   * @param scene   THREE.Scene, or null for the headless simulation
   * @param district District (segments + elevationAt)
   * @param opts    { count = 220, seed = 7 }
   */
  constructor(scene, district, opts = {}) {
    this.district = district;
    this.n = opts.count ?? 220;
    this.rand = mulberry32(opts.seed ?? 7);
    const segs = district.segments;
    // per segment: length once, so the frame loop never calls hypot on a road
    this.segLen = new Float32Array(segs.length);
    for (let i = 0; i < segs.length; i++) this.segLen[i] = Math.hypot(segs[i].bx - segs[i].ax, segs[i].bz - segs[i].az);
    // per car
    this.seg = new Int32Array(this.n).fill(-1);
    this.s = new Float32Array(this.n);        // metres along the segment, in travel order
    this.dir = new Int8Array(this.n);         // +1 a->b, -1 b->a
    this.speed = new Float32Array(this.n);
    this.lane = new Float32Array(this.n);     // metres right of the centreline
    this.age = new Float32Array(this.n);      // seconds since seeding: the fade-in
    // per sprite instance
    this.pos = new Float32Array(this.n * PER_CAR * 3);
    this.col = new Float32Array(this.n * PER_CAR * 3);
    this.scl = new Float32Array(this.n * PER_CAR * 2);
    this.nightK = uniform(0);
    this.sprite = null;
    if (scene) {
      this.posAttr = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
      this.colAttr = new THREE.InstancedBufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
      this.sclAttr = new THREE.InstancedBufferAttribute(this.scl, 2).setUsage(THREE.DynamicDrawUsage);
      const m = new THREE.SpriteNodeMaterial({
        transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false,
      });
      m.positionNode = instancedBufferAttribute(this.posAttr);
      m.scaleNode = instancedBufferAttribute(this.sclAttr);
      const c = uv().sub(0.5);
      const disc = smoothstep(float(0.5), float(0.08), length(c));   // soft halo
      const core = smoothstep(float(0.14), float(0.0), length(c));   // hot centre, blooms
      const sh = disc.mul(disc).mul(0.8).add(core.mul(1.3));
      m.colorNode = vec4(instancedBufferAttribute(this.colAttr).mul(sh).mul(this.nightK), 1);   // additive: colour is the whole contribution
      /* glow(), not additive(): a zero-normal mrt on a quad draws a black square
         (GTAO reads it as occlusion -- the rule in core/additive.js). */
      glow(m, 0.6);
      this.sprite = new THREE.Sprite(m);
      this.sprite.frustumCulled = false;   // spans the whole district
      this.sprite.renderOrder = 3;
      /* Stays VISIBLE with count 0 by day rather than hidden: main's boot warm-up
         un-hides only Points/Mesh objects before compileAsync, so a hidden Sprite
         would compile its pipeline on the first dusk frame (a 30-80 ms hitch).
         A zero-instance draw is legal (RenderObject clamps count to 0) and
         info counts it as one empty call. */
      this.sprite.count = 0;               // update() raises it with the night
      scene.add(this.sprite);
    }
  }

  /** Put car i on a random segment outside the ring and inside FAR. Returns false if none was found. */
  #seed(i, x, z, ringR, p) {
    const segs = this.district.segments;
    for (let k = 0; k < SEED_TRIES; k++) {
      const si = Math.floor(this.rand() * segs.length);
      const len = this.segLen[si];
      if (len < 12) continue;
      this.seg[i] = si;
      this.dir[i] = this.rand() < 0.5 ? 1 : -1;
      this.s[i] = this.rand() * len;
      this.speed[i] = 9 + this.rand() * 5;
      // right-hand traffic, the lane centre ~half*0.5 with a little wander (traffic.js #laneOffset averages to the same)
      this.lane[i] = segs[si].half * (0.4 + this.rand() * 0.25);
      this.age[i] = 0;
      /* Test the PLACED car, lane offset included: an arterial's lane sits 10 m
         off the centreline, and a centreline test let cars land just inside the
         ring, where the edge fade went negative (an additive negative darkens). */
      this.#place(i, p);
      const dx = p.x - x, dz = p.z - z;
      if ((Math.abs(dx) < ringR && Math.abs(dz) < ringR) || dx * dx + dz * dz > FAR * FAR) continue;
      return true;
    }
    this.seg[i] = -1;
    return false;
  }

  /** World position of car i: (x, z) and its unit travel direction. Writes into `out` (no allocation). */
  #place(i, out) {
    const sg = this.district.segments[this.seg[i]], len = this.segLen[this.seg[i]];
    let ux = (sg.bx - sg.ax) / len, uz = (sg.bz - sg.az) / len;
    if (this.dir[i] < 0) { ux = -ux; uz = -uz; }
    // start of travel is `a` when going a->b, `b` when going b->a
    const ox = this.dir[i] > 0 ? sg.ax : sg.bx, oz = this.dir[i] > 0 ? sg.az : sg.bz;
    // right of the travel direction, the same normal traffic.js #shift uses: (-dz, dx)
    out.x = ox + ux * this.s[i] - uz * this.lane[i];
    out.z = oz + uz * this.s[i] + ux * this.lane[i];
    out.ux = ux; out.uz = uz;
  }

  /**
   * @param dt     seconds
   * @param x,z    player position (the ring centre)
   * @param ringR  half-side of the detailed chunk ring in metres: nothing is drawn inside it
   * @param nightK 0 by day .. 1 at night; the whole draw is skipped at 0
   */
  update(dt, x, z, ringR, nightK) {
    this.nightK.value = nightK;
    if (this.sprite) this.sprite.count = nightK > 0.01 ? this.n * PER_CAR : 0;
    if (nightK <= 0.01) return;   // dark streets by day are the sun's problem: no CPU spent
    const p = this._p ??= { x: 0, z: 0, ux: 0, uz: 0 };
    const { pos, col, scl } = this;
    for (let i = 0; i < this.n; i++) {
      let alive = this.seg[i] >= 0;
      if (alive) {
        this.s[i] += this.speed[i] * dt;
        this.age[i] += dt;
        if (this.s[i] >= this.segLen[this.seg[i]]) alive = false;   // end of the road: re-seed elsewhere (no graph walk -- ponytail: a junction turn would need the graph, not worth it at 600 m)
      }
      if (alive) {
        this.#place(i, p);
        const dx = p.x - x, dz = p.z - z;
        if ((Math.abs(dx) < ringR && Math.abs(dz) < ringR) || dx * dx + dz * dz > FAR * FAR) alive = false;
      }
      if (!alive) alive = this.#seed(i, x, z, ringR, p);   // leaves p at the new place
      const b = i * PER_CAR;
      if (!alive) { for (let k = 0; k < PER_CAR; k++) { scl[(b + k) * 2] = 0; scl[(b + k) * 2 + 1] = 0; } continue; }
      const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz) || 1;
      // facing: +1 driving straight at you (headlamps bright), -1 driving away (tails bright)
      const facing = -(p.ux * dx + p.uz * dz) / d;
      // fades: seeding (1.2 s), the ring edge (120 m band), the far limit (150 m band), the segment end (12 m)
      const edge = Math.max(Math.abs(dx), Math.abs(dz)) - ringR;
      const fade = Math.max(0, Math.min(1, this.age[i] / 1.2, edge / 120, (FAR - d) / 150, (this.segLen[this.seg[i]] - this.s[i]) / 12));
      const head = fade * (0.35 + 0.65 * Math.max(0, facing));
      const tail = fade * (0.12 + 0.5 * Math.max(0, -facing));
      const y = this.district.elevationAt(p.x, p.z) + LAMP_Y;   // rides bridges and the flyover
      const rx = -p.uz, rz = p.ux;   // right normal
      for (let k = 0; k < PER_CAR; k++) {
        const isHead = k < 2, side = k & 1 ? 1 : -1;
        const along = isHead ? NOSE : BOOT, gap = isHead ? HEAD_GAP : TAIL_GAP;
        const j = b + k;
        pos[j * 3] = p.x + p.ux * along + rx * gap * side;
        pos[j * 3 + 1] = y;
        pos[j * 3 + 2] = p.z + p.uz * along + rz * gap * side;
        if (isHead) { col[j * 3] = head; col[j * 3 + 1] = head * 0.95; col[j * 3 + 2] = head * 0.82; }
        else { col[j * 3] = tail; col[j * 3 + 1] = tail * 0.1; col[j * 3 + 2] = tail * 0.05; }
        const sz = isHead ? 1.6 : 0.9;
        scl[j * 2] = sz; scl[j * 2 + 1] = sz;
      }
    }
    if (this.sprite) { this.posAttr.needsUpdate = true; this.colAttr.needsUpdate = true; this.sclAttr.needsUpdate = true; }
  }

  dispose() {
    if (!this.sprite) return;
    this.sprite.parent?.remove(this.sprite);
    this.sprite.material.dispose();
    this.sprite = null;
  }
}
