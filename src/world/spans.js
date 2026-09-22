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
 * THE DECK HEIGHT IS LINEAR ALONG THE SEGMENT, NOT SAMPLED. districtWorld's
 * carriageway is ONE quad per segment with elevationAt() at its four corners,
 * so between them the tarmac interpolates linearly. Sampling elevationAt in
 * the middle (which is a smoothstep on a ramp) would put the fascia, the
 * upstand and the railing through the road surface on every approach. Every
 * height here is a lerp of the same four corner values the tarmac uses.
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
import { DECK_T } from './district.js';

export const WATER_Y = -2.6;        // water.js WATER_Y, and districtWorld's `ground()` over water
const BED_DROP = 3.4;               // how far a pier carries on below the waterline
export const MIN_SPAN_H = 2.5;      // under this the road is on an embankment: no pier
export const PIER_MIN = 24, PIER_MAX = 34;
export const POST_STEP = 2.4;       // railing posts
export const LAMP_STEP = 26;        // lamp columns, alternating sides
export const UPSTAND_H = 0.45;      // the solid part of the parapet
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
  const elev = (x, z) => district.elevationAt?.(x, z) ?? 0;

  /* The four corner heights the carriageway quad itself uses. Side +1 is the
     +n edge (q[0] -> q[1]), side -1 the other (q[3] -> q[2]). */
  const yA = [elev(ax - nx * half, az - nz * half), elev(ax + nx * half, az + nz * half)];
  const yB = [elev(bx - nx * half, bz - nz * half), elev(bx + nx * half, bz + nz * half)];
  const si = (side) => (side > 0 ? 1 : 0);
  const edgeY = (side, t) => yA[si(side)] + (yB[si(side)] - yA[si(side)]) * (t / L);
  const midY = (t) => (edgeY(1, t) + edgeY(-1, t)) * 0.5;
  const peak = Math.max(yA[0], yA[1], yB[0], yB[1]);
  if (peak <= 0.12) return out;                   // not elevated: districtWorld already skips it
  /* ...and not a DECK either, if its two kerbs disagree by more than it is
     thick: that quad is the elevation band's edge cutting the carriageway, not
     a bridge (see the header). Nothing false gets built on it. */
  if (Math.max(Math.abs(yA[0] - yA[1]), Math.abs(yB[0] - yB[1])) > DECK_T) return out;

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
  const piers = [];
  for (let tc = pierStep * 0.5, n = 0; tc < L - 1 && n < 64; tc += pierStep, n++) {
    const t = tOf(tc);
    if (midY(t) >= MIN_SPAN_H) piers.push(t);     // below that it is an embankment, not a span
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
    pierList.push({ x: px, z: pz, t, base, top: capTop, deck: y });
    // the shaft batters in as it rises; the cap splays back out under the deck
    push('concrete', at(taper(pierW * 1.22, pierT * 1.45, pierW, pierT, shaftH, CONCRETE_DARK), px, base, pz, yawAcross));
    push('concrete', at(taper(pierW, pierT, pierW + 1.5, pierT + 1.1, CAP_H, CONCRETE), px, capTop - CAP_H, pz, yawAcross));
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

  /* The soffit. A.mat.tarmac is FrontSide, so from underneath the carriageway
     quad is not there; the skirt wall used to hide that by enclosing the span
     down to the ground. Once it is a 0.9 m band you are looking up through the
     road, which is exactly the view this whole module exists for. A thin slab
     between the two fascias closes it: one box, 12 triangles, and it follows
     the deck's own pitch. */
  const softW = 2 * half - 0.9;
  if (softW > 0.5) {
    push('concrete', beam(pt(tLo, 0, midY(tLo) - DECK_T + 0.05), pt(tHi, 0, midY(tHi) - DECK_T + 0.05),
      softW, 0.1, CONCRETE_DARK));
  }

  // ---------------------------- deck edge: fascia, haunch, upstand, railing
  const rails = 2 * half >= 20 ? 3 : 2;
  const railYs = rails === 3 ? [0.30, 0.62, 0.94] : [0.42, 0.90];
  const postH = railYs[railYs.length - 1] + 0.08;

  for (const side of [1, -1]) {
    /* 0.29 back from the edge with a 0.5 m face puts the fascia's outer skin
       40 mm INSIDE the deck edge. districtWorld's skirt quad is exactly on
       that edge, so this cannot z-fight it wherever the skirt survives (a low
       embankment ramp); where it does not, the 40 mm reads as a drip groove,
       which is what a real deck edge has. */
    const off = (half - 0.29) * side;
    const eLo = edgeY(side, tLo), eHi = edgeY(side, tHi);
    // fascia beam: the deck reads DECK_T thick from the bank and from a boat
    push('concrete', beam(pt(tLo, off, eLo - DECK_T * 0.5), pt(tHi, off, eHi - DECK_T * 0.5), 0.5, DECK_T, CONCRETE));
    // haunch: the fascia deepens over each pier, the way a real girder does
    for (const t of piers) {
      const a = Math.max(tLo, t - 3.2), b = Math.min(tHi, t + 3.2);
      if (b - a < 0.5) continue;
      push('concrete', beam(pt(a, off, edgeY(side, a) - DECK_T - 0.3), pt(b, off, edgeY(side, b) - DECK_T - 0.3), 0.56, 0.62, CONCRETE));
    }
    // the solid upstand: low enough to see over, solid enough to stop a car
    const uOff = (half - UPSTAND_T * 0.5) * side;
    push('concrete', beam(pt(tLo, uOff, eLo + UPSTAND_H * 0.5), pt(tHi, uOff, eHi + UPSTAND_H * 0.5), UPSTAND_T, UPSTAND_H, CONCRETE));
    // ...and a REAL railing above it: you can see the water through this one
    for (const ry of railYs) {
      push('metal', beam(pt(tLo, uOff, eLo + UPSTAND_H + ry), pt(tHi, uOff, eHi + UPSTAND_H + ry), 0.07, 0.05, STEEL));
    }
    const postAt = [];
    for (let tc = POST_STEP * 0.5, n = 0; tc < L && n < 400; tc += POST_STEP, n++) {
      const t = tOf(tc);
      if (!inChunk(t)) continue;
      const [px, , pz] = pt(t, uOff, 0);
      postAt.push(new THREE.Matrix4().makeTranslation(px, edgeY(side, t) + UPSTAND_H + postH * 0.5, pz));
    }
    push('metal', repeat(boxM(0.09, postH, 0.09, STEEL), postAt));   // one geometry for the whole run of posts
    // collision: the parapet line, so the caller can drop districtWorld's own
    const cx = (pt(tLo, uOff, 0)[0] + pt(tHi, uOff, 0)[0]) * 0.5;
    const cz = (pt(tLo, uOff, 0)[2] + pt(tHi, uOff, 0)[2]) * 0.5;
    /* baseY: the deck this parapet stands on (2026-09-14).
       Car/building collision is a 2D footprint test -- resolveBoxes never looked
       at a box's height or the car's y -- so a parapet 7.6 m up in the air was a
       wall across the road passing UNDERNEATH the bridge. "under bridge road i
       cannot pass through" is exactly this. Carrying the base lets the solver
       skip a structure the car is driving below. */
    solids.push({ x: cx, z: cz, hw: (tHi - tLo) / 2, hd: UPSTAND_T * 0.5 + 0.15,
      angle: Math.atan2(dz, dx), baseY: Math.min(edgeY(side, tLo), edgeY(side, tHi)) });
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
