import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { attribute, materialReference, time, sin, step, mix, float } from 'three/tsl';
import { mulberry32 } from '../core/rng.js';
import { setTokyoSignNight } from './tokyoSigns.js';

/**
 * Little Tokyo's buildings, built here -- not the kit, not Kenney.
 *
 * A Shinjuku / Shibuya back street is not tall towers; it is six-to-twelve
 * storey mixed-use slabs shoulder to shoulder, every one different in colour
 * and rhythm, with the whole street's identity hung on the OUTSIDE of them:
 * vertical sign columns (kanban) stacked with tenants' names up the corners,
 * a fascia over the shopfront, an awning, air-con units bolted anywhere,
 * balconies with railings, a water tank and an antenna on every roof, a
 * billboard frame on some, and neon tube lines along the floor edges.
 *
 * One building is one merged geometry: boxes, quads and a cylinder, every
 * part carrying real UVs (rule 4) and two per-vertex attributes -- `color`
 * (albedo) and `emit` (what glows at night: lit windows, shopfront glass,
 * neon, the kanban faces). Every building in a chunk merges into ONE mesh
 * drawn with ONE material (tokyoMaterial: vertex colour + emissive from the
 * `emit` attribute), so a whole district of them is one draw per chunk.
 * ~900 triangles a building; ninety buildings is ~80k triangles.
 *
 * The sign LETTERING is not geometry: the generator returns `boards` --
 * positions, sizes and a `kind` (h lightbox, v vertical kanban, s video
 * screen) for Little Tokyo's own atlas quads (world/tokyoSigns.js, one
 * instanced draw per chunk), so the kanban read as ラーメン and カラオケ, not
 * as coloured slabs.
 *
 * Local frame: origin at the footprint centre on the ground, +X is the
 * street side, footprint is 2hw (along X) by 2hd (along Z). Deterministic
 * per seed (CLAUDE.md: seeded randomness only).
 */

export const GROUND_H = 4.2;   // shopfront storey
export const FLOOR_H = 3.1;    // every storey above

/* Facade palettes: [wall, band]. Neutral. These carried eight hues held very
   dark -- violet-black, cyan-black and so on -- and Arun's call was that the
   colour on a building is wrong: "no colour to it". A Shibuya facade IS
   near-black concrete and tile; every colour on that street comes from the
   neon, the kanban and what the glass reflects, and those are all still here.
   Value varies 0x17..0x23 so the buildings read apart from one another. */
/* Tile and plaster in the reference still's own hues -- teal, salmon, cream,
   grey -- because near-black facades made the street a fridge with stickers.
   But VALUE is not hue: the first pass at this palette ran ~1.5 stops hot and
   our upper facades measured mean luminance 0.355/0.515 against the still's
   0.197/0.211. Same hues, darkened, so the wall is a surface the neon lights
   rather than a surface that competes with it. */
const WALLS = [
  [0x24423f, 0x19302e], [0x7d6560, 0x5c4a46], [0x86807a, 0x6b665f], [0x42474a, 0x2e3236],
  [0x2f3a34, 0x1f2622], [0x56534f, 0x3f3d3a], [0x1e2023, 0x141518], [0x726257, 0x554741],
];
/* The pale masses of the Shibuya day stills: stone, blue-grey and cream, about
   half a stop over the brightest wall above -- not the first pass's 1.5 stops.
   Office slabs with ribbon glass wear these; a few others do too. */
const LIGHT = [[0x9d9a93, 0x7f7c76], [0x8f979c, 0x70777c], [0xa39a86, 0x857d6b]];
const MAGENTA = [1.0, 0.25, 0.75], CYAN = [0.2, 0.9, 1.0];
// weighted by repetition: the cover art is six parts magenta/cyan to four of everything else
const NEON = [MAGENTA, CYAN, MAGENTA, CYAN, MAGENTA, CYAN, [1.0, 0.85, 0.2], [0.95, 0.95, 1.0], [1.0, 0.3, 0.2], [0.5, 1.0, 0.4]];
const WARM = [1.0, 0.82, 0.55], COOL = [0.72, 0.85, 1.0];
const _c = new THREE.Color();

/** Add `color`, `emit` and `flick` attributes to a geometry, flat. `flick` > 0 marks a part whose glow buzzes (the phase is the value). */
function paint(geo, hex, emit = null, k = 1, flick = 0) {
  _c.setHex(hex);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3), em = new Float32Array(n * 3), fl = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    if (emit) { em[i * 3] = emit[0] * k; em[i * 3 + 1] = emit[1] * k; em[i * 3 + 2] = emit[2] * k; }
    fl[i] = flick;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('emit', new THREE.BufferAttribute(em, 3));
  geo.setAttribute('flick', new THREE.BufferAttribute(fl, 1));
  return geo;
}
/** A flicker phase for a part, or 0: about one glowing part in seven buzzes. */
const flickerOf = (rnd) => (rnd() < 0.15 ? 0.5 + rnd() * 6 : 0);
const box = (w, h, d, hex, emit, k, flick) => paint(new THREE.BoxGeometry(w, h, d), hex, emit, k, flick);
const cyl = (r, h, hex, seg = 10) => paint(new THREE.CylinderGeometry(r, r, h, seg), hex);
/** A quad facing +Z in its own frame, then turned to face `ry` about Y and moved. */
const quad = (w, h, hex, emit, k, flick) => paint(new THREE.PlaneGeometry(w, h), hex, emit, k, flick);
const _m = new THREE.Matrix4(), _e = new THREE.Euler();
function at(geo, x, y, z, ry = 0) {
  if (ry) geo.applyMatrix4(_m.makeRotationFromEuler(_e.set(0, ry, 0)));
  geo.applyMatrix4(_m.makeTranslation(x, y, z));
  return geo;
}

