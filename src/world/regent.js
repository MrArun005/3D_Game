import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { COMPACT_POLY, makePlayArea } from './playArea.js';
import { KERB_H } from './metrics.js';
import { TOKYO_KIT, PAINT_VARIANT } from './tokyo.js';

/**
 * Kingsway's street wall: Regent Street stone frontages (2026-09-23).
 *
 * The owner's street study of London's Regent Street -- continuous, coordinated
 * pale Portland-stone facades that FOLLOW THE STREET'S CURVE at one cornice
 * height, repeated window bays, a rusticated base of big shop windows with
 * offices above, a strong cornice and a mansard. Downtown Kingsway inside the
 * compact city was a bare road grid: all 24 of its blocks became Little Tokyo
 * (district.js), and the rest of the grid has no blocks and no footprints, so
 * nothing ever built there. This lines those streets.
 *
 *   planRegent()      where: runs along every free building line, corners,
 *                     returns, plots. Pure, deterministic, ~85 ms cold / ~25 ms
 *                     warm for the whole district (node), paid once, in the
 *                     first chunk build -- the boot's unbudgeted one.
 *   regentBuilding()  what: one building into a chunk's Mesher, written face by
 *                     face in tokyo.js's attribute set (position, normal, uv,
 *                     color, emit, flick, surf) with its SURF kinds -- stone is
 *                     WALL's plaster finish (streaked by the detail texture's
 *                     weathering), glass GLASS, slate / lead / copper / fascias
 *                     PAINT -- so a chunk is ONE mesh drawn with
 *                     tokyoFacadeMaterial: the pipeline Little Tokyo already
 *                     compiles and warms. Metre UVs everywhere (rule 4).
 *   regentChunk()     a chunk's buildings as a generator districtWorld's build
 *                     slices per building, plus collision boxes in its shape
 *                     and each lit shop's lamp as a night-light candidate.
 *
 * COST, measured 2026-09-23 on the shipped district (node): 253 buildings
 * (172 plots, 81 corners -- planned crowns 19 domes, 26 raised attics, 13
 * clocks, 23 flags -- and 48 returns) on 7.2 km of frontage; 475k triangles in
 * all, mean 1876 a building (plots 1529, corners 2613), 66 a metre of
 * frontage; 20 chunks from 4.4k to 58.6k triangles (8,4: 29 buildings).
 * Draws: +1 a chunk that has any (the mesh; it casts like the Tokyo mesh, so
 * +1 in each cascade that sees it). Build: ~0.4 ms median, ~0.9 ms mean,
 * ~2.8 ms p95 a building warm, one slice each. Where the triangles go:
 * upper-storey windows (reveals, sills, architraves) 47%, the shopfront base
 * 16%, its rustication 12%, the swept cornices 7%, pilasters 6%, attics 6%.
 * `?noregent` turns it all off.
 *
 * Not built here: a far LOD (#buildFarCity reads blocks, so past the streamed
 * ring these streets are bare again), signage lettering on the fascias.
 */

/* =========================================================================
   THE PLAN (pure: no three, no DOM -- only the District's own queries)
   ========================================================================= */

export const PAVE = 4.8;          // districtWorld's pavement ribbon is 4.8 m from the kerb line
export const FRONT = 4.75;        // the building line: 5 cm onto the ribbon, so no seam of bare ground shows
const TOL = 0.3;                  // a corner may stand this far onto the crossing street's pavement
const STEP = 3;                   // sampling pitch along a building line, metres (ends are bisected to 10 cm)
const DT = [0.4, 5, 10];          // depths the free test probes: a run needs 10 m of land to exist
const EDGE_IN = 6;                // stay this far inside the compact city's outline (the soft wall)
const MIN_RUN = 12, MIN_PLOT = 12, MAX_PLOT = 40, MIN_D = 8;
const PLACE_R = 11;               // keep-out round a place that stands off the road (hospital doors, the precinct)
const G = 16;                     // the planner's own hash cell
const gk = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);

function inPoly(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
/** Twice the signed area of a ring of [x, z]: > 0 counter-clockwise in the x-z plane. */
export function area2(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a;
}
/* Separating-axis overlap of two CONVEX rings, with `eps` of slack so two
   plots that share a party wall do not count. */
function convexOverlap(A, B, eps = 0.05) {
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const p = P[i], q = P[(i + 1) % P.length], nx = q[1] - p[1], nz = p[0] - q[0], l = Math.hypot(nx, nz) || 1;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const v of A) { const d = (v[0] * nx + v[1] * nz) / l; if (d < a0) a0 = d; if (d > a1) a1 = d; }
      for (const v of B) { const d = (v[0] * nx + v[1] * nz) / l; if (d < b0) b0 = d; if (d > b1) b1 = d; }
      if (a1 <= b0 + eps || b1 <= a0 + eps) return false;
    }
  }
  return true;
}

/**
 * The District's questions, answered from grids of our own over Kingsway
 * only. district.tarmacDepth is 5 us a call (nine 96 m cells, every segment
 * in them); the plan asks ~40k times, so it gets a 16 m cell holding only the
 * segments whose pavement can reach it -- 0.3 us, and the SAME answer below
 * FRONT (a segment with d - half < FRONT at a point lies inside its own bbox
 * grown by half + FRONT, which is exactly how it was registered).
 */
function makeProbe(district, box) {
  const segs = new Map(), blks = new Map();
  const add = (m, x0, z0, x1, z1, v) => {
    for (let ix = Math.floor(x0 / G); ix <= Math.floor(x1 / G); ix++) {
      for (let iz = Math.floor(z0 / G); iz <= Math.floor(z1 / G); iz++) {
        const k = gk(ix, iz);
        (m.get(k) ?? m.set(k, []).get(k)).push(v);
      }
    }
  };
  for (const s of district.segments) {
    const r = s.half + FRONT + 1;
    const x0 = Math.min(s.ax, s.bx) - r, x1 = Math.max(s.ax, s.bx) + r, z0 = Math.min(s.az, s.bz) - r, z1 = Math.max(s.az, s.bz) + r;
    if (x1 < box[0] || x0 > box[2] || z1 < box[1] || z0 > box[3]) continue;
    add(segs, Math.max(x0, box[0]), Math.max(z0, box[1]), Math.min(x1, box[2]), Math.min(z1, box[3]), s);
  }
  /* Blocks: Little Tokyo's 24 (and the Old Quarter / Harbour Point ones at
     the edges). A block's rectangle runs kerb to kerb -- its slab IS the
     pavement -- so anything touching it is on somebody else's plot. */
  for (const b of district.blocks) {
    const ca = Math.cos(b.angle || 0), sa = Math.sin(b.angle || 0), pad = 1.5;
    const hw = b.w / 2 + pad, hh = b.h / 2 + pad, r = Math.abs(hw * ca) + Math.abs(hh * sa), rz = Math.abs(hw * sa) + Math.abs(hh * ca);
    if (b.x + r < box[0] || b.x - r > box[2] || b.y + rz < box[1] || b.y - rz > box[3]) continue;
    add(blks, b.x - r, b.y - rz, b.x + r, b.y + rz, { x: b.x, z: b.y, ca, sa, hw, hh });
  }
  const clear = (x, z) => {
    const list = segs.get(gk(Math.floor(x / G), Math.floor(z / G)));
    if (!list) return 60;
    let best = 60;
    for (let i = 0; i < list.length; i++) {
      const s = list[i], vx = s.bx - s.ax, vz = s.bz - s.az, l = vx * vx + vz * vz;
      let t = l ? ((x - s.ax) * vx + (z - s.az) * vz) / l : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - s.ax - vx * t, z - s.az - vz * t) - s.half;
      if (d < best) best = d;
    }
    return best;
  };
  /* The planner's hot question, "is any road's pavement within `thr` of the
     kerb here", as a yes/no: squared distances, first hit returns. */
  const roadNear = (x, z, thr) => {
    const list = segs.get(gk(Math.floor(x / G), Math.floor(z / G)));
    if (!list) return false;
    for (let i = 0; i < list.length; i++) {
      const s = list[i], vx = s.bx - s.ax, vz = s.bz - s.az, l = vx * vx + vz * vz;
      let t = l ? ((x - s.ax) * vx + (z - s.az) * vz) / l : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x - s.ax - vx * t, ez = z - s.az - vz * t, r = s.half + thr;
      if (ex * ex + ez * ez < r * r) return true;
    }
    return false;
  };
  const inBlock = (x, z) => {
    const list = blks.get(gk(Math.floor(x / G), Math.floor(z / G)));
    if (!list) return false;
    for (const b of list) {
      const dx = x - b.x, dz = z - b.z;
      if (Math.abs(dx * b.ca + dz * b.sa) <= b.hw && Math.abs(-dx * b.sa + dz * b.ca) <= b.hh) return true;
    }
    return false;
  };
  return { clear, roadNear, inBlock };
}

/** Seeded [0, 1) from a few numbers: the plan's randomness is positional, so a plot rolls the same whatever order the plan meets it in. */
const seedOf = (...v) => { let h = 0x9e3779b9; for (const x of v) { h = Math.imul(h ^ Math.round(x * 97 + 13), 0x85ebca6b); h ^= h >>> 13; } return h >>> 0; };

/**
 * Where Kingsway's street wall goes. Returns { buildings, runs, stats }.
 *
 * Every road side inside KINGSWAY and the compact city is walked along its
 * own BUILDING LINE -- the road's polyline offset by half + FRONT, mitred at
 * every vertex, so on Halstead Avenue the line bends where the avenue bends.
 * Every STEP metres the strip behind it (0.4, 5 and 10 m deep) must be clear
 * of: every road's carriageway AND pavement (so a run stops where it meets a
 * crossing street -- that is what breaks runs at junctions), every block (the
 * 24 Little Tokyo blocks keep their own look), the open water, any deck, the
 * soft wall, and the hospital's and the precinct's doors. Maximal clear
 * stretches are RUNS.
 *
 * Two run ends from different roads whose building lines cross within reach
 * make a CORNER: one building fronting both streets, footprint from the
 * building-line corner to the two back lines' crossing (an L, or a flatiron
 * on Broadway's diagonals), chamfered, domed or clocked. Runs are then cut
 * into PLOTS 12-40 m wide along their chords, each plot a quad mitred to its
 * neighbours (they share side walls exactly, so a curve leaves no wedges),
 * one cornice line per run +-1 storey, 16-22 m deep -- less where the land
 * between two parallel streets will not take two. Corners first, then
 * arterials, streets, boundary roads; a plot that would overlap one already
 * placed is made shallower, then narrower, then dropped.
 *
 * Deterministic: the district file in, the same list out (seeded by
 * position, not by order).
 */
