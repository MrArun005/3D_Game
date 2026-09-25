/**
 * The structure under, beside and over an elevated road.
 *
 * A bridge in Halstead Bay has been a deck quad, a skirt wall dropped from the
 * deck edge to the ground and a blank 1.0 m parapet -- a road on a wall. From
 * the bank you saw a slab; from the deck you saw a wall where the harbour
 * should be. This module is what every bridge, flyover and ramp gets instead,
 * per ROAD SEGMENT, in WORLD space:
 *
 *   1. PIERS every 24-34 m: a tapered concrete shaft down to grade or the
 *      riverbed, a splayed cap under the soffit, and in water a boat-nosed
 *      cutwater at each end of the shaft. Skipped where the deck is under
 *      MIN_SPAN_H -- that is a ramp on an embankment, not a span.
 *   2. FASCIA: a beam under each deck edge so the deck reads DECK_T thick
 *      instead of like paper, with a haunch deepening it over every pier.
 *   3. PARAPET: a low solid upstand (a kerb you cannot drive through) and a
 *      REAL railing above it -- posts every POST_STEP carrying two or three
 *      rails -- so the water is visible through it.
 *   4. LAMPS every LAMP_STEP, alternating sides: column, arm, head. The head
 *      positions come back in `lamps` for the night light pool
 *      (districtWorld headsByChunk) and the glare sprites (world/glare.js).
 *   5. EXPANSION JOINTS: a dark 60 mm strip across the deck over each pier,
 *      and an abutment block where the deck meets the bank.
 *   6. SOFFIT: a thin slab under the carriageway between the two fascias.
 *      `A.mat.tarmac` is FrontSide, so the deck quad is invisible from below;
 *      the old skirt hid that by walling the span in down to the ground. Turn
 *      the skirt into a soffit band (which is the point of all this) and you
 *      can see the sky through the road from a boat. 12 triangles a segment.
 *
 * WHAT THIS REFUSES TO BUILD. district.js lifts a BAND (`half + 5.5`) about
 * the plan's BRIDGE polyline, but the deck quad is the ROAD graph's segment at
 * its own `half`. Where the two disagree the band cuts the carriageway down
 * the middle and elevationAt returns the deck height on one kerb and 0 on the
 * other: measured over the plan file, 51 of 163 elevated segments have their
 * two long edges more than a metre apart, and on HALSTEAD LIFT BRIDGE it is
 * the full 7.60 m for 480 m of arterial, because the road graph runs ~16 m
 * west of the bridge polyline. A fascia and a railing built on the low edge of
 * such a quad stand on the ground beside the road, and a pier under the
 * average of the two holds nothing (71 of 388 piers, measured). So a segment
 * whose deck edges disagree by more than the deck is thick builds NOTHING and
 * the alignment gets fixed upstream. It costs five bridges nothing: MARROW
 * ROAD, BROADWAY, STEEL MILE and NORTHGATE are all inside 0.30 m.
 *
 * THE DECK HEIGHT IS THE TARMAC'S, NOT elevationAt's. districtWorld draws the
 * carriageway from District.deckProfile: the two END CENTRES lerped on a plain
 * segment, knots every <= DECK_STEP m on a river-bridge arch (2026-09-25).
 * Sampling elevationAt anywhere else (a smoothstep on a ramp) would put the
 * fascia, the upstand and the railing through the road surface on every
 * approach, so every height here comes from that same profile, flat across.
 *
 * SEAMS. districtWorld buckets a segment into every chunk it touches, so a
 * span that crosses a chunk boundary is built twice. world/decals.js already
 * solved this and this follows it exactly: everything is seeded from the
 * SEGMENT's own endpoints (never from the chunk), every run is parameterised
 * by distance `t` from the segment's start, and `opts.bounds` clips the
 * centreline to the caller's chunk ONCE into [tLo, tHi]. Continuous runs are
 * built over that interval and point items (piers, posts, lamps, joints) are
 * kept when their t falls in it -- so the two chunks cut the same span into
 * two complementary halves: no doubled pier, no dropped post, no reshuffle
 * when the ring changes.
 *
 * Materials are the artKit keys (world/artBuildings.js artMaterial), so a
 * chunk's spans merge into the SAME per-key meshes as the self-built
 * buildings: concrete, metal, dark. Three keys, zero extra draws.
 */
import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { boxM, quadM, cylM, at, Parts } from './artKit.js';
import { DECK_T, profileAt } from './district.js';