/* The four faces in the local frame. `n` is the outward normal, `t` the
   along-face tangent, `w` the face width, `yaw` turns a +Z-facing quad to
   face outward (normal = (sin yaw, 0, cos yaw)). */
function faces(hw, hd) {
  return [
    { name: 'front', n: [1, 0], t: [0, 1], w: 2 * hd, yaw: Math.PI / 2, off: hw },
    { name: 'back', n: [-1, 0], t: [0, -1], w: 2 * hd, yaw: -Math.PI / 2, off: hw },
    { name: 'left', n: [0, 1], t: [-1, 0], w: 2 * hw, yaw: 0, off: hd },
    { name: 'right', n: [0, -1], t: [1, 0], w: 2 * hw, yaw: Math.PI, off: hd },
  ];
}
/** Point on a face: `s` along the face from its centre, `out` proud of the wall. */
function onFace(f, s, out) {
  return [f.n[0] * (f.off + out) + f.t[0] * s, f.n[1] * (f.off + out) + f.t[1] * s];
}

/**
 * Build one building. Returns { geo, boards, height, floors, tris }.
 *   hw, hd   half footprint along local X (street axis) and Z
 *   h        the planner's height; snapped to whole storeys
 * boards: [{ x, y, z, yaw, w, h, kind, vertical? }] in the local frame for the Tokyo atlas.
 */
/* Lamp intensities are HALVED from the first pass (2026-09-14): 150-220 against
   the pool's own default of 60 meant a wall 3 m from a kanban was floodlit, and
   the building beside the camera read at mean luminance 0.445 where the
   reference still is 0.211 -- a green wall lit green, not a dark wall wearing a
   green sign. The sign should be the bright thing; the wall it hangs on should
   be what the sign is bright AGAINST. */
