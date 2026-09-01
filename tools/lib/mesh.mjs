/**
 * Procedural mesh builder.
 *
 * Everything is grouped by material so one Mesh exports as one glTF mesh with
 * one primitive per material — what the ingest step and instancing both want.
 *
 * Three decisions carry most of the visual quality here:
 *
 * 1. **Every box is chamfered.** A razor-sharp 90-degree edge cannot catch a
 *    highlight, and nothing in the physical world has one. A 12 mm chamfer
 *    costs ~32 extra triangles per box and is the single largest difference
 *    between geometry that reads as CG and geometry that reads as built.
 * 2. **UVs are planar-projected from world dimensions.** Texel density is then
 *    automatically correct — a bin and a wall sampling the same concrete show
 *    the same grain size, without anyone thinking about it.
 * 3. **Ambient occlusion is baked to vertex colour.** Until Tier 2 lands real
 *    AO maps, this is what stops parts reading as separate objects floating
 *    next to each other. glTF applies COLOR_0 as a multiplier on base colour,
 *    so it survives into the game with no material work.
 */

const TEXEL = 1.0;          // UV units per metre. One tile = one metre.
const CHAMFER = 0.012;      // default edge break, metres

/**
 * Detail level, 0..2. Chamfered geometry cannot be decimated by a normal-blind
 * simplifier - every chamfer is a split-normal border - so LODs are authored
 * here instead. The chamfer is the whole cost (44 triangles a box against 12),
 * so LOD1 drops it entirely and keeps the silhouette; LOD2 also coarsens every
 * cylinder. Same asset, same UVs, a third of the triangles.
 */
let DETAIL = 0;
const DETAIL_CHAMFER = [1, 0, 0];
const DETAIL_SEG = [1, 0.72, 0.42];
export const setDetail = (n) => { DETAIL = n; };

/* ---------------------------------------------------------------- matrix -- */

const idm = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];

function rotXYZ(rx, ry, rz) {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    cy * cz, cz * sx * sy - cx * sz, cx * cz * sy + sx * sz,
    cy * sz, cx * cz + sx * sy * sz, -cz * sx + cx * sy * sz,
    -sy, cy * sx, cx * cy,
  ];
}
const apply = (m, x, y, z) => [
  m[0] * x + m[1] * y + m[2] * z,
  m[3] * x + m[4] * y + m[5] * z,
  m[6] * x + m[7] * y + m[8] * z,
];

/* ------------------------------------------------------------------ mesh -- */

export class Mesh {
  constructor() {
    /** @type {Map<string,{pos:number[],nrm:number[],uv:number[],ao:number[],idx:number[]}>} */
    this.groups = new Map();
    /** Coarse AABBs of everything added, used by the AO bake. */
    this.occluders = [];
  }