export const WATER_Y = -2.6;        // water.js WATER_Y, and districtWorld's `ground()` over water
const BED_DROP = 3.4;               // how far a pier carries on below the waterline
export const MIN_SPAN_H = 2.5;      // under this the road is on an embankment: no pier
export const PIER_MIN = 24, PIER_MAX = 34;
export const POST_STEP = 2.4;       // railing posts
export const LAMP_STEP = 26;        // lamp columns, alternating sides
export const UPSTAND_H = 0.45;      // the solid part of the parapet
export { DECK_STEP } from './district.js';
const RIB_N = 4;                    // voussoir pieces per arch rib
export const PARAPET_MIN = 1.0;     // a deck lower than this, on land, is a kerb-high embankment or the street itself: no parapet
const SOLID_STEP = 8;               // parapet collision boxes, each with its own baseY
const UPSTAND_T = 0.34;
const CAP_H = 0.9;                  // pier cap
const ABUT_D = 3.2;                 // abutment block, along the span

const CONCRETE = 0xf2efe8, CONCRETE_DARK = 0xd8d2c6, STEEL = 0xb9bec4, IRON = 0x2a2e33;
const LAMP_COLOUR = 0xffd9a0;

const _m = new THREE.Matrix4(), _r = new THREE.Matrix4();

/** Scale a geometry's UVs (cylM ships 0..1; the library sets want metres). */
function uvScale(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

/**
 * A box of cross-section w x h running from p0 to p1 in 3D -- the workhorse.
 * artKit's `at` only turns about Y and every run here is pitched (a ramp
 * climbs 9.4 m), so this composes Ry(yaw) * Rz(pitch) itself.
 */
export function beam(p0, p1, w, h, hex = CONCRETE) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 1e-4)) return null;
  const g = boxM(len, h, w, hex);
  const yaw = -Math.atan2(dz, dx);
  const pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  _m.makeRotationY(yaw).multiply(_r.makeRotationZ(pitch));
  _m.setPosition((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2);
  return g.applyMatrix4(_m);
}

/**
 * A box whose top face is a different size from its bottom -- the pier shaft
 * (batters inward as it rises) and the pier cap (splays outward). Origin at
 * the BASE, centred in XZ, per the asset convention. BoxGeometry gives each
 * corner its own vertex per face, so recomputing normals after moving the top
 * four keeps the faces flat.
 */
export function taper(wBot, dBot, wTop, dTop, h, hex = CONCRETE) {
  const g = boxM(wBot, h, dBot, hex);
  g.translate(0, h / 2, 0);
  const p = g.attributes.position;
  const sx = wTop / wBot, sz = dTop / dBot;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > h * 0.5) { p.setX(i, p.getX(i) * sx); p.setZ(i, p.getZ(i) * sz); }
  }
  g.computeVertexNormals();
  return g;
}

/** Clip the centreline t-range [0, L] to an axis-aligned chunk box. */
export function clipToBounds(ax, az, ux, uz, L, b) {
  if (!b) return [0, L];
  let lo = 0, hi = L;
  for (const [p, d, min, max] of [[ax, ux, b.x0, b.x1], [az, uz, b.z0, b.z1]]) {
    if (Math.abs(d) < 1e-9) { if (p < min || p >= max) return [0, -1]; continue; }
    let t0 = (min - p) / d, t1 = (max - p) / d;
    if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
    lo = Math.max(lo, t0); hi = Math.min(hi, t1);
  }
  return [lo, hi];
}

/**
 * N copies of one prototype in one geometry. The railing posts are 70% of the
 * parts in a span and every one of them is the same 0.09 m box; building them
 * as N BoxGeometries cost 23 us each (measured in node over the worst bridge
 * chunk: 984 parts, 28 ms). One buffer filled from the prototype is ~1 us a
 * copy, and it hands mergeGeometries one input instead of sixty.
 */
export function repeat(proto, xforms) {
  if (!xforms.length) { proto.dispose(); return null; }
  const n = proto.attributes.position.count;
  const keys = Object.keys(proto.attributes);
  const out = new THREE.BufferGeometry();
  const dst = {};
  for (const k of keys) dst[k] = new Float32Array(proto.attributes[k].array.length * xforms.length);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  xforms.forEach((M, i) => {
    nm.getNormalMatrix(M);
    for (const k of keys) {
      const src = proto.attributes[k].array, base = i * src.length;
      if (k === 'position') for (let j = 0; j < n; j++) v.fromArray(src, j * 3).applyMatrix4(M).toArray(dst[k], base + j * 3);
      else if (k === 'normal') for (let j = 0; j < n; j++) v.fromArray(src, j * 3).applyMatrix3(nm).normalize().toArray(dst[k], base + j * 3);
      else dst[k].set(src, base);
    }
  });
  for (const k of keys) out.setAttribute(k, new THREE.BufferAttribute(dst[k], proto.attributes[k].itemSize));
  if (proto.index) {
    const ia = proto.index.array, ix = new Uint32Array(ia.length * xforms.length);
    for (let i = 0; i < xforms.length; i++) for (let j = 0; j < ia.length; j++) ix[i * ia.length + j] = ia[j] + i * n;
    out.setIndex(new THREE.BufferAttribute(ix, 1));
  }
  proto.dispose();
  return out;
}