export function planRegent(district, opts = {}) {
  const name = opts.district ?? 'KINGSWAY';
  const region = district.data?.districts?.find((d) => d.name === name)?.boundary;
  const roads = district.data?.roads;
  if (!region || !roads) return { buildings: [], runs: [], corners: [], byChunk: new Map(), stats: { frontage: 0 } };
  const play = makePlayArea(opts.poly ?? COMPACT_POLY);
  let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
  for (const [x, z] of region) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z); }
  const box = [bx0 - 40, bz0 - 40, bx1 + 40, bz1 + 40];
  const { clear, roadNear, inBlock } = makeProbe(district, box);
  const places = (district.places ?? []).filter((p) => inPoly(region, p.x, p.y) && clear(p.x, p.y) > 1);
  const nearPlace = (x, z) => { for (const p of places) if ((p.x - x) ** 2 + (p.y - z) ** 2 < PLACE_R * PLACE_R) return true; return false; };
  /* The soft wall's inset, per 16 m cell: a cell whose centre is more than
     half its diagonal clear of the line answers for every point in it; only
     the cells the line crosses ask play.probe (0.6 us) point by point. */
  const edgeCell = new Map(), HD = G * 0.7072;
  const inPlay = (x, z) => {
    const k = gk(Math.floor(x / G), Math.floor(z / G));
    let c = edgeCell.get(k);
    if (c === undefined) {
      const d = play.probe((Math.floor(x / G) + 0.5) * G, (Math.floor(z / G) + 0.5) * G).d;
      c = d < -EDGE_IN - HD ? 1 : d > -EDGE_IN + HD ? 0 : 2;
      edgeCell.set(k, c);
    }
    return c === 2 ? play.probe(x, z).d < -EDGE_IN : c === 1;
  };
  /* One point of a footprint: 0 fine, 1 a road (or its pavement), 2 anything
     else. Water and decks are asked per FOOTPRINT (hazard below), not per
     sample: inOpenWater walks the river's 99 points and was a third of the
     plan's time, for a district with no water in it. */
  const why = (x, z) => {
    if (!inPoly(region, x, z) || inBlock(x, z) || !inPlay(x, z) || nearPlace(x, z)) return 2;
    return roadNear(x, z, FRONT - TOL) ? 1 : 0;
  };
  const hazard = (x, z) => !!district.inOpenWater?.(x, z) || (district.elevationAt?.(x, z) ?? 0) > 0.05;
  const cls = { arterial: 0, street: 1, boundary: 2 };

  const T0 = performance.now(), ms = {};
  /* 1. Runs. */
  const runs = [];
  roads.forEach((road, ri) => {
    if (!(road.class in cls) || !road.points || road.points.length < 2) return;
    const P = road.points, half = road.width / 2, off = half + FRONT;
    let near = false;
    for (const [x, z] of P) if (x > box[0] - 200 && x < box[2] + 200 && z > box[1] - 200 && z < box[3] + 200) near = true;
    if (!near) return;
    for (const side of [1, -1]) {
      // the building line: segment normals (left of travel) times side, mitred at every vertex
      const n = [];
      for (let i = 0; i < P.length - 1; i++) { const dx = P[i + 1][0] - P[i][0], dz = P[i + 1][1] - P[i][1], l = Math.hypot(dx, dz) || 1; n.push([(-dz / l) * side, (dx / l) * side]); }
      const L = [], S = [0];
      for (let i = 0; i < P.length; i++) {
        const a = n[Math.max(0, i - 1)], b = n[Math.min(n.length - 1, i)], k = 1 + a[0] * b[0] + a[1] * b[1];
        const mx = (a[0] + b[0]) / k, mz = (a[1] + b[1]) / k;
        L.push([P[i][0] + mx * off, P[i][1] + mz * off]);
        if (i) S.push(S[i - 1] + Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1]));
      }
      const line = { pts: L, cum: S, n, len: S[S.length - 1] };
      // position, direction, away-normal at arc length s (into `out`: the sampling loop allocates nothing)
      const at = (s, out = {}) => {
        let lo = 0, hi = S.length - 2;
        while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S[m] <= s) lo = m; else hi = m - 1; }
        const i = lo;
        const t = (s - S[i]) / ((S[i + 1] - S[i]) || 1), a = L[i], b = L[i + 1];
        const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
        out.x = a[0] + dx * t; out.z = a[1] + dz * t; out.ux = dx / l; out.uz = dz / l; out.ax = n[i][0]; out.az = n[i][1];
        return out;
      };
      line.at = at;
      const q = {};
      const test = (s) => {                                  // 0 free, 1 a road ends it, 2 something else
        at(s, q);
        let worst = 0;
        for (const d of DT) { const w = why(q.x + q.ax * d, q.z + q.az * d); if (w > worst) worst = w; if (worst === 2) break; }
        return worst;
      };
      const refine = (sFree, sBad) => { for (let k = 0; k < 5; k++) { const m = (sFree + sBad) / 2; if (test(m) === 0) sFree = m; else sBad = m; } return sFree; };
      // only the stretch of the line inside Kingsway's box is walked (the arterials run the whole bay)
      let sLo = Infinity, sHi = -Infinity;
      for (let i = 0; i < L.length - 1; i++) {
        const a = L[i], b = L[i + 1];
        if (Math.max(a[0], b[0]) < box[0] || Math.min(a[0], b[0]) > box[2] || Math.max(a[1], b[1]) < box[1] || Math.min(a[1], b[1]) > box[3]) continue;
        sLo = Math.min(sLo, S[i]); sHi = Math.max(sHi, S[i + 1]);
      }
      if (!(sHi > sLo)) continue;
      let open = null, lastBad = { s: sLo - STEP, w: 2 };
      const close = (s1, endWhy) => {
        if (s1 - open.s0 >= MIN_RUN) runs.push({ road: ri, side, cls: road.class, half, line, s0: open.s0, s1, why0: open.why0, why1: endWhy });
        open = null;
      };
      for (let s = sLo; s <= sHi + 1e-6; s += STEP) {
        const w = test(Math.min(s, sHi));
        if (w === 0 && !open) open = { s0: s > 0 ? refine(s, Math.max(0, lastBad.s)) : 0, why0: s > 0 ? lastBad.w : 2 };
        else if (w !== 0 && open) close(refine(s - STEP, s), w);
        if (w !== 0) lastBad = { s, w };
      }
      if (open) close(sHi, 2);
    }
  });

  ms.runs = performance.now() - T0;
  /* 2. Corners: a pair of run ends, on different roads, both stopped by a road. */
  const ends = [];
  runs.forEach((r, i) => {
    for (const e of [0, 1]) {
      if ((e ? r.why1 : r.why0) !== 1) continue;
      const q = r.line.at(e ? r.s1 : r.s0), sg = e ? -1 : 1;   // u points INTO the run, away from its end
      ends.push({ run: i, e, x: q.x, z: q.z, ux: q.ux * sg, uz: q.uz * sg, ax: q.ax, az: q.az });
    }
  });
  const cand = [];
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const A = ends[i], B = ends[j];
      if (runs[A.run].road === runs[B.run].road) continue;
      if (Math.abs(A.x - B.x) > 70 || Math.abs(A.z - B.z) > 70) continue;
      const cosT = A.ux * B.ux + A.uz * B.uz;
      if (cosT > 0.82 || cosT < -0.87) continue;             // 35..150 degrees between the two frontages
      // the building lines' crossing C = A - uA*la = B - uB*mb
      const det = -A.ux * B.uz + A.uz * B.ux;
      if (Math.abs(det) < 1e-6) continue;
      const rx = B.x - A.x, rz = B.z - A.z;
      const la = (rx * B.uz - rz * B.ux) / det, mb = (-A.ux * rz + A.uz * rx) / det;
      if (la < -1.5 || mb < -1.5 || la > 40 || mb > 40) continue;
      // a block's corner, not a re-entrant one: each run's land lies along the other's frontage
      if (A.ax * B.ux + A.az * B.uz < 0.2 || B.ax * A.ux + B.az * A.uz < 0.2) continue;
      cand.push({ i, j, C: [A.x - A.ux * la, A.z - A.uz * la], la, mb, cost: Math.abs(la) + Math.abs(mb) });
    }
  }
  cand.sort((a, b) => a.cost - b.cost);
  const corners = [], used = new Set();
  for (const c of cand) {
    if (used.has(c.i) || used.has(c.j)) continue;
    used.add(c.i); used.add(c.j);
    corners.push({ A: ends[c.i], B: ends[c.j], C: c.C, la: c.la, mb: c.mb });
  }

  ms.corners = performance.now() - T0 - ms.runs;
  /* 3. Buildings, each with its footprint as CONVEX pieces (the overlap test's unit). */
  const buildings = [], pgrid = new Map();
  const bboxOf = (parts) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of parts) for (const [x, z] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    return [x0, z0, x1, z1];
  };
  const overlapsPlaced = (parts) => {
    const [x0, z0, x1, z1] = bboxOf(parts), seen = new Set();
    for (let ix = Math.floor(x0 / G); ix <= Math.floor(x1 / G); ix++) {
      for (let iz = Math.floor(z0 / G); iz <= Math.floor(z1 / G); iz++) {
        for (const o of pgrid.get(gk(ix, iz)) ?? []) {
          if (seen.has(o)) continue;
          seen.add(o);
          for (const a of parts) for (const b of o.parts) if (convexOverlap(a, b)) return true;
        }
      }
    }
    return false;
  };
  const register = (b) => {
    const [x0, z0, x1, z1] = bboxOf(b.parts);
    for (let ix = Math.floor(x0 / G); ix <= Math.floor(x1 / G); ix++) for (let iz = Math.floor(z0 / G); iz <= Math.floor(z1 / G); iz++) {
      const k = gk(ix, iz); (pgrid.get(k) ?? pgrid.set(k, []).get(k)).push(b);
    }
    let cx = 0, cz = 0, n = 0;
    for (const p of b.parts) for (const [x, z] of p) { cx += x; cz += z; n++; }
    b.cx = cx / n; b.cz = cz / n;
    buildings.push(b);
  };
  /* Every point of a footprint's outline clear, sampled every 4 m (roads by the corner tolerance). */
  const footprintFree = (ring) => {
    let cx = 0, cz = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
      for (let j = 0; j <= k; j++) {
        const t = j / k;
        if (why(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) !== 0) return false;
      }
      if (hazard(a[0], a[1])) return false;
      cx += a[0] / ring.length; cz += a[1] / ring.length;
    }
    return !hazard(cx, cz);
  };
  /* How much land lies behind a point of a building line, up to 48 m, and
     what ends it (1: another street's pavement -- so a strip between two
     parallel streets is SHARED, each frontage taking half; 2: a block, the
     wall or the region edge -- taken whole). 4 m steps, then two halvings. */
  const land = (x, z, ax, az) => {
    for (let d = 12; d <= 48; d += 4) {
      const w = why(x + ax * d, z + az * d);
      if (w) {
        let lo = d - 4, hi = d;
        for (let k = 0; k < 2; k++) { const m = (lo + hi) / 2; if (why(x + ax * m, z + az * m)) hi = m; else lo = m; }
        return { d: lo, w };
      }
    }
    return { d: 48, w: 0 };
  };
  const ccw = (p) => (area2(p) < 0 ? p.slice().reverse() : p);
  /* A run's storeys: one cornice line (each plot may go a storey either way). */
  const runStyle = (r) => {
    if (r.st) return r.st;
    const rnd = mulberry32(seedOf(r.road, r.side, Math.round(r.s0 / 50)));
    return (r.st = {
      ground: 4.7 + rnd() * 0.7, mezz: rnd() < 0.7 ? 2.8 + rnd() * 0.4 : 0, upper: 3.45 + rnd() * 0.35,
      floors: rnd() < 0.5 ? 3 : 4, depth: 16 + rnd() * 6, attic: rnd() < 0.72 ? 'mansard' : 'stone',
    });
  };
  const heights = (st) => { const H = st.ground + st.mezz + st.floors * st.upper; return { H, top: H + 1.1 + 3.3 }; };

  // corners first: they claim the block corners both runs were going to fight over
  for (const c of corners) {
    const rA = runs[c.A.run], rB = runs[c.B.run], stA = runStyle(rA), stB = runStyle(rB);
    const rnd = mulberry32(seedOf(c.C[0], c.C[1], 7));
    const D = Math.min(stA.depth, stB.depth, 17 + rnd() * 4);
    const A = c.A, B = c.B, C = c.C;
    // the back lines' crossing Q = C + uA*s + aA*D = C + uB*t + aB*D
    const det = -A.ux * B.uz + A.uz * B.ux;
    const rx = (B.ax - A.ax) * D, rz = (B.az - A.az) * D;
    const s = (-rx * B.uz + rz * B.ux) / det, t = (A.ux * rz - A.uz * rx) / det;
    if (!(s > 1 && t > 1 && s < 55 && t < 55)) continue;
    // each street's frontage: at least to the back lines' crossing, so the wings meet in an L
    let wa = Math.max(s + 1.5, 13 + rnd() * 9), wb = Math.max(t + 1.5, 13 + rnd() * 9);
    const rest = (r, la, w) => r.s1 - r.s0 + la - w;   // what the run keeps past the wing
    // a sliver left over on a run joins the corner rather than standing alone
    const leftA = rest(rA, c.la, wa), leftB = rest(rB, c.mb, wb);
    if (leftA > 0 && leftA < MIN_PLOT * 0.75) wa += leftA;
    if (leftB > 0 && leftB < MIN_PLOT * 0.75) wb += leftB;
    const Q = [C[0] + A.ux * s + A.ax * D, C[1] + A.uz * s + A.az * D];
    const Pa = [C[0] + A.ux * wa, C[1] + A.uz * wa], Pb = [C[0] + B.ux * wb, C[1] + B.uz * wb];
    const Ba = [Pa[0] + A.ax * D, Pa[1] + A.az * D], Bb = [Pb[0] + B.ax * D, Pb[1] + B.az * D];
    const parts = [ccw([C, Pa, Ba, Q]), ccw([C, Q, Bb, Pb])];
    if (!parts.every(footprintFree) || overlapsPlaced(parts)) continue;
    const cosT = A.ux * B.ux + A.uz * B.uz;
    const shape = cosT > 0.45 ? 'chamfer' : rnd() < 0.55 ? 'chamfer' : rnd() < 0.6 ? 'round' : 'square';
    const st = { ...(stA.floors >= stB.floors ? stA : stB) };
    const b = {
      kind: 'corner', seed: seedOf(C[0], C[1], 3), C, ua: [A.ux, A.uz], ub: [B.ux, B.uz], aa: [A.ax, A.az], ab: [B.ax, B.az],
      wa, wb, depth: D, Q, Pa, Pb, Ba, Bb, parts, shape,
      // the crown: a dome on one corner in five (a whole street of domes is a wedding cake), a raised attic, a clock or a flag
      feature: ((q) => (q < 0.22 ? 'dome' : q < 0.55 ? 'attic' : q < 0.72 ? 'clock' : 'flag'))(rnd()),
      style: st, ...heights(st), nbrA: null, nbrB: null,
    };
    register(b);
    // the runs now begin past the corner's wings
    for (const [E, la, w, key] of [[A, c.la, wa, 'nbrA'], [B, c.mb, wb, 'nbrB']]) {
      const r = runs[E.run];
      if (E.e) { r.s1 = r.s1 + la - w; r.cornerEnd = b; r.cornerEndKey = key; } else { r.s0 = r.s0 - la + w; r.cornerStart = b; r.cornerStartKey = key; }
    }
  }

  /* THE CIRCUS CORNERS (2026-09-24, Arun: "where's that curvy building of
     London?"). The compact city's London grid has no curved road, so the
     Quadrant has nothing to follow; what Regent Street does at a crossroads is
     Oxford Circus -- the corner blocks cut back on ONE circle round the
     junction, concave stone fronts facing each other across it. A corner on a
     wide crossroads (its roads sum >= CIRCUS_W m of carriageway: the grandest few) takes that arc:
     centre the junction, radius so the curve meets each street 11-15 m from
     the corner, and never deeper into the block than its depth allows. */
  {
    const crosses = (district.graph?.nodes ?? []).filter((n) => n.kind === 'cross');
    const wsum = new Map();
    for (const e of district.graph?.edges ?? []) for (const id of [e.a, e.b]) wsum.set(id, (wsum.get(id) ?? 0) + e.width);
    for (const b of buildings) {
      if (b.kind !== 'corner') continue;
      let J = null, jd = 32;
      for (const n of crosses) { const r = Math.hypot(n.x - b.C[0], n.y - b.C[1]); if (r < jd) { jd = r; J = n; } }
      if (!J || (wsum.get(J.id) ?? 0) < CIRCUS_W) continue;
      const arc = circusArc(b.C, b.ua, b.ub, [J.x, J.y], b.wa, b.wb, b.depth);
      if (arc) { b.shape = 'circus'; b.J = [J.x, J.y]; b.Rc = arc.R; }
    }
  }

  // then plots along every run: arterials first, so the grand streets keep their depth
  const order = runs.map((r, i) => i).sort((a, b) => cls[runs[a].cls] - cls[runs[b].cls] || a - b);
  for (const ri of order) {
    const r = runs[ri], st = runStyle(r), len = r.s1 - r.s0;
    if (len < 6) continue;
    const rnd = mulberry32(seedOf(r.road, r.side, Math.round(r.s0), 11));
    // plot widths along the run: mostly 13-26 m, one in four 26-40 m; a short remainder widens the last
    const cuts = [r.s0];
    for (let s = r.s0; ;) {
      const w = rnd() < 0.25 ? 26 + rnd() * 14 : 13 + rnd() * 13;
      if (r.s1 - (s + w) < MIN_PLOT) break;
      s += w; cuts.push(s);
    }
    cuts.push(r.s1);
    if (cuts.length > 2 && cuts[cuts.length - 1] - cuts[cuts.length - 3] <= MAX_PLOT + 4 && cuts[cuts.length - 1] - cuts[cuts.length - 2] < MIN_PLOT) cuts.splice(cuts.length - 2, 1);
    // chords and their away-normals; mitres at the cuts are the bisectors, so neighbours share a side wall exactly
    const F = cuts.map((s) => { const q = r.line.at(s); return [q.x, q.z]; });
    const an = [];
    for (let k = 0; k < F.length - 1; k++) { const dx = F[k + 1][0] - F[k][0], dz = F[k + 1][1] - F[k][1], l = Math.hypot(dx, dz) || 1; an.push([(-dz / l) * r.side, (dx / l) * r.side]); }
    const mit = F.map((_, k) => {
      const a = an[Math.max(0, k - 1)], b = an[Math.min(an.length - 1, k)];
      const mx = a[0] + b[0], mz = a[1] + b[1], l = Math.hypot(mx, mz) || 1;
      return [mx / l, mz / l];
    });
    let prev = r.cornerStart ?? null;
    for (let k = 0; k < F.length - 1; k++) {
      const F0 = F[k], F1 = F[k + 1], cl = Math.hypot(F1[0] - F0[0], F1[1] - F0[1]);
      if (cl < 6) { prev = null; continue; }
      const n = an[k], m0 = mit[k], m1 = mit[k + 1];
      const c0 = m0[0] * n[0] + m0[1] * n[1], c1 = m1[0] * n[0] + m1[1] * n[1];
      // the land behind this chord, at a quarter, half and three quarters along it
      let room = 48, shared = false;
      for (const f of [0.25, 0.5, 0.75]) {
        const l = land(F0[0] + (F1[0] - F0[0]) * f, F0[1] + (F1[1] - F0[1]) * f, n[0], n[1]);
        if (l.d < room) { room = l.d; shared = l.w === 1; }
      }
      const cap = shared && room >= 2 * MIN_D + 0.6 ? room / 2 - 0.3 : room - 0.3;
      let D = Math.floor(Math.min(st.depth, cap) * 2) / 2, ring = null, B0, B1;
      for (; D >= MIN_D; D -= 1.5) {
        B0 = [F0[0] + (m0[0] * D) / c0, F0[1] + (m0[1] * D) / c0]; B1 = [F1[0] + (m1[0] * D) / c1, F1[1] + (m1[1] * D) / c1];
        const q = ccw([F0, F1, B1, B0]);
        if (footprintFree(q) && !overlapsPlaced([q])) { ring = q; break; }
      }
      if (!ring) { prev = null; continue; }
      const prnd = mulberry32(seedOf(F0[0], F0[1], F1[0], F1[1]));
      const bump = prnd() < 0.14 ? 1 : prnd() < 0.14 ? -1 : 0;
      const pst = { ...st, floors: Math.max(3, Math.min(4, st.floors + bump)) };
      const ux = (F1[0] - F0[0]) / cl, uz = (F1[1] - F0[1]) / cl;
      /* A RETURN: the run's first or last plot, where the run was stopped by a
         crossing street and no corner building took the corner -- its end
         wall faces that street, so the facade turns the corner onto it. */
      const b = {
        kind: 'plot', seed: seedOf(F0[0], F0[1], F1[0], 5), F0, F1, B0, B1, u: [ux, uz], away: n, depth: D, width: cl,
        parts: [ring], style: pst, ...heights(pst), left: prev, right: null, road: r.road, side: r.side, run: ri,
        returnL: k === 0 && !r.cornerStart && r.why0 === 1, returnR: k === F.length - 2 && !r.cornerEnd && r.why1 === 1,
      };
      if (prev) { if (prev.kind === 'plot') prev.right = b; else prev[r.cornerStartKey] = b; }
      register(b);
      prev = b;
    }
    if (prev && r.cornerEnd && prev.kind === 'plot' && Math.hypot(prev.F1[0] - F[F.length - 1][0], prev.F1[1] - F[F.length - 1][1]) < 0.01) {
      prev.right = r.cornerEnd; r.cornerEnd[r.cornerEndKey] = prev;
    }
  }
  /* BUNTING (2026-09-24, the reference: Regent Street strung with red, white
     and blue pennants across the road). From every other plot on a street
     whose far side is built too: straight out from the frontage's middle,
     over the carriageway, to the building line opposite. `b.bunting` is the
     span in metres; regentBuilding hangs it. */
  for (const b of buildings) {
    if (b.kind !== 'plot' || b.width < 10 || (Math.round(b.F0[0] * 3 + b.F0[1] * 7) & 1)) continue;
    const mx = (b.F0[0] + b.F1[0]) / 2, mz = (b.F0[1] + b.F1[1]) / 2, ox = -b.away[0], oz = -b.away[1];
    let t = 2, onRoad = false, span = 0;
    for (; t < 64; t += 1) {
      const d = clear(mx + ox * t, mz + oz * t);
      if (d < 0) onRoad = true;
      else if (onRoad) { span = t + FRONT; break; }
    }
    if (span < 16 || span > 52) continue;
    const fx = mx + ox * span, fz = mz + oz * span;
    if (buildings.some((o) => o !== b && (o.cx - fx) ** 2 + (o.cz - fz) ** 2 < 22 * 22)) b.bunting = span;
  }
  ms.total = performance.now() - T0;
  /* Owned by the chunk its footprint's centroid stands in -- the same rule blkByChunk uses for a block. */
  const byChunk = new Map();
  let frontage = 0;
  for (const b of buildings) {
    b.chunk = `${Math.floor(b.cx / 256)},${Math.floor(b.cz / 256)}`;
    (byChunk.get(b.chunk) ?? byChunk.set(b.chunk, []).get(b.chunk)).push(b);
    frontage += b.kind === 'plot' ? b.width : b.wa + b.wb;
  }
  return {
    buildings, runs, corners, byChunk,
    stats: { ms, frontage, runs: runs.length, corners: buildings.filter((b) => b.kind === 'corner').length, plots: buildings.filter((b) => b.kind === 'plot').length },
  };
}

