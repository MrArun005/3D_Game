import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as THREE from 'three';
import { mulberry32 } from '../../core/rng.js';
import { boxM, quadM, cylM, at, faces, onFace, Parts } from '../artKit.js';

/**
 * Office midrise (assets/art/building_office_midrise.jpg), built here -- no
 * kit, no Kenney. What sells the board:
 *
 *  - HORIZONTAL banding: every storey is one ribbon of glass panels sitting on
 *    a spandrel, between projecting floor slabs / sun shades that wrap the
 *    whole building unbroken (one box per band, full footprint + 0.6 m).
 *  - Dark vertical piers at the four corners and one wide dark bay over the
 *    entrance break the ribbons, so the block is not a stack of stripes.
 *  - A taller, darker ground floor: full-height glazing in dark mullions, a
 *    2 m deep recess with two revolving-door drums under a flat canopy, and
 *    the 'ARCHITECTURAL ENTRANCE SIGN' board beside the doors with a downlight.
 *  - A flat roof behind a cornice and a light railing: plant room, louvred
 *    air-handling units with fan cowls, pipe runs, vent stacks.
 *
 * Material keys (artKit): the cladding and slabs are 'metal' tinted bronze-grey;
 * panels are 'glass' by day and 'emit' (dark colour, cool office light) for the
 * ~45% that are lit; the ground floor is 'dark'. Mullions are not geometry --
 * the 0.14 m gaps between panels show the cladding behind (ponytail: a gap is
 * a free mullion; add thin 'dark' quads if the ribbon reads as one sheet).
 *
 * Local frame: origin at the footprint centre on the ground, +X is the street.
 * Nothing leaves |x| <= hw + 0.6, |z| <= hd + 0.6 (the slabs and the canopy lip
 * both stop at 0.6; the brief's 0.7 m slab would break the footprint contract).
 *
 * Budget: panels scale with perimeter x storeys. Measured 1,214-2,098 triangles
 * over the test footprints (half-widths 8-19 m), 3,472 at a 60 x 60 m footprint
 * with 9 storeys -- this style is for 'mid' footprints (half-width <= 16 m in
 * the district file); hand it a yard-sized one and the 3,000 budget breaks.
 */
export const STYLE = 'officeMidrise';
export const GROUND_H = 5.0;   // the lobby storey
export const FLOOR_H = 3.6;    // every office storey above
export const MIN_FLOORS = 5, MAX_FLOORS = 9;

const CLAD = 0x6a5f52, SLAB = 0x8a8378, PIER = 0x4a433c, GROUND = 0x2a2724, RAIL = 0xb0b0b0, PLANT = 0x9a9a9a;
const GLASS_DARK = 0x1a2230;                          // day colour of a lit (emit) panel: reads as glass
const COOL = [0.85, 0.92, 1.0], WARM = [1.0, 0.86, 0.62];
const SLAB_OUT = 0.6, SLAB_T = 0.35;                  // band projection and thickness
const SILL = 1.0, HEAD = 0.4;                         // spandrel below the ribbon, cladding above it
const GLASS_H = FLOOR_H - SLAB_T - SILL - HEAD;       // 1.85 m ribbon
const RECESS = 2.0, DOOR_H = 3.4, ENTRANCE_W = 5.2;
const _m = new THREE.Matrix4();
/** Turn a +Z-facing quad to face straight down (canopy soffits). */
const faceDown = (g) => g.applyMatrix4(_m.makeRotationX(Math.PI / 2));
/** Lay a Y-axis cylinder along X (pipe runs). */
const alongX = (g) => g.applyMatrix4(_m.makeRotationZ(Math.PI / 2));
/** Does the span [c - hw, c + hw] cross any of the [centre, halfwidth] exclusions? */
const blocked = (c, hw, excl) => excl.some(([ec, ehw]) => Math.abs(c - ec) < hw + ehw);

/** A dark cladding pier centred on face `f` at `s`, `w` wide, proud 0.06 m. */
function pier(f, s, w, y, h) {
  const [x, z] = onFace(f, s, 0);
  return at(f.n[0] ? boxM(0.12, h, w, PIER) : boxM(w, h, 0.12, PIER), x, y, z);
}