/**
 * @param seg      a district segment: { ax, az, bx, bz, half, cls }
 * @param district the District (elevationAt, inOpenWater)
 * @param opts     { bounds?, seed? }
 * @returns { parts: [{mat, geo}], lamps: [{x,y,z,colour}],
 *            solids: [{x,z,hw,hd,angle}], piers: [{x,z,t,base,top,deck}],
 *            carried: boolean -- piers hold this deck up, so districtWorld's
 *            skirt must be a soffit band and not a wall to the ground }
 */
export function buildSpan(seg, district, opts = {}) {
  const P = new Parts(), lamps = [], solids = [];
  const pierList = [];   // {x, z, t, base, top, deck} -- for the tests, and for any caller that wants a solid under the deck
  const out = { parts: P.list, lamps, solids, piers: pierList, carried: false };
  if (!seg) return out;

  const ax = seg.ax, az = seg.az, bx = seg.bx, bz = seg.bz;
  const dx = bx - ax, dz = bz - az;
  const L = Math.hypot(dx, dz);
  if (!(L > 2)) return out;
  const ux = dx / L, uz = dz / L;                 // along the span
  const nx = -uz, nz = ux;                        // across it
  const half = seg.half ?? 6;
  const yawAcross = -Math.atan2(nz, nx);
  const elev = (x, z, h) => district.elevationAt?.(x, z, h) ?? 0;

  /* The four corner heights the carriageway quad itself uses. Side +1 is the
     +n edge (q[0] -> q[1]), side -1 the other (q[3] -> q[2]). */
  const yA = [elev(ax - nx * half, az - nz * half), elev(ax + nx * half, az + nz * half)];
  const yB = [elev(bx - nx * half, bz - nz * half), elev(bx + nx * half, bz + nz * half)];
  /* The deck is the centreline PROFILE, flat across -- the same heights
     districtWorld gives the tarmac (2026-09-25). This used to lerp the four
     CORNERS, and a corner of an expressway segment that lands on a street
     passing underneath reads that street (elevationAt's under-the-flyover
     guard answers 0 there): measured on segment 683 at (3032-3078, 559-600),
     both end centres 9.4 m, the fascia and parapet on one side sloped from
     9.4 m to the ground while the tarmac stayed flat -- and the parapet's
     collision box took baseY 0, a wall across every street under it. On an
     arch the profile has a knot every <= DECK_STEP m; elsewhere it is the two
     end centres. */
  const prof = deckProfile(district, seg);
  const arch = prof.knots.length > 2;
  const edgeY = (side, t) => profileAt(prof, t);
  const midY = (t) => (edgeY(1, t) + edgeY(-1, t)) * 0.5;
  const peak = Math.max(yA[0], yA[1], yB[0], yB[1], prof.peak);
  /* Runs between the profile's knots: a straight beam from tLo to tHi is a
     CHORD of an arch and would cut through the deck at the crown. One piece
     on a linear segment, so nothing changes there. */
  const runs = (a, b) => {
    const ts = [a, ...prof.knots.filter((t) => t > a + 0.01 && t < b - 0.01), b];
    const out = [];
    for (let i = 0; i < ts.length - 1; i++) out.push([ts[i], ts[i + 1]]);
    return out;
  };
  if (peak <= 0.12) return out;                   // not elevated: districtWorld already skips it
  /* ...and not a DECK either, if its two kerbs disagree by more than it is
     thick: that quad is the elevation band's edge cutting the carriageway, not
     a bridge (see the header). Nothing false gets built on it. */
  /* (Not on the expressway or its ramps: there the kerbs disagree because a
     street passes UNDER a corner, which says nothing about the deck.) */
  if (seg.cls !== 'freeway' && seg.cls !== 'ramp'
    && Math.max(Math.abs(yA[0] - yA[1]), Math.abs(yB[0] - yB[1])) > DECK_T) return out;

  const pt = (t, off, y) => [ax + ux * t + nx * off, y, az + uz * t + nz * off];
  const wet = (x, z) => !!district.inOpenWater?.(x, z);
  const groundY = (x, z) => (wet(x, z) ? WATER_Y : 0);

  /* Seeded from the segment's own endpoints, canonicalised so the order the
     endpoints happen to be stored in can never change the structure. */
  const flip = (ax * 8191 + az) > (bx * 8191 + bz);
  const [k0, k1] = flip ? [[bx, bz], [ax, az]] : [[ax, az], [bx, bz]];
  /* Everything periodic (piers, posts, lamps) is laid out from the CANONICAL
     end and mapped back, so the structure is a property of the two points on
     the map and not of the order the planner happened to store them in. */
  const tOf = (tc) => (flip ? L - tc : tc);
  const h32 = Math.round(k0[0] * 13.7) * 73856093 ^ Math.round(k0[1] * 13.7) * 19349663
            ^ Math.round(k1[0] * 13.7) * 83492791 ^ Math.round(k1[1] * 13.7) * 2654435761 ^ (opts.seed ?? 0);
  const rnd = mulberry32(h32 >>> 0);

  // ---------------------------------------------------------------- piers
  const pierStep = PIER_MIN + rnd() * (PIER_MAX - PIER_MIN);
  const pierW = Math.min(2 * half * 0.5, 9);      // across the span
  const pierT = 2.2;                              // along it, at the top
  /* WHERE the piers go is settled before any clipping, and `carried` with it.
     districtWorld draws the skirt for the WHOLE segment in every chunk that
     holds it, so its wall-or-soffit decision has to be the same in all of
     them -- including a chunk the segment's bounding box touches but its
     centreline never enters, which clips to an empty range and returns below. */
  /* A wide deck stands on TWO columns under a crosshead, a narrow one on one
     (2026-09-25) -- the GTA IV expressway silhouette. And no column stands in
     a road: a pier whose column would touch a carriageway underneath slides
     along the span (up to 12 m either way) to the nearest clear spot, or is
     dropped. Measured before: 31 expressway piers stood on a street's
     tarmac, one in the middle of the arterial at (3054,563). */
  const twin = 2 * half >= 20;
  const colOff = twin ? [-half * 0.55, half * 0.55] : [0];
  const colR = twin ? 1.3 : Math.min(2 * half * 0.5, 9) * 0.61;
  const clearAt = (t) => colOff.every((o) => {
    const [cx, , cz] = pt(t, o, 0);
    return !roadUnder(district, seg, cx, cz, colR + 0.6, midY(t) - DECK_T - 1);
  });
  const piers = [];
  for (let tc = pierStep * 0.5, n = 0; tc < L - 1 && n < 64; tc += pierStep, n++) {
    let t = tOf(tc);
    if (midY(t) < MIN_SPAN_H) continue;           // below that it is an embankment, not a span
    if (!clearAt(t)) {
      let moved = null;
      for (let d = 2; d <= 12 && moved === null; d += 2) for (const sg of [1, -1]) {
        const u = t + sg * d;
        if (moved === null && u > 1 && u < L - 1 && midY(u) >= MIN_SPAN_H && clearAt(u)) moved = u;
      }
      if (moved === null) continue;
      t = moved;
    }
    piers.push(t);
  }
  piers.sort((p, q) => p - q);
  out.carried = piers.length > 0;

  const [tLo, tHi] = clipToBounds(ax, az, ux, uz, L, opts.bounds);
  if (tHi <= tLo) return out;
  const inChunk = (t) => t >= tLo && t < tHi;
  const push = (mat, geo) => { if (geo) P.push(mat, geo); };

  for (const t of piers) {
    const y = midY(t);
    if (!inChunk(t)) continue;                    // the neighbouring chunk owns this one
    const [px, , pz] = pt(t, 0, 0);
    const g0 = groundY(px, pz);
    const inWater = wet(px, pz);
    const base = inWater ? WATER_Y - BED_DROP : g0;
    const capTop = y - DECK_T;
    const shaftH = capTop - CAP_H - base;
    if (shaftH < 0.6) continue;
    pierList.push({ x: px, z: pz, t, base, top: capTop, deck: y, cols: colOff.map((o) => { const c = pt(t, o, 0); return [c[0], c[2]]; }), colR });
    if (twin) {
      /* two round-cornered columns (8-sided, battered) and a crosshead the
         full deck width under the girders -- the cap IS the crosshead */
      for (const o of colOff) {
        const [cx, , cz] = pt(t, o, 0);
        const cb = inWater ? base : groundY(cx, cz);
        const h = capTop - CAP_H - cb;
        if (h < 0.6) continue;
        const col = cylM(1, h, CONCRETE_DARK, 8);
        uvScale(col, 2 * Math.PI * colR, h);
        col.scale(colR, 1, colR);
        col.translate(0, h / 2, 0);
        push('concrete', at(col, cx, cb, cz, yawAcross));
      }
      push('concrete', at(taper(2 * half - 1.2, pierT, 2 * half - 0.4, pierT + 0.6, CAP_H, CONCRETE), px, capTop - CAP_H, pz, yawAcross));
    } else {
      // the shaft batters in as it rises; the cap splays back out under the deck
      push('concrete', at(taper(pierW * 1.22, pierT * 1.45, pierW, pierT, shaftH, CONCRETE_DARK), px, base, pz, yawAcross));
      push('concrete', at(taper(pierW, pierT, pierW + 1.5, pierT + 1.1, CAP_H, CONCRETE), px, capTop - CAP_H, pz, yawAcross));
    }
    if (inWater) {
      // boat-nosed cutwater at each end of the shaft, up to just over the waterline
      const cwH = Math.min(shaftH, (WATER_Y + 1.6) - base);
      if (cwH > 0.5) for (const s of [1, -1]) {
        const nose = cylM(1, cwH, CONCRETE_DARK, 3);
        uvScale(nose, 2.4 * Math.PI, cwH);
        nose.rotateY(Math.PI / 2);
        nose.scale(1.7 / 1.5, 1, (pierW * 0.5) / 0.8660254);
        nose.translate(0.5 * (1.7 / 1.5), cwH / 2, 0);
        push('concrete', at(nose, px + ux * s * (pierT * 0.72), base, pz + uz * s * (pierT * 0.72),
          -Math.atan2(uz * s, ux * s)));
      }
    }
  }

  pierList.sort((p, q) => p.t - q.t);

  /* ARCH RIBS on the river bridges (2026-09-25): under each fascia, from pier
     cap to pier cap, a segmental rib whose intrados springs at the cap and
     meets the soffit at mid-span -- the deck reads as carried by arches, not
     laid on posts. RIB_N straight voussoir pieces per rib (12 triangles each),
     built by the chunk that owns the arch's mid-point. River arches only
     (district.archAt); the expressway keeps its straight girders. */
  const riverArch = arch && district.archAt?.((ax + bx) / 2, (az + bz) / 2);
  if (riverArch) for (let i = 0; i < piers.length - 1; i++) {
    const t0 = piers[i], t1 = piers[i + 1], tm = (t0 + t1) / 2;
    if (!inChunk(tm)) continue;
    for (const side of [1, -1]) {
      const off = (half - 0.7) * side;
      const spring = (t) => midY(t) - DECK_T - CAP_H;
      const yb = (u) => {
        const t = t0 + (t1 - t0) * u;
        const lo = spring(t0) + (spring(t1) - spring(t0)) * u;
        return lo + (midY(t) - DECK_T - 0.12 - lo) * Math.sin(Math.PI * u);
      };
      for (let k = 0; k < RIB_N; k++) {
        const ua = k / RIB_N, ub = (k + 1) / RIB_N;
        const ta = t0 + (t1 - t0) * ua, tb = t0 + (t1 - t0) * ub;
        push('concrete', beam(pt(ta, off, yb(ua) - 0.35), pt(tb, off, yb(ub) - 0.35), 0.8, 0.7, CONCRETE_DARK));
      }
    }
  }

  /* The soffit. A.mat.tarmac is FrontSide, so from underneath the carriageway
     quad is not there; the skirt wall used to hide that by enclosing the span
     down to the ground. Once it is a 0.9 m band you are looking up through the
     road, which is exactly the view this whole module exists for. A thin slab
     between the two fascias closes it: one box, 12 triangles, and it follows
     the deck's own pitch. */
  const softW = 2 * half - 0.9;
  if (softW > 0.5) for (const [a, b] of runs(tLo, tHi)) {
    push('concrete', beam(pt(a, 0, midY(a) - DECK_T + 0.05), pt(b, 0, midY(b) - DECK_T + 0.05),
      softW, 0.1, CONCRETE_DARK));
  }

  // ---------------------------- deck edge: fascia, haunch, upstand, railing
  const rails = 2 * half >= 30 ? 3 : 2;   // 3 on the expressway; 2 on the river arches (their ribs cost the third rail's triangles, 2026-09-25)
  const railYs = rails === 3 ? [0.30, 0.62, 0.94] : [0.42, 0.90];
  const postH = railYs[railYs.length - 1] + 0.08;

  for (const side of [1, -1]) {
    /* 0.29 back from the edge with a 0.5 m face puts the fascia's outer skin
       40 mm INSIDE the deck edge. districtWorld's skirt quad is exactly on
       that edge, so this cannot z-fight it wherever the skirt survives (a low
       embankment ramp); where it does not, the 40 mm reads as a drip groove,
       which is what a real deck edge has. */
    const off = (half - 0.29) * side;
    // fascia beam: the deck reads DECK_T thick from the bank and from a boat
    for (const [a, b] of runs(tLo, tHi)) {
      push('concrete', beam(pt(a, off, edgeY(side, a) - DECK_T * 0.5), pt(b, off, edgeY(side, b) - DECK_T * 0.5), 0.5, DECK_T, CONCRETE));
    }
    // haunch: the fascia deepens over each pier, the way a real girder does
    // (not under a river arch: the ribs spring from the pier caps there instead)
    if (!riverArch) for (const t of piers) {
      const a = Math.max(tLo, t - 3.2), b = Math.min(tHi, t + 3.2);
      if (b - a < 0.5) continue;
      push('concrete', beam(pt(a, off, edgeY(side, a) - DECK_T - 0.3), pt(b, off, edgeY(side, b) - DECK_T - 0.3), 0.56, 0.62, CONCRETE));
    }
    // the solid upstand: low enough to see over, solid enough to stop a car
    const uOff = (half - UPSTAND_T * 0.5) * side;
    /* The parapet stops where the bridge meets the bank (2026-09-25). An arch
       lands at grade on its end node, and that node is a junction: the quay
       street crosses right there, so a parapet run to t = 0 stood across its
       carriageway (a 0.45 m kerb with a solid behind it). It covers the deck
       where it is PARAPET_MIN up or over water -- which also takes it off the
       last few metres of every expressway ramp's foot, where it stood on the
       street the ramp lands on. */
    const [gLo, gHi] = guardedRange(prof, (t) => { const p = pt(t, 0, 0); return wet(p[0], p[2]); }, tLo, tHi);
    /* ...and it OPENS wherever another road's carriageway reaches this edge at
       the same level (2026-09-25): a junction on the deck (DOCK ROAD across
       the lift deck), an on-ramp's gore merging into the expressway. A parapet
       there was a kerb-and-rail wall across a live lane. A street passing
       UNDER the edge is at another level and keeps the parapet over it.
       Sampled every metre; the open stretches come back as intervals. */
    const ivs = [];
    if (gHi > gLo + 0.5) {
      let open = null;
      for (let t = gLo; ; t = Math.min(gHi, t + 1)) {
        const [px, , pz] = pt(t, uOff, 0);
        const ok = !junctionAt(district, seg, px, pz, edgeY(side, t));
        if (ok && open === null) open = t;
        if ((!ok || t >= gHi) && open !== null) { if (t - open > 0.5) ivs.push([open, t]); open = null; }
        if (t >= gHi) break;
      }
    }
    for (const [ia, ib] of ivs) for (const [a, b] of runs(ia, ib)) {
      const ea = edgeY(side, a), eb = edgeY(side, b);
      push('concrete', beam(pt(a, uOff, ea + UPSTAND_H * 0.5), pt(b, uOff, eb + UPSTAND_H * 0.5), UPSTAND_T, UPSTAND_H, CONCRETE));
      // ...and a REAL railing above it: you can see the water through this one
      for (const ry of railYs) {
        push('metal', beam(pt(a, uOff, ea + UPSTAND_H + ry), pt(b, uOff, eb + UPSTAND_H + ry), 0.07, 0.05, STEEL));
      }
    }
    const inIv = (t) => ivs.some(([a, b]) => t >= a && t <= b);
    const postAt = [];
    for (let tc = POST_STEP * 0.5, n = 0; tc < L && n < 400; tc += POST_STEP, n++) {
      const t = tOf(tc);
      if (!inChunk(t) || !inIv(t)) continue;
      const [px, , pz] = pt(t, uOff, 0);
      postAt.push(new THREE.Matrix4().makeTranslation(px, edgeY(side, t) + UPSTAND_H + postH * 0.5, pz));
    }
    push('metal', repeat(boxM(0.09, postH, 0.09, STEEL), postAt));   // one geometry for the whole run of posts
    /* Collision: one box per SOLID_STEP m, each with its own baseY (2026-09-25).
       One box for the whole clipped run took the LOWEST end as its base, so on
       any ramp segment (0 -> 9.4 m) the parapet counted as standing on the
       ground along its entire length: a street passing under the high end hit
       a wall 4-9 m below the deck. Measured over the full map before this: 18
       of 47 ground crossings of a span stopped the car dead.
       baseY (2026-09-14): resolveBoxes skips a box the car is driving under.
       The boxes of one interval abut exactly and share a line, so a car
       scraping along the parapet slides from one to the next (the resolver
       pushes along the box normal; test/bridges.test.js drives it). */
    for (const [ia, ib] of ivs) {
      const nS = Math.max(1, Math.ceil((ib - ia) / SOLID_STEP));
      for (let i = 0; i < nS; i++) {
        const a = ia + (ib - ia) * i / nS, b = ia + (ib - ia) * (i + 1) / nS;
        const pa = pt(a, uOff, 0), pb = pt(b, uOff, 0);
        const baseY = Math.min(edgeY(side, a), edgeY(side, b), edgeY(side, (a + b) / 2));
        /* Where a street at grade OWNS the spot (elevationAt's "the road wins
           ties against a ramp"), a low ramp foot's parapet is not a wall on it:
           measured, ramp 760 lands across street 596 at (3221,1284) with its
           parapet 0.5-1.5 m up while the street there is at 0. Pieces the car
           could not pass under anyway (base under 1.7 m + 0.62 ride) and that
           stand > 0.3 m over the surface there go. */
        const mx = (pa[0] + pb[0]) * 0.5, mz = (pa[2] + pb[2]) * 0.5;
        if (baseY < 2.4 && elev(mx, mz, baseY) < baseY - 0.3) continue;   // the surface on the parapet's own layer
        solids.push({ x: mx, z: mz, hw: (b - a) / 2, hd: UPSTAND_T * 0.5 + 0.15, angle: Math.atan2(dz, dx), baseY });
      }
    }
  }

  // ---------------------------------------------------------------- lamps
  for (let tc = LAMP_STEP * 0.5, n = 0; tc < L && n < 64; tc += LAMP_STEP, n++) {
    const t = tOf(tc);
    if (!inChunk(t)) continue;
    if (midY(t) < 1.2) continue;                  // still on the embankment
    const side = n % 2 ? 1 : -1;                  // alternating, indexed from the segment start
    const uOff = (half - UPSTAND_T * 0.5) * side;
    const y = edgeY(side, t) + UPSTAND_H;
    const [px, , pz] = pt(t, uOff, 0);
    const colH = 4.2;
    push('metal', at(boxM(0.16, colH, 0.16, IRON), px, y + colH * 0.5, pz, yawAcross));
    const armL = 1.1, hx = px - nx * side * armL, hz = pz - nz * side * armL;
    push('metal', beam([px, y + colH, pz], [hx, y + colH + 0.22, hz], 0.11, 0.11, IRON));
    push('metal', at(boxM(0.4, 0.16, 0.24, IRON), hx, y + colH + 0.14, hz, yawAcross));
    lamps.push({ x: hx, y: y + colH + 0.06, z: hz, colour: LAMP_COLOUR });
  }

  // ------------------------------------------- expansion joints, abutments
  for (const t of piers) {
    if (!inChunk(t)) continue;
    const strip = quadM(2 * half, 0.06, 0x101215);
    strip.rotateX(-Math.PI / 2);
    const [jx, , jz] = pt(t, 0, 0);
    push('dark', at(strip, jx, midY(t) + 0.02, jz, yawAcross));
  }
  for (const end of [0, 1]) {
    const t = end ? L : 0;
    if (!inChunk(Math.min(t, L - 0.001))) continue;
    const y = midY(t);
    if (y < MIN_SPAN_H) continue;
    const probe = end ? L + 6 : -6;               // 6 m past the end, along the same line
    const [qx, , qz] = pt(probe, 0, 0);
    if (y - elev(qx, qz) < 0.8) continue;         // the deck carries on: not a bank
    const [px, , pz] = pt(end ? t - ABUT_D * 0.5 : ABUT_D * 0.5, 0, 0);
    const g0 = groundY(px, pz);
    const hgt = y - DECK_T - g0;
    if (hgt < 0.5) continue;
    push('concrete', at(taper(2 * half + 1.4, ABUT_D + 1.0, 2 * half + 0.6, ABUT_D, hgt, CONCRETE_DARK),
      px, g0, pz, yawAcross));
  }

  return out;
}