/* One plan per District (the constructor is the expensive part of a District, so they are few). */
const PLANS = new WeakMap();
export function regentPlan(district) {
  let p = PLANS.get(district);
  if (!p) { p = planRegent(district); PLANS.set(district, p); }
  return p;
}

/* =========================================================================
   THE BUILDINGS
   ========================================================================= */

const { SURF } = TOKYO_KIT;
const FLOOD_BASE = 0.11, FLOOD_TOP = 0.035, FLOOD_FALL = 8;   // the floodlit stone's emit: over the shops, high up, fall-off (m)
const S_WALL = (v) => SURF.WALL + v;                    // v < 0.45: the plaster/stone finish, v shifts the streaks per building
const S_TOP = SURF.WALL + 0.1;                          // tops take plaster (tokyo.js wallFinish's rule)
const S_PAINT = SURF.PAINT + PAINT_VARIANT.PLAIN, S_RIBS = SURF.PAINT + PAINT_VARIANT.RIBS;
const S_PANEL = SURF.PAINT + PAINT_VARIANT.PANEL, S_SLATS = SURF.PAINT + PAINT_VARIANT.SLATS;
const S_GLASS = (r) => SURF.GLASS + 0.05 + 0.8 * r;     // r: curtains < 0.21, blinds 0.36-0.51, clear above

/* Portland stone, pale and a little warm, ~0.5 linear: about half a stop
   over tokyo.js's LIGHT walls, which is what "pale stone against a dark
   Tokyo" needs without competing with the sky (ART_BIBLE: albedo <= 0.85). */
const STONE = [0xc6bdab, 0xc0b8a7, 0xcbc3b1, 0xbbb4a4, 0xc7c0b2, 0xc3b9a3, 0xbfb6a2];
const FASCIA = [0x1e2b23, 0x2c1b1e, 0x1b2029, 0x28231c, 0x2b2b2d, 0x3a2a1a, 0x16261f];
const SLATE = 0x4b5058, LEAD = 0x5c6064, ROOF = 0x4b4844, GRANITE = 0x26231f, BRONZE = 0x3b3326;
const COPPER = 0x5f8b79, POTS = 0x8a4b33, FLAGS = [0xa8232b, 0x1f2d5c, 0xe6e4de, 0x1f5a3a];
const WARM = [1.0, 0.82, 0.55], COOL = [0.72, 0.85, 1.0];
const SHOPS = [[1.0, 0.86, 0.64], [1.0, 0.86, 0.64], [0.96, 0.94, 0.86], [0.84, 0.91, 1.0], [1.0, 0.78, 0.55], [1.0, 0.74, 0.8]];
const Z3 = [0, 0, 0];
const _col = new THREE.Color();
const LIN = new Map();   // a constant colour's linear triple, converted once (setHex's sRGB decode was 5% of a building)
const lin = (hex, k = 1) => {
  if (k === 1 && LIN.has(hex)) return LIN.get(hex);
  _col.setHex(hex);
  const c = [Math.min(0.85, _col.r * k), Math.min(0.85, _col.g * k), Math.min(0.85, _col.b * k)];
  if (k === 1) LIN.set(hex, c);
  return c;
};
const scale3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/**
 * Flat arrays in the Tokyo mesh's attribute set (position, normal, uv, color,
 * emit, flick, surf -- tokyo.js paint()), so a chunk's frontages are ONE
 * geometry drawn with tokyoFacadeMaterial and could merge with the Tokyo mesh
 * itself. Every polygon is wound to face the normal it is given (Newell's
 * normal against it: the winding is computed, never assumed) and carries metre
 * UVs projected on its own plane, measured from the chunk's corner so the
 * numbers stay small. Convex polygons only; they are fanned.
 */
