/**
 * Brick warehouse -- the harbour / industrial style (assets/art/
 * building_brick_warehouse.jpg). Ours: authored in code, no kit, no Kenney.
 *
 * What the board shows and what we build for it:
 *   - 3-6 storeys of red brick, tall storeys (a warehouse floor is 3.9 m),
 *     the ground one taller still for the shopfront.
 *   - Tall arched-top windows in a strict rhythm, brick pilasters between
 *     the bays. A window is FLAT (dark border quad + pane quad + two
 *     half-discs for the arch + two mullion strips): 18 triangles, so a
 *     hundred of them stay under the budget. The pilasters give the relief.
 *   - Under the cornice: a sooted top course (darker brick tint), two
 *     stepped corbel courses and a row of dentils on the street face, then
 *     the wide weathered-copper cornice ('metal' tinted verdigris).
 *   - A timber water tank on a black steel lattice on about half of them;
 *     a stair bulkhead and a vent pipe on the rest of the roofs.
 *   - A black iron fire escape zig-zagging down one face: gratings,
 *     railings, tilted stair runs, alternating direction each storey, a
 *     drop ladder at the bottom.
 *   - Ground floor: a dark shopfront band across the street face with big
 *     multi-pane windows, double timber doors under a lit transom, a
 *     marquee box over the door (sign atlas board on its face, lit soffit)
 *     and a warm wall lantern either side (lamps for the night pool).
 *     Back face: a steel roller door and a concrete loading dock.
 *
 * Local frame per artKit: origin at the footprint centre on the ground, +X
 * the street, footprint 2hw (X) by 2hd (Z). Nothing reaches past 0.6 m
 * proud of the wall (the cornice is exactly 0.5; the escape 0.58).
 * Deterministic per seed (CLAUDE.md: seeded randomness only).
 */
import * as THREE from 'three';
import { mulberry32 } from '../../core/rng.js';
import { boxM, quadM, cylM, paint, at, faces, onFace, Parts, flickerOf } from '../artKit.js';

export const STYLE = 'warehouse';
export const GROUND_H = 4.8;   // shopfront storey: doors, transom, marquee
export const FLOOR_H = 3.9;    // a warehouse floor: 3.25 m windows with room over them
export const MIN_FLOORS = 3, MAX_FLOORS = 6;

// tints on the library brick (near-white so the PBR set shows through; the last two age it)
const BRICK_TINTS = [0xffffff, 0xf6e9df, 0xeadbcf, 0xf9f1ea];
const SOOT = 0x8a7c74;                 // the sooted top course and corbel steps
const COPPER = 0x5f9a86;               // verdigris on metal_painted
const IRON = 0x15161a;                 // the fire escape, frames, brackets
const WARM = [1.0, 0.8, 0.5], COOL = [0.7, 0.84, 1.0];
const LANTERN = 0xffb060;

const _m = new THREE.Matrix4();
/** A +Z-facing half disc (an arch head), metre UVs. */
function halfDisc(r, hex, emit = null, k = 1) {
  const g = new THREE.CircleGeometry(r, 4, 0, Math.PI);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * r, uv.getY(i) * 2 * r);
  return paint(g, hex, emit, k);
}
/** Tilt about Z in place (stair runs, lattice braces) -- artKit's `at` only turns about Y. */
const tilt = (geo, rz) => geo.applyMatrix4(_m.makeRotationZ(rz));