export function buildTokyoBuilding(seed, hw, hd, h) {
  const rnd = mulberry32((seed * 2654435761) >>> 0);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const wide = Math.max(hw, hd) > 15;
  const cap = wide ? 13 : h > 50 ? 26 : 20;
  const floors = Math.max(2, Math.min(cap, Math.round((h - GROUND_H) / FLOOR_H) + 1));
  const H = GROUND_H + (floors - 1) * FLOOR_H;
  const floorY = (f) => (f === 0 ? 0 : GROUND_H + (f - 1) * FLOOR_H);   // bottom of storey f
  const residential = rnd() < 0.5;
  // office floors wear a glass band per storey on the street face, the way the stills' office slabs do
  const ribbon = !residential && rnd() < 0.45;
  const [wall, band] = ribbon || rnd() < 0.15 ? pick(LIGHT) : pick(WALLS);
  const neon = pick(NEON);   // was seven in ten; with only 30% of the avenue left non-glass, every one of them carries a tube colour ("RGB buildings only")
  const parts = [], boards = [], lamps = [];   // lamps: where the night light pool may put a real coloured light (the kanban)
  const F = faces(hw, hd);

  // 1. RECESSED GROUND-FLOOR COLONNADE & MASS
  const recess = 1.35;
  const upperH = Math.max(0, H - GROUND_H);
  if (upperH > 0) {
    parts.push(at(box(2 * hw, upperH, 2 * hd, wall), 0, GROUND_H + upperH / 2, 0));
  }
  // Ground floor recessed mass (offset -recess/2 along X so sidewalk is under upper overhang)
  parts.push(at(box(2 * hw - recess, GROUND_H, 2 * hd, wall), -recess / 2, GROUND_H / 2, 0));
  // Colonnade soffit ceiling
  parts.push(at(box(recess + 0.04, 0.16, 2 * hd + 0.04, band), hw - recess / 2, GROUND_H - 0.08, 0));
  // Structural support pillars along curb line X = hw - 0.22
  const numPillars = Math.max(2, Math.floor(2 * hd / 4.0) + 1);
  for (let p = 0; p < numPillars; p++) {
    const pz = -hd + 0.5 + (p / (numPillars - 1)) * (2 * hd - 1.0);
    parts.push(at(box(0.44, GROUND_H, 0.44, band), hw - 0.22, GROUND_H / 2, pz));
    parts.push(at(box(0.50, 0.35, 0.50, 0x14161a), hw - 0.22, 0.175, pz));
  }
  // Storey bands
  for (let f = 1; f < floors; f++) parts.push(at(box(2 * hw + 0.08, 0.16, 2 * hd + 0.08, band), 0, floorY(f), 0));

  // 2. WINDOW BAYS & REVEALS
  for (const f of F) {
    const bays = Math.max(1, Math.floor((f.w - 0.8) / (f.name === 'front' ? 2.4 : 3.4)));
    const pitch = f.w / bays;
    for (let s = 1; s < floors; s++) {
      // Horizontal window sill shelf on the street face for depth
      if (f.name === 'front') {
        parts.push(at(box(0.18, 0.08, f.w * 0.98, band), hw + 0.08, floorY(s) + 0.78, 0));
      }
      for (let b = 0; b < bays; b++) {
        const along = -f.w / 2 + pitch * (b + 0.5);
        const lit = rnd() < 0.3;
        const em = lit ? (rnd() < 0.7 ? WARM : COOL) : null;
        const [x, z] = onFace(f, along, 0.035);
        const band3 = ribbon && f.name === 'front';   // a bay of the glass band: the bays touch, so the storey reads as one strip
        parts.push(at(quad(band3 ? pitch * 0.97 : Math.min(1.4, pitch * 0.55), band3 ? 1.8 : 1.5, band3 ? 0x22384a : 0x0c121a, em, 0.16), x, floorY(s) + 1.55, z, f.yaw));
        // balconies: residential backs and sides, one storey in two
        if (residential && f.name !== 'front' && s >= 2 && rnd() < 0.5) {
          const [bx, bz] = onFace(f, along, 0.5);
          const slabW = Math.min(1.8, pitch * 0.8);
          parts.push(at(box(1.0, 0.12, slabW, band), bx, floorY(s) + 0.06, bz, f.yaw));
          const [rx, rz] = onFace(f, along, 0.98);
          parts.push(at(box(0.05, 0.95, slabW, 0x5b5f66), rx, floorY(s) + 0.6, rz, f.yaw));
        }
        // air-con units, bolted under windows on the sides and back
        if (f.name !== 'front' && s >= 1 && rnd() < 0.3) {
          const [ax, az] = onFace(f, along + pitch * 0.3, 0.2);
          parts.push(at(box(0.32, 0.55, 0.7, 0xc9ccd1), ax, floorY(s) + 0.6, az, f.yaw));
        }
      }
    }
  }

  // an external steel stair on the back of three in ten: landings at every storey with a railing, a stringer up the wall
  if (rnd() < 0.3 && floors >= 3) {
    const back = F[1], s0 = -back.w / 2 + 1.4;
    const [sx, sz] = onFace(back, s0 - 0.7, 1.35);
    parts.push(at(box(0.08, H - 1.0, 0.08, 0x3a3d42), sx, (H - 1.0) / 2 + 0.5, sz));   // the stringer
    for (let s = 1; s < floors; s++) {
      const [lx, lz] = onFace(back, s0, 0.7);
      parts.push(at(box(1.4, 0.08, 1.4, 0x4a4d52), lx, floorY(s) + 0.05, lz, back.yaw));
      const [rx, rz] = onFace(back, s0, 1.38);
      parts.push(at(box(0.04, 0.9, 1.4, 0x3a3d42), rx, floorY(s) + 0.5, rz, back.yaw));
    }
  }

  // 3. RECESSED STOREFRONT UNDER THE OVERHANG
  const front = F[0];
  const shopX = hw - recess + 0.04;
  let konbiniFront = false;   // the awning below needs to know which shop this is
  if (rnd() < 0.18) {
    // shuttered: ribbed grey roller door tucked under colonnade
    parts.push(at(quad(front.w - 0.6, 2.7, 0x8d9096), shopX, 1.65, 0, front.yaw));
    for (let r = 0; r < 6; r++) { parts.push(at(box(0.02, 0.04, front.w - 0.7, 0x6f7378), shopX + 0.02, 0.5 + r * 0.42, 0)); }
  } else {
    // OPEN SHOP: a room you can see into (image 11), not a glowing glass sticker.
    const konbini = rnd() < 0.35;
    konbiniFront = konbini;
    const shop = konbini ? [1.0, 0.92, 0.72] : WARM;
    const roomW = Math.max(2.4, front.w - 0.8);
    const roomD = recess - 0.15;
    parts.push(at(box(0.08, 2.55, roomW, konbini ? 0x3a3830 : 0x3a2e24, shop, 0.85), shopX - roomD, 1.4, 0));
    parts.push(at(box(roomD, 0.05, roomW, 0x2a241c, shop, 0.22), shopX - roomD / 2, 0.04, 0));
    parts.push(at(box(roomD, 0.08, roomW, 0x2a2618, shop, 0.55), shopX - roomD / 2, GROUND_H - 0.2, 0));
    parts.push(at(box(0.08, 2.55, 0.08, 0x2a2a28), shopX - 0.02, 1.4, roomW / 2 - 0.04));
    parts.push(at(box(0.08, 2.55, 0.08, 0x2a2a28), shopX - 0.02, 1.4, -roomW / 2 + 0.04));
    parts.push(at(box(0.45, 0.95, Math.min(3.4, roomW * 0.45), 0x4a4038, shop, 0.4), shopX - 0.4, 0.5, 0));
    if (konbini) {
      for (const z of [-roomW * 0.28, roomW * 0.28]) {
        parts.push(at(box(0.22, 1.6, 0.7, 0x3a4048, [0.7, 0.75, 0.85], 0.5), shopX - roomD + 0.2, 1.1, z));
      }
    }
    lamps.push({
      x: hw + 0.4, y: 1.6, z: 0,
      colour: _c.setRGB(shop[0], shop[1], shop[2]).getHex(),
      neon: true, intensity: 95, range: 30, glare: 1.6,
    });
  }
  // Store entrance door
  {
    const ds = (rnd() < 0.5 ? -1 : 1) * (front.w / 2 - 1.3);
    parts.push(at(box(0.06, 2.5, 1.25, 0x2a2d33), shopX + 0.03, 1.25, ds));
    parts.push(at(quad(1.0, 2.2, 0x3c4a5a, [0.95, 0.9, 0.8], 0.22), shopX + 0.06, 1.15, ds, front.yaw));
  }

  /* 4. THE STREET FACE'S SIGNS, zoned (2026-09-23). Four kinds used to go up
     at the face's ends independently -- blade boards at +-(w/2 - 1.2), the tall
     kanban at +-(w/2 - bw/2 - 0.35), the kanban column at +-(hd - 0.55), a neon
     blade at +-(w/2 - 0.8) -- so on most buildings two shared an end and ran
     through each other. Now, matched to the Shibuya stills:
       end A   the tall flat kanban, or the white kanban column
       end B   a stack of projecting vertical kanban, lettered on both faces
       middle  a tenant sign per storey in the spandrels and, on some tall
               buildings, a video screen above them
     Every board carries `kind` for the Tokyo atlas (world/tokyoSigns.js):
     h (4:1 lightbox), v (vertical kanban) or s (2:1 screen). */
  const endA = rnd() < 0.5 ? -1 : 1, endB = -endA;
  const signColor = neon ?? pick(NEON);

  // end B: projecting vertical kanban, 1.15 m out from the wall on brackets
  {
    const proj = 1.15, top = H - 1.0, px = hw + 0.25 + proj / 2;
    const pz = endB * Math.max(0.6, hd - 0.9);
    let y0 = 5.2;
    for (let i = 0; i < 4 && y0 + 2.6 < top; i++) {
      const signH = Math.min(top - y0, 3.4 + rnd() * 1.8);
      const y = y0 + signH / 2;
      y0 += signH + 0.9;
      if (i > 0 && rnd() < 0.3) continue;
      const c = i === 0 ? signColor : pick(NEON);
      parts.push(at(box(proj, signH, 0.2, 0x181a1f), px, y, pz));                                                 // the lightbox
      parts.push(at(box(0.07, signH + 0.1, 0.24, 0x111115, c, 2.4, flickerOf(rnd)), px + proj / 2, y, pz));       // a tube down its leading edge
      for (const dy of [signH / 2 - 0.3, 0.3 - signH / 2]) parts.push(at(box(0.3, 0.08, 0.1, 0x2b2e34), hw + 0.1, y + dy, pz));   // brackets
      /* A face on each side, each facing AWAY from the lightbox (normal =
         (sin yaw, 0, cos yaw)). The blade boards this replaces had it the wrong
         way round -- yaw front.yaw + side*PI/2 gave the +Z face a -Z normal --
         so both faces looked into their own box and were culled from outside. */
      for (const side of [-1, 1]) boards.push({ x: px, y, z: pz + side * 0.105, yaw: side > 0 ? 0 : Math.PI, w: proj - 0.12, h: signH - 0.14, vertical: true, kind: 'v' });
    }
    lamps.push({
      x: hw + 1.6, y: 2.6, z: pz,
      colour: _c.setRGB(signColor[0], signColor[1], signColor[2]).getHex(),
      neon: true, intensity: 85, range: 30, glare: 2.4,
    });
  }

  // end A: the tall flat kanban (ラーメン) three buildings in five, the white kanban column on the rest
  const bhA = Math.min(4.4 + rnd() * 2.2, H - 5.8);
  if (rnd() < 0.6 && bhA > 2.8) {
    const bw = 1.35 + rnd() * 0.45;
    const by = 5.2 + bhA / 2 + rnd() * Math.min(0.6, H - 5.5 - bhA);   // above the fascia, under the parapet
    const along = endA * Math.max(0.4, hd - bw / 2 - 0.35);
    parts.push(at(box(0.14, bhA, bw, 0x141418, signColor, 1.9, flickerOf(rnd)), hw + 0.22, by, along));
    boards.push({ x: hw + 0.32, y: by, z: along, yaw: front.yaw, w: bw * 0.88, h: bhA * 0.92, vertical: true, kind: 'v' });
    lamps.push({
      x: hw + 1.4, y: 2.5, z: along * 0.3,
      colour: _c.setRGB(signColor[0], signColor[1], signColor[2]).getHex(),
      neon: true, intensity: 105, range: 34, glare: 2.5,
    });
  } else {
    const colH = Math.max(0, H - 5.5) * (0.74 + rnd() * 0.26);
    if (colH > 2.0) {
      const cz = endA * (hd - 0.55);
      const cc = neon ?? [0.9, 0.9, 0.9];
      parts.push(at(box(0.28, colH, 0.95, 0xf2f2f2, cc, 1.25, flickerOf(rnd)), hw + 0.18, 4.6 + colH / 2, cz));
      parts.push(at(box(0.08, colH + 0.2, 0.1, 0x222222, cc, 2.4), hw + 0.33, 4.6 + colH / 2, cz + 0.5), at(box(0.08, colH + 0.2, 0.1, 0x222222, cc, 2.4), hw + 0.33, 4.6 + colH / 2, cz - 0.5));
      { const nc = pick(NEON); lamps.push({ x: hw + 1.5, y: 2.4, z: cz, colour: _c.setRGB(nc[0], nc[1], nc[2]).getHex(), neon: true, intensity: 100, range: 34, glare: 2.6 }); }
      { const g = quad(2.8, 2.0, 0x2a2a2e, cc, 0.85); g.applyMatrix4(_m.makeRotationX(-Math.PI / 2)); parts.push(at(g, hw + 1.35, 0.03, cz)); }
      // panels 3.2 m tall (were 2.6): the kanban tiles are 1:4, and a 0.9 x 2.6 board squashed their characters
      const panelH = 3.2, n = Math.min(3, Math.max(1, Math.floor((colH - 0.2) / (panelH + 0.1))));
      for (let i = 0; i < n; i++) boards.push({ x: hw + 0.335, y: 4.6 + 0.1 + panelH / 2 + i * (panelH + 0.1), z: cz, yaw: front.yaw, w: 0.9, h: panelH, vertical: true, kind: 'v' });
    }
  }

  // middle, high: a video screen on some tall buildings -- the corner screens in the stills
  let screenFloor = floors;   // the tenant column stops under it
  {
    const want = floors >= 12 ? rnd() < 0.7 : floors >= 7 ? rnd() < 0.35 : false;
    const bw = Math.min(2 * hd - 4.8, floors >= 12 ? 12 : 9), bh = bw / 2;   // 4.8: the bezel clears a tall kanban at end A
    const sb = Math.max(2, Math.floor(floors * 0.45));
    if (want && bw >= 4.5 && floorY(sb) + bh + 0.8 < H) {
      const by = floorY(sb) + 0.3 + bh / 2;
      parts.push(at(box(0.25, bh + 0.36, bw + 0.36, 0x0d0e11), hw + 0.125, by, 0));   // the bezel
      boards.push({ x: hw + 0.26, y: by, z: 0, yaw: front.yaw, w: bw, h: bh, kind: 's' });
      lamps.push({ x: hw + 2.0, y: by - bh / 2, z: 0, colour: 0xd6e6ff, neon: true, intensity: 70, range: 28, glare: 2.0 });
      screenFloor = sb;
    }
  }

  // middle: one tenant per storey, its lightbox in the spandrel between the windows
  {
    const tw = Math.min(3.0, (2 * hd - 3.5) * 0.8), tz = endA * -0.45;
    const last = Math.min(screenFloor - 1, floors - 1, 9);
    if (tw >= 1.6 && rnd() < 0.75) {
      for (let st = 1; st <= last; st++) {
        if (rnd() < 0.2) continue;
        const y = floorY(st) + 2.78;
        parts.push(at(box(0.12, 0.7, tw + 0.1, 0x1a1b20), hw + 0.1, y, tz));
        boards.push({ x: hw + 0.17, y, z: tz, yaw: front.yaw, w: tw, h: 0.62, kind: 'h' });
      }
    }
  }

  // Awning extending from colonnade
  /* The konbini's awning is the three-stripe one the reference points at
     (green / orange / red over white), not a flat colour: it is the single most
     recognisable thing on a Japanese street at this scale. */
  const awningCol = konbiniFront ? 0xecf0f1 : pick([0xc0392b, 0x2e86de, 0xf1c40f, 0xecf0f1, 0x27ae60]);
  parts.push(at(box(1.5, 0.08, front.w * 0.88, awningCol), hw - recess + 0.75, 3.25, 0));
  if (konbiniFront) {
    const sw = front.w * 0.88 / 3;
    const cols = [0x1f8a4c, 0xe8762a, 0xd5312a];
    for (let i = 0; i < 3; i++) {
      parts.push(at(box(1.52, 0.05, sw * 0.92, cols[i]), hw - recess + 0.75, 3.30, -front.w * 0.44 + sw * (i + 0.5)));
    }
  }
  if (rnd() < 0.5) {
    const stripes = Math.max(2, Math.floor(front.w * 0.88 / 0.9));
    for (let i = 0; i < stripes; i += 2) parts.push(at(box(1.51, 0.02, 0.42, 0xf4f4f0), hw - recess + 0.75, 3.30, -front.w * 0.44 + 0.45 + i * 0.9));
  }
  // string lights under colonnade
  if (rnd() < 0.33) {
    const n = Math.max(4, Math.floor(front.w / 0.9));
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), s = 4 * t * (1 - t);
      const along = -front.w * 0.42 + front.w * 0.84 * t;
      parts.push(at(box(0.09, 0.09, 0.09, 0x3a2a1a, [1.0, 0.72, 0.35], 1.3), hw - recess + 1.1, 4.2 - 0.35 * s, along));
    }
  }
  // Fascia boards above the colonnade: one per shop width -- a single board across a 12 m front read three times too wide
  {
    const span = front.w * 0.85, n = Math.max(1, Math.round(span / 4.0)), segW = span / n;
    for (let i = 0; i < n; i++) boards.push({ x: front.off + 0.16, y: 4.45, z: -span / 2 + segW * (i + 0.5), yaw: front.yaw, w: segW - 0.12, h: 0.95, kind: 'h' });
  }
  parts.push(at(box(0.1, 0.12, front.w * 0.88, 0x111115, neon ?? MAGENTA, 2.2, flickerOf(rnd)), hw + 0.22, 4.95, 0));

  // Vending machine on the sidewalk
  {
    const vz = -(hd - 0.9);
    parts.push(at(box(0.85, 1.85, 1.0, 0xf4f4f6), hw - recess + 0.55, 0.925, vz));
    parts.push(at(quad(0.78, 1.25, 0x9fb7d8, [0.55, 0.75, 1.0], 0.9), hw - recess + 0.98, 1.15, vz, front.yaw));
  }
  // Izakaya red paper lanterns
  if (rnd() < 0.35) {
    const n = 3 + Math.floor(rnd() * 3), span = front.w * 0.7;
    for (let i = 0; i < n; i++) {
      const lz = -span / 2 + span * (i / Math.max(1, n - 1));
      parts.push(at(paint(new THREE.CylinderGeometry(0.17, 0.17, 0.32, 8), 0xc0392b, [1.0, 0.32, 0.12], 1.1, flickerOf(rnd)), hw - recess + 0.65, 2.95, lz));
    }
  }
  // EVERY kerb face gets a shop + tall kanban. Image 11 is shops on both
  // sides; dressing only the "front" left a blank wall on the N-S street.
  for (const f of [F[2], F[3]]) {
    if (f.w < 6) continue;
    const shop = rnd() < 0.4 ? [1.0, 0.9, 0.65] : WARM;
    const [gx, gz] = onFace(f, 0, 0.08);
    if (rnd() < 0.18) {
      parts.push(at(quad(f.w - 0.7, 2.7, 0x8d9096), gx, 1.5, gz, f.yaw));
    } else {
      /* ON the wall, not inside the solid mass -- a quad 40 cm in is buried.
         But BAYS, not one panel (2026-09-14). A single emissive quad the full
         width of the face, up to 13 m of it at intensity 1.35, is a light box:
         it was the brightest thing in frame, held our right-hand facade at mean
         luminance 0.478 against the reference still's 0.211, and pushed blown
         pixels to 2.24% against its 0.59%. The reference's shopfronts are
         glazed bays between dark piers, over a dark stallriser -- bright, but
         punctuated, and the dark returns are what make the bright parts read as
         bright. Same lit area, a third of the glare. */
      const bays = Math.max(1, Math.round((f.w - 0.8) / 3.2));
      const pier = 0.36;
      const bayW = Math.max(1.4, (f.w - 0.8 - pier * (bays - 1)) / bays);
      for (let i = 0; i < bays; i++) {
        const along = -(f.w - 0.8) / 2 + bayW / 2 + i * (bayW + pier);
        const [bx2, bz2] = onFace(f, along, 0.08);
        parts.push(at(quad(bayW, 1.95, 0x3a2a1c, shop, 0.62), bx2, 1.72, bz2, f.yaw));   // the glazing
        parts.push(at(quad(bayW, 0.55, 0x24201c), bx2, 0.42, bz2, f.yaw));               // stallriser, dark
      }
      const [lx, lz] = onFace(f, 0, 1.1);
      lamps.push({
        x: lx, y: 1.65, z: lz,
        colour: _c.setRGB(shop[0], shop[1], shop[2]).getHex(),
        neon: true, intensity: 110, range: 34, glare: 2.0,
      });
    }
    { // the fascia in shop widths, like the street face's
      const span = Math.min(f.w * 0.9, 14), n = Math.max(1, Math.round(span / 4.2)), segW = span / n;
      for (let i = 0; i < n; i++) {
        const [fx, fz] = onFace(f, -span / 2 + segW * (i + 0.5), 0.2);
        boards.push({ x: fx, y: 4.3, z: fz, yaw: f.yaw, w: segW - 0.12, h: 1.05, kind: 'h' });
      }
    }
    const nKan = rnd() < 0.30 ? 0 : f.w > 11 ? 2 : 1;   // see the sign-coverage note on the kanban column
    for (let i = 0; i < nKan; i++) {
      const along = -f.w / 2 + (i + 0.55) * (f.w / nKan);
      const [kx, kz] = onFace(f, along, 0.3);
      const bh = 4.8 + rnd() * 2.2, bw = 1.35 + rnd() * 0.45;
      const c = pick(NEON);
      parts.push(at(box(0.16, bh, bw, 0x141418, c, 2.05, flickerOf(rnd)), kx, 6.1 + rnd() * 0.6, kz, f.yaw));
      boards.push({ x: kx + f.n[0] * 0.1, y: 6.3, z: kz + f.n[1] * 0.1, yaw: f.yaw, w: bw * 0.86, h: bh * 0.9, vertical: true, kind: 'v' });
    }
  }

  // 5. ROOFTOP CROWN, HVAC, WATER TANK & BEACON ANTENNA
  const pw = 0.22;
  parts.push(at(box(2 * hw + 0.1, 0.5, pw, band), 0, H + 0.25, hd), at(box(2 * hw + 0.1, 0.5, pw, band), 0, H + 0.25, -hd));
  parts.push(at(box(pw, 0.5, 2 * hd + 0.1, band), hw, H + 0.25, 0), at(box(pw, 0.5, 2 * hd + 0.1, band), -hw, H + 0.25, 0));
  const tx = -hw * 0.45, tz = hd * 0.4;
  // Water cooling tank
  parts.push(at(cyl(0.85, 1.5, 0x9fa4aa), tx, H + 1.35, tz), at(box(1.9, 0.6, 1.9, 0x484d54), tx, H + 0.3, tz));
  // Rooftop HVAC unit
  parts.push(at(box(2.0, 1.1, 1.3, 0x42464c), hw * 0.2, H + 0.55, hd * 0.25));
  parts.push(at(box(1.6, 0.35, 0.05, 0x16181b), hw * 0.2, H + 0.55, hd * 0.25 + 0.67));
  // Communications tower with pulsing red aviation warning beacon
  parts.push(at(box(0.08, 4.8, 0.08, 0x3a3d42), hw * 0.55, H + 2.4, -hd * 0.5));
  parts.push(at(box(0.2, 0.2, 0.2, 0xff2030, [1.0, 0.1, 0.15], 2.8, 0.85), hw * 0.55, H + 4.9, -hd * 0.5));
  // Elevator motor room bulkhead
  parts.push(at(box(2.2, 2.4, 2.4, wall), -hw * 0.3, H + 1.2, -hd * 0.45));
  // a rooftop billboard on a third of them -- and on every landmark slab (18+ storeys), wider, with a neon frame
  const landmark = floors >= 18;
  if ((landmark || rnd() < 0.35) && 2 * hd > 5) {
    const bw = Math.min(2 * hd - 1.2, landmark ? 14 : 9), by = H + (landmark ? 3.0 : 2.2);
    if (landmark) { const nc = pick(NEON); parts.push(at(box(0.1, 0.12, bw + 0.4, 0x222222, nc, 1.3), -hw + 0.34, by + 1.55, 0), at(box(0.1, 0.12, bw + 0.4, 0x222222, nc, 1.3), -hw + 0.34, by - 1.55, 0)); }
    const bh = Math.min(2.4, bw * 0.92 / 3.0);   // at least 3:1, or a narrow roof squashes the 4:1 tile's lettering
    parts.push(at(box(0.12, bh + 0.4, bw, 0x2b2e33), -hw + 0.3, by, 0));
    parts.push(at(box(0.08, 3.2, 0.08, 0x2b2e33), -hw + 0.3, H + 1.6, -bw / 2 + 0.2), at(box(0.08, 3.2, 0.08, 0x2b2e33), -hw + 0.3, H + 1.6, bw / 2 - 0.2));
    boards.push({ x: -hw + 0.38, y: by, z: 0, yaw: front.yaw, w: bw * 0.92, h: bh, kind: 'h' });
  }

  const geo = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  geo.computeBoundingSphere();
  return { geo, boards, lamps, height: H, floors, tris: geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3 };
}