class Mesher {
  /* Typed arrays written by index, doubled when full: a chunk is ~50k
     triangles of flat-shaded quads (~100k vertices), and pushing 15 numbers a
     vertex into growing JS arrays was 80% of the build (1.0 s for the city,
     measured in node) -- this is ~4x less, and no conversion at the end. */
  constructor(ox = 0, oz = 0, cap = 4096) {
    this.ox = ox; this.oz = oz; this.n = 0; this.ni = 0;
    this.#alloc(cap, cap * 2);
  }
  /** Start again at a new UV origin, with room for `cap` vertices (the buffers are kept: see POOL). */
  reset(ox, oz, cap) {
    this.ox = ox; this.oz = oz; this.n = 0; this.ni = 0;
    if (cap > this.vcap) this.#alloc(cap, cap * 2);
    return this;
  }
  #alloc(vc, ic) {
    const grow = (a, n) => { const b = new a.constructor(n); b.set(a.subarray(0, Math.min(a.length, n))); return b; };
    this.P = grow(this.P ?? new Float32Array(0), vc * 3); this.N = grow(this.N ?? new Float32Array(0), vc * 3);
    this.U = grow(this.U ?? new Float32Array(0), vc * 2); this.C = grow(this.C ?? new Float32Array(0), vc * 3);
    this.E = grow(this.E ?? new Float32Array(0), vc * 3); this.S = grow(this.S ?? new Float32Array(0), vc);
    this.I = grow(this.I ?? new Uint32Array(0), ic);
    this.vcap = vc; this.icap = ic;
  }
  poly(c, nrm, rgb, surf, emit = null, uv = null) {
    const m = c.length, k = this.n;
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < m; i++) {
      const p = c[i], q = c[(i + 1) % m];
      nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]);
    }
    if (nx * nx + ny * ny + nz * nz < 1e-10) return;   // degenerate: nothing to see
    const flip = nx * nrm[0] + ny * nrm[1] + nz * nrm[2] < 0;
    if (k + m > this.vcap || this.ni + (m - 2) * 3 > this.icap) this.#alloc(Math.max(this.vcap * 2, k + m), Math.max(this.icap * 2, this.ni + m * 3));
    const per = emit && Array.isArray(emit[0]);
    // metre UVs on the polygon's own plane (tokyo.js muv): u to the right seen from outside, v up the face
    const flat = Math.abs(nrm[1]) > 0.7, rl = Math.hypot(nrm[2], nrm[0]) || 1, rx = nrm[2] / rl, rz = -nrm[0] / rl;
    const vx = nrm[1] * rz, vy = nrm[2] * rx - nrm[0] * rz, vz = -nrm[1] * rx;
    const { P, N, U, C, E, S } = this;
    const lit = surf >= SURF.WALL && surf < SURF.WALL + 1 && Math.abs(nrm[1]) < 0.3;   // an upright stone face
    for (let i = 0; i < m; i++) {
      const p = c[i], v = k + i, x = p[0] - this.ox, z = p[2] - this.oz;
      P[v * 3] = p[0]; P[v * 3 + 1] = p[1]; P[v * 3 + 2] = p[2];
      N[v * 3] = nrm[0]; N[v * 3 + 1] = nrm[1]; N[v * 3 + 2] = nrm[2];
      if (uv) { U[v * 2] = uv[i][0]; U[v * 2 + 1] = uv[i][1]; }
      else if (flat) { U[v * 2] = x; U[v * 2 + 1] = nrm[1] > 0 ? -z : z; }
      else { U[v * 2] = x * rx + z * rz; U[v * 2 + 1] = x * vx + p[1] * vy + z * vz; }
      C[v * 3] = rgb[0]; C[v * 3 + 1] = rgb[1]; C[v * 3 + 2] = rgb[2];
      if (!emit && lit) {
        /* Floodlit stone (Arun, 2026-09-24: "night lighting should be a little
           better"; the photos: Regent Street's Portland stone glows warm from
           the shop light below and the cornice floods above). A faint warm emit
           on every upright stone face, strongest over the shopfronts and fading
           up the wall. The Tokyo material scales emit by its night intensity
           (0.05 by day: nothing), so this costs no light and no draw. */
        const f = FLOOD_TOP + FLOOD_BASE * Math.exp(-Math.max(0, p[1]) / FLOOD_FALL);
        E[v * 3] = rgb[0] * f; E[v * 3 + 1] = rgb[1] * f * 0.86; E[v * 3 + 2] = rgb[2] * f * 0.66;
      } else {
        const e = emit ? (per ? emit[i] : emit) : Z3;
        E[v * 3] = e[0]; E[v * 3 + 1] = e[1]; E[v * 3 + 2] = e[2];
      }
      S[v] = surf;
    }
    const I = this.I;
    for (let i = 1; i < m - 1; i++) {
      I[this.ni++] = k; I[this.ni++] = flip ? k + i + 1 : k + i; I[this.ni++] = flip ? k + i : k + i + 1;
    }
    this.n += m;
  }
  get tris() { return this.ni / 3; }
  build() {
    const g = new THREE.BufferGeometry(), n = this.n;
    g.setAttribute('position', new THREE.BufferAttribute(this.P.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.slice(0, n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.U.slice(0, n * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.slice(0, n * 3), 3));
    g.setAttribute('emit', new THREE.BufferAttribute(this.E.slice(0, n * 3), 3));
    g.setAttribute('flick', new THREE.BufferAttribute(new Float32Array(n), 1));   // nothing here buzzes
    g.setAttribute('surf', new THREE.BufferAttribute(this.S.slice(0, n), 1));
    g.setIndex(new THREE.BufferAttribute(n > 65535 ? this.I.slice(0, this.ni) : Uint16Array.from(this.I.subarray(0, this.ni)), 1));
    return g;
  }
}

/* An edge of a footprint as a facade frame: `s` along it from `a`, `o` out
   from its plane toward the street, `y` up. */
function edge(a, b, n) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
  return { a, b, L, t: [dx / L, dz / L], n };
}
const EP = (e, s, o, y) => [e.a[0] + e.t[0] * s + e.n[0] * o, y, e.a[1] + e.t[1] * s + e.n[1] * o];
/** A box in an edge's frame, only the faces in `mask`: F out, B in, L toward -s, R toward +s, T top, D underside. */
function ebox(M, e, s0, s1, y0, y1, o0, o1, mask, rgb, surf, emit = null) {
  const n3 = [e.n[0], 0, e.n[1]], t3 = [e.t[0], 0, e.t[1]];
  for (const ch of mask) {
    if (ch === 'F') M.poly([EP(e, s0, o1, y0), EP(e, s1, o1, y0), EP(e, s1, o1, y1), EP(e, s0, o1, y1)], n3, rgb, surf, emit);
    else if (ch === 'B') M.poly([EP(e, s0, o0, y0), EP(e, s1, o0, y0), EP(e, s1, o0, y1), EP(e, s0, o0, y1)], [-n3[0], 0, -n3[2]], rgb, surf, emit);
    else if (ch === 'L') M.poly([EP(e, s0, o0, y0), EP(e, s0, o1, y0), EP(e, s0, o1, y1), EP(e, s0, o0, y1)], [-t3[0], 0, -t3[2]], rgb, surf, emit);
    else if (ch === 'R') M.poly([EP(e, s1, o0, y0), EP(e, s1, o1, y0), EP(e, s1, o1, y1), EP(e, s1, o0, y1)], t3, rgb, surf, emit);
    else if (ch === 'T') M.poly([EP(e, s0, o0, y1), EP(e, s1, o0, y1), EP(e, s1, o1, y1), EP(e, s0, o1, y1)], [0, 1, 0], rgb, surf, emit);
    else if (ch === 'D') M.poly([EP(e, s0, o0, y0), EP(e, s1, o0, y0), EP(e, s1, o1, y0), EP(e, s0, o1, y0)], [0, -1, 0], rgb, surf, emit);
  }
}
/** The inside of an opening s0..s1 x y0..y1 cut from o1 back to o0: its faces look INTO the hole (L the left reveal, R the right, T the soffit, D the sill). */
function ehole(M, e, s0, s1, y0, y1, o0, o1, mask, rgb, surf) {
  const t3 = [e.t[0], 0, e.t[1]];
  for (const ch of mask) {
    if (ch === 'L') M.poly([EP(e, s0, o0, y0), EP(e, s0, o1, y0), EP(e, s0, o1, y1), EP(e, s0, o0, y1)], t3, rgb, surf);
    else if (ch === 'R') M.poly([EP(e, s1, o0, y0), EP(e, s1, o1, y0), EP(e, s1, o1, y1), EP(e, s1, o0, y1)], [-t3[0], 0, -t3[2]], rgb, surf);
    else if (ch === 'T') M.poly([EP(e, s0, o0, y1), EP(e, s1, o0, y1), EP(e, s1, o1, y1), EP(e, s0, o1, y1)], [0, -1, 0], rgb, surf);
    else if (ch === 'D') M.poly([EP(e, s0, o0, y0), EP(e, s1, o0, y0), EP(e, s1, o1, y0), EP(e, s0, o1, y0)], [0, 1, 0], rgb, S_TOP);
  }
}
/** A wall quad in an edge's plane at offset `o`, facing out. */
const eface = (M, e, s0, s1, y0, y1, o, rgb, surf, emit) => { if (s1 - s0 > 1e-3 && y1 - y0 > 1e-3) M.poly([EP(e, s0, o, y0), EP(e, s1, o, y0), EP(e, s1, o, y1), EP(e, s0, o, y1)], [e.n[0], 0, e.n[1]], rgb, surf, emit); };
/** A pane: normalised UVs, so the glass shader draws its frame and transom. */
const eglass = (M, e, s0, s1, y0, y1, o, rgb, emit, r) => M.poly([EP(e, s0, o, y0), EP(e, s1, o, y0), EP(e, s1, o, y1), EP(e, s0, o, y1)], [e.n[0], 0, e.n[1]], rgb, S_GLASS(r), emit, [[0, 0], [1, 0], [1, 1], [0, 1]]);
/** A gable triangle (a pediment's face) on an edge: base s0..s1 at y0, apex at y1, plane o. */
const etri = (M, e, s0, s1, y0, y1, o, rgb, surf) => M.poly([EP(e, s0, o, y0), EP(e, s1, o, y0), EP(e, (s0 + s1) / 2, o, y1)], [e.n[0], 0, e.n[1]], rgb, surf);
/** A pediment: front triangle at o1, two raking tops back to o0 -- and a back triangle when it stands clear of any wall (on a roof). */
function pediment(M, e, s0, s1, y0, rise, o0, o1, rgb, surf, back = false) {
  const sm = (s0 + s1) / 2, y1 = y0 + rise, w = (s1 - s0) / 2, l = Math.hypot(w, rise);
  etri(M, e, s0, s1, y0, y1, o1, rgb, surf);
  if (back) M.poly([EP(e, s0, o0, y0), EP(e, s1, o0, y0), EP(e, sm, o0, y1)], [-e.n[0], 0, -e.n[1]], rgb, surf);
  const nL = [-e.t[0] * rise / l, w / l, -e.t[1] * rise / l], nR = [e.t[0] * rise / l, w / l, e.t[1] * rise / l];
  M.poly([EP(e, s0, o0, y0), EP(e, s0, o1, y0), EP(e, sm, o1, y1), EP(e, sm, o0, y1)], nL, rgb, S_TOP);
  M.poly([EP(e, sm, o0, y1), EP(e, sm, o1, y1), EP(e, s1, o1, y0), EP(e, s1, o0, y0)], nR, rgb, S_TOP);
}

/**
 * A profile swept along a chain of facade edges: every cornice, string
 * course, parapet, balustrade rail and mansard is one of these. `prof` is
 * [[o, y], ...] (o out from the wall, y over `y0`), walked so its outside is
 * on the left -- up a face, out along a soffit, back along a top. The joints
 * are MITRED (so a cornice runs round a chamfer unbroken) and the two ends are
 * cut square and capped with `cap` (a closed [[o, y]] polygon) when given.
 */
function sweep(M, chain, prof, y0, rgb, surf, cap = null) {
  const E = chain.edges, nv = E.length + 1;
  const mit = [];
  for (let j = 0; j < nv; j++) {
    const a = E[Math.max(0, j - 1)].n, b = E[Math.min(E.length - 1, j)].n;
    const k = 1 + a[0] * b[0] + a[1] * b[1];
    mit.push(k > 0.05 ? [(a[0] + b[0]) / k, (a[1] + b[1]) / k] : b);
  }
  const V = (j, o, y) => { const p = j < E.length ? E[j].a : E[E.length - 1].b, m = mit[j]; return [p[0] + m[0] * o, y0 + y, p[1] + m[1] * o]; };
  for (let j = 0; j < E.length; j++) {
    const e = E[j], j1 = j + 1;
    for (let k = 0; k < prof.length - 1; k++) {
      const [o0, y0k] = prof[k], [o1, y1k] = prof[k + 1], dO = o1 - o0, dY = y1k - y0k, l = Math.hypot(dO, dY);
      if (l < 1e-4) continue;
      const no = dY / l, ny = -dO / l;   // the profile's outward normal
      M.poly([V(j, o0, y0k), V(j1, o0, y0k), V(j1, o1, y1k), V(j, o1, y1k)], [e.n[0] * no, ny, e.n[1] * no], rgb, surf);
    }
  }
  if (cap) {
    const tri = THREE.ShapeUtils.triangulateShape(cap.map(([o, y]) => new THREE.Vector2(o, y)), []);
    for (const [e, j, sg] of [[E[0], 0, -1], [E[E.length - 1], nv - 1, 1]]) {
      const nn = [e.t[0] * sg, 0, e.t[1] * sg];
      for (const t of tri) M.poly(t.map((i) => V(j, cap[i][0], cap[i][1])), nn, rgb, surf);
    }
  }
}

/* How far a chain can be offset INWARD before one of its edges shrinks to
   nothing and the mitred sweep turns inside out: an edge of length L between
   turns a and b vanishes at L / (tan(a/2) + tan(b/2)). A plot's one edge
   never does; a 4 m chamfer at a 45-degree flatiron does at ~3 m, which a 6.5 m
   mansard would pass -- its back wall was wound backwards and fought itself. */
