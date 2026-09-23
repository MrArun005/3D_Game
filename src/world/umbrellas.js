import * as THREE from 'three';

/**
 * Umbrellas for the crowd in the rain (2026-09-23, Arun's Shibuya night
 * photos: under rain the crossing is a field of clear vinyl umbrellas with a
 * few dark and coloured ones, and the road turns into a mirror).
 *
 * ONE instanced draw for the whole crowd, fed by FigureFleet.flush() from the
 * same per-person root it already packs: an umbrella over the head of each
 * person whose seeded share falls under the rain (so the same people open
 * theirs first, and nobody's flickers as the rain wavers), held in the right
 * hand (the person's right arm is raised for it: figure.js reads UMBRELLA_BIT),
 * tipped forward a little with the walk. Dry, the mesh keeps ONE
 * zero-scaled instance instead of count 0 -- a zero-count mesh is never drawn,
 * so the boot warm-up would never compile it and the first shower would hitch.
 *
 * Model space as the people: forward +X, up +Y, left +Z; the canopy top sits
 * at y = 2.18 for a person of scale 1 (1.76 m; the grip in the raised fist, 1.27 m). ~90 triangles,
 * every face indexed with real UVs (rule 4), wound out (tested).
 */

export const UMBRELLA_SEGMENTS = 8;
/** What FigureFleet adds to a person's packed look while their umbrella is up: bit 5 of the look (x6 on the code). */
export const UMBRELLA_BIT = 192;
const NodeMaterial = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;   // plain three in node --test
const R_CANOPY = 0.52, TOP = 2.18, DROP = 0.2, RIB_DROP = 0.05, SHAFT_R = 0.012, HAND_Y = 1.27;   // the grip in the raised right fist (figure.js umbR pose)
const HAND_X = 0.3, HAND_Z = -0.21;                                                             // that fist: forward of the chest, at the right shoulder

/** The umbrella geometry, pure. Canopy outside and inside (the inside darker: `aShade`), shaft, handle. */
export function buildUmbrellaGeometry() {
  const pos = [], nrm = [], uv = [], shade = [], idx = [];
  const put = (p, n, t, s) => { pos.push(...p); nrm.push(...n); uv.push(...t); shade.push(s); return pos.length / 3 - 1; };
  const tri = (a, b, c, out) => {
    // wind so the face looks along `out`
    const A = pos.slice(a * 3, a * 3 + 3), B = pos.slice(b * 3, b * 3 + 3), C = pos.slice(c * 3, c * 3 + 3);
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * out[0] + ny * out[1] + nz * out[2] < 0) idx.push(a, c, b); else idx.push(a, b, c);
  };
  const S = UMBRELLA_SEGMENTS;
  // canopy: an apex, a mid ring, and a scalloped rim (the rib tips hang RIB_DROP lower than the panel edges between them)
  const ring = (k, r, y) => { const a = (k / S) * Math.PI * 2; return [Math.cos(a) * r, y, Math.sin(a) * r]; };
  for (const side of [1, -1]) {   // 1 = outside, -1 = the underside
    const s = side > 0 ? 1 : 0.55;
    for (let k = 0; k < S; k++) {
      const k1 = k + 1, km = k + 0.5;
      const apex = [0, TOP, 0], m0 = ring(k, R_CANOPY * 0.55, TOP - DROP * 0.42), m1 = ring(k1, R_CANOPY * 0.55, TOP - DROP * 0.42);
      const r0 = ring(k, R_CANOPY, TOP - DROP - RIB_DROP), r1 = ring(k1, R_CANOPY, TOP - DROP - RIB_DROP), rm = ring(km, R_CANOPY * 0.97, TOP - DROP);
      // a flat panel normal for the upper quad and the lower pair, facing up-and-out (outside) or down-and-in (inside)
      const out = (p) => { const l = Math.hypot(p[0], p[2]) || 1; return [side * p[0] / l * 0.45, side * 0.9, side * p[2] / l * 0.45]; };
      const mid = [(m0[0] + m1[0]) / 2, 0, (m0[2] + m1[2]) / 2];
      const nU = out(mid);
      const a = put(apex, nU, [0.5, 1], s), b = put(m0, nU, [k / S, 0.55], s), c = put(m1, nU, [k1 / S, 0.55], s);
      tri(a, b, c, nU);
      const mm = [(r0[0] + r1[0]) / 2, 0, (r0[2] + r1[2]) / 2], nL = out(mm);
      const d = put(m0, nL, [k / S, 0.55], s), e = put(m1, nL, [k1 / S, 0.55], s), f = put(r0, nL, [k / S, 0], s), g = put(r1, nL, [k1 / S, 0], s), h = put(rm, nL, [km / S, 0.04], s);
      tri(d, f, h, nL); tri(d, h, e, nL); tri(e, h, g, nL);
    }
  }
  // the shaft (six sides) from the hand to the apex, and a crook of a handle as a short stub below the hand
  const SH = 6;
  const shaft = (y0, y1, r, cx = 0, cz = 0) => {
    for (let k = 0; k < SH; k++) {
      const a0 = (k / SH) * Math.PI * 2, a1 = ((k + 1) / SH) * Math.PI * 2, am = (a0 + a1) / 2;
      const n = [Math.cos(am), 0, Math.sin(am)];
      const p = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r], q = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r];
      const i0 = put(p, n, [k / SH, 0], 0.3), i1 = put(q, n, [(k + 1) / SH, 0], 0.3), i2 = put([q[0], y1, q[2]], n, [(k + 1) / SH, 1], 0.3), i3 = put([p[0], y1, p[2]], n, [k / SH, 1], 0.3);
      tri(i0, i1, i2, n); tri(i0, i2, i3, n);
    }
  };
  shaft(HAND_Y - 0.12, TOP - 0.02, SHAFT_R);
  shaft(HAND_Y - 0.14, HAND_Y + 0.02, SHAFT_R * 2.2);   // the grip
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(shade.flatMap((v) => [v, v, v]), 3));   // the underside and the shaft read darker
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/* Clear vinyl most of the time (the photos), then black, navy, magenta, red, a check. */
const CANOPY = [0xdfe7ec, 0xdfe7ec, 0xdfe7ec, 0xd6e0e6, 0xdfe7ec, 0xe4ecef, 0x17191d, 0x1e2b4a, 0xc2185b, 0xb3261e, 0x17191d, 0x3b4a3a];