/**
 * Which side faces the street: sample a point 3 m outside each face and take
 * the one deepest into tarmac. Returns the rotation (about Y, radians) that
 * turns the generator's +X front onto that side. `probe(x, z)` is
 * district.tarmacDepth in the block's world frame; `toWorld(lx, lz)` maps the
 * footprint's local frame to world. Pure; tested.
 */
export function frontRotation(probe, toWorld, hw, hd) {
  /* `probe` is district.tarmacDepth: the SIGNED distance to the nearest road
     edge, negative on tarmac, positive on the pavement, capped at 60 off the
     plan. Probe 3, 7 and 11 m out from each face and take the side with the
     smallest weighted distance -- the one that reaches the street soonest.
     (The first cut maximised it, and every kanban went up on the back wall.) */
  const tests = [[1, 0, 0], [-1, 0, Math.PI], [0, 1, -Math.PI / 2], [0, -1, Math.PI / 2]];
  let best = 0, bestD = Infinity;
  for (const [nx, nz, rot] of tests) {
    /* Min of a few metres out, not a weighted sum. A weighted SUM of signed
       distances is not a meaningful quantity -- it lets a face that is far from
       the road at 3 m win on the strength of an arterial 11 m out -- whereas the
       min asks the only question that matters: "how close does this face ever
       get to tarmac".

       Measured over all 219 Little Tokyo footprints, both rules pick the SAME
       face on 219/219, so this fixes no bug on today's district file; it is
       here so a future block layout cannot be decided by that arithmetic. */
    let d = Infinity;
    for (const out of [3, 5, 8]) {
      const [x, z] = toWorld(nx * (hw + out), nz * (hd + out));
      d = Math.min(d, probe(x, z));
    }
    if (d < bestD) { bestD = d; best = rot; }
  }
  return best;
}