/** The deck height along a road segment -- District.deckProfile (district.js),
 *  re-exported here beside the structure that reads it. */
export function deckProfile(district, seg) {
  if (district?.deckProfile) return district.deckProfile(seg);
  const L = Math.hypot(seg.bx - seg.ax, seg.bz - seg.az) || 1;   // a stub district: the end-centre lerp
  const yA = district?.elevationAt?.(seg.ax, seg.az) ?? 0, yB = district?.elevationAt?.(seg.bx, seg.bz) ?? 0;
  return { knots: [0, L], ys: [yA, yB], peak: Math.max(yA, yB) };
}
export { profileAt } from './district.js';

/**
 * Does another road's carriageway reach (x, z) at height y (+-1.5 m)? A
 * junction or a merge on the deck -- not a street passing underneath.
 */
function roadUnder(district, seg, x, z, r, below) {
  if (!district?.segmentsNear) return false;
  for (const o of district.segmentsNear(x, z, 40)) {
    if (o === seg) continue;
    const vx = o.bx - o.ax, vz = o.bz - o.az, l2 = vx * vx + vz * vz;
    if (!l2) continue;
    let t = ((x - o.ax) * vx + (z - o.az) * vz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    if (Math.hypot(x - o.ax - vx * t, z - o.az - vz * t) >= o.half + r) continue;
    const oy = district.deckAt ? district.deckAt(o, t * Math.sqrt(l2)) : 0;
    if (oy < below) return true;                 // a carriageway under the deck: the column would stand in it
  }
  return false;
}

function junctionAt(district, seg, x, z, y) {
  if (!district?.segmentsNear) return false;
  for (const o of district.segmentsNear(x, z, 40)) {
    if (o === seg) continue;
    const vx = o.bx - o.ax, vz = o.bz - o.az, l2 = vx * vx + vz * vz;
    if (!l2) continue;
    let t = ((x - o.ax) * vx + (z - o.az) * vz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    if (Math.hypot(x - o.ax - vx * t, z - o.az - vz * t) >= o.half - 0.3) continue;
    const oy = district.deckAt ? district.deckAt(o, t * Math.sqrt(l2)) : 0;
    if (Math.abs(oy - y) < 1.5) return true;
  }
  return false;
}

/** [lo, hi] of [tLo, tHi] where an arch deck needs a parapet: PARAPET_MIN up, or over water. */
function guardedRange(prof, wetAt, tLo, tHi) {
  const need = (t) => profileAt(prof, t) >= PARAPET_MIN || wetAt(t);
  let lo = tLo, hi = tHi;
  while (lo < hi && !need(lo)) lo += 0.5;
  while (hi > lo && !need(hi)) hi -= 0.5;
  return [lo, hi];
}

/**
 * Does this segment run with the plan's SIGNATURE bridge?
 *
 * There WAS a through-truss here, on the theory that the signature bridge
 * needed a silhouette. It has gone, for two reasons measured rather than
 * argued. First, a through-truss is not a vertical-lift bridge, which is what
 * the plan calls HALSTEAD LIFT BRIDGE and what the owner said was missing;
 * world/liftBridge.js builds that one properly -- towers, sheaves,
 * counterweights, cables, and its own approach piers, railings and lamps over
 * the whole 381 m -- so anything this module put there was a second structure
 * inside the first (measured: 16 piers and 125 truss members inside its
 * footprint, three of the piers in the navigation channel the lift span exists
 * to open). Second, its panel grid was laid out from the CHUNK-clipped extent
 * instead of the segment, so a span cut by a chunk boundary got two different
 * panel spacings and a doubled vertical at the seam -- the one thing the
 * header promises cannot happen.
 *
 * The predicate stays because the caller still needs it: districtWorld must
 * not dress a bridge world/liftBridge.js has already built.
 */
export function signatureBridge(seg, district) {
  /* The lift system's twin deck (district.js #liftSystem) is the bridge now:
     every road running with it inside its width -- the lift road AND the
     Embankment -- is world/liftBridge.js's to build (2026-09-25). */
  const sys = district?.liftSystem;
  if (sys && seg) {
    const [a, b] = [sys.a, sys.b], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    const mx = (seg.ax + seg.bx) / 2, mz = (seg.az + seg.bz) / 2;
    const t = (mx - a[0]) * ux + (mz - a[1]) * uz, off = Math.abs((mx - a[0]) * -uz + (mz - a[1]) * ux);
    const sl = Math.hypot(seg.bx - seg.ax, seg.bz - seg.az) || 1;
    const par = Math.abs(((seg.bx - seg.ax) * ux + (seg.bz - seg.az) * uz) / sl) > 0.7;
    return par && off < sys.width / 2 && t > -20 && t < L + 20;
  }
  const bridges = district?.data?.bridges;
  if (!bridges || !seg) return false;
  const mx = (seg.ax + seg.bx) / 2, mz = (seg.az + seg.bz) / 2;
  const sl = Math.hypot(seg.bx - seg.ax, seg.bz - seg.az) || 1;
  const sx = (seg.bx - seg.ax) / sl, sz = (seg.bz - seg.az) / sl;
  for (const br of bridges) {
    if (!br.signature) continue;
    const pts = br.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0], az = pts[i][1];
      const vx = pts[i + 1][0] - ax, vz = pts[i + 1][1] - az, l2 = vx * vx + vz * vz;
      let t = l2 ? ((mx - ax) * vx + (mz - az) * vz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (Math.hypot(mx - ax - vx * t, mz - az - vz * t) >= br.width / 2 + 4) continue;
      /* ...and RUNS WITH it. DOCK ROAD crosses the lift bridge at right
         angles and its midpoint is inside the corridor; district.js's
         elevationAt draws the same distinction with the same 0.7. */
      const l = Math.sqrt(l2) || 1;
      if (Math.abs((sx * vx + sz * vz) / l) > 0.7) return true;
    }
  }
  return false;
}

/** Triangles in a built span -- the budget check, used by the tests and tools. */
export const spanTris = (built) => built.parts.reduce(
  (n, p) => n + (p.geo.index ? p.geo.index.count : p.geo.attributes.position.count) / 3, 0);