function insetLimit(chain) {
  const E = chain.edges, th = (a, b) => Math.abs(a[0] * b[1] - a[1] * b[0]) / Math.max(1e-6, 1 + a[0] * b[0] + a[1] * b[1]);
  let lim = Infinity;
  for (let j = 0; j < E.length; j++) {
    const t = (j > 0 ? th(E[j - 1].n, E[j].n) : 0) + (j < E.length - 1 ? th(E[j].n, E[j + 1].n) : 0);
    if (t > 1e-6) lim = Math.min(lim, E[j].L / t);
  }
  return lim;
}

/* The stretch of a chain within `w` metres of its vertex `j` (0 < j < edges): a corner's raised attic sits on it. */
function subChain(chain, j, w) {
  const e0 = chain.edges[j - 1], e1 = chain.edges[j];
  const a = EP(e0, Math.max(0, e0.L - w), 0, 0), b = EP(e1, Math.min(e1.L, w), 0, 0);
  const p = e1.a;
  return { edges: [edge([a[0], a[2]], p, e0.n), edge(p, [b[0], b[2]], e1.n)] };
}

/**
 * A circus corner's arc: the circle about the junction J that cuts both street
 * lines (C + ua*s, C + ub*t) 11-15 m from the corner. Null when no radius fits
 * the wings (wa, wb) or would cut deeper than `depth - 4` into the block.
 * Returns { R, sa, sb } -- the arc meets street A at sa and B at sb. Pure.
 */
const CIRCUS_W = 116;   // m of carriageway meeting at a junction: 18 of the 81 corners on the shipped district, facing pairs at the widest crossroads

export function circusArc(C, ua, ub, J, wa, wb, depth) {
  const cx = C[0] - J[0], cz = C[1] - J[1], c2 = cx * cx + cz * cz, c = Math.sqrt(c2);
  const ka = ua[0] * cx + ua[1] * cz, kb = ub[0] * cx + ub[1] * cz;
  if (ka < 0 || kb < 0) return null;   // the corner must face the junction: its streets run AWAY from it
  const sOn = (k, R) => -k + Math.sqrt(Math.max(0, k * k - (c2 - R * R)));
  for (let want = 15; want >= 11; want -= 1) {
    const R = Math.sqrt(c2 + 2 * want * ka + want * want);
    const sa = want, sb = sOn(kb, R);
    if (sa > wa * 0.78 || sb > wb * 0.78 || sb < 8) continue;
    if (R - c > depth - 4) continue;
    return { R, sa, sb };
  }
  return null;
}

/**
 * A string of pennants across the street from a plot's frontage: a 1.1-1.6 m
 * sag, a pennant every 0.8 m cycling red, white and blue, each a triangle hung
 * point-down and seen from both sides (two faces, opposite windings). ~2
 * triangles a metre plus the line.
 */
const PENNANT = [0xc8102e, 0xf2f2f0, 0x012169];
function bunting(M, b, y, rnd) {
  const mx = (b.F0[0] + b.F1[0]) / 2, mz = (b.F0[1] + b.F1[1]) / 2, ox = -b.away[0], oz = -b.away[1];
  const L = b.bunting - 0.6, sag = 1.1 + rnd() * 0.5, tx = b.u[0], tz = b.u[1];
  const P = (t) => { const f = t / L; return [mx + ox * (t + 0.3), y - 4 * sag * f * (1 - f), mz + oz * (t + 0.3)]; };
  const line = lin(0x2a2a2a), n = Math.max(2, Math.round(L / 0.8));
  for (let i = 0; i < n; i++) {
    const a = P((L * i) / n), c = P((L * (i + 1)) / n);
    // the cord: a thin vertical ribbon, both sides
    const q = [a, c, [c[0], c[1] - 0.03, c[2]], [a[0], a[1] - 0.03, a[2]]];
    M.poly(q, [tx, 0, tz], line, S_PAINT); M.poly(q.slice().reverse(), [-tx, 0, -tz], line, S_PAINT);
    // the pennant under the middle of this span
    const m = P((L * (i + 0.5)) / n), w = 0.24, h = 0.5 + rnd() * 0.08, col = lin(PENNANT[i % 3]);
    const tri = [[m[0] - ox * w, m[1] - 0.02, m[2] - oz * w], [m[0] + ox * w, m[1] - 0.02, m[2] + oz * w], [m[0], m[1] - h, m[2]]];
    M.poly(tri, [tx, 0, tz], col, S_PAINT); M.poly(tri.slice().reverse(), [-tx, 0, -tz], col, S_PAINT);
  }
}

/* ---- One building ---- */

/** Cornice top (the roof) and the attic's top, from a style: the plan and the generator agree on these. */
function levels(st) {
  const y0 = KERB_H, Yb = y0 + st.ground + st.mezz, Yc = Yb + st.floors * st.upper, Yr = Yc + 1.12;
  return { y0, Yb, Yc, Yr, top: Yr + 3.1 };
}

/**
 * Its outline, street chain and wall kinds. A plot is [F0, F1, B1, B0]; a
 * corner runs its street chain Pb -> (chamfer / quadrant / square corner) ->
 * Pa, then the back of the L: Ba, Q, Bb.
 */
function outlineOf(b, rnd) {
  let chainPts, ring, party;
  if (b.kind === 'plot') {
    // party: edge index -> [neighbour or null, is the edge's START at the street]
    if (b.returnL && b.returnR) { chainPts = [b.B0, b.F0, b.F1, b.B1]; ring = chainPts; party = {}; }
    else if (b.returnL) { chainPts = [b.B0, b.F0, b.F1]; ring = [b.B0, b.F0, b.F1, b.B1]; party = { 2: [b.right, true] }; }
    else if (b.returnR) { chainPts = [b.F0, b.F1, b.B1]; ring = [b.F0, b.F1, b.B1, b.B0]; party = { 3: [b.left, false] }; }
    else { chainPts = [b.F0, b.F1]; ring = [b.F0, b.F1, b.B1, b.B0]; party = { 1: [b.right, true], 3: [b.left, false] }; }
  } else {
    const C = b.C, ua = b.ua, ub = b.ub;
    const at = (u, d) => [C[0] + u[0] * d, C[1] + u[1] * d];
    /* The chamfer: 3.4-4.8 m back along each street -- and at a sharp corner
       (a flatiron on Broadway) a prow at least ~5 m across, or the mansard
       behind it would have nothing to stand on (insetLimit). */
    const sinH = Math.sqrt(Math.max(0.01, (1 - (ua[0] * ub[0] + ua[1] * ub[1])) / 2));
    const ch = b.shape === 'square' ? 0 : Math.min(Math.max(3.4 + rnd() * 1.4, 2.6 / sinH), b.wa * 0.4, b.wb * 0.4);
    let mid;
    if (b.shape === 'circus') {
      // the concave arc about the junction, from street B's end to street A's, in facets ~3.2 m long (a bay each)
      const J = b.J, R = b.Rc;
      const arc = circusArc(C, ua, ub, J, b.wa, b.wb, b.depth), Cb = at(ub, arc.sb), Ca = at(ua, arc.sa);
      let t0 = Math.atan2(Cb[1] - J[1], Cb[0] - J[0]), t1 = Math.atan2(Ca[1] - J[1], Ca[0] - J[0]);
      let dt = t1 - t0; while (dt > Math.PI) dt -= 2 * Math.PI; while (dt < -Math.PI) dt += 2 * Math.PI;
      const n = Math.max(3, Math.round((Math.abs(dt) * R) / 3.2));
      mid = [];
      for (let i = 0; i <= n; i++) { const t = t0 + (dt * i) / n; mid.push([J[0] + Math.cos(t) * R, J[1] + Math.sin(t) * R]); }
    } else if (ch === 0) mid = [C];
    else if (b.shape === 'round') {
      const Cb = at(ub, ch * 1.5), Ca = at(ua, ch * 1.5);
      mid = [Cb];
      for (const t of [1 / 3, 2 / 3]) {   // a quadrant: a quadratic Bezier on the corner, three facets
        const k0 = (1 - t) * (1 - t), k1 = 2 * t * (1 - t), k2 = t * t;
        mid.push([k0 * Cb[0] + k1 * C[0] + k2 * Ca[0], k0 * Cb[1] + k1 * C[1] + k2 * Ca[1]]);
      }
      mid.push(Ca);
    } else mid = [at(ub, ch), at(ua, ch)];
    chainPts = [b.Pb, ...mid, b.Pa];
    ring = [...chainPts, b.Ba, b.Q, b.Bb];
    party = { [chainPts.length - 1]: [b.nbrA, true], [ring.length - 1]: [b.nbrB, false] };
  }
  const sgn = area2(ring) > 0 ? 1 : -1;
  const edges = ring.map((a, i) => {
    const c = ring[(i + 1) % ring.length], dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return edge(a, c, [(sgn * dz) / l, (-sgn * dx) / l]);
  });
  const nStreet = chainPts.length - 1;
  return { ring, edges, chain: { edges: edges.slice(0, nStreet) }, party, nStreet };
}