/**
 * The street's overhead: utility poles along the kerb and sagging power lines
 * between them, with a drop to each building. `segments` are
 * { ax, az, bx, bz, half } in world metres; `near(x, z)` says whether a point
 * is by a Tokyo building. Returns { parts } (pole geometry for the chunk's
 * Tokyo mesh, world space) and { lines } (a Float32Array of segment pairs for
 * one LineSegments). Poles every ~22 m, alternating sides; wires sag 0.9 m at
 * mid-span in five pieces. Deterministic per chunk seed.
 */
export const POLE_H = 9.5;
export function buildTokyoStreet(segments, near, seed) {
  const rnd = mulberry32((seed * 2246822519) >>> 0);
  const parts = [], lines = [];
  const sag = (a, b, out) => {
    const N = 5;
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N;
      for (const t of [t0, t1]) {
        const s = 4 * t * (1 - t);   // parabola, 1 at mid-span
        out.push(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - 0.9 * s, a[2] + (b[2] - a[2]) * t);
      }
    }
  };
  for (const s of segments) {
    const dx = s.bx - s.ax, dz = s.bz - s.az, L = Math.hypot(dx, dz);
    if (L < 20) continue;
    const ux = dx / L, uz = dz / L, nx = -uz, nz = ux, off = s.half + 0.9;
    let prev = null;
    for (let t = 9 + rnd() * 6, i = 0; t < L - 6; t += 20 + rnd() * 5, i++) {
      const side = i % 2 ? 1 : -1;
      const px = s.ax + ux * t + nx * off * side, pz = s.az + uz * t + nz * off * side;
      if (!near(px, pz)) { prev = null; continue; }
      // the pole: a dark concrete cylinder with a cross-arm and two insulators
      parts.push(at(paint(new THREE.CylinderGeometry(0.14, 0.18, POLE_H, 8), 0x6e6f72), px, POLE_H / 2, pz));
      parts.push(at(box(1.6, 0.1, 0.1, 0x3a3d42), px, POLE_H - 0.6, pz, Math.atan2(-uz, ux)));
      const top = [px, POLE_H - 0.55, pz];
      if (prev) { sag(prev, top, lines); sag([prev[0], prev[1] - 0.35, prev[2]], [top[0], top[1] - 0.35, top[2]], lines); }   // two lines per span
      // a drop to the nearest building face, roughly: back toward the block side at about 7 m
      const bx = px + nx * side * 4.5, bz = pz + nz * side * 4.5;
      lines.push(px, POLE_H - 0.9, pz, bx, 7.2 + rnd() * 1.5, bz);
      prev = top;
    }
  }
  return { parts, lines: new Float32Array(lines) };
}