export function build(seed, hw, hd, h) {
  const rnd = mulberry32((seed * 2654435761) >>> 0);
  const floors = Math.max(MIN_FLOORS, Math.min(MAX_FLOORS, Math.round((h - GROUND_H) / FLOOR_H) + 1));
  const H = GROUND_H + (floors - 1) * FLOOR_H;         // roof deck level
  const HUP = H - GROUND_H;                              // the clad office storeys
  const floorY = (f) => (f === 0 ? 0 : GROUND_H + (f - 1) * FLOOR_H);
  const P = new Parts(), boards = [], lamps = [];
  const F = faces(hw, hd), front = F[0];

  // ---- the entrance: off-centre on the street face, the sign on its long side
  const eW = Math.min(ENTRANCE_W, 2 * hd - 2.0);
  const eS = (rnd() < 0.5 ? -1 : 1) * rnd() * Math.max(0, hd - eW / 2 - 1.0);
  const signSide = eS >= 0 ? -1 : 1;
  const signRoom = hd - eW / 2 + Math.abs(eS) - 0.8;     // wall between the entrance edge and the far corner
  const signW = Math.min(4.0, signRoom - 0.6);
  const signS = eS + signSide * (eW / 2 + 0.4 + signW / 2 + 0.3);

  // ---- ground floor: dark, 2 m recess cut out of the street side by building it in pieces
  P.push('dark', at(boxM(2 * hw - RECESS, GROUND_H, 2 * hd, GROUND), -RECESS / 2, GROUND_H / 2, 0));
  const fl0 = eS - eW / 2 + hd, fl1 = hd - (eS + eW / 2);   // flank lengths either side of the opening
  if (fl0 > 0.01) P.push('dark', at(boxM(RECESS, GROUND_H, fl0, GROUND), hw - RECESS / 2, GROUND_H / 2, -hd + fl0 / 2));
  if (fl1 > 0.01) P.push('dark', at(boxM(RECESS, GROUND_H, fl1, GROUND), hw - RECESS / 2, GROUND_H / 2, hd - fl1 / 2));
  P.push('dark', at(boxM(RECESS, GROUND_H - DOOR_H, eW, GROUND), hw - RECESS / 2, (GROUND_H + DOOR_H) / 2, eS));   // lintel over the opening
  // lobby glazing at the back of the recess, lit; two revolving-door drums in front of it
  P.push('emit', at(quadM(eW - 0.3, DOOR_H - 0.2, GLASS_DARK, WARM, 0.55), hw - RECESS + 0.03, DOOR_H / 2, eS, front.yaw));
  for (const side of [-1, 1]) {
    const dz = eS + side * 1.2;
    P.push('glass', at(cylM(0.95, 2.6, 0xffffff, 12), hw - RECESS + 1.0, 1.3, dz));
    P.push('dark', at(boxM(2.0, 0.12, 2.0, 0x15130f), hw - RECESS + 1.0, 2.66, dz));   // the drum's lid
  }
  // canopy: a flat dark slab from the recess back wall to 0.6 m proud of the face, a warm soffit and two downlights
  const cx = hw - RECESS / 2 + 0.3;                     // spans hw - 1.95 .. hw + 0.6
  P.push('dark', at(boxM(RECESS + 0.55, 0.3, eW + 1.4, GROUND), cx, 3.45, eS));
  P.push('emit', at(faceDown(quadM(RECESS + 0.4, eW + 1.2, 0x3a3530, WARM, 0.5)), cx, 3.29, eS));
  for (const side of [-1, 1]) lamps.push({ x: hw - 0.4, y: 3.15, z: eS + side * 1.6, colour: 0xffe6c0 });
  // the entrance sign: dark backing, atlas board, a lit downlight strip and a lamp for the pool
  if (signW >= 1.5) {
    P.push('dark', at(boxM(0.08, 1.4, signW + 0.3, 0x15130f), hw + 0.04, 2.35, signS));
    boards.push({ x: hw + 0.13, y: 2.35, z: signS, yaw: front.yaw, w: signW, h: 1.2 });
    P.push('emit', at(boxM(0.16, 0.08, signW + 0.3, GROUND, WARM, 1.3), hw + 0.1, 3.15, signS));
    lamps.push({ x: hw + 0.5, y: 3.1, z: signS, colour: 0xffe6c0 });
  }
  // full-height lobby glazing on every face; the gaps between bays are the dark mullions
  for (const f of F) {
    const excl = f === front ? [[eS, eW / 2 + 0.2], [signS, signW / 2 + 0.4]] : [];
    const usable = f.w - 1.0, bays = Math.max(1, Math.floor(usable / 2.6)), p = usable / bays;
    for (let b = 0; b < bays; b++) {
      const s = -usable / 2 + p * (b + 0.5);
      if (blocked(s, (p - 0.3) / 2, excl)) continue;
      const [x, z] = onFace(f, s, 0.03);
      const lit = rnd() < (f === front ? 0.6 : 0.4);
      P.push(lit ? 'emit' : 'glass', at(lit ? quadM(p - 0.3, 4.0, GLASS_DARK, WARM, 0.6) : quadM(p - 0.3, 4.0), x, 2.5, z, f.yaw));
    }
  }

  // ---- the office storeys: one clad mass, corner piers, a dark bay over the entrance, one more pier on a side
  P.push('metal', at(boxM(2 * hw, HUP, 2 * hd, CLAD), 0, GROUND_H + HUP / 2, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.push('metal', at(boxM(1.26, HUP, 1.26, PIER), sx * (hw - 0.57), GROUND_H + HUP / 2, sz * (hd - 0.57)));
  P.push('metal', pier(front, eS, eW, GROUND_H + HUP / 2, HUP));
  const skip = { front: [[eS, eW / 2]] };
  if (rnd() < 0.6) {
    const sf = F[2 + Math.floor(rnd() * 2)];            // left or right
    const ps = (rnd() - 0.5) * (sf.w - 6);
    P.push('metal', pier(sf, ps, 1.8, GROUND_H + HUP / 2, HUP));
    skip[sf.name] = [[ps, 0.9]];
  }
  // the ribbons: a panel every ~1.9 m between the corner piers, ~45% lit cool office light
  for (const f of F) {
    const excl = skip[f.name] ?? [];
    const usable = f.w - 2.6, bays = Math.max(1, Math.floor(usable / 1.9)), p = usable / bays;
    for (let s = 1; s < floors; s++) {
      const y = floorY(s) + SLAB_T + SILL + GLASS_H / 2;
      for (let b = 0; b < bays; b++) {
        const along = -usable / 2 + p * (b + 0.5);
        if (blocked(along, (p - 0.14) / 2, excl)) continue;
        const [x, z] = onFace(f, along, 0.03);
        const lit = rnd() < 0.45;
        const em = lit ? (rnd() < 0.8 ? COOL : WARM) : null;
        P.push(lit ? 'emit' : 'glass', at(lit ? quadM(p - 0.14, GLASS_H, GLASS_DARK, em, 0.8) : quadM(p - 0.14, GLASS_H), x, y, z, f.yaw));
      }
    }
  }
  // the slab bands: one box each, wrapping the whole footprint 0.6 m proud; the top one is the cornice
  for (let f = 1; f < floors; f++) P.push('metal', at(boxM(2 * hw + 2 * SLAB_OUT, SLAB_T, 2 * hd + 2 * SLAB_OUT, SLAB), 0, floorY(f) + SLAB_T / 2, 0));
  P.push('metal', at(boxM(2 * hw + 2 * SLAB_OUT, SLAB_T, 2 * hd + 2 * SLAB_OUT, SLAB), 0, H - SLAB_T / 2, 0));

  // ---- the roof: deck, railing round the cornice, plant
  const RY = H + 0.12;                                   // deck surface
  P.push('concrete', at(boxM(2 * hw, 0.12, 2 * hd, 0x9a9a9a), 0, H + 0.06, 0));
  const rx = hw + SLAB_OUT - 0.1, rz = hd + SLAB_OUT - 0.1;
  for (const ry of [H + 0.55, H + 1.1]) {
    for (const s of [-1, 1]) P.push('metal', at(boxM(0.05, 0.05, 2 * rz, RAIL), s * rx, ry, 0));
    for (const s of [-1, 1]) P.push('metal', at(boxM(2 * rx, 0.05, 0.05, RAIL), 0, ry, s * rz));
  }
  for (const [len, along] of [[2 * rz, 'z'], [2 * rx, 'x']]) {
    const n = Math.max(2, Math.round(len / 4.5));
    for (let i = 0; i <= n; i++) {
      const t = -len / 2 + (len / n) * i;
      for (const s of [-1, 1]) P.push('metal', along === 'z' ? at(boxM(0.06, 1.1, 0.06, RAIL), s * rx, H + 0.55, t) : at(boxM(0.06, 1.1, 0.06, RAIL), t, H + 0.55, s * rz));
    }
  }
  // plant room on the back half, with a door and a louvre
  const pw = Math.min(6, hw - 2.4), pd = Math.min(4, 2 * hd - 2.8), ph = 3.2;
  let px = 0, pz = 0;
  if (pw >= 2 && pd >= 2) {
    px = -hw / 2; pz = (rnd() - 0.5) * Math.max(0, 2 * hd - 5.6 - pd);   // stays clear of the vent stacks at |z| = hd - 2.2
    P.push('metal', at(boxM(pw, ph, pd, CLAD), px, RY + ph / 2, pz));
    P.push('dark', at(quadM(0.9, 2.1, 0x4a4744), px + pw / 2 + 0.02, RY + 1.05, pz - pd / 2 + 0.9, Math.PI / 2));     // door on the +X side
    P.push('dark', at(quadM(Math.min(2.4, pw - 1.0), 1.2, 0x2f2d2a), px, RY + 2.1, pz + pd / 2 + 0.02, 0));           // louvre on the +Z side
  }
  // air-handling units in a row along the front edge: louvred box, fan cowl on top
  const nA = Math.min(2 + (rnd() < 0.5 ? 1 : 0), Math.max(1, Math.floor((2 * hd - 2.4) / 3.0)));
  const ax = hw - 2.7, az0 = -(nA - 1) * 1.5 + (rnd() - 0.5) * Math.max(0, 2 * hd - 2.4 - nA * 3.0);
  for (let i = 0; i < nA; i++) {
    const az = az0 + i * 3.0;
    P.push('metal', at(boxM(2.4, 1.6, 1.6, PLANT), ax, RY + 0.8, az));
    P.push('dark', at(quadM(2.0, 1.0, 0x2a2a2a), ax + 1.22, RY + 0.8, az, Math.PI / 2));
    P.push('dark', at(cylM(0.55, 0.3, 0x3a3a3a, 8), ax, RY + 1.75, az));
  }
  // two pipe runs from the plant room to the units, and two vent stacks
  const pL = ax - 1.2 - (px + pw / 2) - 0.2;
  if (pw >= 2 && pL > 1) for (const s of [-1, 1]) {
    P.push('metal', at(alongX(cylM(0.12, pL, PLANT, 8)), px + pw / 2 + 0.1 + pL / 2, RY + 0.35, Math.max(-hd + 1, Math.min(hd - 1, pz + s * 0.35))));
  }
  for (const s of [-1, 1]) P.push('metal', at(cylM(0.22, 1.3, SLAB, 8), -hw + 2.0, RY + 0.65, s * (hd - 2.2)));


  /* Merge per material key before returning. These three shipped their raw
     part list -- 686 to 845 separate geometries a building -- and districtWorld
     applies a matrix to EVERY one and pushes it into a per-key array, per
     footprint. Measured: one footprint's slice of the chunk build hit 79.5 ms,
     which is five dropped frames as you drive into a new block. loft.js and
     brickRow.js already did this and return 5 to 8. The chunk merges per key
     anyway, so nothing downstream changes. */
  const byMat = new Map();
  for (const { mat, geo } of P.list) (byMat.get(mat) ?? byMat.set(mat, []).get(mat)).push(geo);
  const parts = [];
  for (const [mat, geos] of byMat) {
    const geo = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (geo) parts.push({ geo, mat });
  }
  return { parts: parts, boards, lamps, height: H, floors };
}