/** Everything on one street edge below the cornice: base, storeys, pilasters, windows. */
function streetFace(M, e, B, L, rnd, lit, isChamfer, out) {
  const { y0, Yb, Yc } = L, st = B.st, U = st.upper;
  if (e.L < 2.2) { eface(M, e, 0, e.L, -0.25, Yc, 0, B.stone, B.sw); return; }   // a facet too narrow for a bay: plain ashlar
  const EM = 0.55, nb = Math.max(1, Math.round((e.L - 2 * EM) / B.bayT)), bw = (e.L - 2 * EM) / nb;
  const cs = (i) => EM + bw * (i + 0.5);
  const groundTop = y0 + st.ground;

  /* 1. THE BASE: rusticated piers, shop windows in bronze-dark frames and a
     fascia, or round-headed arches, a grand door on the axis. */
  const pier = Math.min(0.9, Math.max(0.55, bw * 0.22));
  const openTop = B.arcade ? null : groundTop - 0.25;
  const doorAt = isChamfer ? 0 : nb >= 3 && e.L > 14 ? Math.floor(nb / 2) : -1;
  const ops = [];
  for (let i = 0; i < nb; i++) {
    const c = cs(i), w = bw - pier;
    if (i === doorAt) { const dw = Math.min(2.1, w); ops.push({ s0: c - dw / 2, s1: c + dw / 2, door: true, top: y0 + 3.3 }); }
    else ops.push({ s0: c - w / 2, s1: c + w / 2, top: B.arcade ? Yb - 0.45 - w / 2 : openTop, r: w / 2 });
  }
  const wallTop = B.arcade ? Yb : openTop;          // the pier courses stop here; above is the mezzanine band
  eface(M, e, 0, e.L, -0.25, y0, 0, B.base, B.sw);  // plinth, below the pavement's top
  // piers between the openings, channelled every ~0.9 m (the rustication): course face + a 6 cm groove, 4 cm deep
  let prev = 0;
  const pierRun = (s0, s1) => {
    if (s1 - s0 < 1e-3) return;
    const top = wallTop, n = Math.max(3, Math.round((top - y0) / 0.9)), h = (top - y0) / n;   // ~0.9 m courses: 5 on a shop storey
    for (let k = 0; k < n; k++) {
      const ya = y0 + k * h;
      if (k) eface(M, e, s0, s1, ya, ya + 0.06, -0.04, B.base, B.sw);   // the channel's back
      eface(M, e, s0, s1, k ? ya + 0.06 : ya, ya + h, 0, B.base, B.sw);
    }
  };
  for (const o of ops) { pierRun(prev, o.s0); prev = o.s1; }
  pierRun(prev, e.L);
  const shop = B.shops[out.shopIx++ % B.shops.length];
  for (const o of ops) {
    const w = o.s1 - o.s0;
    if (o.door) {
      // an entrance: deep reveals, glazed door and fanlight, a doorcase with an entablature and a pediment
      const R = 0.55;
      eface(M, e, o.s0, o.s1, o.top, wallTop, 0, B.base, B.sw);                         // over the door, up to the courses' top
      ehole(M, e, o.s0, o.s1, y0, o.top, -R, 0, 'LRT', B.base, B.sw);                  // reveals and soffit
      ebox(M, e, o.s0 - 0.1, o.s1 + 0.1, y0 - 0.25, y0 + 0.02, -R, 0.1, 'FT', lin(GRANITE), S_PAINT);   // the step
      eglass(M, e, o.s0, o.s1, y0 + 0.02, o.top, -R, lin(0x3a3226), lit.door, 0.6);
      const pw = 0.36;
      for (const s of [o.s0 - pw - 0.08, o.s1 + 0.08]) ebox(M, e, s, s + pw, y0, o.top + 0.25, 0, 0.2, 'FLR', B.trim, B.sw);
      ebox(M, e, o.s0 - pw - 0.22, o.s1 + pw + 0.22, o.top + 0.25, o.top + 0.7, 0, 0.34, 'FTDLR', B.trim, B.sw);
      if (o.top + 1.3 < wallTop) pediment(M, e, o.s0 - pw - 0.22, o.s1 + pw + 0.22, o.top + 0.7, 0.55, 0, 0.3, B.trim, B.sw);
      continue;
    }
    const R = 0.22, gl = shop.lit ? [scale3(shop.col, 0.36), scale3(shop.col, 0.36), scale3(shop.col, 0.62), scale3(shop.col, 0.62)] : null;
    const glTop = o.top - (B.arcade ? 0 : 0.85);
    ehole(M, e, o.s0, o.s1, y0, o.top, -R, 0, 'LR', B.base, B.sw);                         // the opening's reveals
    ehole(M, e, o.s0, o.s1, y0 + 0.012, o.top, -0.14, 0, 'D', B.base, B.sw);               // the threshold before the stallriser, 12 mm over the pavement (which runs 5 cm in: never its plane)
    eface(M, e, o.s0, o.s1, y0, y0 + 0.55, -0.14, lin(GRANITE), S_PAINT);                  // stallriser: dark granite
    ebox(M, e, o.s0, o.s1, y0 + 0.55, y0 + 0.55, -R, -0.14, 'T', lin(GRANITE), S_PAINT);
    /* A lit shop's glass carries its display in the ALBEDO too (2026-09-24):
       the emit is scaled by the night intensity (0.05 by day), so by day every
       shopfront read as a black hole; Regent Street's windows are bright
       displays at noon. The warm tone takes the daylight; the emit still
       comes up after dark. */
    eglass(M, e, o.s0, o.s1, y0 + 0.55, glTop, -R, shop.lit ? scale3(shop.col, 0.34) : lin(0x2a2620), gl, 0.62 + rnd() * 0.3);
    if (!B.arcade) {
      // the fascia: a painted board in the shop's colour, proud of the stone
      ebox(M, e, o.s0, o.s1, glTop, o.top, -R, 0.1, 'FD', shop.fascia, S_PAINT);
      ebox(M, e, o.s0, o.s1, glTop, o.top, 0, 0.1, 'LRT', shop.fascia, S_PAINT);
    } else {
      // round head: spandrel facets up to the base's top, the arch's soffit, a lit fanlight, a keystone
      const c = (o.s0 + o.s1) / 2, r = w / 2, ys = o.top, NA = 6;
      const P = (i) => { const th = Math.PI - (Math.PI * i) / NA; return [c + r * Math.cos(th), ys + r * Math.sin(th)]; };
      for (let i = 0; i < NA; i++) {
        const [sa, ya] = P(i), [sb, yb] = P(i + 1);
        M.poly([EP(e, sa, 0, ya), EP(e, sb, 0, yb), EP(e, sb, 0, Yb), EP(e, sa, 0, Yb)], [e.n[0], 0, e.n[1]], B.base, B.sw);
        const mx = (sa + sb) / 2 - c, my = (ya + yb) / 2 - ys, ml = Math.hypot(mx, my) || 1;   // the soffit faces the arch's centre
        M.poly([EP(e, sa, 0, ya), EP(e, sb, 0, yb), EP(e, sb, -R, yb), EP(e, sa, -R, ya)], [-e.t[0] * mx / ml, -my / ml, -e.t[1] * mx / ml], B.base, B.sw);
      }
      const fan = [EP(e, c, -R, ys)];
      for (let i = 0; i <= NA; i++) { const [s, y] = P(i); fan.push(EP(e, s, -R, y)); }
      const fe = shop.lit ? scale3(shop.col, 0.5) : null;
      M.poly(fan, [e.n[0], 0, e.n[1]], lin(0x2a2620), S_GLASS(0.62), fe, fan.map((p, i) => (i === 0 ? [0.5, 0] : [0.5 - 0.5 * Math.cos((Math.PI * (i - 1)) / NA), Math.sin((Math.PI * (i - 1)) / NA)])));
      ebox(M, e, c - 0.22, c + 0.22, ys + r - 0.12, ys + r + 0.42, 0, 0.1, 'FLRD', B.trim, B.sw);   // keystone
    }
  }
  // above the shops: the mezzanine band (square windows, one a bay) or plain stone to the string course
  if (!B.arcade) {
    if (st.mezz > 0) {
      const mS = groundTop + 0.5, mH = Math.min(Yb - 0.45, mS + 1.45), ww = Math.min(1.5, bw * 0.42);
      eface(M, e, 0, e.L, openTop, mS, 0, B.stone, B.sw);
      eface(M, e, 0, e.L, mH, Yb, 0, B.stone, B.sw);
      let p = 0;
      for (let i = 0; i < nb; i++) {
        const c = cs(i), a0 = c - ww / 2, a1 = c + ww / 2;
        eface(M, e, p, a0, mS, mH, 0, B.stone, B.sw); p = a1;
        ehole(M, e, a0, a1, mS, mH, -0.2, 0, 'LRTD', B.stone, B.sw);
        const em = rnd() < 0.45 ? scale3(shop.col, 0.2) : null;
        eglass(M, e, a0, a1, mS, mH, -0.2, lin(0x18202a), em, rnd());
      }
      eface(M, e, p, e.L, mS, mH, 0, B.stone, B.sw);
    } else eface(M, e, 0, e.L, openTop, Yb, 0, B.stone, B.sw);
  }

  /* 2. THE UPPER STOREYS: a window a bay in a stone architrave, a pediment or
     a hood on the first floor (the piano nobile), smaller windows at the top. */
  /* Nash's proportions: tall sashes, the first floor's taller still -- French
     windows down to the balcony line -- and the top storey squat. At 0.46 x
     0.56 they read as punched holes in a wall rather than a stone frame. */
  const ww = Math.min(1.6, bw * 0.48);
  for (let k = 0; k < st.floors; k++) {
    const ys = Yb + k * U, top = k === st.floors - 1, sill = ys + (k === 0 ? 0.6 : 0.8);
    const head = top ? sill + U * 0.47 : k === 0 ? sill + U * 0.7 : sill + U * 0.62;
    const yTop = ys + U;
    eface(M, e, 0, e.L, ys, sill, 0, B.stone, B.sw);
    eface(M, e, 0, e.L, head, yTop, 0, B.stone, B.sw);
    let p = 0;
    for (let i = 0; i < nb; i++) {
      const c = cs(i), a0 = c - ww / 2, a1 = c + ww / 2, fr = 0.15, R = 0.22;
      eface(M, e, p, a0 - (B.surround ? fr : 0), sill, head, 0, B.stone, B.sw);
      p = a1 + (B.surround ? fr : 0);
      const lo = B.surround ? 0.06 : 0, sw = B.surround ? fr + 0.02 : 0.1;
      ehole(M, e, a0, a1, sill, head, -R, lo, 'LRTD', B.stone, B.sw);                     // reveals, head and the sill's inner half
      eglass(M, e, a0, a1, sill, head, -R, lin(0x141c26), lit.win(), rnd());
      ebox(M, e, a0 - sw, a1 + sw, sill - 0.09, sill, 0, 0.09, 'FD', B.trim, B.sw);      // the sill
      ebox(M, e, a0 - sw, a1 + sw, sill - 0.09, sill, lo, 0.09, 'T', B.trim, S_TOP);
      if (B.surround) {
        // the architrave: jambs and a head 15 cm wide, 6 cm proud (its inner faces are the reveals)
        eface(M, e, a0 - fr, a0, sill, head, lo, B.trim, B.sw); eface(M, e, a1, a1 + fr, sill, head, lo, B.trim, B.sw);
        eface(M, e, a0 - fr, a1 + fr, head, head + fr, lo, B.trim, B.sw);
        ebox(M, e, a0 - fr, a0 - fr, sill, head + fr, 0, lo, 'L', B.trim, B.sw);
        ebox(M, e, a1 + fr, a1 + fr, sill, head + fr, 0, lo, 'R', B.trim, B.sw);   // (no top: from above the band behind closes it -- 7.7k windows x 2 triangles)
      }
      if (k === 0 && !isChamfer) {
        if (B.hood === 'pediment' && (i % 2 === 0 || B.allPed)) {
          ebox(M, e, a0 - 0.28, a1 + 0.28, head + 0.15, head + 0.3, 0, 0.24, 'FDLR', B.trim, B.sw);
          pediment(M, e, a0 - 0.28, a1 + 0.28, head + 0.3, 0.42, 0, 0.24, B.trim, B.sw);
        } else ebox(M, e, a0 - 0.28, a1 + 0.28, head + 0.15, head + 0.34, 0, 0.24, 'FTDLR', B.trim, B.sw);
      }
    }
    eface(M, e, p, e.L, sill, head, 0, B.stone, B.sw);
  }

  /* 3. THE ORDER: giant pilasters (or engaged columns) between the bays, the height of the upper storeys. */
  if (B.order !== 'plain' && nb >= 2) {
    const pw = Math.min(0.62, bw * 0.2), y1 = Yb + 0.38, y2 = Yc;
    for (let i = 1; i < nb; i++) {
      const s = EM + bw * i;
      ebox(M, e, s - pw / 2 - 0.06, s + pw / 2 + 0.06, y1, y1 + 0.42, 0, 0.24, 'FLRT', B.trim, B.sw);   // base
      ebox(M, e, s - pw / 2 - 0.1, s + pw / 2 + 0.1, y2 - 0.42, y2, 0, 0.28, 'FLRD', B.trim, B.sw);     // capital
      if (B.order === 'columns' && i > 0) {
        const r = pw * 0.55, NS = 6;
        for (let q = 0; q < NS; q++) {
          const t0 = Math.PI * (q / NS), t1 = Math.PI * ((q + 1) / NS), tm = (t0 + t1) / 2;
          const p0 = [s - r * Math.cos(t0), r * Math.sin(t0)], p1 = [s - r * Math.cos(t1), r * Math.sin(t1)];
          const nn = [-Math.cos(tm) * e.t[0] + Math.sin(tm) * e.n[0], 0, -Math.cos(tm) * e.t[1] + Math.sin(tm) * e.n[1]];
          M.poly([EP(e, p0[0], p0[1], y1 + 0.42), EP(e, p1[0], p1[1], y1 + 0.42), EP(e, p1[0], p1[1], y2 - 0.42), EP(e, p0[0], p0[1], y2 - 0.42)], nn, B.trim, B.sw);
        }
      } else ebox(M, e, s - pw / 2, s + pw / 2, y1 + 0.42, y2 - 0.42, 0, 0.18, 'FLR', B.trim, B.sw);
    }
  }

  /* 4. A balcony on the piano nobile: a stone slab on the string course, a balustrade (SLATS paint: balusters at 12 cm). */
  if (B.balcony && !isChamfer && nb >= 3) {
    const s0 = EM + bw * (nb >= 5 ? 1 : 0) + 0.2, s1 = e.L - EM - bw * (nb >= 5 ? 1 : 0) - 0.2, yb = Yb + 0.38;
    ebox(M, e, s0, s1, yb - 0.18, yb, 0.24, 0.95, 'FTDLR', B.trim, B.sw);
    ebox(M, e, s0 + 0.05, s1 - 0.05, yb, yb + 0.16, 0.8, 0.92, 'FT', B.trim, B.sw);
    eface(M, e, s0 + 0.05, s1 - 0.05, yb + 0.16, yb + 0.86, 0.86, B.trim, S_SLATS);
    ebox(M, e, s0, s1, yb + 0.86, yb + 1.0, 0.78, 0.95, 'FTDLR', B.trim, B.sw);
    for (const s of [s0, s1 - 0.3]) ebox(M, e, s, s + 0.3, yb, yb + 0.86, 0.78, 0.95, 'FLR', B.trim, B.sw);
  }
}

/** A plain wall -- back, or a party wall where it shows -- with flat windows 3 cm proud on the storeys above the shops. */
function plainWall(M, e, yA, yB, L, B, lit, windows, rnd) {
  eface(M, e, 0, e.L, yA, yB, 0, B.stone, B.sw);
  if (!windows || e.L < 4) return;
  const nb = Math.max(1, Math.round((e.L - 1.2) / 3.6)), bw = (e.L - 1.2) / nb, ww = Math.min(1.2, bw * 0.4);
  for (let k = 0; k < B.st.floors; k++) {
    const ys = L.Yb + k * B.st.upper + 0.9, ye = ys + B.st.upper * 0.5;
    if (ys < yA + 0.3 || ye > yB) continue;
    for (let i = 0; i < nb; i++) { const c = 0.6 + bw * (i + 0.5); eglass(M, e, c - ww / 2, c + ww / 2, ys, ye, 0.03, lin(0x151b22), lit.back(), rnd()); }
  }
}