/**
 * A neighbourhood shrine for the district's park block: a red torii (two
 * pillars, the curved-looking kasagi lintel as a wider box over the nuki
 * beam), two stone lanterns, a gravel-coloured apron and a pair of komainu
 * plinths. Local frame, origin at the apron centre, gate facing +X. Merged
 * like a building; ~200 triangles.
 */
export function buildShrine(seed = 1) {
  const rnd = mulberry32((seed * 3266489917) >>> 0);
  const red = 0xb5321c, stone = 0x9a9a94, dark = 0x2b2a28;
  const parts = [];
  parts.push(at(box(14, 0.12, 10, 0xb8b0a0), 0, 0.06, 0));                                  // gravel apron
  for (const side of [-1, 1]) {
    parts.push(at(cyl(0.22, 5.2, red, 10), 4.2, 2.6, side * 2.1));                           // pillars
    parts.push(at(cyl(0.26, 0.3, dark, 10), 4.2, 0.15, side * 2.1));                         // pillar bases
    parts.push(at(cyl(0.16, 2.3, stone, 8), -2.5 + rnd() * 0.4, 1.15, side * 3.6));         // lantern posts
    parts.push(at(box(0.7, 0.55, 0.7, stone), -2.5, 2.55, side * 3.6));                       // lantern houses
    parts.push(at(quad(0.4, 0.3, 0x2a2420, [1.0, 0.75, 0.4], 1.0), -2.5 + 0.36, 2.55, side * 3.6, Math.PI / 2));   // the lit window, facing the gate
    parts.push(at(box(0.9, 0.12, 0.9, stone), -2.5, 2.9, side * 3.6));                        // lantern roofs
    parts.push(at(box(0.8, 0.6, 0.8, stone), 3.0, 0.3, side * 3.3));                          // komainu plinths
  }
  parts.push(at(box(0.35, 0.28, 5.6, red), 4.2, 4.55, 0));                                   // nuki beam
  parts.push(at(box(0.5, 0.42, 6.6, red), 4.2, 5.35, 0));                                    // kasagi lintel
  parts.push(at(box(0.55, 0.22, 7.0, dark), 4.2, 5.68, 0));                                  // its dark cap
  parts.push(at(box(0.3, 0.6, 0.5, red), 4.2, 4.95, 0));                                     // the gakuzuka tablet post
  parts.push(at(box(3.2, 2.6, 3.6, 0x4a3a2c), -5.2, 1.3, 0));                                // the small hall
  parts.push(at(box(4.2, 0.35, 4.6, dark), -5.2, 2.75, 0));                                  // its roof slab
  parts.push(at(box(0.9, 1.4, 0.06, dark), -3.62, 0.7, 0));                                  // door shadow
  const geo = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  geo.computeBoundingSphere();
  return { geo, tris: geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3 };
}

