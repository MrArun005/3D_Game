import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as THREE from 'three';
import { mulberry32 } from '../../core/rng.js';
import { GROUND_H, FLOOR_H } from '../tokyo.js';
import { boxM, quadM, cylM, at, faces, onFace, Parts, flickerOf } from '../artKit.js';

/**
 * OLD QUARTER terrace (docs/VISUAL-BRIEF.md: "brick rows, bay windows,
 * stoops, fire escapes; muted brick, cream, green-grey").
 *
 * NOT a free-standing block: the plot is read as a RUN OF NARROW HOUSES.
 * The street frontage (2*hd along +Z -- artKit's front face is +X and its
 * width is 2*hd) is cut into N units of 4.6-7.6 m (one wide house where the
 * plot is too short to halve), each with its own brick tint, its own storey height (+/- 0.25 m, so the eaves line steps along the
 * row), its own door colour, and a brick party-wall pilaster with a stone cap
 * between it and its neighbour. 3-5 storeys.
 *
 * How the openings get DEPTH (the brief's "change of plane", and the reason
 * sun casts a shadow into a window): the unit's brick mass stops REC behind
 * the nominal face and the street elevation is rebuilt in front of it out of
 * a centre pier and a spandrel band per storey. The gaps between them ARE the
 * openings; sashes sit on the mass at the back of a 0.2 m reveal, with a
 * stone lintel over each and a stone sill band per storey standing proud.
 * Everything else is the Old Quarter kit: stoop + moulded surround + fanlight
 * or canopy, a square bay on ~55% of units, a black iron fire escape on ~35%
 * (capped at one per three houses -- 240 triangles each), parapet and coping,
 * chimney stacks with clay pots on the party walls, a hatch housing and the
 * odd aerial. Flanks are blank brick party walls by intent -- this is a
 * terrace, and they are where a ghost-sign decal goes later.
 *
 * Measured (2026-09-12) by replaying the OLD QUARTER's 589 real footprints out
 * of the district file, both street orientations, through ART_CAP: 604 / 1,268
 * / 2,344 triangles (min/mean/max) per building, 1 to 3 houses a plot. The
 * synthetic long terraces the test also covers run to 5,928 across a whole
 * 56 m plot at five storeys, which is what the 6,000 cap is written against.
 * Nothing in the hero block is anywhere near that: the planner draws 6.9-18.8 m
 * of frontage there, so the ART_CAP ([12, 28] in artBuildings.js) never bites.
 *
 * Window state is rolled per window per seed -- dark / dim warm / bright warm
 * / TV-blue (flickering) / curtained -- and counted in `states` so Phase 5 can
 * see the distribution without re-deriving it.
 *
 * Parts merge per material key before returning (<= 8 geometries), same
 * attribute set on every part (artKit paint), local frame origin at the
 * footprint centre on the ground, +X the street.
 */
export const STYLE = 'brickRow';

const REC = 0.22;             // the brick mass sits this far behind the elevation face
const PANE_BACK = 0.02;       // pane in front of the mass -> a 0.20 m reveal
const UNIT_W = 6.5;           // target frontage per house
const PROJ = 1.2;             // hard cap on how far anything leans over the pavement

/* Tints multiply the library texture (artKit MAT_KEYS): near-white is raw. */
const BRICKS = [0xffffff, 0xf1e0d4, 0xe6cbba, 0xd9c0b2, 0xcbb4a9, 0xf7ead9, 0xddc7bd];
const RENDERS = [0xf3ead3, 0xc9d3c5, 0xe2e3d6, 0xdcd3bd];          // cream / green-grey: one unit in six is painted
const DOORS = [0x2f6b4f, 0x7a3a36, 0x33507f, 0x5d5348, 0x2a3b3a];  // green, oxblood, navy, brown, near-black
const STONE = 0xece7dd, SASH = 0xf2efe6, IRON = 0x9aa0a6, LEAD = 0x9aa3a8;
const DAMP = 0.66, SOOT = 0.8;                                     // wear multipliers on the brick tint

/* Window states. `p` is the share, `emit`/`k` the Tokyo emissive, `hex` the
   pane colour by day (glass mat for dark, emit mat for the rest). */