export function build(seed, hw, hd, h) {
  const rnd = mulberry32((seed * 2654435761) >>> 0);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const floors = Math.max(MIN_FLOORS, Math.min(MAX_FLOORS, Math.round((h - GROUND_H) / FLOOR_H) + 1));
  const H = GROUND_H + (floors - 1) * FLOOR_H;
  const floorY = (f) => (f === 0 ? 0 : GROUND_H + (f - 1) * FLOOR_H);   // bottom of storey f
  const brick = pick(BRICK_TINTS);
  const P = new Parts(), boards = [], lamps = [];
  const F = faces(hw, hd), front = F[0], back = F[1];
  const bandY = H - 0.6;   // the sooted course + corbels live in the top 0.6 m; windows stop below it

  // ---- the mass, plinth, sooted top course, corbels, dentils, copper cornice, parapet
  P.push('brick', at(boxM(2 * hw, H, 2 * hd, brick), 0, H / 2, 0));
  P.push('concrete', at(boxM(2 * hw + 0.12, 0.6, 2 * hd + 0.12, 0xa8a29c), 0, 0.3, 0));
  P.push('brick', at(boxM(2 * hw + 0.04, 0.6, 2 * hd + 0.04, SOOT), 0, H - 0.3, 0));                // soot under the cornice
  P.push('brick', at(boxM(2 * hw + 0.2, 0.2, 2 * hd + 0.2, SOOT), 0, H - 0.3, 0));                   // corbel step 1
  P.push('brick', at(boxM(2 * hw + 0.4, 0.2, 2 * hd + 0.4, SOOT), 0, H - 0.1, 0));                   // corbel step 2
  {  // dentils along the street face only: a brick tooth every 1.6 m, where the player looks up
    const n = Math.floor(front.w / 1.6);
    for (let i = 0; i < n; i++) {
      const [x, z] = onFace(front, -front.w / 2 + 0.8 + i * 1.6 + (front.w - n * 1.6) / 2, 0.1);
      P.push('brick', at(boxM(0.2, 0.18, 0.5, SOOT), x, H - 0.5, z));
    }
  }
  P.push('metal', at(boxM(2 * hw + 0.6, 0.32, 2 * hd + 0.6, COPPER), 0, H + 0.16, 0));               // frieze
  P.push('metal', at(boxM(2 * hw + 1.0, 0.34, 2 * hd + 1.0, COPPER), 0, H + 0.49, 0));               // the wide cap (0.5 proud)
  P.push('dark', at(quadM(2 * hw - 0.5, 2 * hd - 0.5, 0x2a2a2d).applyMatrix4(_m.makeRotationX(-Math.PI / 2)), 0, H + 0.67, 0));   // tar roof
  for (const f of F) {  // low brick parapet behind the cornice
    const [x, z] = onFace(f, 0, -0.15);
    P.push('brick', at(boxM(f.w - 0.3, 0.5, 0.3, brick), x, H + 0.91, z, f.yaw));   // length along X before the yaw, like a quad
  }

  // ---- pilasters and arched windows, every face above the ground storey
  const escapeFace = rnd() < 0.55 && hd >= 6.4 ? front : pick([F[2], F[3]]);   // the board hangs it on the street face (if it clears the corner and the marquee); some go round the side
  // bay pitch and cap per face: the street face is the dense one; a wide face gets wide piers rather than more windows (triangle budget: 3,000)
  const bayPitch = { front: 2.6, back: 3.6, left: 3.1, right: 3.1 }, bayCap = { front: 7, back: 5, left: 6, right: 6 };
  const bays = {};
  for (const f of F) {
    const n = Math.max(1, Math.min(bayCap[f.name], Math.floor((f.w - 1.0) / bayPitch[f.name])));
    const pitch = f.w / n; bays[f.name] = { n, pitch };
    // pilasters: brick piers 0.5 wide, 0.16 proud, between bays; the back face is plain (nobody looks). On the front they start above the shopfront band.
    if (f !== back) {
      const y0 = f === front ? GROUND_H : 0.6, ph = bandY - y0;
      for (let b = 0; b <= n; b++) {
        const s = Math.max(-f.w / 2 + 0.25, Math.min(f.w / 2 - 0.25, -f.w / 2 + b * pitch));
        const [x, z] = onFace(f, s, 0.08);
        P.push('brick', at(boxM(0.5, ph, 0.16, brick), x, y0 + ph / 2, z, f.yaw));
      }
    }
    const w = Math.min(1.6, pitch * 0.58), r = w / 2;   // 3.25 m from sill to crown, arch radius = half the width
    for (let s = 1; s < floors; s++) for (let b = 0; b < n; b++) {
      const along = -f.w / 2 + pitch * (b + 0.5), y0 = floorY(s) + 0.6;
      const rectH = Math.min(3.25, bandY - 0.14 - y0) - r;   // the top row stops under the dentils (frame r+0.12 included), like the board's shorter top windows
      const lit = rnd() < 0.4, em = lit ? (rnd() < 0.72 ? WARM : COOL) : null, pane = lit ? 0x2b2418 : 0x141a22;
      const [fx, fz] = onFace(f, along, 0.04), [px, pz] = onFace(f, along, 0.06), [mx, mz] = onFace(f, along, 0.08);
      if (f !== back) {   // frame border; the back face makes do with the pane alone
        P.push('dark', at(quadM(w + 0.24, rectH, IRON), fx, y0 + rectH / 2, fz, f.yaw));
        P.push('dark', at(halfDisc(r + 0.12, IRON), fx, y0 + rectH, fz, f.yaw));
      }
      P.push('emit', at(quadM(w, rectH, pane, em, 0.8), px, y0 + rectH / 2, pz, f.yaw));               // the pane
      P.push('emit', at(halfDisc(r, pane, em, 0.8), px, y0 + rectH, pz, f.yaw));
      if (f === front) {  // mullion + transom strips, the small-pane grid read from the street
        P.push('dark', at(quadM(0.07, rectH, IRON), mx, y0 + rectH / 2, mz, f.yaw));
        P.push('dark', at(quadM(w, 0.07, IRON), mx, y0 + rectH * 0.55, mz, f.yaw));
      }
    }
    if (f === front) for (let s = 1; s < floors; s++) {   // one continuous sill course per storey (a warehouse string course), not a sill per window
      const [sx, sz] = onFace(f, 0, 0.09);
      P.push('concrete', at(boxM(f.w - 0.5, 0.12, 0.18, 0xb9b3ad), sx, floorY(s) + 0.54, sz, f.yaw));
    }
  }

  // ---- the street face ground storey: dark shopfront band, windows, doors, marquee, lanterns
  {
    const W = front.w;
    const [bx, bz] = onFace(front, 0, 0.05);
    P.push('dark', at(boxM(0.1, GROUND_H - 0.6, W, 0x23252a), bx, 0.6 + (GROUND_H - 0.6) / 2, bz));   // the shopfront band
    let n = Math.max(3, Math.floor((W - 0.8) / 2.6)); if (n % 2 === 0) n--;                            // odd bay count: the door is the centre one
    const pitch = (W - 0.8) / n, mid = (n - 1) / 2;
    for (let b = 0; b < n; b++) {
      const along = -(W - 0.8) / 2 + pitch * (b + 0.5);
      const [gx, gz] = onFace(front, along, 0.11), [mx, mz] = onFace(front, along, 0.13);
      if (b === mid) {   // double timber doors, a lit transom over them, a concrete step
        for (const side of [-1, 1]) { const [dx, dz] = onFace(front, along + side * 0.5, 0.11); P.push('timber', at(quadM(0.92, 2.6, 0x6a4a30), dx, 1.9, dz, front.yaw)); }
        P.push('emit', at(quadM(2.0, 0.3, 0x2a2418, WARM, 0.9), gx, 3.37, gz, front.yaw));
        P.push('dark', at(quadM(0.06, 2.6, IRON), mx, 1.9, mz, front.yaw));
        const [sx, sz] = onFace(front, along, 0.3); P.push('concrete', at(boxM(0.5, 0.16, 2.6, 0xb0aaa4), sx, 0.08, sz));
        // the marquee: a black box out over the door, sign board on its face, warm soffit underneath
        const mw = Math.min(6.2, W - 1.0), [qx, qz] = onFace(front, along, 0.3);
        P.push('dark', at(boxM(0.5, 1.2, mw, 0x1b1c20), qx, 4.15, qz));
        const [ox, oz] = onFace(front, along, 0.56);
        boards.push({ x: ox, y: 4.15, z: oz, yaw: front.yaw, w: mw - 0.2, h: 1.1 });
        const soffit = quadM(0.44, mw - 0.1, 0x3a3020, WARM, 1.2, flickerOf(rnd)).applyMatrix4(_m.makeRotationX(Math.PI / 2));   // faces down
        P.push('emit', at(soffit, qx, 3.54, qz));
        // wall lanterns either side of the door: iron bracket, lit glass, a light head each
        for (const side of [-1, 1]) {
          const k = Math.ceil((mw / 2 + 0.25) / pitch - 0.5);   // first bay boundary clear of the marquee: the lantern hangs on the dark band, not on glass
          const ls = along + side * (k < mid ? (k + 0.5) * pitch : mw / 2 + 0.6);
          const [ax, az] = onFace(front, ls, 0.2), [lx, lz] = onFace(front, ls, 0.42);
          P.push('dark', at(boxM(0.36, 0.06, 0.06, IRON), ax, 3.27, az, front.yaw + Math.PI / 2));
          P.push('emit', at(boxM(0.26, 0.4, 0.26, 0x4a3a20, WARM, 1.4), lx, 3.1, lz));
          lamps.push({ x: lx, y: 3.1, z: lz, colour: LANTERN });
        }
      } else {   // a big multi-pane shop window, most of them lit warm
        const lit = rnd() < 0.7;
        P.push('emit', at(quadM(pitch - 0.4, 2.7, lit ? 0x2a2418 : 0x141a22, lit ? WARM : null, 0.7), gx, 2.05, gz, front.yaw));
        P.push('dark', at(quadM(0.07, 2.7, IRON), mx, 2.05, mz, front.yaw));
        P.push('dark', at(quadM(pitch - 0.4, 0.07, IRON), mx, 2.75, mz, front.yaw));
      }
    }
    // a second, flush fascia board across the rest of a wide shopfront
    if (W > 14) { const [fx, fz] = onFace(front, -W / 4 - 1.0, 0.12); boards.push({ x: fx, y: 4.15, z: fz, yaw: front.yaw, w: Math.min(6, W / 2 - 4.2), h: 0.9 }); }
    // downpipes on the front corners
    for (const side of [-1, 1]) { const [dx, dz] = onFace(front, side * (W / 2 - 0.35), 0.12); P.push('dark', at(boxM(0.12, bandY - 0.6, 0.12, IRON), dx, 0.6 + (bandY - 0.6) / 2, dz)); }
  }
  // ---- the back: a steel roller door, a loading dock, small ground windows
  {
    const [dx, dz] = onFace(back, back.w * 0.15, 0.05);
    P.push('metal', at(boxM(0.1, 3.4, Math.min(3.4, back.w * 0.4), 0x6e7276), dx, 2.3, dz));
    const [kx, kz] = onFace(back, back.w * 0.15, 0.3);
    P.push('concrete', at(boxM(0.5, 0.9, Math.min(4.0, back.w * 0.45), 0xa8a29c), kx, 0.45, kz));
    for (let b = 0; b < bays.back.n; b++) {
      const along = -back.w / 2 + bays.back.pitch * (b + 0.5); if (Math.abs(along - back.w * 0.15) < 2.4) continue;
      const [gx, gz] = onFace(back, along, 0.06);
      P.push('emit', at(quadM(1.0, 1.0, 0x141a22, rnd() < 0.3 ? COOL : null, 0.6), gx, 2.6, gz, back.yaw));
    }
  }

  // ---- the fire escape: canonical frame is a face at z = 0 facing +Z, x along it; `at` turns it onto its face
  if (floors >= 3) {
    const f = escapeFace, run = 2.4, depth = 0.54;   // platform reach; 0.04 -> 0.58 proud stays inside the overhang allowance
    const s0 = f === front ? front.w * 0.25 : 0;      // off-centre on the street face so it clears the marquee
    const [cx, cz] = onFace(f, s0, 0.04);
    const esc = [];
    const geoAt = (g, x, y, z) => { g.applyMatrix4(_m.makeTranslation(x, y, z)); esc.push(g); return g; };
    for (let s = 1; s < floors; s++) {
      const y = floorY(s) + 0.1, dir = s % 2 ? 1 : -1;   // alternate: the zig-zag
      geoAt(boxM(run * 2 + 0.6, 0.08, depth, IRON), 0, y, depth / 2);                          // grating
      geoAt(boxM(run * 2 + 0.6, 0.05, 0.05, IRON), 0, y + 1.0, depth - 0.03);                  // top rail
      for (const px of [-run - 0.25, 0, run + 0.25]) geoAt(boxM(0.05, 1.0, 0.05, IRON), px, y + 0.5, depth - 0.03);   // posts
      if (s < floors - 1) {   // stair run up to the next platform, from this end to the far end
        const L = Math.hypot(run * 2, FLOOR_H), ang = Math.atan2(FLOOR_H, run * 2);
        geoAt(tilt(boxM(L, 0.08, depth - 0.1, IRON), dir * ang), 0, y + FLOOR_H / 2 + 0.3, depth / 2);
        geoAt(tilt(boxM(L, 0.04, 0.04, IRON), dir * ang), 0, y + FLOOR_H / 2 + 1.2, depth - 0.03);   // its handrail
      }
    }
    // drop ladder from the first platform to 2.6 m above the pavement
    for (const lx of [-0.25, 0.25]) geoAt(boxM(0.05, GROUND_H - 2.5, 0.05, IRON), run * 0.5 + lx, GROUND_H - (GROUND_H - 2.5) / 2 + 0.1, depth - 0.1);
    for (const g of esc) P.push('dark', at(g, cx, 0, cz, f.yaw));
  }

  // ---- the roof: water tank on a lattice (half), stair bulkhead, vent pipe
  if (rnd() < 0.5) {
    const tx = -hw * 0.35, tz = hd * 0.3, legH = 3.4, r = Math.min(1.3, Math.min(hw, hd) * 0.3), base = H + 0.7;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.push('dark', at(boxM(0.12, legH, 0.12, IRON), tx + sx * r * 0.85, base + legH / 2, tz + sz * r * 0.85));
    for (const [yy, ry] of [[0.55, 0], [0.55, Math.PI / 2]]) {   // one X-brace per side, mid-height (two bands + hoops put the biggest seed over 3,000 tris)
      const span = r * 1.7, ang = Math.atan2(legH * 0.35, span);
      for (const side of [-1, 1]) for (const d of [-1, 1]) {
        const g = tilt(boxM(Math.hypot(span, legH * 0.35), 0.05, 0.05, IRON), d * ang);
        at(g, 0, 0, side * r * 0.85, 0); P.push('dark', at(g, tx, base + legH * (yy - 0.175), tz, ry));
      }
    }
    P.push('dark', at(boxM(r * 1.9, 0.12, r * 1.9, IRON), tx, base + legH, tz));                    // platform
    P.push('timber', at(cylM(r, 2.0, 0xc9a87c, 12), tx, base + legH + 1.06, tz));                    // the tank
    P.push('metal', at(paint(new THREE.ConeGeometry(r + 0.1, 0.7, 12), 0x3d4448), tx, base + legH + 2.41, tz));   // conical lid
  } else {
    P.push('brick', at(boxM(2.4, 2.2, 2.6, brick), -hw * 0.3, H + 0.7 + 1.1, hd * 0.3));
    P.push('dark', at(boxM(2.6, 0.2, 2.8, 0x2a2a2d), -hw * 0.3, H + 3.0, hd * 0.3));
  }
  P.push('metal', at(cylM(0.18, 1.6, 0x8a8d90, 8), hw * 0.4, H + 1.5, -hd * 0.4));                    // vent pipe

  return { parts: P.list, boards, lamps, height: H, floors };
}