/** The corner's crown: a dome on a drum, a raised attic (with a clock), or a flag. */
function cornerFeature(M, B, O, L, rnd, out) {
  const j = Math.floor(O.nStreet / 2);   // the chain vertex (or chamfer) at the corner
  const e = O.chain.edges[Math.min(O.nStreet - 1, j)];
  const chamfer = O.nStreet >= 3;
  // the corner's point and its outward bisector
  let cx, cz, bx, bz;
  if (chamfer) { const m = EP(e, e.L / 2, 0, 0); cx = m[0]; cz = m[2]; bx = e.n[0]; bz = e.n[1]; }
  else { const e0 = O.chain.edges[0], e1 = O.chain.edges[1]; cx = e1.a[0]; cz = e1.a[1]; bx = e0.n[0] + e1.n[0]; bz = e0.n[1] + e1.n[1]; const l = Math.hypot(bx, bz) || 1; bx /= l; bz /= l; }
  let f = B.feature, R = 0, cxx = 0, czz = 0;
  if (f === 'dome') {
    // the drum stands on the corner's bisector, as big as the footprint takes it (a flatiron's prow takes a small one, or none)
    const fit = (r) => {
      cxx = cx - bx * (r + 0.8); czz = cz - bz * (r + 0.8);
      for (let i = 0; i < 16; i++) { const t = (i / 16) * Math.PI * 2; if (!inPoly(O.ring, cxx + Math.cos(t) * (r + 0.45), czz + Math.sin(t) * (r + 0.45))) return false; }
      return true;
    };
    R = 2.5 + rnd() * 0.7;
    while (R > 1.6 && !fit(R)) R -= 0.25;
    if (!fit(R)) f = 'attic';
  }
  if (f === 'dome') {
    const NS = 12;
    const yA = L.Yr, yB = L.Yr + 3.1 + 2.3, stone = B.trim;
    const ring = (r, y) => Array.from({ length: NS }, (_, i) => { const t = (i / NS) * Math.PI * 2; return [cxx + Math.cos(t) * r, y, czz + Math.sin(t) * r]; });
    const band = (r0, y0, r1, y1, rgb, surf, emitFn) => {
      const A = ring(r0, y0), Bq = ring(r1, y1);
      for (let i = 0; i < NS; i++) {
        const i1 = (i + 1) % NS, tm = ((i + 0.5) / NS) * Math.PI * 2, dr = r0 - r1, dy = y1 - y0, l = Math.hypot(dr, dy) || 1;
        const nn = [Math.cos(tm) * dy / l, dr / l, Math.sin(tm) * dy / l];
        M.poly([A[i], A[i1], Bq[i1], Bq[i]], nn, rgb, surf, emitFn ? emitFn(i) : null);
      }
    };
    band(R, yA, R, yB, stone, B.sw);                                             // the drum
    for (let i = 0; i < NS; i += 2) {                                            // its windows, lit at night
      const t = ((i + 0.5) / NS) * Math.PI * 2, nx = Math.cos(t), nz = Math.sin(t), tx = -nz, tz = nx, rr = R * Math.cos(Math.PI / NS) + 0.03;
      const px = cxx + nx * rr, pz = czz + nz * rr, hw = 0.38, ya = yB - 1.9, yb2 = yB - 0.45;
      M.poly([[px - tx * hw, ya, pz - tz * hw], [px + tx * hw, ya, pz + tz * hw], [px + tx * hw, yb2, pz + tz * hw], [px - tx * hw, yb2, pz - tz * hw]], [nx, 0, nz], lin(0x151b22), S_GLASS(0.8), out.nightDome ? WARM.map((v) => v * 0.3) : null, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    band(R, yB, R + 0.35, yB + 0.1, stone, S_TOP);                               // a cornice ring
    band(R + 0.35, yB + 0.1, R + 0.35, yB + 0.4, stone, B.sw);
    band(R + 0.35, yB + 0.4, R * 0.98, yB + 0.45, stone, S_TOP);
    const Hd = R * 1.05, rings = [0, 0.3, 0.55, 0.78], last = rings[rings.length - 1] * Math.PI / 2;
    for (let q = 0; q < rings.length - 1; q++) {                                 // the dome, copper gone green, standing seams
      const a0 = rings[q] * Math.PI / 2, a1 = rings[q + 1] * Math.PI / 2;
      band(R * 0.98 * Math.cos(a0), yB + 0.45 + Hd * Math.sin(a0), R * 0.98 * Math.cos(a1), yB + 0.45 + Hd * Math.sin(a1), lin(B.domeHex), S_PANEL);
    }
    const yT = yB + 0.45 + Hd * Math.sin(last), rT = R * 0.98 * Math.cos(last);   // the eye: the lantern stands on it
    band(rT, yT, 0.55, yT + 0.05, lin(B.domeHex), S_PANEL);
    band(0.55, yT + 0.05, 0.55, yT + 1.3, stone, B.sw);                          // the lantern
    band(0.55, yT + 1.3, 0.05, yT + 2.4, lin(B.domeHex), S_PAINT);              // its spire
    out.top = Math.max(out.top, yT + 2.4);
    return;
  }
  if (f === 'flag') {
    const px = cx - bx * 1.6, pz = cz - bz * 1.6, y1 = L.Yr + 0.9, y2 = y1 + 7.5, h = 0.06;
    const pe = edge([px - h, pz - h], [px + h, pz - h], [0, -1]);
    ebox(M, pe, 0, 2 * h, y1, y2, -2 * h, 0, 'FBLRT', lin(0xe8e6e0), S_PAINT);
    // the flag flies along the building's longest street edge
    const fe = O.chain.edges.reduce((a, c) => (c.L > a.L ? c : a));
    const tx = fe.t[0], tz = fe.t[1], fl = lin(B.flagHex);
    const q = [[px, y2 - 0.1, pz], [px + tx * 2.3, y2 - 0.25, pz + tz * 2.3], [px + tx * 2.3, y2 - 1.55, pz + tz * 2.3], [px, y2 - 1.4, pz]];
    const sh = (k) => q.map((p) => [p[0] + fe.n[0] * k, p[1], p[2] + fe.n[1] * k]);   // two faces, 1 cm apart: never one plane
    M.poly(sh(0.005), [fe.n[0], 0, fe.n[1]], fl, S_PAINT);
    M.poly(sh(-0.005).reverse(), [-fe.n[0], 0, -fe.n[1]], fl, S_PAINT);
    out.top = Math.max(out.top, y2);
    return;
  }
  // a raised attic storey over the corner (and a clock on it): the chamfer and a bay either side, a storey over the mansard
  const sc = chamfer ? subChainAround(O.chain, j) : subChain(O.chain, 1, 6);
  const h = 3.6, y = L.Yr;
  const ad = Math.max(1.2, Math.min(5.5, 0.85 * insetLimit(sc) - 0.3));   // 30 cm short of where the mansard's own back may clamp: never one plane with it
  const AP = [[0.05, 0], [0.05, h], [0.3, h + 0.15], [0.3, h + 0.4], [0.12, h + 0.48], [-ad, h + 0.48], [-ad, 0]];
  sweep(M, sc, AP, y, B.trim, B.sw, AP);
  for (const ce of sc.edges) {
    if (ce.L < 2) continue;
    const nw = Math.max(1, Math.round(ce.L / 3.4));
    for (let i = 0; i < nw; i++) {
      const c = (ce.L * (i + 0.5)) / nw;
      if (f === 'clock' && ce === sc.edges[Math.floor(sc.edges.length / 2)] && i === Math.floor(nw / 2)) continue;
      eglass(M, ce, c - 0.5, c + 0.5, y + 0.9, y + 2.5, 0.08, lin(0x151b22), rnd() < 0.3 ? WARM.map((v) => v * 0.16) : null, rnd());
    }
  }
  const pe = sc.edges[Math.floor(sc.edges.length / 2)];
  pediment(M, pe, Math.max(0, pe.L / 2 - 2.4), Math.min(pe.L, pe.L / 2 + 2.4), y + h + 0.48, 1.1, -0.2, 0.3, B.trim, B.sw, true);
  if (f === 'clock') {
    const cc = pe.L / 2, cy = y + h / 2 + 0.2, r = Math.min(1.05, pe.L / 2 - 0.3), NS = 16;
    const face = Array.from({ length: NS }, (_, i) => { const t = (i / NS) * Math.PI * 2; return EP(pe, cc + Math.cos(t) * r, 0.1, cy + Math.sin(t) * r); });
    const rim = Array.from({ length: NS }, (_, i) => { const t = (i / NS) * Math.PI * 2; return EP(pe, cc + Math.cos(t) * (r + 0.16), 0.07, cy + Math.sin(t) * (r + 0.16)); });
    M.poly(rim, [pe.n[0], 0, pe.n[1]], lin(BRONZE), S_PAINT);
    M.poly(face, [pe.n[0], 0, pe.n[1]], lin(0xe6e1d2), S_PAINT, [0.5, 0.47, 0.38]);
    const hand = (ang, len, w, o) => {   // each hand on its own plane: they cross at the hub
      const dx = Math.sin(ang), dy = Math.cos(ang), px = -dy * w, py = dx * w;
      M.poly([EP(pe, cc + px, o, cy + py), EP(pe, cc - px, o, cy - py), EP(pe, cc - px + dx * len, o, cy - py + dy * len), EP(pe, cc + px + dx * len, o, cy + py + dy * len)], [pe.n[0], 0, pe.n[1]], lin(0x141414), S_PAINT);
    };
    const hr = rnd() * 12, mn = rnd() * 60;
    hand((hr / 12) * Math.PI * 2, r * 0.55, 0.05, 0.13);
    hand((mn / 60) * Math.PI * 2, r * 0.85, 0.035, 0.145);
  }
  out.top = Math.max(out.top, y + h + 1.6);
}
/* The chamfer (edge j) and ~5 m of each street either side of it. */
function subChainAround(chain, j) {
  const E = chain.edges, e0 = E[j - 1], e1 = E[j], e2 = E[j + 1];
  if (!e0 || !e2) return { edges: [e1] };
  const a = EP(e0, Math.max(0, e0.L - 5), 0, 0), b = EP(e2, Math.min(e2.L, 5), 0, 0);
  return { edges: [edge([a[0], a[2]], e1.a, e0.n), e1, edge(e2.a, [b[0], b[2]], e2.n)] };
}

/**
 * One building into the chunk's Mesher. Returns { lamps, boxes, top }.
 * Levels: plinth to KERB_H-0.25; the rusticated base (a ground storey of
 * shops 4.7-5.4 m, a mezzanine 2.8-3.2 m on seven in ten) to the string
 * course; 3-4 upper storeys of 3.45-3.8 m; the frieze and a cornice
 * oversailing 0.98 m; a blocking course or a balustrade; a slate mansard with
 * a dormer a bay (or a stone attic storey). Corners add their crown.
 */
export function regentBuilding(M, b) {
  const rnd = mulberry32(b.seed);
  const st = b.style, L = levels(st);
  const stoneHex = STONE[Math.floor(rnd() * STONE.length)], tone = 0.96 + rnd() * 0.08;
  const B = {
    st, bayT: 3.25 + rnd() * 0.55,
    stone: lin(stoneHex, tone), base: lin(stoneHex, tone * 0.93), trim: lin(stoneHex, tone * 1.04),
    sw: S_WALL(0.05 + rnd() * 0.33),
    arcade: rnd() < 0.35, order: rnd() < 0.62 ? 'pilasters' : rnd() < 0.45 ? 'columns' : 'plain',
    hood: rnd() < 0.6 ? 'pediment' : 'hood', allPed: rnd() < 0.3, surround: rnd() < 0.8,
    balcony: rnd() < 0.35, balustrade: rnd() < 0.45, feature: b.feature,
    domeHex: rnd() < 0.7 ? COPPER : LEAD, flagHex: FLAGS[Math.floor(rnd() * FLAGS.length)],
    shops: [],
  };
  for (let i = 0; i < 3; i++) B.shops.push({ col: SHOPS[Math.floor(rnd() * SHOPS.length)], fascia: lin(FASCIA[Math.floor(rnd() * FASCIA.length)]), lit: rnd() < 0.88 });
  const lit = {
    win: () => (rnd() < 0.28 ? (rnd() < 0.7 ? WARM : COOL).map((v) => v * 0.16) : null),
    back: () => (rnd() < 0.2 ? WARM.map((v) => v * 0.14) : null),
    door: WARM.map((v) => v * 0.45),
  };
  const O = outlineOf(b, rnd);
  const out = { shopIx: 0, top: L.top, nightDome: rnd() < 0.6 };
  if (b.bunting) bunting(M, b, L.Yb + 1.4, mulberry32(b.seed ^ 0xb0b));

  // the street faces
  for (let i = 0; i < O.nStreet; i++) streetFace(M, O.edges[i], B, L, rnd, lit, O.nStreet >= 3 && i === Math.floor(O.nStreet / 2) && O.edges[i].L < 8, out);
  // string course, frieze + cornice, then a blocking course or a balustrade, all swept round the chain
  const capOf = (pts, back) => [...pts, [back, pts[pts.length - 1][1]], [back, pts[0][1]]];
  const SC = [[0, 0], [0.22, 0.05], [0.22, 0.3], [0, 0.38]];
  sweep(M, O.chain, SC, L.Yb, B.trim, B.sw, [...SC]);
  const CO = [[0, 0], [0.06, 0.02], [0.06, 0.5], [0.18, 0.58], [0.18, 0.66], [0.92, 0.76], [0.98, 0.82], [0.98, 1.0], [0.9, 1.06], [0.28, 1.12]];
  sweep(M, O.chain, CO, L.Yc, B.trim, B.sw, capOf(CO, 0));
  if (B.balustrade) {
    const PL = [[0.28, 1.12], [0.28, 1.32], [0.22, 1.36], [-0.1, 1.36], [-0.1, 1.12]];
    sweep(M, O.chain, PL, L.Yc, B.trim, B.sw, PL);
    sweep(M, O.chain, [[0.2, 1.36], [0.2, 1.82]], L.Yc, B.trim, S_SLATS);
    const RL = [[0.26, 1.82], [0.26, 1.98], [-0.1, 1.98], [-0.1, 1.82], [0.26, 1.82]];
    sweep(M, O.chain, RL, L.Yc, B.trim, B.sw, RL.slice(0, 4));
    // dies over the pilasters' lines and at the ends
    for (let i = 0; i < O.nStreet; i++) {
      const e = O.edges[i];
      if (e.L < 2.2) continue;
      const nb = Math.max(1, Math.round((e.L - 1.1) / B.bayT)), bw = (e.L - 1.1) / nb;
      for (let k = 1; k < nb; k++) { const s = 0.55 + bw * k; ebox(M, e, s - 0.28, s + 0.28, L.Yc + 1.12, L.Yc + 2.02, -0.1, 0.3, 'FLRT', B.trim, B.sw); }
    }
  } else {
    const PA = [[0.28, 1.12], [0.28, 1.78], [0.2, 1.84], [-0.12, 1.84], [-0.12, 1.12]];
    sweep(M, O.chain, PA, L.Yc, B.trim, B.sw, PA);
  }
  /* The attic. AD: how far back it runs from the street -- short of the back wall. */
  const depth = b.depth;
  let AD = Math.min(6.5, depth - 2.5, 0.85 * insetLimit(O.chain)), attic = st.attic;
  if (attic === 'mansard' && AD < 2.3) attic = 'stone';   // too tight a prow for a slope and a flat: a stone attic, shallower
  AD = Math.max(0.6, AD);
  if (attic === 'mansard') {
    const MS = [[-0.55, 0], [-1.45, 2.85]], MT = [[-1.45, 2.85], [-1.75, 3.1], [-AD, 3.1]], MB = [[-AD, 3.1], [-AD, 0]];
    const cap = [[-0.55, 0], [-1.45, 2.85], [-1.75, 3.1], [-AD, 3.1], [-AD, 0]];
    sweep(M, O.chain, MS, L.Yr, lin(SLATE), S_RIBS);
    sweep(M, O.chain, MT, L.Yr, lin(LEAD), S_PAINT);
    sweep(M, O.chain, MB, L.Yr, B.stone, B.sw, cap);
    // dormers: one a bay, in the slate
    for (let i = 0; i < O.nStreet; i++) {
      const e = O.edges[i];
      if (e.L < 2.6) continue;
      const nb = Math.max(1, Math.round((e.L - 1.1) / B.bayT)), bw = (e.L - 1.1) / nb;
      for (let k = 0; k < nb; k++) {
        const c = 0.55 + bw * (k + 0.5), w = Math.min(1.3, bw * 0.42), y1 = L.Yr + 0.5, y2 = L.Yr + 2.25;
        ebox(M, e, c - w / 2, c + w / 2, y1, y2, -1.5, -0.62, 'FLR', B.trim, B.sw);
        eglass(M, e, c - w / 2 + 0.14, c + w / 2 - 0.14, y1 + 0.16, y2 - 0.14, -0.59, lin(0x151b22), rnd() < 0.3 ? WARM.map((v) => v * 0.16) : null, rnd());
        pediment(M, e, c - w / 2 - 0.08, c + w / 2 + 0.08, y2, 0.45, -1.5, -0.56, lin(LEAD), S_PAINT);
      }
    }
  } else {
    const SA = [[-0.3, 0], [-0.3, 2.5], [-0.14, 2.56], [-0.14, 2.76], [-0.2, 2.82], [-AD, 2.82], [-AD, 0]];
    sweep(M, O.chain, SA, L.Yr, B.stone, B.sw, SA);
    for (let i = 0; i < O.nStreet; i++) {
      const e = O.edges[i];
      if (e.L < 2.6) continue;
      const nb = Math.max(1, Math.round((e.L - 1.1) / B.bayT)), bw = (e.L - 1.1) / nb;
      for (let k = 0; k < nb; k++) { const c = 0.55 + bw * (k + 0.5); eglass(M, e, c - 0.5, c + 0.5, L.Yr + 0.7, L.Yr + 2.0, -0.27, lin(0x151b22), rnd() < 0.3 ? WARM.map((v) => v * 0.16) : null, rnd()); }
    }
  }
  // the roof: the whole outline at the cornice top (earcut: a corner's L is not convex)
  {
    const tri = THREE.ShapeUtils.triangulateShape(O.ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
    for (const t of tri) M.poly(t.map((i) => [O.ring[i][0], L.Yr, O.ring[i][1]]), [0, 1, 0], lin(ROOF), S_TOP);
  }
  // back walls and party walls, only where they show
  const roofOf = (n) => (n ? levels(n.style).Yr : -1);
  for (let i = O.nStreet; i < O.edges.length; i++) {
    const e = O.edges[i], pw = O.party[i];
    if (pw === undefined) { plainWall(M, e, -0.25, L.Yr, L, B, lit, true, rnd); continue; }   // a back wall
    const [nb, atStart] = pw;
    if (!nb) { plainWall(M, e, -0.25, L.Yr, L, B, lit, true, rnd); continue; }               // an exposed end over a gap: nobody next door
    // next door is there: our wall shows above its roof, and wherever we run deeper than it does
    const dn = Math.min(e.L, nb.depth ?? e.L), hn = roofOf(nb);
    const s0 = atStart ? 0 : e.L - dn, s1 = atStart ? dn : e.L;
    if (hn < L.Yr - 0.05) eface(M, e, s0, s1, hn, L.Yr, 0, B.stone, B.sw);
    if (dn < e.L - 0.05) eface(M, e, atStart ? dn : 0, atStart ? e.L : e.L - dn, -0.25, L.Yr, 0, B.stone, B.sw);
  }
  // chimney stacks on the party walls, behind the attic
  for (const i of Object.keys(O.party)) {
    const e = O.edges[+i];
    if (!e || e.L < AD + 3 || rnd() < 0.3) continue;
    const s = e.L * 0.55, ya = L.Yr, yb = L.Yr + 3.1 + 1.3;
    ebox(M, e, s - 0.8, s + 0.8, ya, yb, -0.95, -0.05, 'FBLRT', B.base, B.sw);
    for (const q of [-0.3, 0.3]) ebox(M, e, s + q - 0.13, s + q + 0.13, yb, yb + 0.55, -0.62, -0.38, 'FBLRT', lin(POTS), S_PAINT);
  }
  if (b.kind === 'corner') cornerFeature(M, B, O, L, rnd, out);

  // a lamp under the fascia at the middle of the longest street face: the shop light, a night-light candidate
  const lampE = b.kind === 'plot' ? O.edges[b.returnL ? 1 : 0] : O.edges.slice(0, O.nStreet).reduce((a, c) => (c.L > a.L ? c : a));
  const lp = EP(lampE, lampE.L / 2, 1.2, L.y0 + st.ground - 1.3), sh = B.shops[0];
  _col.setRGB(sh.col[0], sh.col[1], sh.col[2]);
  const lamps = sh.lit ? [{ x: lp[0], y: lp[1], z: lp[2], colour: _col.getHex(), intensity: 26, range: 13, glare: 0.9 }] : [];
  return { lamps, boxes: boxesOf(b, out.top), top: out.top };
}

/**
 * Collision boxes in districtWorld's shape ({ x, z, angle, hw, hd, height },
 * +X = (cos angle, sin angle), as vehicle/collision.js reads them). A plot is
 * one box on its front chord. A corner wing that is not a rectangle -- a
 * flatiron's -- is cut into strips along its front, each box the part of the
 * strip that is inside the wing at BOTH its ends, so no box ever stands on the
 * pavement of the other street.
 */
export function boxesOf(b, height) {
  const out = [];
  const fronts = b.kind === 'plot' ? [[b.parts[0], b.u]] : [[b.parts[0], b.ua], [b.parts[1], b.ub]];
  for (const [ring, u] of fronts) {
    const vx = -u[1], vz = u[0];
    const pr = ring.map(([x, z]) => [x * u[0] + z * u[1], x * vx + z * vz]);
    let s0 = Infinity, s1 = -Infinity;
    for (const [s] of pr) { s0 = Math.min(s0, s); s1 = Math.max(s1, s); }
    // the ring's extent across at a given s (convex: one interval)
    const span = (s) => {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < pr.length; i++) {
        const p = pr[i], q = pr[(i + 1) % pr.length];
        if ((p[0] - s) * (q[0] - s) > 0) continue;
        const t = Math.abs(q[0] - p[0]) < 1e-9 ? 0 : (s - p[0]) / (q[0] - p[0]);
        const v = p[1] + (q[1] - p[1]) * Math.max(0, Math.min(1, t));
        lo = Math.min(lo, v); hi = Math.max(hi, v);
        if (Math.abs(q[0] - p[0]) < 1e-9) { lo = Math.min(lo, p[1], q[1]); hi = Math.max(hi, p[1], q[1]); }
      }
      return [lo, hi];
    };
    const a = span(s0 + 0.05), c = span(s1 - 0.05);
    const rect = Math.abs(a[0] - c[0]) < 0.4 && Math.abs(a[1] - c[1]) < 0.4;
    const n = rect ? 1 : Math.max(2, Math.ceil((s1 - s0) / 1.5));   // a corner wing narrows to a point at the corner: 5 m strips left a ~5 x 5 m hole there (review, HULL_PROBES replay)
    for (let k = 0; k < n; k++) {
      const sa = s0 + ((s1 - s0) * k) / n, sb = s0 + ((s1 - s0) * (k + 1)) / n;
      const A = span(sa + 0.02), Bs = span(sb - 0.02);
      const lo = rect ? Math.min(A[0], Bs[0]) : Math.max(A[0], Bs[0]), hi = rect ? Math.max(A[1], Bs[1]) : Math.min(A[1], Bs[1]);
      if (!(hi - lo > 0.6)) continue;
      const sm = (sa + sb) / 2, vm = (lo + hi) / 2;
      out.push({ x: u[0] * sm + vx * vm, z: u[1] * sm + vz * vm, angle: Math.atan2(u[1], u[0]), hw: (sb - sa) / 2, hd: (hi - lo) / 2, height, district: 'KINGSWAY', art: true, regent: true });
    }
  }
  return out;
}

/**
 * Every Regent building a chunk owns, as ONE geometry for tokyoFacadeMaterial,
 * plus their collision boxes and shop lamps. A generator: `tick` is the chunk
 * build's own clock check (districtWorld #buildSteps), called between
 * buildings so a dense chunk spreads over frames like every other step.
 */
export function* regentChunk(district, key, tick = null) {
  const list = regentPlan(district).byChunk.get(key);
  if (!list || !list.length) return null;
  const [ix, iz] = key.split(',').map(Number);
  return yield* regentSteps(list, ix * 256, iz * 256, tick);
}
/** Any list of planned buildings into one geometry, the generator's work in one go (the viewer, the tests). */
export function regentGeometry(list, ox = 0, oz = 0) {
  const g = regentSteps(list, ox, oz, null);
  let r;
  do { r = g.next(); } while (!r.done);
  return r.value;
}
/* Meshers are pooled: a dense chunk's buffers are ~7 MB of typed arrays, and
   a fresh set per chunk (grown twice on a dense one) was most of the build's
   garbage -- a major GC waiting to land mid-drive. A build takes one and gives
   it back when it is done; one parked mid-chunk and then abandoned simply
   never comes back, and the next build makes another. build() slices
   exact-size arrays out for the GPU. The pool keeps at most one, and none
   past 160k vertices (~10 MB), so what stays resident is bounded. */
const POOL = [];
function* regentSteps(list, ox, oz, tick) {
  let need = 0;
  for (const b of list) need += b.kind === 'corner' ? 6200 : 3600;   // vertices; measured means 5.3k / 3.1k, the Mesher grows past it
  const M = (POOL.pop() ?? new Mesher()).reset(ox, oz, need);
  const lamps = [], boxes = [];
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, top = 0;
  for (const b of list) {
    const r = regentBuilding(M, b);
    lamps.push(...r.lamps); boxes.push(...r.boxes);
    for (const p of b.parts) for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    top = Math.max(top, r.top);
    if (tick) yield* tick('regent');
  }
  const geo = M.build(), tris = M.tris;
  if (!POOL.length && M.vcap <= 160000) POOL.push(M);
  /* The sphere from the footprints (every part stands inside its outline, the
     cornice 1 m out): a scan of ~100k vertices was 1.5 ms of one step. */
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, top / 2, cz), Math.hypot((x1 - x0) / 2 + 1.5, top / 2 + 1, (z1 - z0) / 2 + 1.5));
  return { geo, lamps, boxes, tris, count: list.length };
}
/** `?noregent` turns the street wall off. */
export const regentEnabled = () => !(typeof location !== 'undefined' && new URLSearchParams(location.search).has('noregent'));
