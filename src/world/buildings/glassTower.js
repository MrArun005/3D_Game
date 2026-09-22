import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
/**
 * CBD glass tower -- the board is assets/art/building_cbd_glass_tower.jpg:
 * "HALSTEAD BAY FINANCIAL". Twelve to twenty-four storeys of dark curtain
 * wall read as HORIZONTAL: a pale spandrel band wraps every storey (one box
 * each, round the whole footprint), dark mullions cut the glass into 2.6 m
 * modules, dark corner posts hold the corners, and the top two or three
 * storeys step back once or twice onto railed terraces with a pale coping.
 * The roof carries a louvred plant penthouse, two or three lattice masts
 * (the tallest with a red beacon) and a tilted dish. The ground storey is a
 * DOUBLE-HEIGHT glass lobby set back under the tower -- the cantilever is
 * the entrance canopy, with downlights in its soffit -- flanked by pale
 * stone columns, with the lettered fascia on a dark panel over the doors.
 *
 * Built on artKit (parts grouped by material key, metre UVs), same frame as
 * tokyo.js: origin at the footprint centre on the ground, +X the street.
 *
 * Night: an `emit` quad sits 2 cm PROUD of the glass over ~35% of the panes
 * (warm/cool mix, per seed), between the mullions and under the bands, the
 * same way officeMidrise.js and tokyo.js do it: the 'glass' key is an opaque
 * PBR surface (no transmission), so a quad behind it would never show. Its
 * day colour is curtain-wall dark so a lit pane is invisible until dusk; the
 * lobby glow keeps a pale colour because the board's lobby reads warm by day.
 *
 * Cost: 1.8k-3.0k triangles a tower (mean 2.5k) over 20 seeds (mullions and spandrels
 * are one box each per storey/module, lit windows are the only per-pane
 * geometry). Deterministic per seed.
 */
import * as THREE from 'three';
import { mulberry32 } from '../../core/rng.js';
import { boxM, quadM, cylM, at, faces, onFace, Parts } from '../artKit.js';

export const STYLE = 'glassTower';
export const GROUND_H = 7.4;      // the double-height lobby
export const FLOOR_H = 3.6;       // an office storey, slab to slab
export const MIN_FLOORS = 12, MAX_FLOORS = 24;
const BAY = 2.6;                  // curtain-wall module: one mullion per bay
const BAND_H = 0.6;               // spandrel band height; it stands 0.15 proud of the glass
const WINDOW_INSET = 0.02;        // lit quads sit just proud of the (opaque) glass, behind the 0.05 mullions (see header)
const SPANDREL = 0xd8dbe0, PLANT = 0xb4b9c0, DARK = 0x1b1e23, WHITE = 0xffffff, GLASS_DARK = 0x1a2230;
/* What a lit room looks like through glass: tungsten and fluorescent, both
   near-white. Kept dim so the reflection stays the loudest thing on the pane. */
const WARM_ROOM = [1.0, 0.92, 0.80], COOL_ROOM = [0.88, 0.93, 1.0];
const WARM = [1.0, 0.85, 0.6], COOL = [0.72, 0.84, 1.0], LOBBY = [1.0, 0.82, 0.55], BEACON = [1.0, 0.15, 0.1];
const _m = new THREE.Matrix4();

/** Storey s (0 = lobby) starts at floorY(s); floorY(floors) is the roof. */
const floorY = (s) => (s === 0 ? 0 : GROUND_H + (s - 1) * FLOOR_H);

/* Saturated pane colours for a district that wants an RGB skyline rather than
   an office one (Little Tokyo). Off by default: Kingsway keeps warm/cool. */
/* No pane palette any more. This held eight saturated hues and every lit
   window took one: Arun -- "we are adding some shit colors to the buildings...
   buildings covered with glass and no colour to it, and when rain beats down it
   reflects as is". A curtain wall has no colour of its own. What you see in it
   is the sky, the sunset and the street, and that is the environment map's job,
   not a vertex colour's. A lit room behind the glass is a WARMTH, not a hue. */