function hash(n) {
  let t = (n * 2654435761 + 0x9e37) >>> 0;
  t ^= t >>> 15; t = Math.imul(t, 0x2c1b3c6d); t ^= t >>> 12; t = Math.imul(t, 0x297a2d39); t ^= t >>> 15;
  return (t >>> 0) / 4294967296;
}
/** Does person `i` have an umbrella open at rain `k` (0..1)? Pure. Nobody below 0.35; at full rain about three in four. */
export const umbrellaOpen = (i, k) => k > 0.35 && hash(i) < Math.min(0.78, (k - 0.35) * 1.6);

export class Umbrellas {
  constructor(scene, count, { shadows = false } = {}) {
    this.cap = count;
    const geo = buildUmbrellaGeometry();
    this.material = new NodeMaterial({ vertexColors: true, roughness: 0.28, metalness: 0 });
    this.material.name = 'umbrella';
    this.mesh = new THREE.InstancedMesh(geo, this.material, Math.max(1, count));
    this.mesh.name = 'umbrellas';
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;   // the instances span the whole crowd; the geometry's sphere is one umbrella
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // each PERSON's canopy colour (linear), copied into whichever slot they draw in: slots are packed, people are not
    const c = new THREE.Color();
    this.palette = new Float32Array(Math.max(1, count) * 3);
    for (let i = 0; i < Math.max(1, count); i++) { c.setHex(CANOPY[Math.floor(hash(i * 5 + 1) * CANOPY.length) % CANOPY.length]); this.palette.set([c.r, c.g, c.b], i * 3); this.mesh.setColorAt(i, c); }
    this.mesh.instanceColor.needsUpdate = true;
    this._g = new THREE.Matrix4().makeTranslation(0, -HAND_Y, 0);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    this.dry();
    scene.add(this.mesh);
  }
  /** One zero-scaled instance: drawn (so it is compiled at boot), invisible. */
  dry() {
    this._m.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(0, this._m);
    this.mesh.count = 1;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  /**
   * Fill from the fleet's canonical arrays (root: x, y, z, yaw; anim: phase,
   * state, scale, look) for rain `k`. Instance slot n takes person i's own
   * colour from the palette, so an umbrella keeps its colour whoever else opens.
   */
  update(root, anim, count, k) {
    let n = 0;
    if (k > 0.35) {
      const col = this.mesh.instanceColor, M = this._m;
      for (let i = 0; i < count && n < this.cap; i++) {
        const sc = anim[i * 4 + 2], st = anim[i * 4 + 1];
        if (sc <= 0 || st >= 3 || !umbrellaOpen(i, k)) continue;
        const x = root[i * 4], y = root[i * 4 + 1], z = root[i * 4 + 2], yaw = root[i * 4 + 3];
        /* In the raised right fist (figure.js holds that arm still while the
           umbrella is up), tipped forward into the walk about the grip. The
           geometry's grip sits on its own axis at HAND_Y, so: move the grip to
           the origin, tip and turn, scale, then out to the fist. */
        const fx = Math.cos(yaw), fz = -Math.sin(yaw), lx = Math.sin(yaw), lz = Math.cos(yaw);
        this._p.set(x + (fx * HAND_X + lx * HAND_Z) * sc, y + HAND_Y * sc, z + (fz * HAND_X + lz * HAND_Z) * sc);
        this._e.set(0, yaw, -(st === 2 ? 0.2 : st === 1 ? 0.09 : 0.03));
        this._q.setFromEuler(this._e);
        M.compose(this._p, this._q, this._s.set(sc, sc, sc)).multiply(this._g);
        this.mesh.setMatrixAt(n, M);
        if (col) { const o = n * 3, s = (i % this.cap) * 3, a = col.array, P = this.palette; a[o] = P[s]; a[o + 1] = P[s + 1]; a[o + 2] = P[s + 2]; }
        n++;
      }
      if (col) col.needsUpdate = true;
    }
    if (n === 0) { this.dry(); return 0; }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    return n;
  }
  dispose() { this.mesh.parent?.remove(this.mesh); this.mesh.geometry.dispose(); this.material.dispose(); }
}