let WIRE_MAT = null;
export function wireMaterial() { return (WIRE_MAT ??= new THREE.LineBasicMaterial({ color: 0x0f1113 })); }

/** One material for every Tokyo building: vertex colour albedo, `emit` attribute as emissive, dimmed by day through emissiveIntensity. */
let MAT = null;
export function tokyoMaterial() {
  if (MAT) return MAT;
  const m = new THREE.MeshStandardNodeMaterial({
    vertexColors: true,
    roughness: 0.48,
    metalness: 0.22,
    emissive: 0xffffff,
    emissiveIntensity: 1.0,
  });
  m.name = 'tokyo_facade';
  m.envMapIntensity = 1.15;
  /* The buzz: a part with flick > 0 drops to 45% for a beat when a fast sine
     (its own phase) crosses a threshold -- the stutter of a tube on its way
     out. Steady parts multiply by 1. */
  const ph = attribute('flick', 'float');
  const buzz = mix(float(1), float(0.45).add(float(0.55).mul(step(float(0.35), sin(time.mul(23).add(ph.mul(7)))))), step(float(0.01), ph));
  m.emissiveNode = attribute('emit', 'vec3').mul(materialReference('emissiveIntensity', 'float', m)).mul(buzz);
  MAT = m;
  return m;
}

/** 0 by day, 1 at night: the windows, neon and kanban faces come up with it. */
export function setTokyoNight(k) {
  setTokyoSignNight(k);   // the boards (world/tokyoSigns.js) light up with the street
  if (MAT) MAT.emissiveIntensity = 0.05 + 1.45 * Math.max(0, Math.min(1, k));   // windows stay a texture (emit 0.16); neon at 2.4x blooms
}