  #group(mat) {
    if (!this.groups.has(mat)) this.groups.set(mat, { pos: [], nrm: [], uv: [], ao: [], idx: [] });
    return this.groups.get(mat);
  }

  #occlude(pts) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of pts) for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
    this.occluders.push({ min, max });
  }

  /** Raw quad, corners counter-clockwise from the front. `n` forces a normal. */
  quad(mat, a, b, c, d, uvs, n) {
    const g = this.#group(mat);
    const base = g.pos.length / 3;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx, ny, nz;
    if (n) { [nx, ny, nz] = n; } else {
      nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
    }
    for (const p of [a, b, c, d]) g.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) { g.nrm.push(nx, ny, nz); g.ao.push(1); }
    const w = Math.hypot(ux, uy, uz) * TEXEL, h = Math.hypot(vx, vy, vz) * TEXEL;
    const q = uvs ?? [[0, 0], [w, 0], [w, h], [0, h]];
    for (const t of q) g.uv.push(t[0], t[1]);
    g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return this;
  }

  tri(mat, a, b, c, n) {
    const g = this.#group(mat);
    const base = g.pos.length / 3;
    let nx, ny, nz;
    if (n) { [nx, ny, nz] = n; } else {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
    }
    for (const p of [a, b, c]) {
      g.pos.push(p[0], p[1], p[2]); g.nrm.push(nx, ny, nz); g.ao.push(1);
      g.uv.push(p[0] * TEXEL, p[2] * TEXEL);
    }
    g.idx.push(base, base + 1, base + 2);
    return this;
  }

  /**
   * Chamfered box. `size` is the full extent; `pos` is the centre unless
   * `base` is true, in which case it is the centre of the bottom face — which
   * is how street furniture is naturally described.
   *
   * `skip` drops whole faces (and their edges) for geometry nobody sees.
   * `bevel: 0` gives the old sharp box, for the rare piece that wants it.
   */
  box(mat, { size, pos = [0, 0, 0], rot = [0, 0, 0], base = false, skip = [], bevel } = {}) {
    const [w, h, d] = size;
    // never chamfer more than a third of the thinnest dimension, or a 40 mm
    // sign panel inverts itself
    const c = Math.min((bevel ?? CHAMFER) * DETAIL_CHAMFER[DETAIL], Math.min(w, h, d) / 3);
    const m = (rot[0] || rot[1] || rot[2]) ? rotXYZ(rot[0], rot[1], rot[2]) : idm();
    const [px, py, pz] = pos;
    const oy = base ? h / 2 : 0;
    const hx = w / 2, hy = h / 2, hz = d / 2;

    // p(sx,sy,sz, ix,iy,iz): corner (sx,sy,sz) pulled inward on the axes marked in i
    const P = (sx, sy, sz, ix, iy, iz) => {
      const [x, y, z] = apply(m,
        sx * (hx - (ix ? c : 0)), sy * (hy - (iy ? c : 0)), sz * (hz - (iz ? c : 0)));
      return [px + x, py + oy + y, pz + z];
    };
    const N = (x, y, z) => {
      const [a, b, cc] = apply(m, x, y, z);
      const l = Math.hypot(a, b, cc) || 1;
      return [a / l, b / l, cc / l];
    };
    this.#occlude([P(-1, -1, -1, 0, 0, 0), P(1, 1, 1, 0, 0, 0), P(-1, 1, -1, 0, 0, 0), P(1, -1, 1, 0, 0, 0)]);

    const has = (k) => !skip.includes(k);

    // six inset faces
    if (has('pz')) this.quad(mat, P(-1,-1,1,1,1,0), P(1,-1,1,1,1,0), P(1,1,1,1,1,0), P(-1,1,1,1,1,0), null, N(0,0,1));
    if (has('nz')) this.quad(mat, P(1,-1,-1,1,1,0), P(-1,-1,-1,1,1,0), P(-1,1,-1,1,1,0), P(1,1,-1,1,1,0), null, N(0,0,-1));
    if (has('px')) this.quad(mat, P(1,-1,1,0,1,1), P(1,-1,-1,0,1,1), P(1,1,-1,0,1,1), P(1,1,1,0,1,1), null, N(1,0,0));
    if (has('nx')) this.quad(mat, P(-1,-1,-1,0,1,1), P(-1,-1,1,0,1,1), P(-1,1,1,0,1,1), P(-1,1,-1,0,1,1), null, N(-1,0,0));
    if (has('py')) this.quad(mat, P(-1,1,1,1,0,1), P(1,1,1,1,0,1), P(1,1,-1,1,0,1), P(-1,1,-1,1,0,1), null, N(0,1,0));
    if (has('ny')) this.quad(mat, P(-1,-1,-1,1,0,1), P(1,-1,-1,1,0,1), P(1,-1,1,1,0,1), P(-1,-1,1,1,0,1), null, N(0,-1,0));

    if (c <= 0.0004) return this;

    // twelve edge strips. Each gets its own 45-degree normal — that flat sliver
    // is what produces the highlight line along every edge.
    const EDGES = [
      // along X: (sy,sz) of the edge
      ['py','pz', [0,1,1], (s)=>[P(-s,1,1,1,0,1), P(s,1,1,1,0,1), P(s,1,1,1,1,0), P(-s,1,1,1,1,0)]],
      ['py','nz', [0,1,-1],(s)=>[P(-s,1,-1,1,1,0), P(s,1,-1,1,1,0), P(s,1,-1,1,0,1), P(-s,1,-1,1,0,1)]],
      ['ny','pz', [0,-1,1],(s)=>[P(-s,-1,1,1,1,0), P(s,-1,1,1,1,0), P(s,-1,1,1,0,1), P(-s,-1,1,1,0,1)]],
      ['ny','nz', [0,-1,-1],(s)=>[P(-s,-1,-1,1,0,1), P(s,-1,-1,1,0,1), P(s,-1,-1,1,1,0), P(-s,-1,-1,1,1,0)]],
      // along Y: (sx,sz)
      ['px','pz', [1,0,1], (s)=>[P(1,-s,1,1,1,0), P(1,-s,1,0,1,1), P(1,s,1,0,1,1), P(1,s,1,1,1,0)]],
      ['px','nz', [1,0,-1],(s)=>[P(1,-s,-1,0,1,1), P(1,-s,-1,1,1,0), P(1,s,-1,1,1,0), P(1,s,-1,0,1,1)]],
      ['nx','pz', [-1,0,1],(s)=>[P(-1,-s,1,0,1,1), P(-1,-s,1,1,1,0), P(-1,s,1,1,1,0), P(-1,s,1,0,1,1)]],
      ['nx','nz', [-1,0,-1],(s)=>[P(-1,-s,-1,1,1,0), P(-1,-s,-1,0,1,1), P(-1,s,-1,0,1,1), P(-1,s,-1,1,1,0)]],
      // along Z: (sx,sy)
      ['px','py', [1,1,0], (s)=>[P(1,1,-s,0,1,1), P(1,1,s,0,1,1), P(1,1,s,1,0,1), P(1,1,-s,1,0,1)]],
      ['px','ny', [1,-1,0],(s)=>[P(1,-1,-s,1,0,1), P(1,-1,s,1,0,1), P(1,-1,s,0,1,1), P(1,-1,-s,0,1,1)]],
      ['nx','py', [-1,1,0],(s)=>[P(-1,1,-s,1,0,1), P(-1,1,s,1,0,1), P(-1,1,s,0,1,1), P(-1,1,-s,0,1,1)]],
      ['nx','ny', [-1,-1,0],(s)=>[P(-1,-1,-s,0,1,1), P(-1,-1,s,0,1,1), P(-1,-1,s,1,0,1), P(-1,-1,-s,1,0,1)]],
    ];
    for (const [fa, fb, nrm, verts] of EDGES) {
      if (!has(fa) && !has(fb)) continue;
      const [a, b, cc, d2] = verts(1);
      this.quad(mat, a, b, cc, d2, null, N(...nrm));
    }

    // eight corner triangles
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const fx = sx > 0 ? 'px' : 'nx', fy = sy > 0 ? 'py' : 'ny', fz = sz > 0 ? 'pz' : 'nz';
      if (!has(fx) && !has(fy) && !has(fz)) continue;
      const a = P(sx, sy, sz, 1, 0, 1);   // on the Y face
      const b = P(sx, sy, sz, 0, 1, 1);   // on the X face
      const cc = P(sx, sy, sz, 1, 1, 0);  // on the Z face
      const wind = (sx * sy * sz) > 0 ? [a, cc, b] : [a, b, cc];
      this.tri(mat, ...wind, N(sx, sy, sz));
    }
    return this;
  }

  /** Vertical cylinder. `r` may be [rBottom, rTop] for a taper. */
  cylinder(mat, { r, h, seg: segIn = 14, pos = [0, 0, 0], base = true, caps = true } = {}) {
    const seg = Math.max(5, Math.round(segIn * DETAIL_SEG[DETAIL]));
    const [r0, r1] = Array.isArray(r) ? r : [r, r];
    const [px, py, pz] = pos;
    const y0 = base ? py : py - h / 2;
    const y1 = y0 + h;
    const ring = (rad, y) => Array.from({ length: seg }, (_, i) => {
      const t = (i / seg) * Math.PI * 2;
      return [px + Math.cos(t) * rad, y, pz + Math.sin(t) * rad];
    });
    const lo = ring(r0, y0), hi = ring(r1, y1);
    const rMax = Math.max(r0, r1);
    this.#occlude([[px - rMax, y0, pz - rMax], [px + rMax, y1, pz + rMax]]);

    const circ = Math.PI * 2 * ((r0 + r1) / 2) * TEXEL;
    const g = this.#group(mat);
    // smooth around the ring: radial normals, not face normals
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      const u0 = (i / seg) * circ, u1 = ((i + 1) / seg) * circ;
      const base_ = g.pos.length / 3;
      const nAt = (k) => {
        const t = (k / seg) * Math.PI * 2;
        const slope = (r0 - r1) / (h || 1);
        const nx = Math.cos(t), nz = Math.sin(t);
        const l = Math.hypot(nx, nz, slope) || 1;
        return [nx / l, slope / l, nz / l];
      };
      const ni = nAt(i), nj = nAt(j);
      const verts = [[lo[i], ni, [u0, 0]], [lo[j], nj, [u1, 0]], [hi[j], nj, [u1, h * TEXEL]], [hi[i], ni, [u0, h * TEXEL]]];
      for (const [p, n, uv] of verts) {
        g.pos.push(p[0], p[1], p[2]); g.nrm.push(n[0], n[1], n[2]);
        g.uv.push(uv[0], uv[1]); g.ao.push(1);
      }
      g.idx.push(base_, base_ + 1, base_ + 2, base_, base_ + 2, base_ + 3);
    }
    if (caps) { this.#fan(mat, hi, [px, y1, pz], false); this.#fan(mat, lo, [px, y0, pz], true); }
    return this;
  }

  #fan(mat, ring, centre, flip) {
    const g = this.#group(mat);
    const n = flip ? [0, -1, 0] : [0, 1, 0];
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      const b = g.pos.length / 3;
      const tri = flip ? [centre, ring[j], ring[i]] : [centre, ring[i], ring[j]];
      for (const p of tri) {
        g.pos.push(p[0], p[1], p[2]); g.nrm.push(n[0], n[1], n[2]);
        g.uv.push(p[0] * TEXEL, p[2] * TEXEL); g.ao.push(1);
      }
      g.idx.push(b, b + 1, b + 2);
    }
  }

  /**
   * Extrude a 2D profile along X. This is what a cornice, a kerb, a sill, a
   * coping or a handrail actually is — a moulded section run to a length. A
   * stack of boxes cannot make one, which is why the first pass of toppers
   * read as plain bars.
   *
   * `pts` are [z, y] pairs describing the section, counter-clockwise.
   */
  profile(mat, { pts, length, pos = [0, 0, 0], rot = 0, caps = true } = {}) {
    const [px, py, pz] = pos;
    const x0 = px - length / 2, x1 = px + length / 2;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const at = (x, [z, y]) => [x, py + y * cr - z * sr, pz + z * cr + y * sr];
    const zs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    this.#occlude([[x0, py + Math.min(...ys), pz + Math.min(...zs)],
                   [x1, py + Math.max(...ys), pz + Math.max(...zs)]]);

    let run = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (!caps && i === pts.length - 1) break;
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      this.quad(mat, at(x0, a), at(x1, a), at(x1, b), at(x0, b),
        [[0, run], [length * TEXEL, run], [length * TEXEL, run + seg], [0, run + seg]]);
      run += seg;
    }
    if (caps) {
      // fan the section closed at both ends
      for (const [x, flip] of [[x0, true], [x1, false]]) {
        const c = [pts.reduce((s, p) => s + p[0], 0) / pts.length,
                   pts.reduce((s, p) => s + p[1], 0) / pts.length];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          const t = flip ? [at(x, c), at(x, b), at(x, a)] : [at(x, c), at(x, a), at(x, b)];
          this.tri(mat, ...t, [flip ? -1 : 1, 0, 0]);
        }
      }
    }
    return this;
  }

  /** Triangular prism running along X — roofs, wedges, ramps. */
  wedge(mat, { size, pos = [0, 0, 0], base = true, flip = false } = {}) {
    const [w, h, d] = size;
    const [px, py, pz] = pos;
    const y0 = base ? py : py - h / 2;
    const zL = -d / 2, zR = d / 2;
    const apexZ = flip ? zL : zR;
    return this.profile(mat, {
      pts: [[zL, 0], [zR, 0], [apexZ, h]],
      length: w, pos: [px, y0, pz],
    });
  }

  /** Horizontal slab — paths, plinths, road quads. */
  slab(mat, { size, pos = [0, 0, 0], rot = [0, 0, 0] } = {}) {
    return this.box(mat, { size, pos, rot, base: true });
  }

  /**
   * Loft a chain of rings with SMOOTH normals around each ring.
   *
   * Boxes and profiles want hard edges; a body does not. Each ring is a list
   * of {p, n} — position and outward normal — and consecutive rings are
   * stitched into quads carrying their own per-vertex normals, so a limb
   * shades as a tube rather than as a faceted prism.
   *
   * UVs: u runs around the ring in metres, v along the loft in metres, so the
   * same texel density rule holds as everywhere else.
   */
  /**
   * `uv: 'normalized'` writes u = around the ring (0..1) and v = along the loft
   * (0..1) instead of arc length in metres. Tiling materials want metres; a
   * painted texture — a face, a decal, a livery — wants the surface to occupy a
   * known rectangle.
   */
  loftRings(mat, rings, { capStart = true, capEnd = true, uv = 'metres' } = {}) {
    const NORM = uv === 'normalized';
    if (rings.length < 2) return this;
    const g = this.#group(mat);
    const N = rings[0].length;

    // occluder AABB over the whole loft
    const pts = [];
    for (const r of rings) for (const v of r) pts.push(v.p);
    this.#occlude(pts);

    let vRun = 0;
    for (let i = 0; i < rings.length - 1; i++) {
      const a = rings[i], b = rings[i + 1];
      const step = Math.hypot(
        b[0].p[0] - a[0].p[0], b[0].p[1] - a[0].p[1], b[0].p[2] - a[0].p[2]);
      // Decide the winding ONCE per ring pair, from the loft axis and the ring's
      // own tangential direction. Deciding per quad lets tiny numerical
      // differences flip neighbours against each other, which leaves half the
      // surface backfacing and destroys the averaged normals downstream.
      const cen = (r) => {
        const c = [0, 0, 0];
        for (const v of r) { c[0] += v.p[0] / r.length; c[1] += v.p[1] / r.length; c[2] += v.p[2] / r.length; }
        return c;
      };
      const ca = cen(a), cb = cen(b);
      const ax = [cb[0] - ca[0], cb[1] - ca[1], cb[2] - ca[2]];
      // radial x tangential should point along the loft axis for CCW rings
      const r0 = [a[0].p[0] - ca[0], a[0].p[1] - ca[1], a[0].p[2] - ca[2]];
      const t0 = [a[1].p[0] - a[0].p[0], a[1].p[1] - a[0].p[1], a[1].p[2] - a[0].p[2]];
      const cx = r0[1] * t0[2] - r0[2] * t0[1];
      const cy = r0[2] * t0[0] - r0[0] * t0[2];
      const cz = r0[0] * t0[1] - r0[1] * t0[0];
      const flip = (cx * ax[0] + cy * ax[1] + cz * ax[2]) < 0;

      let uRun = 0;
      for (let k = 0; k < N; k++) {
        const k2 = (k + 1) % N;
        const seg = Math.hypot(
          a[k2].p[0] - a[k].p[0], a[k2].p[1] - a[k].p[1], a[k2].p[2] - a[k].p[2]);
        const base = g.pos.length / 3;
        const u0 = NORM ? k / N : uRun;
        const u1 = NORM ? (k + 1) / N : uRun + seg;
        const v0 = NORM ? i / (rings.length - 1) : vRun;
        const v1 = NORM ? (i + 1) / (rings.length - 1) : vRun + step;
        const quad = flip
          ? [[a[k2], u1, v0], [a[k], u0, v0], [b[k], u0, v1], [b[k2], u1, v1]]
          : [[a[k], u0, v0], [a[k2], u1, v0], [b[k2], u1, v1], [b[k], u0, v1]];
        for (const [v, u, w] of quad) {
          g.pos.push(v.p[0], v.p[1], v.p[2]);
          g.nrm.push(v.n[0], v.n[1], v.n[2]);
          g.uv.push(u, w); g.ao.push(1);
        }
        g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        uRun += seg;
      }
      vRun += step;
    }

    const cap = (ring, flip) => {
      const c = [0, 0, 0];
      for (const v of ring) { c[0] += v.p[0] / ring.length; c[1] += v.p[1] / ring.length; c[2] += v.p[2] / ring.length; }
      for (let k = 0; k < ring.length; k++) {
        const k2 = (k + 1) % ring.length;
        const tri = flip ? [c, ring[k2].p, ring[k].p] : [c, ring[k].p, ring[k2].p];
        const base = g.pos.length / 3;
        // flat normal from the winding
        const ux = tri[1][0] - tri[0][0], uy = tri[1][1] - tri[0][1], uz = tri[1][2] - tri[0][2];
        const vx = tri[2][0] - tri[0][0], vy = tri[2][1] - tri[0][1], vz = tri[2][2] - tri[0][2];
        let a1 = uy * vz - uz * vy, b1 = uz * vx - ux * vz, c1 = ux * vy - uy * vx;
        const l = Math.hypot(a1, b1, c1) || 1; a1 /= l; b1 /= l; c1 /= l;
        for (const t of tri) {
          g.pos.push(t[0], t[1], t[2]); g.nrm.push(a1, b1, c1);
          g.uv.push(t[0], t[2]); g.ao.push(1);
        }
        g.idx.push(base, base + 1, base + 2);
      }
    };
    if (capStart) cap(rings[0], true);
    if (capEnd) cap(rings[rings.length - 1], false);
    return this;
  }

  /** Repeat a builder along X. Railings, fences, colonnades. */
  repeatX(count, step, fn) {
    const span = (count - 1) * step;
    for (let i = 0; i < count; i++) fn(i * step - span / 2, i);
    return this;
  }

  /**
   * Bake ambient occlusion into vertex colour.
   *
   * Rays are cast against the coarse AABBs recorded as geometry was added —
   * not against triangles. That is 30 boxes rather than 3000 triangles, which
   * is why this runs in milliseconds, and at this scale the two look the same.
   * A ground term darkens anything sitting near y=0, which is what makes a
   * prop read as resting on the pavement instead of hovering over it.
   */
  bakeAO({ dist = 0.55, strength = 0.85, rays = 12, groundFade = 0.3 } = {}) {
    const occ = this.occluders;
    if (!occ.length) return this;
    // fixed low-discrepancy hemisphere directions, so the bake is deterministic
    const dirs = [];
    for (let i = 0; i < rays; i++) {
      const y = (i + 0.5) / rays;
      const rad = Math.sqrt(1 - y * y);
      const phi = i * 2.399963;              // golden angle
      dirs.push([Math.cos(phi) * rad, y, Math.sin(phi) * rad]);
    }

    const hit = (ox, oy, oz, dx, dy, dz) => {
      for (const b of occ) {
        let t0 = 0, t1 = dist;
        let ok = true;
        for (const [o, d, mn, mx] of [[ox, dx, b.min[0], b.max[0]],
                                      [oy, dy, b.min[1], b.max[1]],
                                      [oz, dz, b.min[2], b.max[2]]]) {
          if (Math.abs(d) < 1e-8) { if (o < mn || o > mx) { ok = false; break; } continue; }
          let a = (mn - o) / d, c = (mx - o) / d;
          if (a > c) { const s = a; a = c; c = s; }
          if (a > t0) t0 = a;
          if (c < t1) t1 = c;
          if (t0 > t1) { ok = false; break; }
        }
        if (ok) return true;
      }
      return false;
    };

    for (const g of this.groups.values()) {
      for (let v = 0; v < g.pos.length / 3; v++) {
        const px = g.pos[v * 3], py = g.pos[v * 3 + 1], pz = g.pos[v * 3 + 2];
        const nx = g.nrm[v * 3], ny = g.nrm[v * 3 + 1], nz = g.nrm[v * 3 + 2];
        const ox = px + nx * 0.006, oy = py + ny * 0.006, oz = pz + nz * 0.006;

        // build a tangent frame so rays go into the hemisphere above the normal
        const up = Math.abs(ny) > 0.95 ? [1, 0, 0] : [0, 1, 0];
        let tx = up[1] * nz - up[2] * ny, ty = up[2] * nx - up[0] * nz, tz = up[0] * ny - up[1] * nx;
        const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
        const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;

        let blocked = 0;
        for (const [dx, dy, dz] of dirs) {
          const wx = tx * dx + nx * dy + bx * dz;
          const wy = ty * dx + ny * dy + by * dz;
          const wz = tz * dx + nz * dy + bz * dz;
          if (hit(ox, oy, oz, wx, wy, wz)) blocked++;
        }
        let ao = 1 - (blocked / dirs.length) * strength;
        // contact shadow against the ground the asset sits on
        if (py < groundFade) ao *= 0.62 + 0.38 * (py / groundFade);
        g.ao[v] = Math.max(0.18, ao);
      }
    }
    this.aoBaked = true;
    return this;
  }

  /**
   * Recompute vertex normals by averaging adjacent face normals across shared
   * positions. Ring normals are an approximation — they ignore the taper and
   * the squash — and this replaces them with what the surface actually does.
   * Only for organic lofts: running it over a chamfered box would destroy the
   * split normals that make the chamfers read.
   */
  smoothNormals(materials) {
    const want = new Set(materials);
    for (const [mat, g] of this.groups) {
      if (!want.has(mat)) continue;
      // exact key, not a rounded one: adjacent quads share the same ring vertex
      // object, so coincident positions are bit-identical. Rounding to a grid
      // drops pairs that straddle a bucket boundary, which leaves a scatter of
      // un-averaged vertices and reads as faceted noise.
      const key = (i) => `${g.pos[i * 3]},${g.pos[i * 3 + 1]},${g.pos[i * 3 + 2]}`;
      const acc = new Map();
      for (let t = 0; t < g.idx.length; t += 3) {
        const [i0, i1, i2] = [g.idx[t], g.idx[t + 1], g.idx[t + 2]];
        const p = (i) => [g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]];
        const A = p(i0), B = p(i1), C = p(i2);
        const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
        const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
        // not normalised: the cross product's length is twice the triangle
        // area, which is the weighting we want
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const i of [i0, i1, i2]) {
          const k = key(i);
          const e = acc.get(k) ?? [0, 0, 0];
          e[0] += nx; e[1] += ny; e[2] += nz;
          acc.set(k, e);
        }
      }
      for (let i = 0; i < g.pos.length / 3; i++) {
        const e = acc.get(key(i));
        if (!e) continue;
        const l = Math.hypot(e[0], e[1], e[2]) || 1;
        g.nrm[i * 3] = e[0] / l; g.nrm[i * 3 + 1] = e[1] / l; g.nrm[i * 3 + 2] = e[2] / l;
      }
    }
    return this;
  }

  get tris() {
    let t = 0;
    for (const g of this.groups.values()) t += g.idx.length / 3;
    return t;
  }

  bounds() {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const g of this.groups.values()) {
      for (let i = 0; i < g.pos.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const v = g.pos[i + k];
          if (v < min[k]) min[k] = v;
          if (v > max[k]) max[k] = v;
        }
      }
    }
    return { min, max };
  }

  /** Drop the mesh so its lowest point sits at y=0 — the origin convention. */
  seat() {
    const { min } = this.bounds();
    if (!Number.isFinite(min[1]) || Math.abs(min[1]) < 1e-6) return this;
    for (const g of this.groups.values()) for (let i = 1; i < g.pos.length; i += 3) g.pos[i] -= min[1];
    for (const b of this.occluders) { b.min[1] -= min[1]; b.max[1] -= min[1]; }
    return this;
  }
}