export function build(seed, hw, hd, h, opts = {}) {
  const rnd = mulberry32((seed * 2654435761) >>> 0);
  /* opts.rgb is accepted and ignored: callers still pass it, and a glass tower
     is the same neutral curtain wall whichever district it stands in. */
  const floors = Math.max(MIN_FLOORS, Math.min(MAX_FLOORS, Math.round((h - GROUND_H) / FLOOR_H) + 1));
  const H = floorY(floors);
  const P = new Parts(), boards = [], lamps = [];

  /* Tiers: the shaft, then one or two set-back tiers holding the top two or
     three storeys. Each step pulls the front in 1.5x and the back 0.5x the
     side inset, so the upper block sits toward the back as on the board and
     the wide terrace faces the street. */
  const stepped = 2 + (rnd() < 0.5 ? 1 : 0), steps = rnd() < 0.5 ? 1 : 2;   // top 2-3 storeys, in 1 or 2 steps
  const tiers = [{ cx: 0, thw: hw, thd: hd, fa: 1, fb: floors - stepped }];
  for (let k = 0, s = floors - stepped + 1; k < steps; k++) {
    const prev = tiers[tiers.length - 1];
    const ins = Math.max(0, Math.min(2.2 + rnd() * 1.2, prev.thw - 3, prev.thd - 3));   // never below a 6 m block
    const count = k === 0 ? stepped - (steps - 1) : 1;                                  // 2 | 1+1 | 3 | 2+1
    tiers.push({ cx: prev.cx - ins * 0.5, thw: prev.thw - ins, thd: prev.thd - ins, fa: s, fb: s + count - 1 });
    s += count;
  }

  for (let t = 0; t < tiers.length; t++) {
    const { cx, thw, thd, fa, fb } = tiers[t], top = t === tiers.length - 1;
    const y0 = floorY(fa), y1 = floorY(fb + 1), th = y1 - y0;
    // the curtain wall itself: one dark glass box per tier
    P.push('glass', at(boxM(2 * thw, th, 2 * thd, WHITE), cx, y0 + th / 2, 0));
    // spandrel bands at every slab, plus the coping at the tier's roof edge
    for (let f = fa; f <= fb + 1; f++) {
      const by = f === fb + 1 ? y1 - BAND_H / 2 : floorY(f) + BAND_H / 2 - 0.15;
      P.push('metal', at(boxM(2 * thw + 0.3, BAND_H, 2 * thd + 0.3, SPANDREL), cx, by, 0));
    }
    // the roof slab, pale concrete; the tier above stands on it
    P.push('concrete', at(boxM(2 * thw, 0.12, 2 * thd, WHITE), cx, y1 + 0.06, 0));
    // dark corner posts
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.push('dark', at(boxM(0.3, th, 0.3, DARK), cx + sx * thw, y0 + th / 2, sz * thd));
    // mullions and the lit offices behind the glass
    for (const f of faces(thw, thd)) {
      const n = Math.max(1, Math.round(f.w / BAY)), pitch = f.w / n;
      for (let i = 1; i < n; i++) {
        const [x, z] = onFace(f, -f.w / 2 + i * pitch, 0.05);
        P.push('dark', at(boxM(0.14, th, 0.14, DARK), cx + x, y0 + th / 2, z));
      }
      const paneH = FLOOR_H - BAND_H - 0.3, paneW = Math.min(pitch - 0.35, 2.2);
      for (let s = fa; s <= fb; s++) for (let b = 0; b < n; b++) {
        if (rnd() >= 0.35) continue;
        const warm = rnd() < 0.65;
        /* A lit room seen through glass: warm or cool WHITE, never a hue, and
           dim -- the pane's job is to reflect the sky, and an emissive that
           competes with the reflection is what made these read as painted
           panels rather than as glass. */
        const paneCol = warm ? WARM_ROOM : COOL_ROOM;
        const paneE = 0.30 + rnd() * 0.28;
        const [x, z] = onFace(f, -f.w / 2 + pitch * (b + 0.5), WINDOW_INSET);
        P.push('emit', at(quadM(paneW, paneH, GLASS_DARK, paneCol, paneE), cx + x, floorY(s) + 0.45 + (FLOOR_H - BAND_H) / 2, z, f.yaw));
      }
    }
    if (!top) {
      // terrace railing round the roof edge; the next tier is inset well inside it
      for (const [w, d, x, z] of [[2 * thw - 0.3, 0.05, 0, thd - 0.15], [2 * thw - 0.3, 0.05, 0, -thd + 0.15], [0.05, 2 * thd - 0.3, thw - 0.15, 0], [0.05, 2 * thd - 0.3, -thw + 0.15, 0]])
        P.push('dark', at(boxM(w, 1.1, d, DARK), cx + x, y1 + 0.12 + 0.55, z));
    } else {
      // the roof: louvred plant penthouse, hvac, masts, a dish, a beacon
      const pw = thw * 0.9, pd = thd * 0.55, px = cx - thw * 0.05, pz = -thd * 0.35;
      P.push('metal', at(boxM(pw, 3.0, pd, PLANT), px, y1 + 0.12 + 1.5, pz));
      P.push('dark', at(boxM(pw + 0.04, 0.9, pd + 0.04, DARK), px, y1 + 0.12 + 1.9, pz));   // the louvre band
      for (let i = 0; i < 2; i++) P.push('metal', at(boxM(1.4, 1.0, 1.4, PLANT), cx + thw * (0.55 - i * 0.4), y1 + 0.62, thd * 0.5));
      const masts = 2 + (rnd() < 0.5 ? 1 : 0);
      let tallest = null;
      for (let i = 0; i < masts; i++) {
        const mh = 6 + rnd() * 6, mx = cx + thw * (0.75 - i * 0.55), mz = thd * (i % 2 ? 0.7 : -0.7);
        P.push('dark', at(boxM(0.14, mh, 0.14, DARK), mx, y1 + mh / 2, mz));
        for (const k of [0.55, 0.8]) P.push('dark', at(boxM(1.2, 0.07, 0.07, DARK), mx, y1 + mh * k, mz, rnd() < 0.5 ? 0 : Math.PI / 2));
        if (!tallest || mh > tallest.mh) tallest = { mh, mx, mz };
      }
      // the aviation beacon on the tallest mast: a small glowing cube and a red head for the light pool / glare sprite
      P.push('emit', at(boxM(0.25, 0.25, 0.25, 0x3a0a08, BEACON, 1.5), tallest.mx, y1 + tallest.mh + 0.15, tallest.mz));
      lamps.push({ x: tallest.mx, y: y1 + tallest.mh + 0.15, z: tallest.mz, colour: 0xff3020 });
      // the dish: a short cylinder tipped toward the street on a post
      const dx = cx - thw * 0.6, dz = thd * 0.45;
      P.push('dark', at(boxM(0.1, 1.6, 0.1, DARK), dx, y1 + 0.8, dz));
      const dish = cylM(0.9, 0.08, DARK, 14);
      dish.applyMatrix4(_m.makeRotationZ(-1.1));
      P.push('dark', at(dish, dx + 0.3, y1 + 1.7, dz));
    }
  }

  /* The lobby: a glass box set back 1.6 m on the street side and 0.5 m
     elsewhere, so the shaft above cantilevers over the entrance. */
  const insF = 1.6, insS = 0.5, lhw = hw - (insF + insS) / 2, lhd = hd - insS, lcx = (insS - insF) / 2, lobbyH = GROUND_H - 0.15;
  P.push('glass', at(boxM(2 * lhw, lobbyH, 2 * lhd, WHITE), lcx, lobbyH / 2, 0));
  P.push('concrete', at(boxM(2 * lhw + 0.2, 0.35, 2 * lhd + 0.2, WHITE), lcx, 0.175, 0));           // stone plinth
  P.push('dark', at(boxM(2 * lhw - 0.4, 0.25, 2 * lhd - 0.4, DARK), lcx, 3.7, 0));                   // the mezzanine slab, seen through the glass
  const LF = faces(lhw, lhd), frontX = lcx + lhw;
  for (const f of LF) {
    const n = Math.max(1, Math.round(f.w / BAY)), pitch = f.w / n;
    for (let i = 1; i < n; i++) { const [x, z] = onFace(f, -f.w / 2 + i * pitch, 0.05); P.push('dark', at(boxM(0.12, lobbyH, 0.12, DARK), lcx + x, lobbyH / 2, z)); }
    const [tx, tz] = onFace(f, 0, 0.05);
    P.push('dark', at(boxM(f.w, 0.18, 0.1, DARK), lcx + tx, 3.7, tz, f.yaw));                        // transom at the mezzanine
    if (f.name === 'back') continue;
    const [gx, gz] = onFace(f, 0, WINDOW_INSET);
    P.push('emit', at(quadM(f.w - 0.6, lobbyH - 0.7, 0xf2dcb8, LOBBY, 0.9), lcx + gx, lobbyH / 2 + 0.1, gz, f.yaw));   // the warm lobby light
  }
  // the entrance: dark portal, glowing doors, the lettered fascia on a dark panel above
  P.push('dark', at(boxM(0.16, 3.4, 4.4, DARK), frontX + 0.08, 1.7, 0));
  P.push('emit', at(quadM(3.8, 3.0, 0xf6e6c8, LOBBY, 1.0), frontX + 0.17, 1.55, 0, Math.PI / 2));
  const signW = Math.min(7, 2 * lhd * 0.8);
  // the panel is as thick as the portal so it clears the lobby mullions (they reach +0.11) and the board sits in front of both
  P.push('dark', at(boxM(0.16, 1.6, signW + 0.6, DARK), frontX + 0.08, 6.1, 0));
  boards.push({ x: frontX + 0.17, y: 6.1, z: 0, yaw: Math.PI / 2, w: signW, h: 1.4 });
  // pale stone columns under the cantilever: two flanking the doors, two more at the corners of a wide front
  const colZ = [3.4, -3.4]; if (hd > 7) colZ.push(hd - 0.9, -(hd - 0.9));
  for (const z of colZ) P.push('concrete', at(cylM(0.42, GROUND_H, WHITE, 12), hw - 0.55, GROUND_H / 2, z));
  // the canopy soffit glows softly, with downlights for the night pool
  {
    const soffit = quadM(insF, 2 * hd - 1.0, 0xf0e6d6, LOBBY, 0.6);
    soffit.applyMatrix4(_m.makeRotationX(Math.PI / 2));   // face down
    P.push('emit', at(soffit, hw - insF / 2, GROUND_H - 0.17, 0));
    const n = hd > 5 ? 3 : 2, span = 2 * hd - 2.4;
    for (let i = 0; i < n; i++) lamps.push({ x: hw - 0.8, y: GROUND_H - 0.3, z: -span / 2 + span * (i / (n - 1)), colour: 0xfff1d6 });
  }
  // one tower in three wears its tenant's name on the penthouse too
  if (rnd() < 0.35) {
    const tp = tiers[tiers.length - 1];
    // on the penthouse's street face, below its louvre band (H + 1.45 .. 2.35)
    boards.push({ x: tp.cx - tp.thw * 0.05 + tp.thd * 0.55 / 2 + 0.06, y: H + 0.8, z: -tp.thd * 0.35, yaw: Math.PI / 2, w: Math.min(6, tp.thw * 0.9 * 0.8), h: 1.2 });
  }

  let tris = 0;
  for (const { geo } of P.list) tris += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;

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
  return { parts: parts, boards, lamps, height: H, floors, tris };
}