const WARM = [1.0, 0.84, 0.58], COOL = [0.45, 0.62, 1.0], CLOTH = [0.9, 0.82, 0.7];
const STATES = [
  { name: 'dark', p: 0.42, mat: 'glass', hex: 0xdfe4ec },
  { name: 'dim', p: 0.18, mat: 'emit', hex: 0x1a2230, emit: WARM, k: 0.42 },
  { name: 'bright', p: 0.14, mat: 'emit', hex: 0x2a2418, emit: WARM, k: 0.95 },
  { name: 'tv', p: 0.08, mat: 'emit', hex: 0x18202c, emit: COOL, k: 0.8, tv: true },
  { name: 'curtain', p: 0.18, mat: 'emit', hex: 0xbfae95, emit: CLOTH, k: 0.26 },
];

const _m = new THREE.Matrix4();
const tiltX = (geo, a) => geo.applyMatrix4(_m.makeRotationX(a));   // `at` only turns about Y; the stair runs rise along Z
const mul = (hex, k) => (Math.round(((hex >> 16) & 255) * k) << 16) | (Math.round(((hex >> 8) & 255) * k) << 8) | Math.round((hex & 255) * k);
const pick = (rnd, list) => list[Math.floor(rnd() * list.length) % list.length];

export function build(seed, hw, hd, h) {
  const rnd = mulberry32((seed * 2654435761) >>> 0);
  const floors = Math.max(3, Math.min(5, Math.round((h - GROUND_H) / FLOOR_H) + 1));
  const P = new Parts(), lamps = [], units = [], stacks = [];
  const states = { dark: 0, dim: 0, bright: 0, tv: 0, curtain: 0 };
  const F = faces(hw, hd), front = F[0], back = F[1];
  const WALL = hw - REC;                       // the mass's street face

  /** One sash: painted frame quad on the mass, pane just in front, state rolled. */
  const sash = (x, y, z, yaw, w, wh) => {
    P.push('timber', at(quadM(w + 0.14, wh + 0.14, SASH), x, y, z, yaw));
    const r = rnd();
    let acc = 0, st = STATES[STATES.length - 1];
    for (const s of STATES) { acc += s.p; if (r < acc) { st = s; break; } }
    states[st.name]++;
    // ponytail: flickerOf only buzzes one part in seven, which is right for a bulb and wrong for a screen -- a TV that never flickers is just a blue window, so force a phase when it rolls 0
    const flick = st.tv ? flickerOf(rnd) || 3 + rnd() * 3 : 0;
    const gx = x + (yaw === front.yaw ? 0.01 : yaw === back.yaw ? -0.01 : 0);
    P.push(st.mat, at(quadM(w, wh, st.hex, st.emit ?? null, st.k ?? 1, flick), gx, y, z + (yaw === 0 ? 0.01 : yaw === Math.PI ? -0.01 : 0), yaw));
  };

  /* ---- the run of houses ------------------------------------------------ */
  // Measured over the real district file: the OLD QUARTER's 589 built footprints
  // run 6.9-18.8 m of frontage (median ~9.5), so for a frontage of 7.5-11 m NO N
  // gives a 5.5-7.5 m unit -- 9.2 m is either one 9.2 m house or two 4.6 m ones.
  // Two wins (4.6 m is a real Victorian terrace width and the party-wall rhythm
  // is the point), so the band is 4.6 m up to one wide house on a short plot.
  let N = Math.max(1, Math.floor((2 * hd) / UNIT_W));
  while (2 * hd / N > 7.5 && N < 40) N++;
  while (2 * hd / N < 4.6 && N > 1) N--;
  const uw = 2 * hd / N;
  // ponytail: a fire escape is ~240 triangles, so cap them per run the way loft.js caps balconies (the roll is still drawn, so seeds stay stable). They are rare in a real terrace anyway.
  let escLeft = Math.max(1, Math.round(N / 3));

  for (let i = 0; i < N; i++) {
    const zc = -hd + (i + 0.5) * uw;
    const floorH = FLOOR_H + (rnd() - 0.5) * 0.5;                 // +/- 0.25 m: the eaves line steps along the row
    const Hu = GROUND_H + (floors - 1) * floorH;
    const floorY = (f) => (f === 0 ? 0 : GROUND_H + (f - 1) * floorH);
    const rendered = rnd() < 1 / 6;                                // one in six is painted, not bare brick
    const key = rendered ? 'plaster' : 'brick';
    const tint = rendered ? pick(rnd, RENDERS) : pick(rnd, BRICKS);
    const doorSide = rnd() < 0.5 ? -1 : 1;
    const off = Math.min(1.5, uw / 4);                             // door and window columns, one in each half of the unit: at 1.5 fixed, a 4.6 m house hangs its lintels and stone bands over the neighbour (and off the end of the plot)
    const doorZ = zc + doorSide * off, winZ = zc - doorSide * off;
    const bay = rnd() < 0.55, escape = rnd() < 0.35 && escLeft > 0;
    if (escape) escLeft--;
    const bayFloors = bay ? (floors >= 4 && rnd() < 0.4 ? 3 : 2) : 0;
    const winH = Math.min(1.85, floorH - 1.25);                    // sash height on the upper storeys
    const sillY = (f) => floorY(f) + 0.85;

    // the mass (its street face is the back of every reveal) and the plinth the damp climbs
    P.push(key, at(boxM(2 * hw - REC, Hu, uw, tint), -REC / 2, Hu / 2, 0 + zc));
    P.push(key, at(boxM(REC + 0.03, 0.6, uw, mul(tint, DAMP)), WALL + REC / 2, 0.3, zc));

    // the elevation in front of the mass: a centre pier (split at 2.4 m so the damp band has its own tint) and a spandrel per storey.
    // The pier is 1 cm SHALLOWER than the bands: they run the full unit width straight across it, so at equal depth the two share a plane and z-fight up the whole elevation (worse where the tints differ -- the soot band).
    const pierD = REC - 0.01, pierW = Math.min(1.0, 2 * off - 1.7);   // and narrow enough on a small house that it does not eat into the sashes each side
    P.push(key, at(boxM(pierD, 2.4, pierW, mul(tint, DAMP)), WALL + pierD / 2, 1.8, zc));
    P.push(key, at(boxM(pierD, Hu - 3.0, pierW, tint), WALL + pierD / 2, 3.0 + (Hu - 3.0) / 2, zc));
    P.push(key, at(boxM(REC, 0.45, Math.min(2.6, uw / 2), mul(tint, DAMP)), WALL + REC / 2, 0.82, winZ));   // under the ground sash
    P.push(key, at(boxM(REC, sillY(1) - 3.05, uw, tint), WALL + REC / 2, (3.05 + sillY(1)) / 2, zc));   // over the ground openings, up to the first-floor sill
    for (let s = 2; s < floors; s++) P.push(key, at(boxM(REC, sillY(s) - (sillY(s - 1) + winH), uw, tint), WALL + REC / 2, (sillY(s) + sillY(s - 1) + winH) / 2, zc));
    const headTop = sillY(floors - 1) + winH;
    P.push(key, at(boxM(REC, Hu - headTop, uw, mul(tint, SOOT)), WALL + REC / 2, (Hu + headTop) / 2, zc));   // soot under the parapet

    // ground floor: stoop + door on one side, sash or bay on the other
    const doorY = 0.6, stepN = 3 + (rnd() < 0.5 ? 1 : 0), rise = doorY / stepN;
    for (let s = 0; s < stepN; s++) {                             // nested stone slabs: each lower one reaches further over the pavement
      const top = doorY - s * rise, d = Math.min(0.5 + s * 0.28, PROJ - 0.05 + REC);
      P.push('concrete', at(boxM(d, top, 1.5, STONE), WALL + d / 2, top / 2, doorZ));
    }
    const doorCol = pick(rnd, DOORS);
    P.push('metal', at(quadM(1.05, 2.05, doorCol), WALL + 0.02, doorY + 1.025, doorZ, front.yaw));
    for (const e of [-1, 1]) P.push('concrete', at(boxM(REC + 0.06, 2.55, 0.18, STONE), WALL + (REC + 0.06) / 2, doorY + 1.275, doorZ + e * 0.62, 0));   // moulded surround
    P.push('concrete', at(boxM(REC + 0.1, 0.26, 1.62, STONE), WALL + (REC + 0.1) / 2, doorY + 2.68, doorZ));
    const canopy = rnd() < 0.4;
    if (canopy) P.push('metal', at(boxM(0.85, 0.1, 1.75, LEAD), WALL + 0.42, doorY + 2.95, doorZ));
    else P.push('emit', at(quadM(0.9, 0.3, 0x2a2418, WARM, 0.5), WALL + 0.03, doorY + 2.28, doorZ, front.yaw));    // fanlight over the door
    if (rnd() < 0.5) {                                            // a glowing doorway: the brief's hero light per block
      P.push('emit', at(boxM(0.16, 0.24, 0.16, 0x2a2622, WARM, 1.25), WALL + 0.12, doorY + 2.45, doorZ + 0.85));
      lamps.push({ x: WALL + 0.2, y: doorY + 2.3, z: doorZ + 0.85, colour: 0xffc28a });
    }

    if (bay) {
      const bw = Math.min(2.3, Math.max(1.1, uw - 3.5)), dep = REC + 0.7, top = floorY(bayFloors) - 0.1;   // keep the bay clear of the party pilaster on a narrow house, and never let uw - 3.5 go negative (a BoxGeometry with a negative side is inside out)
      P.push(key, at(boxM(dep, top - 0.25, bw, tint), WALL + dep / 2, (top + 0.25) / 2, winZ));
      P.push('concrete', at(boxM(dep + 0.1, 0.25, bw + 0.1, STONE), WALL + dep / 2, 0.125, winZ));      // its own stone plinth
      P.push('metal', at(boxM(dep + 0.18, 0.14, bw + 0.18, LEAD), WALL + dep / 2, top + 0.07, winZ));   // the little lead roof
      for (let s = 0; s < bayFloors; s++) {
        const y0 = s === 0 ? 1.05 : sillY(s), hh = Math.min(s === 0 ? 1.9 : winH, (s === 0 ? GROUND_H : floorY(s) + floorH) - y0 - 0.45);
        sash(hw + 0.7 + 0.01, y0 + hh / 2, winZ, front.yaw, bw - 0.55, hh);                             // three glazed faces
        for (const e of [-1, 1]) sash(WALL + dep / 2, y0 + hh / 2, winZ + e * (bw / 2 + 0.01), e > 0 ? 0 : Math.PI, dep - 0.3, hh);
      }
    } else {
      sash(WALL + PANE_BACK, 2.05, winZ, front.yaw, 1.5, 1.9);
      P.push('concrete', at(boxM(REC + 0.1, 0.2, 1.95, STONE), WALL + (REC + 0.1) / 2, 3.15, winZ));    // lintel
      P.push('concrete', at(boxM(REC + 0.12, 0.12, 1.95, STONE), WALL + (REC + 0.12) / 2, 1.04, winZ));  // sill
    }

    // upper storeys: a sash each side, a stone lintel over each, one sill band across the unit
    for (let s = 1; s < floors; s++) {
      P.push('concrete', at(boxM(REC + 0.12, 0.12, uw - 0.7, STONE), WALL + (REC + 0.12) / 2, sillY(s) - 0.06, zc));
      for (const z of [doorZ, winZ]) {
        if (z === winZ && s < bayFloors) continue;                // the bay glazes these
        sash(WALL + PANE_BACK, sillY(s) + winH / 2, z, front.yaw, 1.35, winH);
        P.push('concrete', at(boxM(REC + 0.1, 0.2, 1.8, STONE), WALL + (REC + 0.1) / 2, sillY(s) + winH + 0.1, z));
      }
    }

    // black iron fire escape on the door column
    if (escape) {
      const run = 1.6, dep = 1.05, ez = Math.min(Math.max(doorZ, -hd + 1.65), hd - 1.65);   // the zig-zag reaches ez +/- 1.6: keep the whole rig inside the plot
      for (let s = 1; s < floors; s++) {
        const y = floorY(s) + 0.05;
        P.push('dark', at(boxM(dep, 0.06, 1.9, IRON), hw + dep / 2, y, ez));
        P.push('dark', at(boxM(dep, 0.05, 1.9, IRON), hw + dep / 2, y + 1.0, ez));
        for (const e of [-1, 1]) P.push('dark', at(boxM(0.05, 1.0, 0.05, IRON), hw + dep - 0.1, y + 0.5, ez + e * 0.9));
        if (s < floors - 1) {                                     // the zig-zag run up to the next platform
          const a = Math.atan2(floorY(s + 1) - floorY(s), run), g = boxM(0.85, 0.08, Math.hypot(floorY(s + 1) - floorY(s), run), IRON);
          tiltX(g, -a);
          P.push('dark', at(g, hw + 0.5, y + (floorY(s + 1) - floorY(s)) / 2, ez + (s % 2 ? 1 : -1) * run / 2));
        }
      }
      P.push('dark', at(boxM(0.06, floorY(1) - 0.5, 0.42, IRON), hw + 0.9, (floorY(1) - 0.5) / 2 + 0.3, ez - 0.7));   // the drop ladder
    }

    // parapet + stone coping (steps with this unit's eaves)
    P.push(key, at(boxM(0.32, 0.55, uw, mul(tint, SOOT)), hw - 0.16, Hu + 0.275, zc));
    P.push('concrete', at(boxM(0.44, 0.12, uw, STONE), hw - 0.16, Hu + 0.61, zc));

    // rear elevation: plainer brick, sashes, a soil pipe on every other house
    for (let s = 0; s < floors; s++) for (const e of [-1, 1]) {
      const [bx, bz] = onFace(back, -(zc + e * 1.4), 0.02);        // back face tangent runs -Z
      sash(bx, s === 0 ? 2.0 : sillY(s) + winH / 2, bz, back.yaw, 1.15, s === 0 ? 1.7 : winH - 0.15);
    }
    if (i % 2 === 0) P.push('dark', at(boxM(0.16, Hu - 0.4, 0.16, 0x8a8f94), -hw - 0.06, (Hu - 0.4) / 2, zc + uw / 2 - 0.4));

    // roof: a hatch housing on the first house, an aerial on some
    if (i === 0 || (N > 5 && i === N - 2)) {
      P.push(key, at(boxM(1.5, 1.25, 1.5, tint), -hw + 2.2, Hu + 0.625, zc));
      P.push('concrete', at(boxM(1.7, 0.1, 1.7, STONE), -hw + 2.2, Hu + 1.3, zc));
    }
    if (rnd() < 0.3) {
      P.push('dark', at(boxM(0.07, 2.1, 0.07, IRON), -hw + 1.0, Hu + 1.05, zc + 1.2));
      for (const y of [1.75, 2.0]) P.push('dark', at(boxM(0.05, 0.05, 1.1, IRON), -hw + 1.0, Hu + y, zc + 1.2));
    }
    units.push({ z: zc, w: uw, height: Hu, floorH, rendered, bay, escape, doorZ, doorY, doorColour: doorCol, floors });
  }

  /* ---- party walls and chimney stacks ----------------------------------- */
  const hAt = (j) => Math.max(units[Math.max(0, j - 1)].height, units[Math.min(N - 1, j)].height);
  for (let j = 0; j <= N; j++) {
    const z = Math.min(Math.max(-hd + j * uw, -hd + 0.32), hd - 0.32);   // the end party walls tuck inside the plot
    const top = hAt(j) + 0.35;                                     // party walls run past the eaves: the Old Quarter skyline
    const u = units[Math.min(N - 1, j)], t = u.rendered ? 0xe8e2d2 : BRICKS[j % BRICKS.length];
    P.push('brick', at(boxM(REC + 0.24, 2.4, 0.46, mul(t, DAMP)), hw - (REC + 0.24) / 2 + 0.1, 1.2, z));
    P.push('brick', at(boxM(REC + 0.24, top - 2.4, 0.46, t), hw - (REC + 0.24) / 2 + 0.1, (top + 2.4) / 2, z));
    P.push('concrete', at(boxM(REC + 0.4, 0.16, 0.62, STONE), hw - (REC + 0.24) / 2 + 0.1, top + 0.08, z));
    if (j % 2 === 0 || rnd() < 0.4) {                                            // stack + clay pots, set back from the street so it reads over the parapet
      const sh = 1.5 + rnd() * 0.8, base = hAt(j), pots = 2 + Math.floor(rnd() * 2);   // a 6-sided pot is 24 triangles; two or three is the whole silhouette
      const cz = Math.min(Math.max(z, -hd + 0.55), hd - 0.55);
      P.push('brick', at(boxM(1.05, sh, 0.95, mul(t, SOOT)), -1.6, base + sh / 2, cz));
      P.push('concrete', at(boxM(1.15, 0.12, 1.05, STONE), -1.6, base + sh + 0.06, cz));
      stacks.push({ x: -1.6, z: cz, y: base + sh + 0.58 });   // pot tops: where chimney smoke would go
      for (let p = 0; p < pots; p++) P.push('concrete', at(cylM(0.13, 0.46, 0xd9a882, 6), -1.6 + (p - (pots - 1) / 2) * 0.3, base + sh + 0.35, cz));
    }
  }
  // one rear parapet for the whole run
  const rearH = Math.max(...units.map((u) => u.height));
  P.push('brick', at(boxM(0.3, 0.5, 2 * hd, 0xe0d2c8), -hw + 0.15, rearH + 0.25, 0));
  P.push('concrete', at(boxM(0.42, 0.11, 2 * hd, STONE), -hw + 0.15, rearH + 0.55, 0));

  const byMat = new Map();
  for (const { mat, geo } of P.list) (byMat.get(mat) ?? byMat.set(mat, []).get(mat)).push(geo);
  const parts = [];
  for (const [mat, geos] of byMat) {
    const geo = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    parts.push({ geo, mat });
  }
  return { parts, boards: [], lamps, height: rearH, floors, units, stacks, states };
}
