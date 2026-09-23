/**
 * The compact city (2026-09-23).
 *
 * The owner asked for "make the game smaller ... for now". Halstead Bay is
 * 4.2 x 3.0 km and 240 km of road; the playable city is now the middle of it:
 * Little Tokyo, the Kingsway grid round it, the Old Quarter's east bank and the
 * top of Harbour Point -- 1.48 km^2, 35.8 km of road, 328 of the graph's 1,789
 * nodes in ONE connected component. The rest of the bay is still drawn (far
 * LOD, skyline, the lift bridge across the river) but is not played: jobs,
 * traffic, the crowd, missions and respawns live inside, the car is held
 * inside by a soft wall, and the chunk streamer only builds the city plus a
 * 128 m margin. `?fullmap` (or localStorage hb.map = 'full') is the whole bay,
 * exactly as before; `?compact` forces this back on.
 *
 * WHY A POLYGON AND NOT A RECTANGLE. Every district grid is tilted a little
 * (Northline -0.05 rad, Old Quarter -0.18, Steelgate -0.09, Harbour Point
 * 0.42), so any axis-aligned edge runs lengthwise down SOME street: the best
 * rectangle tried (x 1700-3100, z 850-2050) lays 941 m of wall along one road.
 * Measured in node against public/halstead-bay.district.json:
 *   west   the river centreline. Straight to 8.5 m between z 900 and 2060 and
 *          the river is 110 m wide, so WATER is the boundary (GTA's way).
 *   north  23 m outside road 94 (a 30 m Northline street merging into the
 *          Kingsway boundary road 28) and the Old Quarter boundary road 27.
 *   east   x = 2955: 0 m of parallel tarmac in the gap between the Kingsway
 *          east boundary road (x ~2882, road 17) and the next Steelgate street.
 *   south  parallel to Harbour Point street 256, 23 m to its SSW, so Harbour
 *          Point's own streets cross it at 66 degrees, not along it.
 * 37 road crossings (5 of them mid-span on river decks at 7.6 m), the longest
 * tarmac run along the outline 81 m. Every Little Tokyo block is >= 60 m in;
 * the spawn (2354,1408) is 499 m in.
 *
 * Pure: no three, no DOM. Everything here is tested in test/playArea.test.js.
 */

import { KERB_H } from './metrics.js';

export const MAP_KEY = 'hb.map';

/** [x, z] vertices, metres. Derivation in the header. */
export const COMPACT_POLY = [[1509, 930], [1905, 931], [2955, 878.7], [2955, 2362.5], [1743.5, 1820.5]];

/* Halstead Raceway, as a polygon: world/raceTrack.js isRacewayArea's two
   rectangles (the access causeway x 3400-3520 z 2400-2480, the island x
   3440-4220 z 2420-3040) traced as one outline. It sits in the bay 600 m from
   the compact city, and /tp track, Shift+T and the phone card still take you
   there -- so the wall treats it as a second island you may stand on. The
   test holds this to isRacewayArea on a grid, so the two cannot drift. */
export const RACEWAY_POLY = [
  [3400, 2400], [3520, 2400], [3520, 2420], [4220, 2420],
  [4220, 3040], [3440, 3040], [3440, 2480], [3400, 2480],
];

/* The three places the compact city was missing: the file's 2 hospitals, 6
   police stations and its garages all stand outside it, so WASTED and BUSTED
   woke you up beyond the wall. Pavement spots (tarmacDepth 5.6-7, off every
   deck and out of the water), found by walking the kerb near a chosen block.
   Same shape as the file's own places ({type, name, x, y}: y is z). */
export const COMPACT_CHOP = { x: 2662, z: 1888 };
export const COMPACT_PLACES = [
  { type: 'hosp', name: 'Kingsway General Hospital', x: 2243, y: 1180 },
  { type: 'police', name: 'Kingsway Precinct', x: 2860, y: 1344 },
  { type: 'garage', name: 'Harbour Chop Shop', x: COMPACT_CHOP.x, y: COMPACT_CHOP.z },
];

