import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as THREE from 'three';
import { mulberry32 } from '../../core/rng.js';
import { GROUND_H, FLOOR_H } from '../tokyo.js';
import { boxM, quadM, at, faces, onFace, Parts } from '../artKit.js';

/**
 * Residential loft (assets/art/building_residential_loft.jpg): a pale
 * travertine concrete FRAME -- corner piers, a pier at every bay line, a
 * band at every floor -- standing 0.3 m proud of the wall, so the grid
 * reads in its own shadow. Inside each cell either a tall dark-framed
 * window (a timber infill panel beside some) or a full-height glazed door
 * onto a black-steel balcony with a planter. Roof terrace: parapet, rail,
 * a timber pergola on the street half, planters. Ground floor is two
 * shopfronts (dark fascia carrying an atlas board each: cafe + bakery),
 * a dark awning with pendant lamps over the left one, and the residents'
 * door between them. 4-7 storeys.
 *
 * Parts are merged per material key before returning (<= 8 geometries),
 * same attribute set on every part (paint), so districtWorld's per-chunk
 * merge stays cheap. Local frame per artKit: origin at the footprint
 * centre on the ground, +X the street.
 */
export const STYLE = 'loft';

const REC = 0.3;              // wall sits this far behind the frame face
const BAND_H = 0.35;
const WARM = [1.0, 0.82, 0.55];
const PLASTER = 0xf2eee6, CONC = 0xf0f0f0, WOOD = 0xffffff, STEEL = 0x1c1d20, SHRUB = 0x2f5a33, PANE = 0x1a2230;

/** Tilt about Z (the awning slope); `at` only turns about Y. */
const _m = new THREE.Matrix4();
const tiltZ = (geo, a) => geo.applyMatrix4(_m.makeRotationZ(a));