/** `?fullmap` > `?compact` > the stored choice (hb.map) > compact. Mirrors game/difficulty.js pickDifficulty. */
export function pickMapMode(search = '', stored = null) {
  const q = new URLSearchParams(search);
  if (q.has('fullmap')) return 'full';
  if (q.has('compact')) return 'compact';
  return stored === 'full' || stored === 'compact' ? stored : 'compact';
}

/**
 * A play area from one polygon or a list of disjoint ones (the city plus the
 * raceway island). `contains` is inside ANY ring; `probe` is the signed
 * distance to the union's outline (negative inside) with the closest outline
 * point and the OUTWARD unit normal there.
 *
 * probe() writes into ONE object it owns and returns it -- the wall calls it
 * at 120 Hz for the car and there is no reason to allocate. Read what you need
 * before the next call.
 */
export function makePlayArea(polys) {
  const rings = Array.isArray(polys?.[0]?.[0]) ? polys : [polys];
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const packed = rings.map((poly) => {
    const n = poly.length;
    // per edge: ax az vx vz 1/l^2 onx onz (outward normal of the edge itself)
    const ex = new Float64Array(n * 7);
    let area2 = 0;
    for (let i = 0; i < n; i++) {
      const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % n];
      area2 += ax * bz - bx * az;
    }
    const s = area2 > 0 ? 1 : -1;   // winding: which side of each edge is out
    for (let i = 0; i < n; i++) {
      const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % n];
      const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz, l = Math.sqrt(l2) || 1;
      // (vz, -vx) is to the right of the edge; out is right for a positive-area ring
      ex.set([ax, az, vx, vz, l2 ? 1 / l2 : 0, (s * vz) / l, (-s * vx) / l], i * 7);
      x0 = Math.min(x0, ax); x1 = Math.max(x1, ax); z0 = Math.min(z0, az); z1 = Math.max(z1, az);
    }
    return { poly, n, ex };
  });

  const inRing = (r, x, z) => {
    const p = r.poly;
    let c = false;
    for (let i = 0, j = r.n - 1; i < r.n; j = i++) {
      const xi = p[i][0], zi = p[i][1], xj = p[j][0], zj = p[j][1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const contains = (x, z) => {
    for (let k = 0; k < packed.length; k++) if (inRing(packed[k], x, z)) return true;
    return false;
  };

  const out = { d: 0, px: 0, pz: 0, nx: 1, nz: 0 };
  const probe = (x, z) => {
    let bestD = Infinity, bpx = 0, bpz = 0, bnx = 1, bnz = 0, bin = false;
    for (let k = 0; k < packed.length; k++) {
      const r = packed[k], ex = r.ex;
      let d2 = Infinity, px = 0, pz = 0, enx = 1, enz = 0;
      for (let i = 0; i < r.n; i++) {
        const o = i * 7, ax = ex[o], az = ex[o + 1], vx = ex[o + 2], vz = ex[o + 3];
        let t = ((x - ax) * vx + (z - az) * vz) * ex[o + 4];
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = ax + vx * t, cz = az + vz * t, dx = x - cx, dz = z - cz, e2 = dx * dx + dz * dz;
        if (e2 < d2) { d2 = e2; px = cx; pz = cz; enx = ex[o + 5]; enz = ex[o + 6]; }
      }
      const inside = inRing(r, x, z), dd = Math.sqrt(d2), sd = inside ? -dd : dd;
      // the union's signed distance is the least over disjoint rings
      if (sd < bestD) {
        bestD = sd; bpx = px; bpz = pz; bin = inside;
        /* Outward normal: from the closest outline point away from the inside,
           which is right at a vertex too (the edge normal is not). On the line
           itself there is no direction to take, so the edge's own normal. */
        let nx = x - px, nz = z - pz;
        const l = Math.hypot(nx, nz);
        if (l > 1e-6) { nx /= l; nz /= l; if (bin) { nx = -nx; nz = -nz; } } else { nx = enx; nz = enz; }
        bnx = nx; bnz = nz;
      }
    }
    out.d = bestD; out.px = bpx; out.pz = bpz; out.nx = bnx; out.nz = bnz;
    return out;
  };

  return { poly: rings[0], rings, bbox: { x0, z0, x1, z1 }, contains, probe };
}

/* The scrub along the wall, per SECOND of contact (holdInside's `dt`). It was
   a flat x0.985 per call, and the car calls at 120 Hz: leaning on the wall at
   full throttle from 100 km/h with the nose 1.7 deg in left 20 / 4 / 0 km/h
   after 1 / 2 / 3 s -- a silent ~2 g brake, the opposite of a slide -- and the
   tank, helicopter and walker, called once a frame, scrubbed at a rate that
   followed the frame rate. exp(-0.1 * t), measured the same way with the
   shipped stepVehicle (test/playArea.test.js): 94 / 84 / 70 km/h at 1.7 deg,
   90 / 78 / 64 at 11.5 deg; no scrub at all is 102 / 101 / 95. Most of what
   is lost is the car yawing into the wall (the heading is not touched), not
   the scrub. */
export const WALL_SCRUB = 0.1;

/**
 * The soft wall. Keeps a body ({x, z, vx, vz}) at least `inset` metres inside
 * the area: pushed back along the outward normal and the OUTWARD part of its
 * velocity removed, the rest kept but for a light scrub over `dt` seconds of
 * contact (WALL_SCRUB, per second -- dt 0 scrubs nothing), so you slide along
 * the barrier instead of sticking to it. Writes nothing else -- no impact,
 * no hitAt -- so touching the edge costs no damage (damage.js), shakes no
 * camera (camera.js) and earns no star. Returns true when it moved the body.
 *
 * A negative inset lets the body that far PAST the outline (the helicopter
 * may hover up to 150 m out over the river, heliInset). Cost: one probe,
 * ~0.2 us in node for the city + raceway union -- 1.6 us a frame at the car's
 * worst 8 steps.
 */
export function holdInside(body, area, inset = 2.6, dt = 0) {
  const p = area.probe(body.x, body.z);
  if (p.d <= -inset) return false;
  const push = p.d + inset;
  body.x -= p.nx * push;
  body.z -= p.nz * push;
  const vo = (body.vx || 0) * p.nx + (body.vz || 0) * p.nz;
  if (vo > 0) {
    const keep = dt > 0 ? Math.exp(-WALL_SCRUB * dt) : 1;
    body.vx = ((body.vx || 0) - p.nx * vo) * keep;
    body.vz = ((body.vz || 0) - p.nz * vo) * keep;
  }
  return true;
}

/**
 * The flown helicopter's inset, by height above the ground under it. Up high
 * it may range 150 m past the wall (the view over the river); the allowance
 * shrinks 3 m per metre of descent and is 3.5 m INSIDE once it is low enough
 * to step out of (main.js useVehicle: <= 3.5 m). A flat -150 let it land 150 m
 * out, and the walker it put down there was then held 0.5 m inside -- a 150 m
 * jump in one frame, onto the river's centreline on the west side. Now a
 * descent past the wall drifts back in as it comes down (at 3x the sink rate)
 * and every exit lands inside: 3.5 m in, minus the 2.6 m exit offset.
 */
export function heliInset(alt) {
  return 3.5 - Math.min(153.5, Math.max(0, (alt || 0) - 3.5) * 3);
}

/**
 * A dispatch request's position, facing into the city. game/dispatch.js
 * #findStreetDrop walks 24-80 m AHEAD of the caller's yaw (+-0.8 rad) to the
 * first pavement, with no idea of the wall: facing out within 80 m of it, the
 * tank or helicopter landed past it, where a walker held 0.5 m inside could
 * never reach it. When the ray `reach` m ahead leaves the area, the yaw turns
 * to the inward normal (dispatch.js's heading is (cos yaw, -sin yaw)).
 */
export function dropFacingIn(area, pos, reach = 90) {
  const yaw = pos.yaw || 0;
  const fx = Math.cos(yaw), fz = -Math.sin(yaw);
  if (area.probe(pos.x + fx * reach, pos.z + fz * reach).d < -4) return pos;
  const p = area.probe(pos.x, pos.z);
  return { ...pos, yaw: Math.atan2(p.nz, -p.nx) };   // heading (-nx, -nz): into the city
}

/**
 * Which chunk builds which stretch of a road SEGMENT. districtWorld builds a
 * segment -- tarmac, lamps, trees, kerbside props, parked cars -- whole, in
 * the chunk of its midpoint. Segments are long (grid streets run 1-1.4 km
 * straight across the map), so in the compact city 17 whose midpoint cell is
 * never built still ran INTO the city for 30-175 m: 1,408 m of tarmac inside
 * the wall with no near road, no lamp, no tree, no kerb furniture. Moving each
 * one whole to a kept cell would have built 15 km of street past the margin,
 * so the segment is split instead:
 *   - the stretch that lies in kept cells ([lo, hi) metres along it, sampled
 *     every `step` m) is built by the kept cell covering most of it;
 *   - the rest ([0, lo) and [hi, L)) stays with the midpoint's cell, which
 *     only photo mode ever builds -- so a lifted clip still draws it all, once.
 * Returns null when nothing needs splitting: no clip, a kept midpoint (the
 * whole segment is built there, as before), or no kept cell on it at all.
 * Keys are districtWorld's `${ix},${iz}`. Seeds along a segment are taken
 * from its own start (dressing.js hash(s.ax + t...)), so a split stretch
 * places exactly the props -- and lamp heads -- the whole segment would.
 */
export function segmentSplit(s, kept, chunk = 256, step = 4) {
  if (!kept) return null;
  const mid = `${Math.floor((s.ax + s.bx) / 2 / chunk)},${Math.floor((s.az + s.bz) / 2 / chunk)}`;
  if (kept.has(mid)) return null;
  const L = Math.hypot(s.bx - s.ax, s.bz - s.az), n = Math.max(1, Math.ceil(L / step)), dl = L / n;
  const len = new Map();
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < n; j++) {
    const f = (j + 0.5) / n;
    const k = `${Math.floor((s.ax + (s.bx - s.ax) * f) / chunk)},${Math.floor((s.az + (s.bz - s.az) * f) / chunk)}`;
    if (!kept.has(k)) continue;
    len.set(k, (len.get(k) ?? 0) + dl);
    lo = Math.min(lo, j * dl); hi = Math.max(hi, (j + 1) * dl);
  }
  if (!len.size) return null;
  let key = null, most = 0;
  for (const [k, l] of len) if (l > most) { most = l; key = k; }
  const rest = [];
  if (lo > 0.5) rest.push([0, lo]); else lo = 0;
  if (hi < L - 0.5) rest.push([hi, L]); else hi = L;
  return { key, lo, hi, mid, rest, L };
}

/** Is `t` metres along a segment inside one of its build `pieces` ([[lo, hi), ...]; null = the whole segment)? */
export function pieceHas(pieces, t) {
  if (!pieces) return true;
  for (let i = 0; i < pieces.length; i++) if (t >= pieces[i][0] && t < pieces[i][1]) return true;
  return false;
}

/**
 * The road graph inside the area: nodes inside, edges whose EVERY point is
 * inside, then only the largest connected component (a stub cut off by the
 * outline would strand whatever spawned on it). Same {nodes, edges} shape as
 * the file's graph, same node and edge objects -- nothing indexes edges by id.
 */
export function clipGraph(graph, area) {
  const inside = new Set();
  for (const nd of graph.nodes) if (area.contains(nd.x, nd.y)) inside.add(nd.id);
  let edges = graph.edges.filter((e) => inside.has(e.a) && inside.has(e.b)
    && e.points.every(([x, z]) => area.contains(x, z)));
  const parent = new Map();
  for (const id of inside) parent.set(id, id);
  const find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
  for (const e of edges) { const a = find(e.a), b = find(e.b); if (a !== b) parent.set(a, b); }
  const size = new Map();
  for (const id of inside) { const r = find(id); size.set(r, (size.get(r) || 0) + 1); }
  let main = null, best = 0;
  for (const [r, n] of size) if (n > best) { best = n; main = r; }
  const keep = new Set();
  for (const id of inside) if (find(id) === main) keep.add(id);
  edges = edges.filter((e) => keep.has(e.a));
  return { nodes: graph.nodes.filter((nd) => keep.has(nd.id)), edges };
}

/**
 * Which 256 m chunk cells the streamer may build: every cell whose centre or
 * a corner passes `keep` -- the same five-point sample as districtWorld's
 * #cellTouches. With keep = "within 128 m of the outline" no playable ground
 * is lost: every point of a cell is within 128 m of one of those five points.
 * Keys are districtWorld's `${ix},${iz}`.
 */
export function keptCellSet(keep, bounds, chunk = 256) {
  const set = new Set();
  const cols = Math.ceil((bounds?.w ?? 4200) / chunk), rows = Math.ceil((bounds?.h ?? 3000) / chunk);
  for (let cx = -1; cx <= cols; cx++) {
    for (let cz = -1; cz <= rows; cz++) {
      const x0 = cx * chunk, z0 = cz * chunk, x1 = x0 + chunk, z1 = z0 + chunk;
      if (keep(x0 + chunk / 2, z0 + chunk / 2) || keep(x0, z0) || keep(x1, z0) || keep(x0, z1) || keep(x1, z1)) {
        set.add(`${cx},${cz}`);
      }
    }
  }
  return set;
}

/**
 * Does the detail ring hide the far stand-in (or far glare head) at (px, pz)?
 * districtWorld #cullFar's rule: inside the square ring of half-size R about
 * the streaming centre AND owned by a cell that will be built -- `kept` --
 * unless the clip is lifted. "Owned" is the cell whose chunk builds the real
 * thing: a stand-in's BLOCK centre (blkByChunk), a lamp head's SEGMENT
 * (ownerCell), never the stand-in's or the head's own position -- at the
 * clip's edge the two differ, and keying by position left 17 stand-ins hidden
 * over nothing (holes) and 18 drawn through the building their chunk built.
 * A stand-in whose owner the compact city never builds stays up, or the
 * ring's edge would be a hole in the skyline.
 */
export function ringHides(px, pz, x, z, R, kept = true, lifted = false) {
  return Math.abs(px - x) < R && Math.abs(pz - z) < R && (lifted || !!kept);
}

/* ------------------------------------------------------------------ *
 *  Dressing the wall
 *
 *  An invisible stop reads as a bug; GTA closes its map with roadworks and
 *  hoardings. The outline is walked edge by edge and each stretch gets what
 *  a real closure would put there, 1.0 m OUTSIDE the line (the car's centre
 *  is held 2.6 m inside, its nose at +2.25 m, so it stops ~1 m short of the
 *  concrete and never needs a collision box for it):
 *    - a bridge deck or ramp (elevation > 0.5, on tarmac or its pavement):
 *      jersey barriers, at the DECK's height -- the segment's own centreline
 *      deck, interpolated the way districtWorld lays the tarmac, never
 *      elevationAt at the barrier's own spot (CLAUDE.md, the banked bridge).
 *      Found doing this: two of the five river crossings (1517,960 and
 *      1734,1785) are boundary roads flattened into single 824-861 m segments
 *      with both ends on land, so their tarmac is DRAWN flat at y 0 across the
 *      river while elevationAt lifts a car onto a 7.6 m span there. Their
 *      barriers follow the drawn road; the mismatch predates this file;
 *    - open water: nothing, the river is the wall;
 *    - road or pavement: jersey barriers, one every 2.4 m (their length);
 *    - inside a building footprint: nothing, the building is the wall;
 *    - open ground: timber hoarding, one every 4 m (its width).
 *  Authored catalogue assets (props/roadblock_jersey, props/hoarding), so
 *  rule 3 holds. Local +X runs along the outline; the hoarding's printed
 *  face (+Z, tools/assets/props/hoarding.mjs) looks INTO the city.
 * ------------------------------------------------------------------ */

const WALL_OUT = 1.0;       // metres outside the outline
export const JERSEY = 'props/roadblock_jersey';
export const HOARDING = 'props/hoarding';

/** [{name, x, y, z, yaw}] along the first ring of `area`. Cold path: once at boot. */
export function wallProps(district, area) {
  const poly = area.poly;
  /* Building footprints near the outline, as rotated rects (districtWorld's
     far-solid maths), bucketed on a 32 m grid: a linear scan per sample was
     most of this function's time. */
  const FG = 32, fgrid = new Map(), fkey = (ix, iz) => ix * 4096 + iz;
  for (const bl of district.blocks) {
    if (Math.abs(area.probe(bl.x, bl.y).d) > Math.hypot(bl.w, bl.h) / 2 + 20) continue;
    const ca = Math.cos(bl.angle || 0), sa = Math.sin(bl.angle || 0);
    for (const g of district.buildingsOf(bl.id)) {
      const lx = g.x + g.w / 2, lz = g.y + g.d / 2;
      const f = { x: bl.x + lx * ca - lz * sa, z: bl.y + lx * sa + lz * ca, hw: g.w / 2, hd: g.d / 2, ca, sa };
      const r = Math.hypot(f.hw, f.hd);
      for (let ix = Math.floor((f.x - r) / FG); ix <= Math.floor((f.x + r) / FG); ix++) {
        for (let iz = Math.floor((f.z - r) / FG); iz <= Math.floor((f.z + r) / FG); iz++) {
          const k = fkey(ix, iz);
          (fgrid.get(k) ?? fgrid.set(k, []).get(k)).push(f);
        }
      }
    }
  }
  const inBuilding = (x, z) => {
    const list = fgrid.get(fkey(Math.floor(x / FG), Math.floor(z / FG)));
    if (!list) return false;
    for (const f of list) {
      const dx = x - f.x, dz = z - f.z;
      if (Math.abs(dx * f.ca + dz * f.sa) < f.hw && Math.abs(-dx * f.sa + dz * f.ca) < f.hd) return true;
    }
    return false;
  };
  /* The road surface under (x, z): the segment whose carriageway the point is
     deepest into, and its deck height by the same end-centre interpolation
     districtWorld uses for the tarmac quad. */
  const surface = (x, z) => {
    let best = Infinity, y = 0;
    for (const s of district.segmentsNear(x, z, 48)) {
      const vx = s.bx - s.ax, vz = s.bz - s.az, l2 = vx * vx + vz * vz;
      let t = l2 ? ((x - s.ax) * vx + (z - s.az) * vz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - s.ax - vx * t, z - s.az - vz * t) - s.half;
      if (d < best) {
        best = d;
        const ea = district.elevationAt(s.ax, s.az), eb = district.elevationAt(s.bx, s.bz);
        y = ea + (eb - ea) * t;
      }
    }
    return { depth: best, y };
  };
  /* Deck, then water, then road, then building, else open. Tarmac proper
     (td < 0) off a deck is never open water, so it skips the water test --
     half the samples, and the river walk is the dearest call here. */
  const classify = (x, z) => {
    const td = district.tarmacDepth(x, z);
    if (td < 5.5 && district.elevationAt(x, z) > 0.5) return 'deck';
    if (td < 0) return 'road';
    if (district.inOpenWater(x, z)) return 'water';
    if (td < 5.5) return 'road';
    if (inBuilding(x, z)) return 'building';
    return 'open';
  };

  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    // outward: the side of the edge the area does not contain
    let nx = uz, nz = -ux;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (area.contains(mx + nx * 2, mz + nz * 2)) { nx = -nx; nz = -nz; }
    const at = (t) => [ax + ux * t + nx * WALL_OUT, az + uz * t + nz * WALL_OUT];
    const cls = (t) => classify(...at(t));
    const yaw = Math.atan2(-nx, -nz);       // local +Z (the hoarding's face) looks inward, local +X along the edge
    let s = 0;
    while (s < L - 0.5) {
      const cj = cls(s + 1.2);
      if (cj === 'deck' || cj === 'road') {
        const [x, z] = at(s + 1.2), sf = surface(x, z);
        out.push({ name: JERSEY, x, z, yaw, y: sf.y + (sf.depth > 0 ? KERB_H : 0) });
        s += 2.4;
        continue;
      }
      // a panel needs open ground at its middle and both ends (cj stands in for the near end)
      if (cj === 'open' && s + 4 <= L && cls(s + 2) === 'open' && cls(s + 3.7) === 'open') {
        const [x, z] = at(s + 2);
        out.push({ name: HOARDING, x, z, yaw, y: KERB_H + district.elevationAt(x, z) });
        s += 4;
        continue;
      }
      s += cj === 'open' ? 1 : 2;           // water or a building: 2 m steps; open but too short for a panel: 1 m
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  Content that assumed the whole map
 * ------------------------------------------------------------------ */

/* Hand-placed where "the nearest junction" is not the right answer. The
   heist_2 Steelgate stash IS the chop shop's address (garage.js), so it moves
   with it; the gun-shop meet follows Schneider's Guns to the east-bank lot it
   takes when landmarks.js is offered only lots inside (block 244, 1754,1349),
   at node 972 on the lot's corner (a cross, 162 m inside the wall). Keyed
   "x,z" (every step at that address) or "missionId:step" (that step only). */
export const COMPACT_TARGETS = {
  '3662,1221': { x: COMPACT_CHOP.x, z: COMPACT_CHOP.z },
  'heist_2:0': { x: 1793, z: 1371 },
};

/**
 * A mission target, inside. Kept as it is if it is already inside; otherwise
 * the nearest cross/tee node of `nodes` (the compact graph) that is at least
 * `minWall` m from the wall and, when `avoid` is given, at least `minGap` m
 * from it -- two remapped steps of one mission must not collapse onto one
 * junction. Returns {x, z}.
 */
export function remapTarget(t, area, nodes, { minWall = 60, avoid = null, minGap = 150 } = {}) {
  if (area.contains(t.x, t.z)) return { x: t.x, z: t.z };
  let best = null, bd = Infinity;
  for (const n of nodes) {
    if (n.kind !== 'cross' && n.kind !== 'tee') continue;
    if (area.probe(n.x, n.y).d > -minWall) continue;
    if (avoid && Math.hypot(n.x - avoid.x, n.y - avoid.z) < minGap) continue;
    const d = Math.hypot(n.x - t.x, n.y - t.z);
    if (d < bd) { bd = d; best = n; }
  }
  return best ? { x: best.x, z: best.y } : { x: t.x, z: t.z };
}

/**
 * A copy of a story mission with every step's target inside the area (the
 * definition itself is never touched: ?fullmap reads the same table). Steps
 * that shared an address keep sharing it (the depot stand-off holds the same
 * yard it drove to); a moved step keeps 150 m from the step before it.
 */
export function remapMission(def, area, nodes, overrides = COMPACT_TARGETS) {
  const memo = new Map();
  let prev = null;
  const steps = (def.steps ?? []).map((st, i) => {
    if (!st.target) return st;
    const key = `${st.target.x},${st.target.z}`;
    let target = overrides[`${def.id}:${i}`] ?? overrides[key] ?? memo.get(key);
    if (!target) target = remapTarget(st.target, area, nodes, { avoid: prev });
    memo.set(key, target);
    prev = target;
    return target.x === st.target.x && target.z === st.target.z ? st : { ...st, target: { x: target.x, z: target.z } };
  });
  return { ...def, steps };
}