export function build(seed, hw, hd, h) {
  const rnd = mulberry32((seed * 2654435761) >>> 0);
  const floors = Math.max(4, Math.min(7, Math.round((h - GROUND_H) / FLOOR_H) + 1));
  const H = GROUND_H + (floors - 1) * FLOOR_H;
  const floorY = (f) => (f === 0 ? 0 : GROUND_H + (f - 1) * FLOOR_H);
  const P = new Parts(), boards = [], lamps = [];
  const F = faces(hw, hd), front = F[0];

  // the recessed wall, the corner piers, and one frame ring per floor line + parapet (a box the size of the footprint: its top and bottom hide inside the mass)
  P.push('plaster', at(boxM(2 * hw - 2 * REC, H, 2 * hd - 2 * REC, PLASTER), 0, H / 2, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.push('plaster', at(boxM(0.5, H, 0.5, PLASTER), sx * (hw - 0.23), H / 2, sz * (hd - 0.23)));
  for (let f = 1; f <= floors; f++) P.push('plaster', at(boxM(2 * hw + 0.04, BAND_H, 2 * hd + 0.04, PLASTER), 0, f === floors ? H - BAND_H / 2 : floorY(f), 0));

  // bays: a pier on every bay line; the cell between gets a window or a balcony door
  const bayLines = [];   // [face, along] for the roof rail posts
  let balcLeft = 14;     // ponytail: a balcony is ~87 triangles; cap them so a 20 m 7-storey slab stays near 3,000 (the rnd is drawn regardless, so seeds stay stable)
  for (const f of F) {
    // the street face takes an ODD bay count so the centre cell (the residents' door at z=0) never lands on a pier (12 m / 4 bays put one straight through it)
    let bays = Math.max(2, Math.round(f.w / 3.4));
    if (f.name === 'front' && bays % 2 === 0) bays += 1;
    const pitch = f.w / bays;
    for (let b = 1; b < bays; b++) {
      const along = -f.w / 2 + pitch * b;
      const [px, pz] = onFace(f, along, -REC / 2 + 0.01);
      P.push('plaster', at(boxM(0.4, H, REC + 0.02, PLASTER), px, H / 2, pz, f.yaw));
      bayLines.push([f, along]);
    }
    const cellW = pitch - 0.4, cellH = FLOOR_H - BAND_H;
    for (let s = 0; s < floors; s++) {
      // the street's ground storey is the shopfronts, built below
      if (s === 0 && f.name === 'front') continue;
      const y0 = floorY(s) + BAND_H / 2, hh = s === 0 ? GROUND_H - BAND_H : cellH;
      for (let b = 0; b < bays; b++) {
        const along = -f.w / 2 + pitch * (b + 0.5);
        const lit = rnd() < 0.55, em = lit ? WARM : null;
        const balc = s >= 1 && cellW >= 2.2 && rnd() < (f.name === 'front' ? 0.35 : f.name === 'back' ? 0 : 0.15) && balcLeft > 0;
        if (balc) {
          balcLeft--;
          // glazed door: dark frame quad, lit pane, then the slab and rail out to the frame face + 0.6
          const [fx, fz] = onFace(f, along, -REC + 0.01), [gx, gz] = onFace(f, along, -REC + 0.02);
          P.push('dark', at(quadM(1.7, hh - 0.1, STEEL), fx, y0 + hh / 2, fz, f.yaw));
          P.push('emit', at(quadM(1.5, hh - 0.3, PANE, em, 0.7), gx, y0 + hh / 2 - 0.05, gz, f.yaw));
          const slabW = Math.min(cellW - 0.1, 3.2), depth = REC + 0.6;
          const [sx, sz] = onFace(f, along, -REC + depth / 2);
          P.push('concrete', at(boxM(slabW, 0.15, depth, CONC), sx, y0 + 0.075, sz, f.yaw));
          const [rx, rz] = onFace(f, along, 0.57);
          for (const ry of [0.4, 0.75, 1.1]) P.push('dark', at(boxM(slabW, 0.04, 0.04, STEEL), rx, y0 + 0.15 + ry, rz, f.yaw));
          for (const e of [-1, 1]) P.push('dark', at(boxM(0.05, 1.1, 0.05, STEEL), rx + f.t[0] * e * (slabW / 2 - 0.03), y0 + 0.7, rz + f.t[1] * e * (slabW / 2 - 0.03)));
          if (rnd() < 0.45) {   // a planter box against the rail, shrub on top
            const [qx, qz] = onFace(f, along + (rnd() < 0.5 ? -1 : 1) * (slabW / 2 - 0.5), 0.35);
            P.push('timber', at(boxM(0.8, 0.35, 0.36, WOOD), qx, y0 + 0.325, qz, f.yaw));
            P.push('dark', at(boxM(0.7, 0.3, 0.3, SHRUB), qx, y0 + 0.62, qz, f.yaw));
          }
        } else {
          // tall window: dark frame quad with the pane just proud of it; a timber infill panel fills the rest of the cell on two in five
          const timber = cellW >= 2.6 && rnd() < 0.4, side = rnd() < 0.5 ? -1 : 1;
          const winW = Math.min(1.5, cellW - 0.4), winH = Math.min(2.3, hh - 0.4);
          const wAlong = timber ? along - side * (cellW - winW) / 2 + side * 0.2 : along;
          const [fx, fz] = onFace(f, wAlong, -REC + 0.01), [gx, gz] = onFace(f, wAlong, -REC + 0.02);
          P.push('dark', at(quadM(winW, winH, STEEL), fx, y0 + hh / 2, fz, f.yaw));
          P.push('emit', at(quadM(winW - 0.2, winH - 0.2, PANE, em, 0.75), gx, y0 + hh / 2, gz, f.yaw));
          if (timber) {
            const tw = cellW - winW - 0.4, [tx, tz] = onFace(f, along + side * (cellW - tw) / 2, -REC + 0.015);
            P.push('timber', at(quadM(tw, hh - 0.1, WOOD), tx, y0 + hh / 2, tz, f.yaw));
          }
        }
      }
    }
  }

  // ---- ground floor: shop | residents' door | shop -------------------------------------------------
  {
    const W = front.w, doorW = 1.6, shopW = (W - 0.8 - doorW) / 2;   // 0.4 margin at each end for the corner piers
    const plinth = 0.45, glassH = 2.65, fasciaY = plinth + glassH + 0.5;   // fascia 3.6 .. 4.1 under the first band
    for (const side of [-1, 1]) {
      const c = side * (doorW / 2 + shopW / 2);
      const [gx, gz] = onFace(front, c, -REC + 0.02);
      P.push('emit', at(quadM(shopW - 0.2, glassH, 0x2a2418, WARM, 0.8), gx, plinth + glassH / 2, gz, front.yaw));
      const [px, pz] = onFace(front, c, -REC + 0.03);
      P.push('dark', at(boxM(0.06, plinth, shopW - 0.1, STEEL), px, plinth / 2, pz));   // plinth
      for (let m = 1; m < 3; m++) { const [mx, mz] = onFace(front, c - shopW / 2 + shopW * m / 3, -REC + 0.04); P.push('dark', at(boxM(0.06, glassH, 0.08, STEEL), mx, plinth + glassH / 2, mz)); }   // mullions
      // the fascia stands PROUD of the pier face (piers reach hw+0.02) as on the board -- a dark band running in front of the frame; inside the recess the bay piers sliced every sign in two
      const [fx, fz] = onFace(front, c, 0.04);
      P.push('dark', at(boxM(0.12, 1.0, shopW, 0x1a1c1f), fx, fasciaY, fz));   // the fascia board
      const [bx, bz] = onFace(front, c, 0.11);
      boards.push({ x: bx, y: fasciaY, z: bz, yaw: front.yaw, w: Math.min(6, shopW * 0.9), h: 1.0 });
    }
    // the awning over the left shop (a dark wedge hinged at the wall just under the fascia, dropping ~12 degrees to the +0.6 line) with three pendants under it
    {
      const c = -(doorW / 2 + shopW / 2), len = REC + 0.6, hingeY = plinth + glassH - 0.05;   // 3.05: under the fascia's bottom edge (3.1), so it does not emerge through the sign
      const g = boxM(len, 0.08, shopW - 0.4, 0x22252a);
      tiltZ(g, -0.21);
      P.push('dark', at(g, hw - REC + len / 2 * Math.cos(0.21), hingeY - len / 2 * Math.sin(0.21), c));
      const n = 3, under = hingeY - 0.45 * Math.tan(0.21) - 0.04;   // awning underside at the drops' x (hw+0.15), ~2.91
      for (let i = 0; i < n; i++) {
        const z = c - (shopW - 1.6) / 2 + (shopW - 1.6) * i / (n - 1);
        P.push('dark', at(boxM(0.02, 0.4, 0.02, STEEL), hw + 0.15, under - 0.2, z));   // the drop, reaching the awning
        P.push('emit', at(boxM(0.22, 0.12, 0.22, 0x2a2622, [1.0, 0.76, 0.54], 1.3), hw + 0.15, under - 0.46, z));
        lamps.push({ x: hw + 0.25, y: under - 0.56, z, colour: 0xffc28a });
      }
    }
    // the residents' door: dark frame, a dimly lit glass leaf, a concrete hood, a lamp
    {
      const [fx, fz] = onFace(front, 0, -REC + 0.01), [gx, gz] = onFace(front, 0, -REC + 0.02);
      P.push('dark', at(quadM(doorW, 2.7, STEEL), fx, 1.35, fz, front.yaw));
      P.push('emit', at(quadM(1.0, 2.3, 0x3c4a5a, [0.95, 0.9, 0.8], 0.35), gx, 1.2, gz, front.yaw));
      P.push('concrete', at(boxM(REC + 0.5, 0.12, doorW + 0.6, CONC), hw - REC + (REC + 0.5) / 2, 2.85, 0));
      lamps.push({ x: hw + 0.1, y: 2.75, z: 0, colour: 0xffc28a });
    }
  }

  // ---- roof terrace: parapet, rail with posts at every other bay line, pergola on the street half, planters, stair bulkhead ----
  {
    const pH = 0.45, railY = H + pH + 0.95;
    for (const f of F) {
      const [cx, cz] = onFace(f, 0, -0.15);
      P.push('plaster', at(boxM(f.w + 0.04, pH, 0.3, PLASTER), cx, H + pH / 2, cz, f.yaw));
      const [rx, rz] = onFace(f, 0, -0.15);
      P.push('dark', at(boxM(f.w - 0.2, 0.05, 0.05, STEEL), rx, railY, rz, f.yaw));
    }
    for (let i = 0; i < bayLines.length; i += 2) {
      const [f, along] = bayLines[i], [px, pz] = onFace(f, along, -0.15);
      P.push('dark', at(boxM(0.05, 0.95, 0.05, STEEL), px, H + pH + 0.475, pz));
    }
    for (const sz of [-1, 1]) P.push('dark', at(boxM(0.05, 0.95, 0.05, STEEL), hw - 0.15, H + pH + 0.475, sz * (hd - 0.15)), at(boxM(0.05, 0.95, 0.05, STEEL), -hw + 0.15, H + pH + 0.475, sz * (hd - 0.15)));
    // pergola: four timber posts, two beams running along the street face, rafters across
    const pw = Math.min(2 * hd - 3, 8), pd = Math.min(hw - 1.2, 3.6), px0 = hw - 0.9 - pd / 2, ph = 2.6;
    if (pw > 2.5 && pd > 1.5) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.push('timber', at(boxM(0.15, ph, 0.15, WOOD), px0 + sx * pd / 2, H + ph / 2, sz * pw / 2));
      for (const sx of [-1, 1]) P.push('timber', at(boxM(0.12, 0.2, pw + 0.4, WOOD), px0 + sx * pd / 2, H + ph + 0.1, 0));
      const n = Math.min(6, Math.floor(pw / 0.9));
      for (let i = 0; i < n; i++) P.push('timber', at(boxM(pd + 0.5, 0.12, 0.08, WOOD), px0, H + ph + 0.26, -pw / 2 + 0.3 + (pw - 0.6) * i / (n - 1)));
      lamps.push({ x: px0, y: H + ph - 0.3, z: 0, colour: 0xffc28a });   // a warm bulb under the pergola
    }
    // planters along the back parapet, and a stair bulkhead
    const np = Math.max(2, Math.min(4, Math.floor(hd / 2.5)));
    for (let i = 0; i < np; i++) {
      const z = -hd + 1.2 + (2 * hd - 2.4) * i / (np - 1);
      P.push('timber', at(boxM(0.6, 0.5, 1.4, WOOD), -hw + 0.75, H + 0.25, z));
      P.push('dark', at(boxM(0.5, 0.45, 1.3, SHRUB), -hw + 0.75, H + 0.7, z));
    }
    P.push('plaster', at(boxM(2.6, 2.4, 2.6, PLASTER), -hw + 2.4, H + 1.2, hd - 1.9));   // x from -hw+1.1: clear of the planters (they end at -hw+1.05)
  }

  // merge per material key: the integrator merges per chunk anyway, and the test counts triangles per part
  const byMat = new Map();
  for (const { mat, geo } of P.list) (byMat.get(mat) ?? byMat.set(mat, []).get(mat)).push(geo);
  const parts = [];
  for (const [mat, geos] of byMat) {
    const geo = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    parts.push({ geo, mat });
  }
  return { parts, boards, lamps, height: H, floors };
}
