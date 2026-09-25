import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';
import { buildTokyoBuilding, TOKYO_KIT } from './tokyo.js';
import { H_TILE, V_TILE } from './tokyoSigns.js';

/**
 * Little Tokyo's other buildings (2026-09-23, the owner: "improve the
 * building and add new kind of building structure").
 *
 * Every footprint in the district was the same machine: tokyo.js's walk-up,
 * a slab with a colonnade, kanban and a water tank. It is a good walk-up, and
 * it stays the commonest building here, but a street of 212 of them reads as a
 * box with signs repeated -- the boxiness the screenshots showed. A real
 * Shinjuku / Shibuya block mixes six or seven KINDS of building, and each kind
 * has a silhouette you can read from a car at 60 km/h:
 *
 *   tower    glass curtain-wall office tower, lobby podium, setbacks, a crown
 *   pencil   a 5-9 m "zakkyo" sliver, a tenant a storey, a stair core up one side
 *   mansion  a residential block: balconies on the street, open corridors
 *            (sotoroka) with a row of lights and front doors on the other face
 *   carpark  open decks, spandrel rails, a helical ramp drum, a P on the roof
 *   machiya  two storeys of timber shops with tiled pitched roofs, noren, lanterns
 *   depato   a department store: a glazed corner atrium, banner signs, a canopy
 *
 * Same contract as buildTokyoBuilding -- { geo, boards, lamps, height, floors,
 * tris } in the same local frame (origin at the footprint centre on the
 * ground, +X the street face, 2hw along X by 2hd along Z) -- and built from the
 * SAME painting helpers (tokyo.js's TOKYO_KIT), so every part carries
 * position / normal / uv / color / emit / flick / surf and merges into the
 * chunk's ONE Tokyo mesh: no new draw calls, no new material, no new texture.
 * Boards use Little Tokyo's own atlas kinds (h 4:1 lightbox, v kanban, s
 * screen) so the lettering works on every type unchanged.
 *
 * buildTokyoLot() is the dispatcher districtWorld calls. It keeps the walk-up
 * as the commonest type and gives each new one a niche (see pickTokyoType).
 * Deterministic per seed (CLAUDE.md: seeded randomness only), and a plot that
 * rolls the walk-up gets EXACTLY the building it had before this file existed.
 *
 * Cost, measured in node over the real district file (test/tokyoTypes.test.js
 * prints it): the 212 Little Tokyo plots go walk-up 118, mansion 31, pencil 25,
 * tower 16, machiya 9, department store 7, car park 6. Triangles 709,516 ->
 * 563,346 (mean 3,347 -> 2,657 a building, worst 17,788 -> 9,020: the old
 * worst was a walk-up stretched over a 99 m plot); the worst resident 3x3 ring
 * 629,824 -> 494,334. Draw calls: none added. Build time a plot 8.7 -> 7.1 ms.
 * The trade: the new kinds are quieter than a walk-up (a mansion is not a sign
 * tower), so the atlas boards go 5,005 -> 3,597 and lamp heads 1,058 -> 821;
 * if the street reads too dark at night, the knob is the mansion and tower
 * weights in pickTokyoType, not more boards on a mansion.
 */

const { SURF, paint, box, metal, cyl, quad, glass, display, at, faces, onFace, wallFinish, flickerOf, WALLS, LIGHT, NEON, WARM, COOL, MAGENTA, GROUND_H, FLOOR_H } = TOKYO_KIT;

const PI = Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** A seeded stream per purpose: one for layout, one for which windows are lit, so tuning the lights never moves a wall. */
const stream = (seed, salt) => mulberry32((Math.imul(seed | 0, 0x9e3779b1) ^ salt) >>> 0);
const _c = new THREE.Color();
const hexOf = (rgb) => _c.setRGB(rgb[0], rgb[1], rgb[2]).getHex();
/** A candidate for the night light pool (game/lighting.js) and a glare sprite: the same record the walk-up's kanban push. */
const lampAt = (x, y, z, rgb, intensity, range, glare) => ({ x, y, z, colour: hexOf(rgb), neon: true, intensity, range, glare });

/* Palettes. Values stay in the band tokyo.js settled on (the wall is a
   surface the neon lights, not one that competes with it); only the hues
   are new, and each belongs to its type. */
const TINTS = [0x2a4152, 0x324650, 0x1f3542, 0x3d4852, 0x40382e, 0x2c3a3a];   // curtain-wall glass
const MULLION = [0xa9aeb3, 0x8b9096, 0x5d6268, 0xbfc2c5];
const STONE = [0x8a867e, 0x6f6d69, 0x9a948a, 0x55575b, 0x7d7468];
const MANSION = [[0x9d9a93, 0x7f7c76], [0x8f979c, 0x70777c], [0xa39a86, 0x857d6b], [0x7d6560, 0x5c4a46], [0x86807a, 0x6b665f]];
const CONCRETE = [0x8c8c88, 0x7c7e80, 0x96928a];
const ACCENT = [0xd6b21e, 0x2f6e4f, 0x2b5c9e, 0xc0392b, 0xd8d8d8];
const CAR_PAINT = [0xe8e8e6, 0x1b1c1e, 0x9aa0a6, 0x7a1414, 0x1f3a6a, 0xc9c1b0, 0x2e4a3a, 0xb3161c];
const KAWARA = [0x3c4046, 0x44484e, 0x34383e, 0x4a4f55];                         // fired roof tile, silver-grey
const PLASTER = [0x8e877a, 0x9a9282, 0x7a7266, 0x857c70];
const TIMBER = [0x3a2a1e, 0x4a3626, 0x2e241c, 0x55402c];
const NOREN = [0x22305a, 0x7a1c1c, 0x5a3a22, 0x1f3a2e, 0xd8d4c8];
const SHOJI = [1.0, 0.86, 0.62];

/* ---------------------------------------------------------------- helpers */

/** Drop faces of a box-built part, named in its own frame BEFORE at() turns it (px nx py ny pz nz): a fin's back on the glass is never seen. */
const FACE_NAMES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
function trim(geo, ...drop) {
  const src = geo.index.array, keep = [];
  for (let f = 0; f < 6; f++) if (!drop.includes(FACE_NAMES[f])) for (let j = 0; j < 6; j++) keep.push(src[f * 6 + j]);
  geo.setIndex(keep);
  return geo;
}

/**
 * Hand-built surfaces (roof slopes, the ramp helix, lattice slats, a glass
 * pyramid). Every quad is told which way is OUT and winds itself to face it,
 * so nothing here can be built inside out (the first tank track was); per-
 * vertex normals are optional for smooth shading. Indexed, position / normal
 * / uv like a BoxGeometry, so paint() and mergeGeometries treat it the same.
 */
class Shape {
  constructor() { this.p = []; this.n = []; this.t = []; this.ix = []; }
  #put(P, N, T) {
    const i = this.p.length / 3;
    for (let k = 0; k < P.length; k++) { this.p.push(P[k][0], P[k][1], P[k][2]); this.n.push(N[k][0], N[k][1], N[k][2]); this.t.push(T[k][0], T[k][1]); }
    if (P.length === 4) this.ix.push(i, i + 1, i + 2, i, i + 2, i + 3);
    else this.ix.push(i, i + 1, i + 2);
  }
  /** a b c d in order round the quad; `uv` defaults to metres along a->b and a->d. */
  quad(a, b, c, d, out, uv = null, nrm = null) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const lu = Math.hypot(ux, uy, uz), lv = Math.hypot(vx, vy, vz);
    let P = [a, b, c, d], T = uv ?? [[0, 0], [lu, 0], [lu, lv], [0, lv]], N = nrm ?? [[nx, ny, nz], [nx, ny, nz], [nx, ny, nz], [nx, ny, nz]];
    if (nx * out[0] + ny * out[1] + nz * out[2] < 0) {
      P = [a, d, c, b]; T = [T[0], T[3], T[2], T[1]];
      N = nrm ? [N[0], N[3], N[2], N[1]] : N.map(() => [-nx, -ny, -nz]);
    }
    this.#put(P, N, T);
    return this;
  }
  tri(a, b, c, out, uv = [[0, 0], [1, 0], [0.5, 1]]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (nx * out[0] + ny * out[1] + nz * out[2] < 0) this.#put([a, c, b], [[-nx, -ny, -nz], [-nx, -ny, -nz], [-nx, -ny, -nz]], [uv[0], uv[2], uv[1]]);
    else this.#put([a, b, c], [[nx, ny, nz], [nx, ny, nz], [nx, ny, nz]], uv);
    return this;
  }
  get empty() { return this.ix.length === 0; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.t, 2));
    g.setIndex(this.ix);
    return g;
  }
}
/** paint() a Shape. `surf` is the kind (SURF.*) plus its variant fraction. */
const shaped = (s, hex, emit = null, k = 1, flick = 0, surf = SURF.PAINT + 0.05) => paint(s.build(), hex, emit, k, flick, surf);
/** A part whose surf the building's wall finish must NOT overwrite (roof tile keeps its tile). */
const own = (g) => { g.userData.keepSurf = true; return g; };

/** faces() for a rectangle centred off the origin (a setback storey, the atrium): the same records plus a centre. */
const facesAt = (cx, cz, hx, hz) => faces(hx, hz).map((f) => ({ ...f, cx, cz }));
const on = (f, s, out) => { const [x, z] = onFace(f, s, out); return [x + (f.cx ?? 0), z + (f.cz ?? 0)]; };
/** One pane on face f: `s` along it, centre height y, `out` proud of the wall. */
const pane = (parts, f, s, y, w, h, hex, em, k, r, out = 0.035) => { const [x, z] = on(f, s, out); parts.push(at(glass(w, h, hex, em, k, r), x, y, z, f.yaw)); };
/* A lit SHOP pane (2026-09-25): the ground-floor glazing below was dark
   brown (0x3a2a1c / 0x2a2016) lit only at night, so by day every shopfront
   of these types read as a brown board. It shows its stock now (tokyo.js
   SURF.DISPLAY) in the shop's warm light. The stock is seeded from where the
   pane stands, never from the building's stream (a fresh draw would
   reshuffle everything rolled after it). */
const SHOP_LIGHT = 0x9a8f7a;
const seedAt = (a, b, c = 0) => Math.abs(Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453) % 1;
const shopGlass = (w, h, em, k, a, b) => display(w, h, SHOP_LIGHT, em, k, seedAt(a, b, w + h));
const shopPane = (parts, f, s, y, w, h, em, k, out = 0.035) => { const [x, z] = on(f, s, out); parts.push(at(shopGlass(w, h, em, k, x, z), x, y, z, f.yaw)); };
/** A box standing on face f: build it with X along the face and Z out of it; its back sits at `out`. */
const proud = (parts, g, f, s, y, out, d) => { const [x, z] = on(f, s, out + d / 2); parts.push(at(g, x, y, z, f.yaw)); };
/** A downward quad (a soffit, a lit ceiling): `w` along X, `d` along Z. */
const soffit = (w, d, hex, emit, k) => quad(w, d, hex, emit, k, 0, SURF.PAINT).rotateX(PI / 2);
/** Four boxes round a rectangle (centre cx, cz; half sizes hx, hz) standing on y: parapets, terraces, rims. */
function ring(parts, cx, cz, hx, hz, y, ph, t, hex, emit = null, k = 1) {
  parts.push(at(box(2 * hx + t, ph, t, hex, emit, k), cx, y + ph / 2, cz + hz), at(box(2 * hx + t, ph, t, hex, emit, k), cx, y + ph / 2, cz - hz));
  parts.push(at(box(t, ph, Math.max(0.05, 2 * hz - t), hex, emit, k), cx + hx, y + ph / 2, cz), at(box(t, ph, Math.max(0.05, 2 * hz - t), hex, emit, k), cx - hx, y + ph / 2, cz));
}
/** An open shop in a ground-floor recess on the street face: lit back wall, floor, ceiling and counter -- a room you see into (tokyo.js's image-11 note), not a glowing sticker. */
function shopRoom(parts, xBack, xFront, zc, width, y1, shop) {
  const d = Math.max(0.3, xFront - xBack);
  parts.push(at(box(0.08, y1 - 0.25, width, 0x3a2e24, shop, 0.8), xBack + 0.04, (y1 - 0.25) / 2 + 0.05, zc));
  parts.push(at(box(d, 0.05, width, 0x2a241c, shop, 0.2), xBack + d / 2, 0.03, zc));
  parts.push(at(box(d, 0.06, width, 0x2a2618, shop, 0.5), xBack + d / 2, y1 - 0.03, zc));
  parts.push(at(box(0.45, 0.95, Math.min(3.2, width * 0.45), 0x4a4038, shop, 0.35), xBack + 0.45, 0.48, zc));
}
/** A column of projecting vertical kanban (the walk-up's end B): lightboxes on brackets, lettered both faces, a tube down the leading edge. */
function kanbanStack(parts, boards, rnd, xWall, z, y0, top, proj, first) {
  const px = xWall + 0.25 + proj / 2;
  let used = 0;
  for (let i = 0; i < 5 && y0 + 2.6 < top; i++) {
    const signH = Math.min(top - y0, 2.8 + rnd() * 0.9);
    const y = y0 + signH / 2;
    y0 += signH + 0.3;
    if (i > 0 && rnd() < 0.25) continue;
    const c = i === 0 ? first : NEON[Math.floor(rnd() * NEON.length)];
    parts.push(at(metal(proj, signH, 0.2, 0x181a1f), px, y, z));
    parts.push(at(box(0.07, signH + 0.1, 0.24, 0x111115, c, 2.4, flickerOf(rnd)), px + proj / 2, y, z));
    for (const dy of [signH / 2 - 0.3, 0.3 - signH / 2]) parts.push(at(metal(0.3, 0.08, 0.1, 0x2b2e34), xWall + 0.1, y + dy, z));
    // each face looks AWAY from its lightbox (tokyo.js: the blade boards once faced into their own box)
    for (const side of [-1, 1]) boards.push({ x: px, y, z: z + side * 0.105, yaw: side > 0 ? 0 : PI, w: proj - 0.12, h: signH - 0.14, vertical: true, kind: 'v' });
    used++;
  }
  return used;
}

/**
 * A gable roof in its own frame: ridge along Z at `rise` over the eave line
 * y = 0, the walls at x = +-run, eaves `over` past them and verges `overZ`
 * past the gable ends (0 where a neighbour's roof takes over). Kawara: the
 * slopes wear the WALL tile finish at a tile's size (0.30 m across, 0.25 m
 * down the slope: u x 0.83, v x 0.25 of the metre UVs the detail texture is
 * drawn for), smooth-shaded and mip-mapped, so the courses read up close and
 * cannot shimmer at 200 m the way corrugated geometry would. The eave carries
 * a crest of round tile ends (a sawtooth of small back-to-back triangles):
 * the silhouette is what the eye reads a tiled roof by. ~100-180 triangles.
 */
function gableRoof(len, run, rise, over, overZ, tileHex, trimHex, wallHex) {
  const tiles = new Shape(), edge = new Shape(), gable = new Shape();
  const L = len / 2 + overZ, drop = over * rise / run, T = 0.14;
  const sn = Math.hypot(rise, run), nY = run / sn, nX = rise / sn;   // slope normal components
  for (const sx of [-1, 1]) {
    const ex = sx * (run + over), ey = -drop;
    const slope = Math.hypot(run + over, rise + drop);
    const n = [sx * nX, nY, 0];
    tiles.quad([ex, ey, -L], [ex, ey, L], [0, rise, L], [0, rise, -L], n,
      [[-L * 0.83, 0], [L * 0.83, 0], [L * 0.83, slope * 0.25], [-L * 0.83, slope * 0.25]]);
    // the fascia at the eave and its crest of tile ends
    edge.quad([ex, ey - T, -L], [ex, ey - T, L], [ex, ey, L], [ex, ey, -L], [sx, 0, 0]);
    const nt = Math.max(2, Math.round((2 * L) / 0.3));
    for (let i = 0; i < nt; i++) {
      const z0 = -L + (2 * L * i) / nt, z1 = -L + (2 * L * (i + 1)) / nt, zm = (z0 + z1) / 2;
      for (const f of [1, -1]) { const x = ex + sx * f * 0.005; edge.tri([x, ey, z0], [x, ey, z1], [x, ey + 0.075, zm], [sx * f, 0, 0]); }   // the outer one faces out, the inner one in
    }
    // the raked soffit under the overhang, from the fascia back to the wall
    edge.quad([ex, ey - T, -L], [ex, ey - T, L], [sx * run, -T, L], [sx * run, -T, -L], [-sx * nX, -nY, 0]);
    // verges: the roof's thickness at each gable end, and the underside of the verge overhang
    for (const sz of [-1, 1]) {
      edge.quad([ex, ey - T, sz * L], [0, rise - T, sz * L], [0, rise, sz * L], [ex, ey, sz * L], [0, 0, sz]);
      if (overZ > 0.01) edge.quad([ex, ey - T, sz * len / 2], [0, rise - T, sz * len / 2], [0, rise - T, sz * L], [ex, ey - T, sz * L], [-sx * nX, -nY, 0]);
    }
  }
  // the gable walls: plaster triangles, the building's own wall, under the verges
  for (const sz of [-1, 1]) gable.tri([-run, 0, sz * len / 2], [run, 0, sz * len / 2], [0, rise, sz * len / 2], [0, 0, sz], [[0, 0], [2 * run, 0], [run, rise]]);
  const parts = [
    own(shaped(tiles, tileHex, null, 1, 0, SURF.WALL + 0.8)),
    shaped(edge, trimHex),
    shaped(gable, wallHex, null, 1, 0, SURF.WALL + 0.05),
    at(metal(0.34, 0.26, 2 * L + 0.1, trimHex), 0, rise + 0.08, 0),   // the ridge
  ];
  for (const sz of [-1, 1]) parts.push(at(metal(0.46, 0.5, 0.12, trimHex), 0, rise + 0.22, sz * (L + 0.04)));   // onigawara, the ridge-end tiles
  return parts;
}
/** A pent roof (hisashi) off a wall: from the wall at y = 0 out `over` along +X, falling `drop`; `len` along Z. Tile slope, crest, soffit, end caps. */
function pentRoof(len, over, drop, tileHex, trimHex) {
  const tiles = new Shape(), edge = new Shape(), T = 0.1, L = len / 2;
  const sl = Math.hypot(over, drop), n = [drop / sl, over / sl, 0];
  tiles.quad([over, -drop, -L], [over, -drop, L], [0, 0, L], [0, 0, -L], n, [[-L * 0.83, 0], [L * 0.83, 0], [L * 0.83, sl * 0.25], [-L * 0.83, sl * 0.25]]);
  edge.quad([over, -drop - T, -L], [over, -drop - T, L], [over, -drop, L], [over, -drop, -L], [1, 0, 0]);
  const nt = Math.max(2, Math.round(len / 0.3));
  for (let i = 0; i < nt; i++) {
    const z0 = -L + (len * i) / nt, z1 = -L + (len * (i + 1)) / nt;
    for (const f of [1, -1]) edge.tri([over + f * 0.005, -drop, z0], [over + f * 0.005, -drop, z1], [over + f * 0.005, -drop + 0.06, (z0 + z1) / 2], [f, 0, 0]);
  }
  edge.quad([over, -drop - T, -L], [over, -drop - T, L], [0, -T, L], [0, -T, -L], [-n[0], -n[1], 0]);
  for (const sz of [-1, 1]) edge.quad([0, -T, sz * L], [over, -drop - T, sz * L], [over, -drop, sz * L], [0, 0, sz * L], [0, 0, sz]);
  return [own(shaped(tiles, tileHex, null, 1, 0, SURF.WALL + 0.8)), shaped(edge, trimHex)];
}
/** Vertical slats (a koshi lattice, a mushiko window) across z0..z1 on a +X face at x: front and both sides of each, no back (it is against the screen). */
function slats(z0, z1, y0, y1, x, pitch, hex) {
  const s = new Shape();
  for (let z = z0 + pitch / 2; z < z1 - 0.01; z += pitch) {
    const a = z - 0.022, b = z + 0.022, f = x + 0.05;
    s.quad([f, y0, a], [f, y0, b], [f, y1, b], [f, y1, a], [1, 0, 0]);
    s.quad([x, y0, a], [f, y0, a], [f, y1, a], [x, y1, a], [0, 0, -1]);
    s.quad([x, y0, b], [f, y0, b], [f, y1, b], [x, y1, b], [0, 0, 1]);
  }
  return shaped(s, hex);
}

/** Merge a building's parts, give its walls one finish, and put back the parts that chose their own (roof tile). */
function finish(parts, variant, out) {
  const kept = [];
  let off = 0;
  for (const p of parts) {
    const n = p.attributes.position.count;
    if (p.userData.keepSurf) kept.push([off, p.attributes.surf.array.slice()]);
    off += n;
  }
  const geo = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  wallFinish(geo, variant);
  for (const [o, arr] of kept) geo.attributes.surf.array.set(arr, o);
  geo.computeBoundingSphere();
  return { ...out, geo, tris: geo.index.count / 3 };
}
/** A building's wall finish, the walk-up's rule: glazed tile (>= 0.45) or plaster / board-marked concrete. */
const finishOf = (grnd, tileShare) => (grnd() < tileShare ? 0.45 + grnd() * 0.4 : 0.05 + grnd() * 0.38);

/* ============================================================== 1. TOWER */

/**
 * A Shinjuku office tower: a two-storey lobby podium with a colonnade over
 * the pavement, then a curtain wall in three sections, each set back from
 * the one below (all round, or -- two in five -- stepping back from the
 * street only), and a crown: a lit screen of fins, a glass pyramid, or a
 * helipad with its H and edge lights. The mullion grid is real geometry --
 * fins at the bay lines, posts at the corners, a spandrel band proud of the
 * glass at every floor -- because a flat quad per face is exactly the "box"
 * the owner saw. One pane per bay per storey so offices light by the floor at
 * night. Storeys are 3.8 m (an office floor, not a flat); 10-34 of them.
 * A podium screen on two in five. Measured: 3,478 triangles mean / 4,658 max
 * over 50 seeds in its niche; 2,656 / 5,894 on the district's 16 tower plots
 * (the max is the 99 m plot: a 38 m shaft on a 99 m podium).
 */
export function buildTokyoTower(seed, hw, hd, h) {
  const rnd = stream(seed, 0x51ab), grnd = stream(seed, 0x6a09);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const parts = [], boards = [], lamps = [];
  const POD = 9.0, UP = 5.4, OH = 3.8, SPH = 0.95;
  const N = clamp(Math.round((h - POD) / OH), 10, 34);
  const tint = pick(TINTS), mull = pick(MULLION), stone = pick(STONE);
  const spandStone = rnd() < 0.35;
  const spand = spandStone ? stone : pick([tint, 0x2b2f34]);
  const bayW = 2.7 + rnd() * 0.7;
  const paired = rnd() < 0.45;       // fins on every mullion line, or every other: a double bay
  const oneSided = rnd() < 0.4;
  const crown = pick(['screen', 'pyramid', 'helipad']);
  const cs = rnd() < 0.5 ? -1 : 1;
  const neon = pick(NEON);
  const F0 = faces(hw, hd), front = F0[0];

  // 1. PODIUM: the lobby set back under a colonnade, the upper podium bridging over it
  const REC = Math.min(2.6, hw * 0.25);
  parts.push(at(box(2 * hw - REC, UP, 2 * hd, stone), -REC / 2, UP / 2, 0));
  parts.push(at(box(2 * hw, POD - UP, 2 * hd, stone), 0, UP + (POD - UP) / 2, 0));
  parts.push(at(soffit(REC - 0.05, 2 * hd - 0.3, 0x2a2622, WARM, 0.45), hw - REC / 2, UP - 0.01, 0));   // the colonnade ceiling, lit
  {
    const lw = 2 * hd - 1, nb = clamp(Math.round(lw / 3.2), 2, 14), p = lw / nb, lx = hw - REC;
    for (let b = 0; b < nb; b++) {
      const z = -lw / 2 + p * (b + 0.5), door = b === Math.floor(nb / 2);
      parts.push(at(glass(p - 0.5, UP - 1.0, door ? 0x3c4a5a : 0x33414c, WARM, door ? 0.5 : 0.3, 0.95), lx + 0.035, (UP - 1.0) / 2 + 0.15, z, PI / 2));
    }
    for (let b = 0; b <= nb; b++) parts.push(at(box(0.3, UP, 0.45, stone), lx + 0.15, UP / 2, -lw / 2 + p * b));
    const nc = Math.max(2, Math.round(2 * hd / 6) + 1);
    for (let c = 0; c < nc; c++) parts.push(at(cyl(0.3, UP, stone, 12), hw - 0.35, UP / 2, -hd + 0.6 + (c / (nc - 1)) * (2 * hd - 1.2)));
    // the upper podium's glass band, all four faces
    for (const f of F0) {
      const n = clamp(Math.round((f.w - 1) / 3.2), 1, 14), q = (f.w - 1) / n;
      for (let b = 0; b < n; b++) pane(parts, f, -(f.w - 1) / 2 + q * (b + 0.5), UP + 1.85, q - 0.3, 1.7, tint, grnd() < 0.3 ? COOL : null, 0.16, 0.9);
    }
    // the lobby's name over the colonnade, and a monolith at the corner
    parts.push(at(metal(0.12, 0.8, 3.4, 0x141619), hw + 0.06, UP + 0.5, 0));
    boards.push({ x: hw + 0.13, y: UP + 0.5, z: 0, yaw: front.yaw, w: 3.2, h: 0.7, kind: 'h' });
    const mz = cs * Math.max(0.6, hd - 1.8);
    parts.push(at(metal(0.5, 3.2, 1.1, 0x1a1c20), hw - 0.6, 1.6, mz));
    boards.push({ x: hw - 0.34, y: 1.7, z: mz, yaw: front.yaw, w: 0.9, h: 2.9, vertical: true, kind: 'v' });
    ring(parts, 0, 0, hw, hd, POD, 1.0, 0.25, stone);
    lamps.push(lampAt(hw + 0.6, 2.4, 0, [1.0, 0.86, 0.66], 90, 30, 1.6));
    lamps.push(lampAt(hw + 0.5, 1.6, mz, neon, 70, 26, 1.8));
    // the ground-floor tenants round the sides: a lit sign each over a shop window
    for (const f of [F0[2], F0[3]]) {
      if (f.w < 9) continue;
      const [gx, gz] = on(f, f.w * 0.2, 0.035);
      parts.push(at(shopGlass(3.2, 2.6, WARM, 0.55, gx, gz), gx, 1.6, gz, f.yaw));
      proud(parts, metal(3.4, 0.85, 0.1, 0x141418), f, f.w * 0.2, 3.6, 0, 0.1);
      const [bx, bz] = on(f, f.w * 0.2, 0.11);
      boards.push({ x: bx, y: 3.6, z: bz, yaw: f.yaw, w: 3.2, h: 0.75, kind: 'h' });
      const [lx, lz] = on(f, f.w * 0.2, 1.2);
      lamps.push(lampAt(lx, 1.8, lz, WARM, 80, 26, 1.6));
    }
  }
  /* Shinjuku's podium screens: a video wall on a frame on the podium roof,
     in front of the shaft's lower floors, two towers in five (+1 board, 44
     triangles; the screen itself is the atlas's cycling ad). */
  if (rnd() < 0.4 && 2 * hd >= 12 && hw - clamp(hw - 2.2, 4, 19) >= 1.6) {
    const sw = Math.min(2 * hd - 4, 10), sh = sw / 2, sy = POD + 1.2 + sh / 2;
    parts.push(at(metal(0.3, sh + 0.4, sw + 0.4, 0x0d0e11), hw - 1.0, sy, 0));
    for (const k of [-1, 1]) parts.push(at(metal(0.2, 1.2, 0.2, 0x2b2e33), hw - 1.0, POD + 0.6, k * (sw / 2 - 0.3)));
    boards.push({ x: hw - 0.84, y: sy, z: 0, yaw: front.yaw, w: sw, h: sh, kind: 's' });
    lamps.push(lampAt(hw + 2.0, 3.0, 0, [0.84, 0.9, 1.0], 70, 28, 2.0));
  }

  // 2. THE SHAFT: three sections, set back
  const n1 = Math.max(3, Math.round(N * (0.5 + rnd() * 0.1))), n2 = Math.max(n1 + 2, Math.min(N - 2, Math.round(N * (0.78 + rnd() * 0.08))));
  const sb = clamp(Math.min(hw, hd) * 0.14, 1.0, 3.2);
  let cx = 0, cz = 0, tx = clamp(hw - 2.2, 4, 19), tz = clamp(hd - 2.2, 4, 19);
  const litFloor = Array.from({ length: N }, () => grnd() < 0.42);
  const blinds = grnd() < 0.3;
  let top = POD, last = null;
  for (const [f0, f1, i] of [[0, n1, 0], [n1, n2, 1], [n2, N, 2]]) {
    if (i > 0) {
      if (oneSided) { const bx = Math.min(1.6 * sb, tx - 3.5); tx -= bx / 2; cx -= bx / 2; const bz = Math.min(sb, tz - 3.5); tz -= bz / 2; cz -= cs * bz / 2; }
      else { const b = Math.min(sb, tx - 3.5, tz - 3.5); tx -= b; tz -= b; }
    }
    const y0 = POD + f0 * OH, y1 = POD + f1 * OH, hs = y1 - y0;
    parts.push(at(box(2 * tx - 0.08, hs, 2 * tz - 0.08, stone), cx, y0 + hs / 2, cz));
    const SF = facesAt(cx, cz, tx, tz);
    for (let fl = f0; fl < f1; fl++) {
      const yb = POD + fl * OH;
      parts.push(at(box(2 * tx + 0.12, SPH, 2 * tz + 0.12, spand, null, 1, 0, spandStone ? SURF.WALL : SURF.PAINT), cx, yb + SPH / 2, cz));
    }
    for (const f of SF) {
      const nb = Math.max(2, Math.round(f.w / bayW)), p = f.w / nb;
      for (let fl = f0; fl < f1; fl++) {
        const yb = POD + fl * OH;
        for (let b = 0; b < nb; b++) {
          const lit = litFloor[fl] ? grnd() < 0.85 : grnd() < 0.06;
          pane(parts, f, -f.w / 2 + p * (b + 0.5), yb + SPH + (OH - SPH) / 2, p - 0.02, OH - SPH - 0.02, tint, lit ? (grnd() < 0.8 ? COOL : WARM) : null, 0.18, blinds && grnd() < 0.5 ? 0.42 : 0.9, 0.02);
        }
      }
      for (let b = 1; b < nb; b++) {
        if (paired && b % 2) continue;
        proud(parts, trim(metal(0.14, hs, 0.3, mull), 'nz', 'ny'), f, -f.w / 2 + p * b, y0 + hs / 2, 0.05, 0.3);
      }
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(at(metal(0.42, hs, 0.42, mull), cx + sx * tx, y0 + hs / 2, cz + sz * tz));
    if (i < 2) {
      ring(parts, cx, cz, tx, tz, y1, 1.0, 0.2, stone);   // the terrace edge, until the next section sits inside it
    }
    top = y1; last = { cx, cz, tx, tz, SF };
  }
  // the podium roof and each setback are terraces: a few planters where there is room
  if (hw - clamp(hw - 2.2, 4, 19) >= 1.6) for (const sz of [-1, 1]) parts.push(at(box(1.0, 0.6, 1.6, 0x3d5a32), hw - 0.9, POD + 0.3, sz * (hd - 1.1)));

  // 3. CROWN
  const { tx: lx, tz: lz } = last;
  const lf = last.SF[0];
  let crownTop = top, signY = null, signOut = 0.36, lightY = top + 1.4;   // lightY: where the corner aviation lights sit on this crown
  if (crown === 'screen') {
    const CRH = 2 * OH;
    for (const f of last.SF) {
      const nb = Math.max(2, Math.round(f.w / bayW)), p = f.w / nb;
      for (let b = 1; b < nb; b++) proud(parts, metal(0.14, CRH, 0.3, mull), f, -f.w / 2 + p * b, top + CRH / 2, 0.05, 0.3);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(at(metal(0.42, CRH, 0.42, mull), last.cx + sx * lx, top + CRH / 2, last.cz + sz * lz));
    ring(parts, last.cx, last.cz, lx + 0.12, lz + 0.12, top + CRH - 0.35, 0.3, 0.12, 0x202226, COOL, 1.6);   // the crown's rim of light
    parts.push(at(box(lx * 1.1, CRH - 1.2, lz * 1.1, stone), last.cx, top + (CRH - 1.2) / 2, last.cz));     // plant behind the screen
    crownTop = top + CRH; signY = top + CRH / 2; signOut = 0.62; lightY = top + CRH + 0.2;
  } else if (crown === 'pyramid') {
    const ap = Math.min(lx, lz) * 0.9, A = [last.cx, top + ap, last.cz];
    const s = new Shape();
    const C = [[lx, lz], [-lx, lz], [-lx, -lz], [lx, -lz]].map(([x, z]) => [last.cx + x, top, last.cz + z]);
    for (let k = 0; k < 4; k++) {
      const a = C[k], b = C[(k + 1) % 4], mx = (a[0] + b[0]) / 2 - last.cx, mz = (a[2] + b[2]) / 2 - last.cz;
      s.tri(a, b, A, [mx, Math.hypot(mx, mz) * 0.6, mz]);
    }
    parts.push(shaped(s, tint, grnd() < 0.5 ? COOL : null, 0.22, 0, SURF.GLASS + 0.05 + 0.8 * 0.9));
    ring(parts, last.cx, last.cz, lx + 0.1, lz + 0.1, top, 0.2, 0.14, 0x202226, neon, 1.5);
    parts.push(at(metal(0.12, 6.0, 0.12, 0x3a3d42), last.cx, top + ap + 3.0, last.cz));
    parts.push(at(box(0.25, 0.25, 0.25, 0xff2030, [1.0, 0.1, 0.15], 2.8, 0.85), last.cx, top + ap + 6.1, last.cz));
    crownTop = top + ap; lightY = top + 0.35;   // on the rim at the pyramid's foot, not floating at the apex height
  } else {
    ring(parts, last.cx, last.cz, lx, lz, top, 1.2, 0.2, stone);
    parts.push(at(box(lx * 0.7, 3.4, lz * 1.2, stone), last.cx - lx * 0.55, top + 1.7, last.cz));   // plant room, clear of the pad
    const pw = Math.min(lx, lz) * 1.1, px = last.cx + lx * 0.4;
    parts.push(at(metal(pw, 0.25, pw, 0x3b3e43), px, top + 0.125, last.cz));
    const H1 = (w, d, dx, dz) => parts.push(at(metal(w, 0.04, d, 0xe8e8e8), px + dx, top + 0.27, last.cz + dz));
    H1(pw * 0.55, 0.3, 0, -pw * 0.2); H1(pw * 0.55, 0.3, 0, pw * 0.2); H1(0.3, pw * 0.4, 0, 0);
    for (let k = 0; k < 8; k++) {
      const t = (k / 8) * 2 * PI, r = pw * 0.48;
      parts.push(at(box(0.18, 0.12, 0.18, 0x303030, [1.0, 0.85, 0.2], 1.8), px + Math.cos(t) * r, top + 0.31, last.cz + Math.sin(t) * r));
    }
    parts.push(at(metal(0.1, 5.0, 0.1, 0x3a3d42), last.cx - lx * 0.5, top + 5.9, last.cz));
    parts.push(at(box(0.25, 0.25, 0.25, 0xff2030, [1.0, 0.1, 0.15], 2.8, 0.85), last.cx - lx * 0.5, top + 8.5, last.cz));
    crownTop = top + 3.4;
  }
  // aviation lights at the corners of the top, blinking (flick)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(at(box(0.25, 0.25, 0.25, 0xff2030, [1.0, 0.1, 0.15], 2.8, 0.85), last.cx + sx * (lx - 0.2), lightY, last.cz + sz * (lz - 0.2)));
  // the company's name on the crown, facing the street
  {
    const w = Math.min(2 * lz * 0.62, 14), bh = w / 4;
    signY ??= top - 0.3 - (bh + 0.3) / 2;   // on the top storey, its lightbox under the roof line
    const [x, z] = on(lf, 0, signOut);
    parts.push(at(metal(0.25, bh + 0.3, w + 0.3, 0x111317), x + 0.125, signY, z));
    boards.push({ x: x + 0.26, y: signY, z, yaw: front.yaw, w, h: bh, kind: 'h' });
  }
  return finish(parts, finishOf(grnd, 0.25), { boards, lamps, height: crownTop, floors: N + 2 });
}

/* ============================================================= 2. PENCIL */

/**
 * A pencil building (zakkyo): 5-9 m of frontage and as tall as the plot
 * allows -- a little over the planner's height (x1.15), because what makes a
 * pencil a pencil is the proportion. One tenant a storey, each with a
 * lightbox in its spandrel; a stair core up one edge of the street face,
 * proud of it, with its landing windows (or one lit slot) and a stair house on
 * the roof; a column of projecting kanban up the other edge; a billboard on
 * the side wall where a tall sliver shows it over its neighbours; a steel
 * fire stair on the back. Measured: 944 triangles mean / 1,176 max over 50
 * seeds; the cheapest type, and the one with the most signs (~20-35 boards).
 */
export function buildTokyoPencil(seed, hw, hd, h) {
  const rnd = stream(seed, 0x7e11), grnd = stream(seed, 0x2c1b);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const parts = [], boards = [], lamps = [];
  const N = clamp(Math.round((h * 1.15 - GROUND_H) / FLOOR_H) + 1, 5, 12);
  const H = GROUND_H + (N - 1) * FLOOR_H;
  const floorY = (f) => (f === 0 ? 0 : GROUND_H + (f - 1) * FLOOR_H);
  const [wall, band] = rnd() < 0.3 ? pick(LIGHT) : pick(WALLS);
  const cs = rnd() < 0.5 ? -1 : 1;
  const cw = clamp(2 * hd * 0.24, 1.4, 2.2), mw = 2 * hd - cw, zc = -cs * cw / 2, coreZ = cs * (hd - cw / 2);
  const coreHex = pick([0x2e3236, 0x8a8a86, band, 0x3a3f46]);
  const neon = pick(NEON), tint = pick([0x0c121a, 0x1a2a36, 0x22384a]);
  const F = faces(hw, hd), front = F[0];
  const REC = Math.min(1.2, hw * 0.3);

  // the mass: ground floor set back for the shop, the tenant floors over it
  parts.push(at(box(2 * hw - REC, GROUND_H, 2 * hd, wall), -REC / 2, GROUND_H / 2, 0));
  parts.push(at(box(2 * hw, H - GROUND_H, 2 * hd, wall), 0, GROUND_H + (H - GROUND_H) / 2, 0));
  for (let s = 1; s < N; s++) parts.push(at(box(2 * hw + 0.08, 0.16, 2 * hd + 0.08, band), 0, floorY(s), 0));

  // the stair core: proud of the street face, full height, a stair house on the roof
  parts.push(at(box(0.34, H + 2.6, cw, coreHex), hw + 0.17, (H + 2.6) / 2, coreZ));
  parts.push(at(box(REC, GROUND_H, cw, coreHex), hw - REC / 2, GROUND_H / 2, coreZ));
  parts.push(at(box(2.6, 2.6, cw, coreHex), hw - 1.3, H + 1.3, coreZ));
  if (rnd() < 0.5) {
    for (let s = 1; s < N; s++) parts.push(at(glass(cw * 0.5, 0.8, 0x1a2230, grnd() < 0.7 ? COOL : null, 0.2, 0.9), hw + 0.355, floorY(s) + 2.2, coreZ, PI / 2));
  } else {
    parts.push(at(glass(0.55, H - GROUND_H - 0.8, 0x1a2230, COOL, 0.2, 0.9), hw + 0.355, (GROUND_H + H) / 2, coreZ, PI / 2));
  }
  parts.push(at(quad(0.95, 2.2, 0x15171a, null, 1, 0, SURF.PAINT), hw + 0.345, 1.1, coreZ, PI / 2));   // the stair door
  {
    const w = Math.max(1.1, cw - 0.3), bh = w / 3.4;
    parts.push(at(metal(0.08, bh + 0.1, w + 0.1, 0x141418), hw + 0.38, 2.7, coreZ));
    boards.push({ x: hw + 0.43, y: 2.7, z: coreZ, yaw: front.yaw, w, h: bh, kind: 'h' });   // the tenant directory
  }

  // the tenant floors: a window, a sill, a lightbox in the spandrel
  const twoPane = mw > 5.2;
  for (let s = 1; s < N; s++) {
    const lit = grnd() < 0.45, em = lit ? (grnd() < 0.6 ? WARM : COOL) : null;
    if (twoPane) for (const k of [-1, 1]) parts.push(at(glass((mw - 0.6) / 2 - 0.1, 1.85, tint, em, 0.18, grnd()), hw + 0.035, floorY(s) + 1.45, zc + k * (mw - 0.6) / 4, PI / 2));
    else parts.push(at(glass(mw - 0.6, 1.85, tint, em, 0.18, grnd()), hw + 0.035, floorY(s) + 1.45, zc, PI / 2));
    parts.push(at(metal(0.2, 0.08, mw - 0.4, band), hw + 0.1, floorY(s) + 0.48, zc));
    if (rnd() < 0.2) continue;
    // the tenants' run stops 0.9 m short of the open edge: the kanban column projects there and its brackets would cut the boxes
    const tw = mw - 1.2, tzc = zc + cs * 0.3;
    const n = clamp(Math.ceil(tw / 3.7), 1, 3), segW = Math.min(3.7, tw / n - 0.1);
    for (let i = 0; i < n; i++) {
      const z = tzc - tw / 2 + (tw / n) * (i + 0.5);
      parts.push(at(metal(0.12, 0.66, segW + 0.06, 0x1a1b20), hw + 0.06, floorY(s) + 2.72, z));
      boards.push({ x: hw + 0.13, y: floorY(s) + 2.72, z, yaw: front.yaw, w: segW, h: 0.62, kind: 'h' });
    }
  }

  // the kanban column up the open edge
  const kz = -cs * Math.max(0.4, hd - 0.45), first = pick(NEON);
  if (kanbanStack(parts, boards, rnd, hw, kz, 4.9, H - 0.6, 0.95, first)) lamps.push(lampAt(hw + 1.5, 2.6, kz, first, 90, 30, 2.4));

  // the shop: an open room under the tenant floors, a lit fascia
  {
    const shop = rnd() < 0.3 ? [1.0, 0.92, 0.72] : WARM;
    shopRoom(parts, hw - REC, hw, zc, mw - 0.3, GROUND_H, shop);
    parts.push(at(metal(0.08, 2.55, 0.08, 0x2a2a28), hw - 0.05, 1.3, zc - cs * (mw / 2 - 0.1)));
    const w = Math.min(mw - 0.6, 4.8), bh = clamp(w / 4.2, 0.6, 0.8);
    parts.push(at(box(0.12, bh + 0.1, w + 0.1, 0x141418, neon, 1.4, flickerOf(rnd)), hw - 0.06, GROUND_H - 0.5, zc));
    boards.push({ x: hw + 0.01, y: GROUND_H - 0.5, z: zc, yaw: front.yaw, w, h: bh, kind: 'h' });
    lamps.push(lampAt(hw + 0.6, 1.7, zc, shop, 95, 30, 1.6));
  }

  // the side wall a sliver shows over its neighbours: a billboard on a frame, floodlit
  if (N >= 7 && 2 * hw >= 8 && rnd() < 0.55) {
    const sf = rnd() < 0.5 ? F[2] : F[3];
    const wB = Math.min(2 * hw * 0.72, 12), hB = wB / 3.6, y = H - 1.0 - hB / 2;
    proud(parts, metal(wB + 0.3, hB + 0.3, 0.2, 0x2b2e33), sf, 0, y, 0, 0.2);
    const [bx, bz] = on(sf, 0, 0.21);
    boards.push({ x: bx, y, z: bz, yaw: sf.yaw, w: wB, h: hB, kind: 'h' });
    for (const k of [-1, 1]) {
      proud(parts, metal(0.05, 0.05, 0.6, 0x2b2e33), sf, k * wB * 0.3, y + hB / 2 + 0.35, 0, 0.6);   // the arm
      proud(parts, box(0.3, 0.12, 0.3, 0x303236, [1.0, 0.9, 0.7], 1.6), sf, k * wB * 0.3, y + hB / 2 + 0.35, 0.5, 0.3);
    }
  } else {
    for (let s = 1; s < N; s++) if (rnd() < 0.3) proud(parts, metal(0.7, 0.55, 0.32, 0xc9ccd1), F[2 + (s & 1)], (rnd() - 0.5) * hw, floorY(s) + 0.6, 0, 0.32);
  }
  // the back: a steel fire stair, landings and a stringer
  if (rnd() < 0.5) {
    const back = F[1], s0 = -back.w / 2 + 1.0;
    const [sx, sz] = on(back, s0 - 0.7, 1.35);
    parts.push(at(metal(0.08, H - 1.0, 0.08, 0x3a3d42), sx, (H - 1.0) / 2 + 0.5, sz));
    for (let s = 1; s < N; s++) {
      proud(parts, metal(1.3, 0.08, 1.3, 0x4a4d52), back, s0, floorY(s) + 0.05, 0.05, 1.3);
      proud(parts, metal(1.3, 0.9, 0.04, 0x3a3d42), back, s0, floorY(s) + 0.5, 1.33, 0.04);
    }
  }
  // the roof: parapet, tank on a stand, antenna, a lightbox facing the street
  ring(parts, 0, 0, hw, hd, H, 0.6, 0.2, band);
  const tz = zc * 0.5, tx = -hw * 0.4;
  parts.push(at(cyl(0.7, 1.3, 0x9fa4aa), tx, H + 1.35, tz), at(metal(1.6, 0.7, 1.6, 0x484d54), tx, H + 0.35, tz));
  parts.push(at(metal(0.07, 4.0, 0.07, 0x3a3d42), -hw * 0.6, H + 2.0, -tz));
  if (rnd() < 0.55) {
    const w = Math.min(mw - 0.3, 6.0), bh = w / 4, y = H + 1.2 + bh / 2;
    parts.push(at(metal(0.12, bh + 0.3, w, 0x2b2e33), hw - 0.6, y, zc));
    for (const k of [-1, 1]) parts.push(at(metal(0.08, y - H, 0.08, 0x2b2e33), hw - 0.6, H + (y - H) / 2, zc + k * (w / 2 - 0.15)));
    boards.push({ x: hw - 0.53, y, z: zc, yaw: front.yaw, w: w * 0.94, h: bh * 0.94, kind: 'h' });
  }
  return finish(parts, finishOf(grnd, 0.55), { boards, lamps, height: H, floors: N });
}

/* ============================================================ 3. MANSION */

/**
 * A residential "mansion": the Tokyo concrete apartment block. The street
 * face is balconies -- a slab a storey, a balustrade (solid concrete, or an
 * aluminium rail over frosted panels), the white fire-escape boards between
 * flats, sliding doors, an air-con unit, now and then a futon over the rail.
 * The other long face is the open corridor (sotoroka): a slab and parapet a
 * storey, a row of steel front doors and kitchen windows, and a light over
 * every door -- the rows of fluorescent dots that ARE a Tokyo night skyline.
 * It goes on a side street when the plot has one (ctx.probe), else the back.
 * A stair/lift core closes one end of it and rises past the roof. Storeys are
 * 2.95 m (a flat), 4-15 of them; a shop (half of them a konbini) on the
 * ground floor of most. Measured: 3,303 triangles mean / 4,528 max over 50
 * seeds -- a flat a storey costs ~200, the balconies are most of it.
 */
export function buildTokyoMansion(seed, hw, hd, h, ctx = {}) {
  const rnd = stream(seed, 0x3a5e), grnd = stream(seed, 0x4b1d);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const parts = [], boards = [], lamps = [];
  const RH = 2.95, N = clamp(Math.round((h - GROUND_H) / RH) + 1, 4, 15);
  const H = GROUND_H + (N - 1) * RH;
  const floorY = (f) => (f === 0 ? 0 : GROUND_H + (f - 1) * RH);
  const [wall, band] = pick(MANSION);
  const rail = pick([0x5b5f66, 0x8d9096, 0x3a3d42, 0xb8b8b4]), doorHex = pick([0x5b6a78, 0x6e5a4a, 0x8a8d90, 0x3e4a52]);
  const solid = rnd() < 0.4;
  const BD = 1.2, CD = 1.3;
  const F = faces(hw, hd);
  // the corridor face: a side street shows it off, otherwise it faces the back
  let ci = 1;
  if (ctx.probe && 2 * hw >= 10) {
    const L = ctx.probe(0, hd + 4), R = ctx.probe(0, -hd - 4);
    if (Math.min(L, R) < 3) ci = L <= R ? 2 : 3;
  }
  const cf = F[ci];
  const x0 = -hw + (ci === 1 ? CD : 0), x1 = hw - BD, z0 = -hd + (ci === 3 ? CD : 0), z1 = hd - (ci === 2 ? CD : 0);

  // the mass: the ground floor to just under the first slab (no coplanar tops), then the flats inside the balcony and corridor zones
  parts.push(at(box(2 * hw - 0.8, GROUND_H - 0.2, 2 * hd, wall), -0.4, (GROUND_H - 0.2) / 2, 0));
  parts.push(at(box(x1 - x0, H - GROUND_H + 0.2, z1 - z0, wall), (x0 + x1) / 2, GROUND_H - 0.2 + (H - GROUND_H + 0.2) / 2, (z0 + z1) / 2));

  // FRONT: balconies
  const nu = clamp(Math.round(2 * hd / 6.2), 1, 6), uw = 2 * hd / nu;   // six flats a floor at most: a wider front gets wider flats, not more triangles
  const futon = [0xe8e4da, 0x7a9cc4, 0xd99aa5, 0xc9b27a];
  for (let s = 1; s < N; s++) {
    const y = floorY(s);
    parts.push(at(box(BD + 0.02, 0.18, 2 * hd, band), hw - BD / 2 + 0.01, y - 0.09, 0));
    if (solid) parts.push(at(box(0.12, 1.05, 2 * hd - 0.02, band), hw - 0.06, y + 0.525, 0));
    else parts.push(at(metal(0.08, 0.06, 2 * hd, rail), hw - 0.04, y + 1.08, 0));
    for (const sz of [-1, 1]) parts.push(at(box(BD - 0.12, 1.05, 0.1, band), hw - BD / 2 - 0.06, y + 0.525, sz * (hd - 0.05)));
    for (let u = 0; u < nu; u++) {
      const uz = -hd + uw * (u + 0.5);
      if (u > 0) parts.push(at(metal(BD - 0.14, 2.35, 0.05, 0xcfd0cc), hw - BD / 2 - 0.05, y + 1.18, -hd + uw * u));
      if (!solid) {
        parts.push(at(glass(uw - 0.25, 0.85, 0x8c979e, null, 1, 0.95), hw - 0.04, y + 0.55, uz, PI / 2));
        if (u > 0) parts.push(at(metal(0.06, 1.05, 0.06, rail), hw - 0.04, y + 0.53, -hd + uw * u));
      }
      const lit = grnd() < 0.4;
      parts.push(at(glass(uw * 0.6, 2.05, 0x121820, lit ? WARM : null, 0.16, grnd()), hw - BD + 0.035, y + 1.08, uz - uw * 0.08, PI / 2));
      parts.push(at(glass(uw * 0.2, 1.2, 0x121820, lit && grnd() < 0.5 ? WARM : null, 0.14, grnd()), hw - BD + 0.035, y + 1.5, uz + uw * 0.33, PI / 2));
      if (rnd() < 0.55) parts.push(at(metal(0.35, 0.6, 0.8, 0xc9ccd1), hw - BD + 0.25, y + 0.31, uz + uw * 0.3));
      if (rnd() < 0.12) parts.push(at(quad(Math.min(1.4, uw * 0.4), 0.8, pick(futon), null, 1, 0, SURF.PAINT), hw + 0.012, y + 0.62, uz - uw * 0.15, PI / 2));
    }
  }
  // the roof over the top balconies
  parts.push(at(box(BD + 0.02, 0.2, 2 * hd, band), hw - BD / 2 + 0.01, H + 0.1, 0));

  // CORRIDOR: along cf, a core at one end
  {
    const side = ci !== 1;
    const Lc = side ? 2 * hw - BD : 2 * hd, s0 = side ? (ci === 2 ? BD / 2 : -BD / 2) : 0;
    const ce = rnd() < 0.5 ? -1 : 1, coreW = Math.min(3.0, Lc * 0.3);
    const sCore = s0 + ce * (Lc / 2 - coreW / 2), Lr = Lc - coreW, sr = s0 - ce * coreW / 2;
    const nuC = clamp(Math.round(Lr / 5.2), 1, 6), pu = Lr / nuC;
    for (let s = 1; s <= N; s++) {
      const y = s < N ? floorY(s) : H + 0.2;
      proud(parts, box(Lr, 0.18, CD, band), cf, sr, y - 0.09, -CD, CD);
      if (s === N) break;
      proud(parts, box(Lr, 1.1, 0.14, band), cf, sr, y + 0.55, -0.14, 0.14);
      proud(parts, metal(Lr, 0.06, 0.06, rail), cf, sr, y + 1.14, -0.1, 0.06);
      for (let u = 0; u < nuC; u++) {
        const su = sr - Lr / 2 + pu * (u + 0.5);
        const [dx, dz] = on(cf, su, -CD + 0.02);
        parts.push(at(quad(0.85, 2.0, doorHex, null, 1, 0, SURF.PAINT), dx, y + 1.0, dz, cf.yaw));
        pane(parts, cf, su + Math.min(1.0, pu * 0.3), y + 1.6, 0.7, 0.8, 0x1a222c, grnd() < 0.4 ? WARM : null, 0.14, grnd(), -CD + 0.035);
        const [lx, lz] = on(cf, su - Math.min(0.9, pu * 0.25), -CD / 2);
        const ny = s + 1 < N ? floorY(s + 1) : H + 0.2;
        parts.push(at(box(0.5, 0.06, 0.14, 0xeeeeee, [1.0, 0.97, 0.9], 1.25, flickerOf(rnd)), lx, ny - 0.22, lz, cf.yaw));
      }
    }
    // the open end of the corridor gets a full-height fin, the other end the core
    proud(parts, box(0.2, H - GROUND_H + 0.2, CD), cf, sr - ce * (Lr / 2 - 0.1), GROUND_H - 0.2 + (H - GROUND_H + 0.2) / 2, -CD, CD);
    proud(parts, box(coreW, H + 2.6, CD + 1.6, band), cf, sCore, (H + 2.6) / 2, -(CD + 1.6), CD + 1.6);
    pane(parts, cf, sCore, (GROUND_H + H) / 2, 0.7, H - GROUND_H - 0.6, 0x1a2230, COOL, 0.2, 0.9);
  }
  // the plain faces: a bathroom window a storey near each end, air-con units
  for (let fi = 1; fi < 4; fi++) {
    if (fi === ci) continue;
    const f = F[fi];
    for (let s = 1; s < N; s++) {
      for (const k of [-0.32, 0.32]) pane(parts, f, k * f.w, floorY(s) + 1.7, 0.6, 0.9, 0x1a222c, grnd() < 0.3 ? WARM : null, 0.12, 0.1);
      if (rnd() < 0.3) proud(parts, metal(0.7, 0.55, 0.32, 0xc9ccd1), f, (rnd() - 0.5) * f.w * 0.4, floorY(s) + 0.6, 0, 0.32);
    }
  }
  // GROUND: the lobby, its name, and a shop in the other half on a wide front
  {
    const gx = hw - 0.8, ez = hd > 5.5 ? (rnd() < 0.5 ? -1 : 1) * hd * 0.45 : 0;
    parts.push(at(glass(1.8, 2.4, 0x3a4652, WARM, 0.35, 0.95), gx + 0.035, 1.25, ez, PI / 2));
    parts.push(at(metal(0.1, 0.62, 2.3, 0x1a1c20), gx + 0.05, 3.3, ez));
    boards.push({ x: gx + 0.11, y: 3.3, z: ez, yaw: F[0].yaw, w: 2.2, h: 0.55, kind: 'h' });
    lamps.push(lampAt(hw + 0.6, 2.0, ez, [1.0, 0.86, 0.66], 70, 26, 1.4));
    /* The ground floor of a Tokyo mansion is usually a shop, and very often a
       konbini: bright, white-lit, with the green / orange / red stripe the
       walk-up's konbini awning carries. */
    if (2 * hd >= 11 && rnd() < 0.7) {
      const sz = -Math.sign(ez || 1) * hd * 0.45, sw = Math.min(hd - 1, 4.4), konbini = rnd() < 0.5;
      const shop = konbini ? [1.0, 0.95, 0.85] : WARM;
      for (const k of [-1, 1]) parts.push(at(shopGlass(sw / 2 - 0.15, 2.4, shop, konbini ? 0.75 : 0.6, gx, sz + k * sw / 4), gx + 0.035, 1.35, sz + k * sw / 4, PI / 2));
      if (konbini) [0x1f8a4c, 0xe8762a, 0xd5312a].forEach((c, i) => parts.push(at(metal(0.06, 0.1, sw, c), gx + 0.05, 2.75 + i * 0.1, sz)));
      const fw = Math.min(sw, 4.2), fh = fw / 4.2;
      boards.push({ x: gx + 0.1, y: 3.35, z: sz, yaw: F[0].yaw, w: fw, h: fh, kind: 'h' });
      parts.push(at(metal(0.08, fh + 0.1, fw + 0.1, 0x141418), gx + 0.04, 3.35, sz));
      lamps.push(lampAt(hw + 0.8, 1.7, sz, shop, 95, 30, 1.8));
      if (rnd() < 0.6) {   // a vertical kanban on the pier beside it
        const kz = sz + Math.sign(sz || 1) * (sw / 2 + 0.45), c = pick(NEON);
        parts.push(at(box(0.14, 2.2, 0.55, 0x141418, c, 1.2, flickerOf(rnd)), gx + 0.07, 1.9, kz));
        boards.push({ x: gx + 0.15, y: 1.9, z: kz, yaw: F[0].yaw, w: 0.48, h: 2.0, vertical: true, kind: 'v' });
      }
    }
  }
  // ROOF: parapet, a water tank on its stand, an antenna
  ring(parts, (x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, H, 0.8, 0.2, band);
  const tx = (x0 + x1) / 2 - (x1 - x0) * 0.2, tz = (z0 + z1) / 2;
  parts.push(at(metal(1.6, 1.4, 1.6, 0x9fa4aa), tx, H + 1.9, tz));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(at(metal(0.08, 1.2, 0.08, 0x3a3d42), tx + sx * 0.7, H + 0.6, tz + sz * 0.7));
  parts.push(at(metal(0.06, 3.2, 0.06, 0x3a3d42), (x0 + x1) / 2 + (x1 - x0) * 0.25, H + 1.6, tz));
  if (rnd() < 0.3 && z1 - z0 > 6) {   // a billboard on the roof, facing the street, over the balconies' edge
    const w = Math.min((z1 - z0) * 0.8, 10), bh = w / 3.5, y = H + 1.4 + bh / 2, bx = x1 - 0.6;
    parts.push(at(metal(0.14, bh + 0.3, w + 0.2, 0x2b2e33), bx, y, (z0 + z1) / 2));
    for (const k of [-1, 1]) parts.push(at(metal(0.1, y - H, 0.1, 0x2b2e33), bx, H + (y - H) / 2, (z0 + z1) / 2 + k * (w / 2 - 0.2)));
    boards.push({ x: bx + 0.08, y, z: (z0 + z1) / 2, yaw: F[0].yaw, w, h: bh, kind: 'h' });
  }
  return finish(parts, finishOf(grnd, 0.75), { boards, lamps, height: H, floors: N });
}

/* =========================================================== 4. CAR PARK */

/** A parked car: a painted body clear of the deck, a dark glasshouse. 24 triangles. `dir` is +1 nose-to-+X, -1 nose-to--X. */
function parkedCar(parts, x, y, z, dir, hex) {
  parts.push(at(metal(4.3, 0.7, 1.74, hex), x, y + 0.55, z));
  parts.push(at(metal(2.2, 0.55, 1.5, 0x1a2028), x - dir * 0.25, y + 1.17, z));
}
/** The parking sign: a blue lightbox with a white P on its street face (+X), in boxes. */
function parkingSign(parts, x, y, z, s) {
  parts.push(at(box(0.3, 2.2 * s, 2.2 * s, 0x1846b8, [0.1, 0.35, 1.0], 1.3), x, y, z));
  // seen from +X the viewer's right is -Z: the stem sits at +Z, the bowl on its right
  const b = (w, hh, dz, dy) => parts.push(at(box(0.06, hh * s, w * s, 0xffffff, [1, 1, 1], 2.0), x + 0.18, y + dy * s, z + dz * s));
  b(0.28, 1.6, 0.42, 0); b(0.9, 0.26, 0, 0.67); b(0.9, 0.26, 0, 0); b(0.26, 0.93, -0.32, 0.335);
}
/**
 * The ramp drum: a helical parapet and ramp round a solid core, one turn a
 * level. Outer and inner faces of the parapet ribbon and its top, the ramp's
 * surface and its soffit -- so the open slot between turns shows the ramp and
 * the core, never the inside of a face. 12 segments a turn with smooth
 * normals: ~120 triangles a turn.
 */
function rampDrum(parts, cx, cz, R, levels, DH, conc) {
  const SEG = 12, Rc = Math.max(1.2, R - 3.4), ri = R - 0.16, ph = 1.0, lift = 0.05;
  const rib = new Shape(), deck = new Shape();
  const P = (r, t, y) => [cx + r * Math.cos(t), y, cz + r * Math.sin(t)];
  const yAt = (t) => lift + (t / (2 * PI)) * DH;
  const nOut = (t) => [Math.cos(t), 0, Math.sin(t)], nIn = (t) => [-Math.cos(t), 0, -Math.sin(t)];
  for (let k = 0; k < levels * SEG; k++) {
    const t0 = (k / SEG) * 2 * PI, t1 = ((k + 1) / SEG) * 2 * PI, y0 = yAt(t0), y1 = yAt(t1), tm = (t0 + t1) / 2;
    const u0 = R * t0, u1 = R * t1;
    // both faces of the parapet run down over the ramp slab's 0.3 m edge, so the slab is closed there
    rib.quad(P(R, t0, y0 - 0.3), P(R, t1, y1 - 0.3), P(R, t1, y1 + ph), P(R, t0, y0 + ph), nOut(tm), [[u0, 0], [u1, 0], [u1, ph + 0.3], [u0, ph + 0.3]], [nOut(t0), nOut(t1), nOut(t1), nOut(t0)]);
    rib.quad(P(ri, t0, y0 - 0.3), P(ri, t1, y1 - 0.3), P(ri, t1, y1 + ph), P(ri, t0, y0 + ph), nIn(tm), [[u0, 0], [u1, 0], [u1, ph + 0.3], [u0, ph + 0.3]], [nIn(t0), nIn(t1), nIn(t1), nIn(t0)]);
    rib.quad(P(ri, t0, y0 + ph), P(R, t0, y0 + ph), P(R, t1, y1 + ph), P(ri, t1, y1 + ph), [0, 1, 0]);
    deck.quad(P(Rc, t0, y0), P(ri, t0, y0), P(ri, t1, y1), P(Rc, t1, y1), [0, 1, 0]);
    deck.quad(P(Rc, t0, y0 - 0.3), P(R, t0, y0 - 0.3), P(R, t1, y1 - 0.3), P(Rc, t1, y1 - 0.3), [0, -1, 0]);   // out to R: it is the parapet's underside too
  }
  // cap both ends of the helix: the parapet and the slab end square, facing back along the ramp
  for (const [t, sg] of [[0, -1], [levels * 2 * PI, 1]]) {
    const y = yAt(t), tan = [-Math.sin(t) * sg, 0, Math.cos(t) * sg];
    rib.quad(P(ri, t, y - 0.3), P(R, t, y - 0.3), P(R, t, y + ph), P(ri, t, y + ph), tan);
    deck.quad(P(Rc, t, y - 0.3), P(ri, t, y - 0.3), P(ri, t, y), P(Rc, t, y), tan);
  }
  parts.push(shaped(rib, conc, null, 1, 0, SURF.WALL + 0.05));
  parts.push(shaped(deck, 0x5e5f60, null, 1, 0, SURF.WALL + 0.05));
  const top = levels * DH + 1.2;
  parts.push(at(cyl(Rc, top, conc, 12), cx, top / 2, cz));
  return top;
}
/**
 * A multi-storey car park: open decks 2.9 m apart on a column grid, a
 * concrete upstand and steel rails (or louvres) round every edge, a
 * fluorescent glow under every deck, cars nosed to the rail, a helical ramp
 * drum in the front corner with the P sign on it, a barrier and booth at the
 * entrance, lamp posts and a billboard on the roof deck. Lower than the plan
 * (x0.5 of the planned height: a car park is never the tall thing on the
 * block), 3-8 decks. Measured: 3,229 triangles mean / 4,310 max over 50
 * seeds; the drum is ~130 a turn, the rails ~40 an edge a deck.
 */
export function buildTokyoCarPark(seed, hw, hd, h) {
  const rnd = stream(seed, 0xca7a), grnd = stream(seed, 0x0fa1);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const parts = [], boards = [], lamps = [];
  const DH = 2.9, N = clamp(Math.round(h * 0.5 / DH), 3, 8), top = N * DH;
  const conc = pick(CONCRETE), accent = pick(ACCENT), louvre = rnd() < 0.35;
  const cs = rnd() < 0.5 ? -1 : 1;
  const R = clamp(Math.min(hw, hd) * 0.55, 4.5, 8);
  const dcx = hw - R, dcz = cs * (hd - R);
  // the deck is an L round the drum: A the full depth, B the strip behind the drum
  const zA = -cs * R, wA = 2 * hd - 2 * R, xB = -R, dB = 2 * hw - 2 * R;
  const edges = [   // [cx, cz, along-X?, length, outward normal]
    [hw, zA, false, wA, [1, 0]], [-hw, 0, false, 2 * hd, [-1, 0]], [0, -cs * hd, true, 2 * hw, [0, -cs]],
    [xB, cs * hd, true, dB, [0, cs]],
  ];
  // the column grid, full height, outside the drum
  const nx = clamp(Math.ceil(2 * hw / 7.5) + 1, 2, 6), nz = clamp(Math.ceil(2 * hd / 7.5) + 1, 2, 6);   // a 6 x 6 grid at most: past that the bays just get longer
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x = -hw + 0.3 + (i / (nx - 1)) * (2 * hw - 0.6), z = -hd + 0.3 + (j / (nz - 1)) * (2 * hd - 0.6);
    if (x > hw - 2 * R - 0.3 && cs * z > hd - 2 * R - 0.3) continue;
    const ch = i === 0 || j === 0 || i === nx - 1 || j === nz - 1 ? top + 1.1 : top - 0.3;   // the perimeter ones carry on as rail posts
    parts.push(at(box(0.5, ch, 0.5, conc), x, ch / 2, z));
  }
  const litDeck = Array.from({ length: N + 1 }, () => grnd() < 0.9);
  for (let L = 1; L <= N; L++) {
    const y = L * DH;
    parts.push(at(box(2 * hw, 0.3, wA, conc), 0, y - 0.15, zA));
    parts.push(at(box(dB, 0.3, 2 * R, conc), xB, y - 0.15, cs * (hd - R)));
    // the deck below's ceiling: a fluorescent glow and strip lights near the street
    if (litDeck[L - 1]) {
      parts.push(at(soffit(2 * hw - 0.4, wA - 0.4, 0x3a3c40, [0.85, 0.92, 1.0], 0.14), 0, y - 0.31, zA));
      for (const k of [-0.3, 0.3]) parts.push(at(box(0.15, 0.05, 1.4, 0xeeeeee, [0.85, 0.95, 1.0], 1.5), hw - 1.2, y - 0.33, zA + k * wA));
      parts.push(at(box(1.4, 0.05, 0.15, 0xeeeeee, [0.85, 0.95, 1.0], 1.5), 0, y - 0.33, -cs * (hd - 1.2)));
    }
  }
  // the rails round every edge of every deck and the roof (not the ground: that is the way in)
  for (let L = 1; L <= N; L++) {
    const y = L * DH;
    for (const [ex, ez, alongX, len, n] of edges) {
      const x = ex - n[0] * 0.1, z = ez - n[1] * 0.1;
      const upH = louvre ? 0.4 : 0.85;
      parts.push(at(alongX ? box(len, upH, 0.2, conc) : box(0.2, upH, len, conc), x, y + upH / 2, z));
      if (louvre) {
        for (const dy of [0.8, 1.35, 1.9]) parts.push(at(alongX ? metal(len, 0.06, 0.34, accent) : metal(0.34, 0.06, len, accent), x + n[0] * 0.06, y + dy, z + n[1] * 0.06));
      } else {
        for (const dy of [1.02, 1.24]) parts.push(at(alongX ? metal(len, 0.06, 0.06, accent) : metal(0.06, 0.06, len, accent), x, y + dy, z));
      }
    }
    // the two short edges against the drum: an upstand only
    parts.push(at(box(0.2, 0.85, 2 * R, conc), hw - 2 * R, y + 0.425, cs * (hd - R)));
    parts.push(at(box(2 * R, 0.85, 0.2, conc), hw - R, y + 0.425, cs * (hd - 2 * R)));
  }
  // cars: nosed to the front rail on every deck, a thinner back row, a few on the roof
  const car = () => CAR_PAINT[Math.floor(grnd() * CAR_PAINT.length)];
  for (let L = 0; L <= N; L++) {
    const y = L * DH, occ = L === N ? 0.3 : 0.45;
    const slots = Math.min(10, Math.floor((wA - 1) / 2.5));
    for (let i = 0; i < slots; i++) {
      const z = zA - (wA - 1) / 2 + 2.5 * (i + 0.5);
      if (L === 0 && cs * (z - zA) + wA / 2 < 5.6) continue;   // the lane in, behind the barrier and the booth
      if (grnd() < occ) parkedCar(parts, hw - 2.8, y, z, 1, car());
      if ((L === 1 || L === N - 1) && grnd() < 0.3) parkedCar(parts, -hw + 2.8, y, z, -1, car());
    }
  }
  // the ramp drum and the P
  const drumTop = rampDrum(parts, dcx, dcz, R, N, DH, conc);
  parts.push(at(metal(0.16, 2.6, 0.16, 0x3a3d42), dcx, drumTop + 1.3, dcz));
  parkingSign(parts, dcx + 0.1, drumTop + 2.6 + 1.1, dcz, 1);
  lamps.push(lampAt(hw + 1.0, 3.2, dcz, [0.3, 0.55, 1.0], 60, 24, 2.0));
  // the way in: a barrier, a booth, its sign
  {
    const ez = zA - cs * (wA / 2 - 3.4);   // the far end of the front from the drum: the booth outermost, the sign toward the drum
    parts.push(at(metal(0.2, 1.0, 0.2, 0xd8d8d8), hw - 0.6, 0.5, ez - 1.6 * cs));
    for (let k = 0; k < 3; k++) parts.push(at(metal(0.08, 0.08, 1.0, k % 2 ? 0xc0392b : 0xf2f2f2), hw - 0.6, 1.0, ez - cs * (1.1 - k)));
    parts.push(at(box(1.3, 2.3, 1.3, 0xd8d8d0), hw - 1.4, 1.15, ez - 2.6 * cs));
    parts.push(at(glass(1.0, 0.9, 0x3a4652, [1.0, 0.92, 0.72], 0.4, 0.95), hw - 0.74, 1.5, ez - 2.6 * cs, PI / 2));
    parts.push(at(metal(0.12, 2.6, 0.12, 0x3a3d42), hw - 0.3, 1.3, ez + 1.6 * cs));
    parts.push(at(metal(0.12, 0.7, 2.5, 0x141418), hw - 0.3, 2.9, ez + 1.6 * cs));
    boards.push({ x: hw - 0.23, y: 2.9, z: ez + 1.6 * cs, yaw: PI / 2, w: 2.4, h: 0.62, kind: 'h' });
    lamps.push(lampAt(hw + 0.8, 2.2, ez, [0.85, 0.92, 1.0], 80, 28, 1.6));
    // the pylon every Tokyo car park stands at its gate: a tall lit column, lettered on its street face
    const pz = ez + 3.2 * cs, pc = pick(NEON);
    parts.push(at(box(0.3, 4.2, 1.1, 0x141418, pc, 1.1, flickerOf(rnd)), hw - 0.35, 2.3, pz));
    boards.push({ x: hw - 0.19, y: 2.4, z: pz, yaw: PI / 2, w: 0.95, h: 3.8, vertical: true, kind: 'v' });
    lamps.push(lampAt(hw + 1.0, 2.4, pz, pc, 85, 28, 2.2));
  }
  // the roof deck: lamp posts and a billboard facing the street
  for (const k of [-0.3, 0.3]) {
    parts.push(at(metal(0.12, 5.0, 0.12, 0x3a3d42), -hw * 0.3, top + 2.5, zA + k * wA));
    parts.push(at(box(0.6, 0.15, 0.3, 0x2a2c30, [1.0, 0.9, 0.72], 1.8), -hw * 0.3 + 0.2, top + 5.0, zA + k * wA));
  }
  {
    const w = Math.min(wA * 0.85, 12), bh = w / 3.5, y = top + 2.4 + bh / 2;
    parts.push(at(metal(0.14, bh + 0.3, w + 0.2, 0x2b2e33), -hw + 1.0, y, zA));
    for (const k of [-1, 1]) parts.push(at(metal(0.1, y - top, 0.1, 0x2b2e33), -hw + 1.0, top + (y - top) / 2, zA + k * (w / 2 - 0.2)));
    boards.push({ x: -hw + 1.08, y, z: zA, yaw: PI / 2, w, h: bh, kind: 'h' });
  }
  return finish(parts, finishOf(grnd, 0.1), { boards, lamps, height: top + 1.1, floors: N + 1 });
}

/* ============================================================ 5. MACHIYA */

/**
 * A shotengai row of machiya: the plot's frontage split into two-storey
 * timber shops 4-7 m wide, each its own house -- its own eave height, pitch,
 * plaster and roof -- so the roofline steps the way a real old street does.
 * Per house: the ground floor set back under a tiled pent roof (hisashi)
 * between timber posts, either an open lit shop with noren across the door
 * or a koshi lattice over a glowing paper screen; a signboard over the pent
 * roof, a slatted upper window, chochin lanterns under the eave, and a
 * gable roof with its ridge along the street, kawara tiles, a crest of tile
 * ends and onigawara at the ridge. A deep plot keeps a back building
 * (sometimes a white kura storehouse). Always two storeys, whatever the plan
 * asked: these are the gaps in the wall of mid-rises, which is what makes the
 * wall read as a wall. Measured: 1,396 triangles mean / 2,288 max over 50
 * seeds (500-700 a house; the lattices and tile crests are most of it).
 */
export function buildTokyoMachiya(seed, hw, hd, h) {
  const rnd = stream(seed, 0x6d61), grnd = stream(seed, 0x6b79);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const parts = [], boards = [], lamps = [];
  const FW = 2 * hd, n = clamp(Math.round(FW / 5.4), 1, 4), uw = FW / n;
  const dF = clamp(2 * hw, 4, 10);
  const G1 = 3.2, REC = Math.min(1.8, dF * 0.25);
  const trimHex = 0x24272b;
  let height = 0;
  for (let i = 0; i < n; i++) {
    const zc = -hd + uw * (i + 0.5);
    const EH = 6.2 + (rnd() - 0.5) * 0.6;       // the eave line wanders from house to house
    const pitch = 0.42 + rnd() * 0.12;          // rise over run: 23-28 degrees
    const wallHex = pick(PLASTER), timber = pick(TIMBER), roofHex = pick(KAWARA);
    const style = pick(['shop', 'shop', 'lattice', 'izakaya']);
    parts.push(at(box(dF, EH - G1, uw, wallHex), hw - dF / 2, G1 + (EH - G1) / 2, zc));
    parts.push(at(box(dF - REC, G1, uw, wallHex), hw - REC - (dF - REC) / 2, G1 / 2, zc));
    // posts at the house's edges, the beam under the pent roof, a partition so each shop is its own alcove
    for (const k of [-1, 1]) parts.push(at(box(0.2, G1, 0.2, timber), hw - 0.12, G1 / 2, zc + k * (uw / 2 - 0.12)));
    parts.push(at(box(0.24, 0.32, uw, timber), hw - 0.12, G1 - 0.16, zc));
    parts.push(at(box(REC, G1 - 0.32, 0.1, timber), hw - REC / 2, (G1 - 0.32) / 2, zc - uw / 2 + 0.05));
    if (i === n - 1) parts.push(at(box(REC, G1 - 0.32, 0.1, timber), hw - REC / 2, (G1 - 0.32) / 2, zc + uw / 2 - 0.05));
    const shop = style === 'izakaya' ? [1.0, 0.62, 0.35] : WARM;
    if (style === 'lattice') {
      // koshi across the front, a glowing shoji behind, a door gap with a short noren
      const door = Math.min(1.0, uw * 0.25), la = zc - uw / 2 + 0.25, lb = zc + uw / 2 - 0.25 - door;
      parts.push(at(quad(uw - 0.3, G1 - 0.5, 0xd8cbb0, SHOJI, 0.35, 0, SURF.PAINT), hw - REC + 0.03, 0.25 + (G1 - 0.5) / 2, zc, PI / 2));
      parts.push(slats(la, lb, 0.3, G1 - 0.34, hw - 0.3, uw > 6 ? 0.18 : 0.15, timber));
      parts.push(at(box(0.08, 0.3, lb - la, timber), hw - 0.26, 0.15, (la + lb) / 2));
      parts.push(at(quad(door - 0.1, 0.7, pick(NOREN), null, 1, 0, SURF.PAINT), hw - 0.18, G1 - 0.32 - 0.35, lb + door / 2, PI / 2));
    } else {
      shopRoom(parts, hw - REC, hw - 0.3, zc, uw - 0.4, G1, shop);
      const dw = Math.min(uw - 0.8, style === 'izakaya' ? uw - 0.8 : 2.8), np = Math.max(2, Math.round(dw / 0.5)), pw = dw / np, nh = pick(NOREN);
      for (let k = 0; k < np; k++) parts.push(at(quad(pw - 0.04, 0.9, nh, null, 1, 0, SURF.PAINT), hw - 0.18, G1 - 0.32 - 0.45, zc - dw / 2 + pw * (k + 0.5), PI / 2));
    }
    // the pent roof over the shop, the signboard over it, the slatted upper window
    const pr = pentRoof(uw, 0.72, 0.36, roofHex, trimHex);
    for (const g of pr) parts.push(at(g, hw, G1 + 0.5, zc));
    {
      const bw = Math.min(uw * 0.7, 3.6), bh = 0.6;
      parts.push(at(metal(0.1, bh + 0.1, bw + 0.1, 0x2a1e14), hw + 0.05, G1 + 0.95, zc));
      boards.push({ x: hw + 0.11, y: G1 + 0.95, z: zc, yaw: PI / 2, w: bw, h: bh, kind: 'h' });
      const ww = Math.min(uw * 0.6, 3.0), wy = G1 + 1.9, mushiko = rnd() < 0.5;
      parts.push(at(glass(ww, 0.9, 0x141a20, grnd() < 0.35 ? WARM : null, 0.2, grnd()), hw + 0.035, wy, zc, PI / 2));
      parts.push(slats(zc - ww / 2, zc + ww / 2, wy - 0.45, wy + 0.45, hw + 0.04, 0.16, mushiko ? wallHex : timber));
      for (const dy of [-0.52, 0.52]) parts.push(at(metal(0.14, 0.1, ww + 0.2, timber), hw + 0.07, wy + dy, zc));
    }
    // a vertical kanban on the post, half the time
    if (rnd() < 0.5) {
      const kz = zc + (rnd() < 0.5 ? -1 : 1) * (uw / 2 - 0.45);
      parts.push(at(box(0.14, 2.0, 0.5, 0x141418, pick(NEON), 1.2, flickerOf(rnd)), hw - 0.08, 1.7, kz));
      boards.push({ x: hw + 0.0, y: 1.7, z: kz, yaw: PI / 2, w: 0.44, h: 1.8, vertical: true, kind: 'v' });
    }
    // chochin under the pent roof; an izakaya's big red one by the door; string lights along the edge
    const nl = style === 'izakaya' ? 3 : 1 + (rnd() < 0.5 ? 1 : 0);
    for (let k = 0; k < nl; k++) {
      const lz = nl === 1 ? zc : zc - uw * 0.3 + (uw * 0.6 * k) / (nl - 1);
      const red = style === 'izakaya' || rnd() < 0.6;
      parts.push(at(paint(new THREE.CylinderGeometry(0.2, 0.2, 0.45, 8), red ? 0xc0392b : 0xe8e0d0, red ? [1.0, 0.32, 0.12] : [1.0, 0.8, 0.5], 1.2, flickerOf(rnd)), hw + 0.4, G1 - 0.1, lz));
    }
    if (rnd() < 0.4) {
      const m = clamp(Math.floor(uw / 0.7), 4, 9);
      for (let k = 0; k < m; k++) parts.push(at(box(0.08, 0.08, 0.08, 0x3a2a1a, [1.0, 0.72, 0.35], 1.3), hw + 0.64, G1 - 0.02, zc - uw / 2 + 0.3 + (k / (m - 1)) * (uw - 0.6)));   // hung under the pent roof's fascia
    }
    lamps.push(lampAt(hw + 0.8, 1.6, zc, style === 'izakaya' ? [1.0, 0.35, 0.15] : shop, 85, 26, 1.6));
    // the main roof: ridge along the street, verges only at the row's two ends
    const run = dF / 2, rise = run * pitch;
    for (const g of gableRoof(uw, run, rise, 0.55, i === 0 || i === n - 1 ? 0.3 : 0, roofHex, trimHex, wallHex)) {
      parts.push(at(g, hw - run, EH, zc));
    }
    height = Math.max(height, EH + rise + 0.3);
  }
  // the back of a deep plot: a lean-to, a pitched back house (a kura, a third of the time), or a flat modern extension
  const r = 2 * hw - dF;
  if (r > 0.4) {
    const kura = rnd() < 0.35;
    const rearHex = kura ? 0xaaa59a : pick(PLASTER), ER = r > 7 ? 6.4 : 5.4;
    parts.push(at(box(r, ER, FW, rearHex), -hw + r / 2, ER / 2, 0));
    if (kura) ring(parts, -hw + r / 2, 0, r / 2 + 0.03, hd + 0.03, 0, 1.1, 0.08, 0x232427);
    if (r > 7) {
      ring(parts, -hw + r / 2, 0, r / 2, hd, ER, 0.6, 0.2, pick(PLASTER));
      for (let k = 0; k < 3; k++) parts.push(at(metal(0.9, 0.7, 0.6, 0xc9ccd1), -hw + 1.5 + k * 2.2, ER + 0.35, hd * 0.4));
    } else if (r >= 2.5) {
      for (const g of gableRoof(FW, r / 2, r / 2 * 0.45, 0.35, 0.3, pick(KAWARA), trimHex, rearHex)) parts.push(at(g, -hw + r / 2, ER, 0));
      height = Math.max(height, ER + r / 2 * 0.45 + 0.3);
    }
    height = Math.max(height, ER + 0.6);
  }
  return finish(parts, finishOf(grnd, 0.15), { boards, lamps, height, floors: 2 });
}

/* ============================================================= 6. DEPATO */

/**
 * A department store: an L of stone-clad sales floors (4.6 m storeys, 5-11
 * of them) round a glazed corner atrium that rises one tier past the roof
 * under a glass pyramid and glows at night. Stone pilasters and a band a
 * storey for relief, lit show windows under a canopy with a neon fascia,
 * two or three tall banner kanban on the front (and on the atrium side), a
 * restaurant floor of windows at the top, the store's name on a frame over
 * the parapet, and the rooftop garden every Tokyo depato has: planters,
 * string lights, sometimes a little torii. The atrium takes the corner on a
 * side street when there is one (ctx.probe). Measured: 1,518 triangles mean /
 * 1,796 max over 50 seeds -- big, plain stone faces are cheap.
 */
export function buildTokyoDepato(seed, hw, hd, h, ctx = {}) {
  const rnd = stream(seed, 0xd3a7), grnd = stream(seed, 0x51c3);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const parts = [], boards = [], lamps = [];
  const SH = 4.6, N = clamp(Math.round(h / SH), 5, 11), H = N * SH;
  const stone = pick(STONE), band = pick(STONE), brand = pick(NEON), mull = pick(MULLION);
  let cs = rnd() < 0.5 ? -1 : 1;
  let sideStreet = rnd() < 0.5;
  if (ctx.probe) {
    const L = ctx.probe(0, hd + 4) < 3, R = ctx.probe(0, -hd - 4) < 3;
    if (L !== R) cs = L ? 1 : -1;
    sideStreet = L || R;
  }
  const a = clamp(Math.min(2 * hd, 2 * hw) * 0.32, 6, 10);
  const zA = -cs * a / 2, xB = -a / 2;
  const F = faces(hw, hd);
  const frontA = { ...F[0], w: 2 * hd - a, cz: zA }, sideS = { ...F[cs > 0 ? 2 : 3], w: 2 * hw - a, cx: xB };
  parts.push(at(box(2 * hw, H, 2 * hd - a, stone), 0, H / 2, zA));
  parts.push(at(box(2 * hw - a, H, a, stone), xB, H / 2, cs * (hd - a / 2)));

  // relief: a band a storey, pilasters, a cornice
  for (let s = 1; s < N; s++) {
    parts.push(at(box(2 * hw + 0.1, 0.3, 2 * hd - a + 0.1, band), 0, s * SH, zA));
    parts.push(at(box(2 * hw - a + 0.1, 0.3, a + 0.1, band), xB, s * SH, cs * (hd - a / 2)));
  }
  parts.push(at(box(2 * hw + 0.7, 0.6, 2 * hd - a + 0.7, band), 0, H - 0.3, zA));
  parts.push(at(box(2 * hw - a + 0.7, 0.6, a + 0.7, band), xB, H - 0.3, cs * (hd - a / 2)));
  const banners = new Set();
  for (const [f, main] of [[frontA, true], [sideS, false]]) {
    const np = clamp(Math.round(f.w / 4.5), 2, 12), p = f.w / np;
    for (let k = 1; k < np; k++) proud(parts, trim(box(0.5, H - SH - 0.9, 0.32, band), 'nz'), f, -f.w / 2 + p * k, SH + 0.3 + (H - SH - 0.9) / 2, 0, 0.32);
    // banners in the bays between pilasters: two or three on the front, one or two on the side
    const want = main ? (np >= 6 ? 3 : 2) : (sideStreet ? 2 : 1);
    const bw = Math.min(p * 0.72, 3.2), bh = Math.min(H - SH - 3, 5.0 * bw);
    const picks = [];
    if (bh >= 2.6 * bw) for (let k = 0; k < want && k < np; k++) picks.push(Math.floor(((k + 0.5) / want) * np));
    for (const b of picks) {
      banners.add(`${main}:${b}`);
      const s = -f.w / 2 + p * (b + 0.5), y = SH + 1.0 + bh / 2, c = pick(NEON);
      proud(parts, box(bw + 0.2, bh + 0.2, 0.25, 0x141418, c, 1.1, flickerOf(rnd)), f, s, y, 0.4, 0.25);
      const [x, z] = on(f, s, 0.66);
      boards.push({ x, y, z, yaw: f.yaw, w: bw, h: bh, vertical: true, kind: 'v' });
      if (main) { const [lx, lz] = on(f, s, 1.4); lamps.push(lampAt(lx, 2.6, lz, c, 90, 30, 2.2)); }
    }
    // floor-guide boards over the canopy in the bays the banners leave, each on its lightbox
    for (let b = 0; b < np; b++) {
      if (banners.has(`${main}:${b}`) || (!main && !sideStreet)) continue;
      const gw = Math.min(p - 1.2, 3.4), gh = gw / 4.2, s = -f.w / 2 + p * (b + 0.5);
      if (gw < 2) continue;
      proud(parts, metal(gw + 0.1, gh + 0.1, 0.12, 0x141418), f, s, SH + 1.25, 0, 0.12);
      const [x, z] = on(f, s, 0.13);
      boards.push({ x, y: SH + 1.25, z, yaw: f.yaw, w: gw, h: gh, kind: 'h' });
    }
    // the restaurant floor: windows in the bays the banners leave
    for (let b = 0; b < np; b++) {
      if (banners.has(`${main}:${b}`) && bh + SH + 1.2 > H - SH) continue;
      pane(parts, f, -f.w / 2 + p * (b + 0.5), H - SH + 2.1, p - 0.9, 2.2, 0x1a2430, grnd() < 0.5 ? WARM : null, 0.2, grnd());
    }
    // the show windows, lit, between dark piers; the doors in the middle of the front
    const nb = clamp(Math.round((f.w - 1) / 4), 1, 12), q = (f.w - 1) / nb;
    for (let b = 0; b < nb; b++) {
      const door = main && b === Math.floor(nb / 2);
      if (door) pane(parts, f, -(f.w - 1) / 2 + q * (b + 0.5), 1.6, q - 0.6, 3.0, 0x3c4a5a, WARM, 0.6, 0.95);
      else shopPane(parts, f, -(f.w - 1) / 2 + q * (b + 0.5), 2.3, q - 0.6, 3.4, WARM, 0.5);
    }
    for (let b = 0; b <= nb; b++) proud(parts, box(0.5, 4.3, 0.3, 0x1c1e22), f, -(f.w - 1) / 2 + q * b, 2.15, 0, 0.3);
    // the canopy, its lit soffit and neon fascia
    if (main || sideStreet) {
      const cl = f.w - 0.6, cd = main ? 2.4 : 2.0;
      proud(parts, metal(cl, 0.3, cd, 0x2a2c30), f, 0, 4.95, 0, cd);
      const [sx, sz] = on(f, 0, cd / 2);
      parts.push(at(soffit(cl - 0.2, cd - 0.1, 0x2a2622, [1.0, 0.86, 0.62], 0.55), sx, 4.79, sz, f.yaw));   // X along the face, Z out, like proud()
      proud(parts, box(cl, 0.12, 0.08, 0x111115, brand, 2.2), f, 0, 4.95, cd, 0.08);
      if (main) { const [lx, lz] = on(f, 0, 1.6); lamps.push(lampAt(lx, 3.2, lz, [1.0, 0.85, 0.62], 115, 34, 2.2)); }
    }
  }

  // THE ATRIUM: a glass box on the corner, one tier over the roof, a pyramid on top
  {
    const xa = hw - a / 2, za = cs * (hd - a / 2), HA = H + SH * 0.8;
    parts.push(at(box(a - 0.12, HA, a - 0.12, 0x2a2d31, null, 1, 0, SURF.PAINT), xa, HA / 2, za));
    const AF = facesAt(xa, za, a / 2, a / 2);
    const outer = [AF[0], AF[cs > 0 ? 2 : 3]];
    const nbA = Math.max(2, Math.round(a / 2.2)), pa = a / nbA, rh = SH / 2, rows = Math.ceil(HA / rh);
    for (const f of AF) {
      const isOuter = outer.includes(f);
      for (let r = 0; r < rows; r++) {
        const y0 = r * rh, y1 = Math.min(HA, y0 + rh);
        if (!isOuter && y0 < H) continue;
        for (let b = 0; b < nbA; b++) pane(parts, f, -a / 2 + pa * (b + 0.5), (y0 + y1) / 2, pa - 0.04, y1 - y0 - 0.04, 0x3a4652, WARM, r < 2 && isOuter ? 0.5 : 0.28 + grnd() * 0.08, 0.95);
      }
      for (let b = 1; b < nbA; b++) {
        const y0 = isOuter ? 0 : H, hh = HA - y0;
        proud(parts, trim(metal(0.1, hh, 0.22, mull), 'nz', 'ny'), f, -a / 2 + pa * b, y0 + hh / 2, 0.035, 0.22);
      }
    }
    parts.push(at(metal(0.36, HA, 0.36, mull), hw - 0.1, HA / 2, cs * (hd - 0.1)));
    for (let s = 1; s <= N; s++) parts.push(at(metal(a + 0.1, 0.14, a + 0.1, mull), xa, s * SH, za));
    const s = new Shape(), A = [xa, HA + a * 0.35, za];
    const C = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([x, z]) => [xa + x * a / 2, HA, za + z * a / 2]);
    for (let k = 0; k < 4; k++) {
      const p0 = C[k], p1 = C[(k + 1) % 4], mx = (p0[0] + p1[0]) / 2 - xa, mz = (p0[2] + p1[2]) / 2 - za;
      s.tri(p0, p1, A, [mx, Math.hypot(mx, mz), mz]);
    }
    parts.push(shaped(s, 0x3a4652, WARM, 0.3, 0, SURF.GLASS + 0.05 + 0.8 * 0.95));
    parts.push(at(metal(0.1, 2.5, 0.1, 0x3a3d42), xa, HA + a * 0.35 + 1.2, za));
    lamps.push(lampAt(hw + 1.2, 2.5, za, [1.0, 0.94, 0.82], 90, 30, 1.8));
  }

  // the store's name on a frame over the parapet
  {
    const w = Math.min(frontA.w * 0.62, 16), bh = w / 4, y = H + 1.3 + bh / 2;   // clear of the 1 m parapet, lower neon tube included
    parts.push(at(metal(0.25, bh + 0.3, w + 0.3, 0x15171a), hw - 0.4, y, zA));
    for (const k of [-1, 1]) parts.push(at(metal(0.12, y - H, 0.12, 0x15171a), hw - 0.5, H + (y - H) / 2, zA + k * (w / 2 - 0.2)));
    for (const dy of [bh / 2 + 0.2, -bh / 2 - 0.2]) parts.push(at(box(0.08, 0.1, w + 0.4, 0x111115, brand, 2.2), hw - 0.26, y + dy, zA));
    boards.push({ x: hw - 0.26, y, z: zA, yaw: PI / 2, w, h: bh, kind: 'h' });
  }
  // the rooftop: parapets, plant, a garden with string lights, sometimes a torii
  ring(parts, 0, zA, hw, hd - a / 2, H, 1.0, 0.2, band);
  ring(parts, xB, cs * (hd - a / 2), hw - a / 2, a / 2, H, 1.0, 0.2, band);
  parts.push(at(box(hw * 0.7, 3.2, (2 * hd - a) * 0.35, stone), -hw * 0.5, H + 1.6, zA));
  for (const k of [-1, 1]) parts.push(at(box(1.2, 0.6, 2.4, 0x3d5a32), hw * 0.2, H + 0.3, zA + k * (hd - a / 2) * 0.5));
  {
    const m = 9, z0 = zA - (hd - a / 2) * 0.6, z1 = zA + (hd - a / 2) * 0.6;
    for (let k = 0; k < m; k++) {
      const t = k / (m - 1), sag = 4 * t * (1 - t);
      parts.push(at(box(0.1, 0.1, 0.1, 0x3a2a1a, [1.0, 0.72, 0.35], 1.3), hw * 0.35, H + 3.2 - 0.5 * sag, z0 + (z1 - z0) * t));
    }
  }
  if (rnd() < 0.5) {
    const tx = hw * 0.05, tz = zA + (hd - a / 2) * 0.55 * (rnd() < 0.5 ? -1 : 1);
    for (const k of [-1, 1]) parts.push(at(cyl(0.12, 2.3, 0xb5321c, 8), tx, H + 1.15, tz + k * 0.9));
    parts.push(at(box(0.3, 0.24, 2.6, 0xb5321c), tx, H + 2.35, tz), at(box(0.2, 0.16, 2.0, 0xb5321c), tx, H + 1.9, tz));
  }
  return finish(parts, finishOf(grnd, 0.3), { boards, lamps, height: H + 1.0, floors: N });
}

/* ============================================ 7. SHIBUYA SET PIECES */

/* Arun's five photos of the scramble (docs/REF-SHIBUYA.md): what makes the
   crossing read as Shibuya is not the walk-ups, it is three buildings round
   it -- the glass drum with a white fin grid and a screen set into it
   (QFRONT), a mid-rise whose street face is ALL boards with a blue-over-green
   pair on the roof (the Hisamitsu corner), and the corner opposite with two
   video walls on its roof (Shibuhachi). pickTokyoType never rolls these:
   districtWorld hands them to the plots round the one scramble in front of
   the spawn (ctx.hero), and ?tokyotype=qfront etc. forces them for a look. */

/**
 * A closed rounded rectangle in plan, half sizes tx, tz, corner radius R -- one
 * number, or four [+x+z, -x+z, -x-z, +x-z] (QFRONT's crossing corner is a big
 * curve, the other three tight) -- a point at most every `step` m: { x, z, nx,
 * nz } with the outward normal. Segment i runs pts[i] -> pts[i + 1], wrapping.
 * Pure; tested.
 */
export function roundLoop(tx, tz, R, step) {
  const Rs = (Array.isArray(R) ? R : [R, R, R, R]).map((r) => clamp(r, 0.01, Math.min(tx, tz)));
  const S = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  const C = S.map(([sx, sz], k) => [sx * (tx - Rs[k]), sz * (tz - Rs[k])]);
  const pts = [];
  for (let k = 0; k < 4; k++) {
    const [cx, cz] = C[k], Rk = Rs[k], a0 = k * PI / 2, na = Math.max(2, Math.ceil((PI / 2) * Rk / step));
    for (let j = 0; j < na; j++) { const a = a0 + (j / na) * (PI / 2); pts.push({ x: cx + Rk * Math.cos(a), z: cz + Rk * Math.sin(a), nx: Math.cos(a), nz: Math.sin(a) }); }
    const a1 = a0 + PI / 2, k1 = (k + 1) % 4, [ncx, ncz] = C[k1], ux = Math.cos(a1), uz = Math.sin(a1);
    const x0 = cx + Rk * ux, z0 = cz + Rk * uz, x1 = ncx + Rs[k1] * ux, z1 = ncz + Rs[k1] * uz, L = Math.hypot(x1 - x0, z1 - z0);
    if (L < 1e-3) continue;
    const ns = Math.max(1, Math.ceil(L / step - 1e-9));   // at most `step` apart
    for (let j = 0; j < ns; j++) { const t = j / ns; pts.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, nx: ux, nz: uz }); }
  }
  return pts;
}
/** An upright band round a loop from y0 to y1, `o` out along the normals, smooth-shaded; `pane` gives each segment 0..1 UVs (a glass pane per segment per storey). */
function loopWall(s, pts, y0, y1, o = 0, pane = false) {
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const a = [p.x + p.nx * o, y0, p.z + p.nz * o], b = [q.x + q.nx * o, y0, q.z + q.nz * o];
    s.quad(a, b, [b[0], y1, b[2]], [a[0], y1, a[2]], [p.nx + q.nx, 0, p.nz + q.nz], pane ? [[0, 0], [1, 0], [1, 1], [0, 1]] : null,
      [[p.nx, 0, p.nz], [q.nx, 0, q.nz], [q.nx, 0, q.nz], [p.nx, 0, p.nz]]);
  }
}
/** A closed ledge round a loop: its face `o` out from y to y + t, and its top and underside back to the wall. */
function loopLedge(s, pts, y, t, o) {
  loopWall(s, pts, y, y + t, o);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    for (const [yy, up] of [[y + t, 1], [y, -1]]) s.quad([p.x, yy, p.z], [q.x, yy, q.z], [q.x + q.nx * o, yy, q.z + q.nz * o], [p.x + p.nx * o, yy, p.z + p.nz * o], [0, up, 0]);
  }
}
/** A flat roof over a loop: a fan from the centre. */
function loopCap(s, pts, y) {
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s.tri([0, y, 0], [p.x, y, p.z], [q.x, y, q.z], [0, 1, 0], [[0, 0], [p.x, p.z], [q.x, q.z]]); }
}
/** A closed bar round a loop from y to y + t, 0..o out: outer, inner, top and underside -- seen from inside an open crown too. */
function loopBar(s, pts, y, t, o) {
  loopLedge(s, pts, y, t, o);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    s.quad([p.x, y, p.z], [q.x, y, q.z], [q.x, y + t, q.z], [p.x, y + t, p.z], [-(p.nx + q.nx), 0, -(p.nz + q.nz)]);
  }
}
/**
 * Which side street a corner plot's other face is on (+1 = +Z) and which way
 * the crossing lies in the building's own frame. districtWorld hands a hero
 * plot `ctx.toward` (unit, local frame); otherwise the probe, else a seeded
 * guess. The probe alone missed the Shibuya corners: their side faces stand a
 * pavement's width off the side street, deeper than its 3 m test.
 */
function sideStreetOf(ctx, hd, rnd) {
  if (ctx.toward && Math.abs(ctx.toward[1]) > 0.15) return ctx.toward[1] > 0 ? 1 : -1;
  let cs = rnd() < 0.5 ? 1 : -1;
  if (ctx.probe) { const L = ctx.probe(0, hd + 4) < 3, R = ctx.probe(0, -hd - 4) < 3; if (L !== R) cs = L ? 1 : -1; }
  return cs;
}

/**
 * A curved video wall: `strips` 's' boards on an arc bulging out along the
 * face normal of `yaw` (the Tokyo board convention: normal = (sin yaw, cos
 * yaw)), its chord centred at (cx, cz), `sw` wide, its foot at y0, each strip
 * showing its slice of the one ad (boardCell's `slice`), each on its own dark
 * housing. o.radius sets the arc (to follow a building's curve); by default
 * the bulge is 9% of the width. o.crop (the tile's centre fraction) sets the
 * aspect: height = strips' width / (2 * crop), so the picture is never
 * stretched round the curve. o.depth is the housing's depth behind the board.
 * Returns the frame it used and the screen's top.
 */
function curvedScreen(parts, boards, cx, cz, yaw, y0, sw, tile, strips = 6, o = {}) {
  const nx = Math.sin(yaw), nz = Math.cos(yaw), tx = Math.cos(yaw), tz = -Math.sin(yaw);   // tangent: the way a board's u runs
  const Rc = Math.max(o.radius ?? 0, sw / 2 + 0.01) || 0, bulge0 = sw * 0.09;
  const R = o.radius ? Rc : (sw * sw / 4 + bulge0 * bulge0) / (2 * bulge0);
  const bulge = R - Math.sqrt(Math.max(0, R * R - sw * sw / 4)), Th = 2 * Math.asin(Math.min(1, sw / (2 * R)));
  const crop = o.crop ?? 1, depth = o.depth ?? 0.5;
  const cw = 2 * R * Math.sin(Th / (2 * strips)), sh = (cw * strips) / (2 * crop), y = y0 + sh / 2;
  for (let i = 0; i < strips; i++) {
    const a = Th / 2 - (Th * (i + 0.5)) / strips, ca = Math.cos(a), sa = Math.sin(a);   // strip 0 is the picture's left end, at -tangent
    const rx = nx * ca - tx * sa, rz = nz * ca - tz * sa, off = R * ca - R + bulge, along = -R * sa;
    const px = cx + nx * off + tx * along, pz = cz + nz * off + tz * along;
    parts.push(at(metal(depth, sh + 0.6, cw + 0.04, o.frameHex ?? 0x0c0d10), px - (depth / 2 + 0.01) * rx, y, pz - (depth / 2 + 0.01) * rz, Math.atan2(-rz, rx)));
    boards.push({ x: px + 0.01 * rx, y, z: pz + 0.01 * rz, yaw: Math.atan2(rx, rz), w: cw, h: sh, kind: 's', tile, slice: [i, strips], crop });
  }
  return { nx, nz, tx, tz, top: y + sh / 2, bulge, sh };
}

/** Which of the 4 corners of a rounded plan faces (sx, sz): roundLoop's order [+x+z, -x+z, -x-z, +x-z]. */
const cornerIndex = (sx, sz) => (sx > 0 ? (sz > 0 ? 0 : 3) : (sz > 0 ? 1 : 2));
/** The crossing's side of the plot in the building's frame: x from ctx.toward (default the front), z from sideStreetOf. */
const crossingCorner = (ctx, hd, rnd) => [ctx.toward && ctx.toward[0] < -0.15 ? -1 : 1, sideStreetOf(ctx, hd, rnd)];

/**
 * QFRONT (the research pass, docs/REF-SHIBUYA.md): a glass building whose
 * crossing corner is one big curve and whose other corners are tight, wrapped
 * in white fins 1.1 m apart from the podium to the top of an OPEN lattice
 * crown at 46 m. The main screen follows the big curve BEHIND the fins, so
 * they stripe it at a slant as they do the real one. Podium: the store's glass
 * (0-4.6 m) under a white canopy slab, a fascia band, the cafe level lit warm
 * (5.8-9.8 m), a white band. A screen inside the crown faces the crossing;
 * tall poster banners on the two street faces; floodlights on the crown;
 * the violet spill of the screens on the road. The plan is at most 28 x 28 m.
 */
export function buildTokyoQFront(seed, hw, hd, h, ctx = {}) {
  const rnd = stream(seed, 0x0f70), grnd = stream(seed, 0x0f71);
  const parts = [], boards = [], lamps = [];
  const L1 = 4.6, L2 = 5.8, POD = 10.6, N = 8, OH = 3.75, GT = POD + N * OH, H = 46;
  const tx = Math.min(hw - 0.6, 14), tz = Math.min(hd - 0.6, 14);
  const [sx, sz] = crossingCorner(ctx, hd, rnd), kc = cornerIndex(sx, sz);
  const Rb = Math.min(tx, tz) * 0.85, radii = [1.4, 1.4, 1.4, 1.4];
  radii[kc] = Rb;
  const pts = roundLoop(tx, tz, radii, 1.9), finPts = roundLoop(tx, tz, radii, 1.1);
  const TINT = 0x2c3b47, FIN = 0xe9ecee, gs = SURF.GLASS + 0.05 + 0.8 * 0.9;
  const dx = sx * Math.SQRT1_2, dz = sz * Math.SQRT1_2, arcX = sx * (tx - Rb), arcZ = sz * (tz - Rb);   // the diagonal to the crossing, and the big curve's centre

  // glass: the store, the cafe, then a floor at a time lit by the floor
  const store = new Shape(), cafe = new Shape(), off = new Shape(), cool = new Shape(), warm = new Shape();
  loopWall(store, pts, 0, L1, 0, true);
  loopWall(cafe, pts, L2, POD - 0.8, 0, true);
  for (let f = 0; f < N; f++) { const r = grnd(); loopWall(r < 0.45 ? off : r < 0.85 ? cool : warm, pts, POD + f * OH, POD + (f + 1) * OH, 0, true); }
  parts.push(shaped(store, TINT, WARM, 0.5, 0, gs), shaped(cafe, 0x3a2a1c, WARM, 0.55, 0, gs));   // 0.6/0.75 read as one peach sheet at night
  for (const [sh, em, k] of [[off, null, 1], [cool, COOL, 0.2], [warm, WARM, 0.22]]) if (!sh.empty) parts.push(shaped(sh, TINT, em, k, 0, gs));

  // white: the canopy slab over the store, the fascia band, the band over the cafe, the glass top
  const white = new Shape();
  loopLedge(white, pts, L1, 0.25, 1.2);
  loopLedge(white, pts, L1 + 0.25, L2 - L1 - 0.25, 0.3);
  loopLedge(white, pts, POD - 0.8, 0.8, 0.4);
  loopLedge(white, pts, GT - 0.15, 0.3, 0.4);
  parts.push(shaped(white, FIN));

  // the crown: OPEN -- the fins run on past the glass, crossed by bars every 1.2 m, a lit rim, a roof over the glass top and a screen box inside facing the crossing
  const bars = new Shape(), rim = new Shape(), roof = new Shape();
  for (let y = GT + 1.2; y < H - 0.6; y += 1.2) loopBar(bars, pts, y, 0.1, 0.35);
  loopBar(rim, pts, H - 0.35, 0.35, 0.4);
  loopCap(roof, pts, GT + 0.15);
  parts.push(shaped(bars, FIN), shaped(rim, 0xe8ecf0, COOL, 1.3), shaped(roof, 0x55585c));
  const ix = Math.max(1.5, tx - 2.2), iz = Math.max(1.5, tz - 2.2);
  parts.push(at(box(2 * ix, H - GT - 1.6, 2 * iz, 0x5d6064), 0, GT + 0.15 + (H - GT - 1.6) / 2, 0));   // board-marked concrete: the building's one wall
  {
    // the crown screen on the inner box's face toward the crossing (the lit one in the night photos)
    const cw = Math.min(2 * iz * 0.9, 18), ch = Math.min(cw / 2, H - GT - 2.2);
    boards.push({ x: sx * (ix + 0.02), y: GT + 0.3 + ch / 2 + 0.2, z: 0, yaw: sx > 0 ? PI / 2 : -PI / 2, w: 2 * ch * 0.98, h: ch, kind: 's' });
  }
  for (const k of [-1, 1]) for (const j of [-1, 1]) parts.push(at(box(0.25, 0.25, 0.25, 0xff2030, [1.0, 0.1, 0.15], 2.8, 0.85), k * (ix - 0.3), H - 1.3, j * (iz - 0.3)));

  // fins: trimmed against the glass below the crown, whole in the open crown (seen from both sides there)
  for (const p of finPts) {
    const ry = Math.atan2(p.nx, p.nz), x = p.x + p.nx * 0.175, z = p.z + p.nz * 0.175;
    parts.push(at(trim(metal(0.08, GT - POD, 0.35, FIN), 'nz', 'ny'), x, POD + (GT - POD) / 2, z, ry));
    parts.push(at(metal(0.08, H - GT, 0.35, FIN), x, GT + (H - GT) / 2, z, ry));
  }

  /* The main screen on the big curve, 16:9 (crop 0.89), a magenta rim tube top
     and bottom. Its housing stands just proud of the fins (they end inside it):
     sunk to the glass, the housing cut through it and 24 panes looked into
     its sides (the glass test). */
  {
    const Rs = Rb + 0.42, half = 0.95, sw = 2 * Rs * Math.sin(half), yaw = Math.atan2(dx, dz);
    const cx = arcX + dx * Rs * Math.cos(half), cz = arcZ + dz * Rs * Math.cos(half);
    const tile = Math.floor(rnd() * 8), arc = 2 * Rs * half, shh = arc / (2 * 0.89), y0 = POD + (GT - POD) * 0.5 - shh / 2;
    curvedScreen(parts, boards, cx, cz, yaw, y0, sw, tile, 8, { radius: Rs, crop: 0.89, depth: 0.1 });
    for (const yy of [y0 - 0.12, y0 + shh + 0.12]) for (let i = 0; i < 8; i++) {
      const a = half - (2 * half * (i + 0.5)) / 8, rx = dx * Math.cos(a) - (Math.cos(yaw)) * Math.sin(a), rz = dz * Math.cos(a) - (-Math.sin(yaw)) * Math.sin(a);
      parts.push(at(box(0.08, 0.12, (arc / 8) + 0.02, 0x16161a, MAGENTA, 1.8), arcX + rx * (Rs + 0.02), yy, arcZ + rz * (Rs + 0.02), Math.atan2(-rz, rx)));
    }
    /* The screen's light belongs on the CROSSING, not on the building: 4 m
       out at 110 it floodlit the white fins lilac-white and the night photos'
       "glass dark with a thin white grid" went (2026-09-24). Both pushed out
       over the road and down. */
    lamps.push(lampAt(arcX + dx * (Rs + 11), y0 - 4, arcZ + dz * (Rs + 11), [0.84, 0.9, 1.0], 55, 34, 2.4));
    lamps.push(lampAt(arcX + dx * (Rs + 18), 7, arcZ + dz * (Rs + 18), [0.62, 0.48, 1.0], 120, 50, 0));   // the violet spill on the crossing
  }

  // poster banners: one tall one on each street face, at its far end, proud of the fins
  for (const [fx, fz] of [[sx, 0], [0, sz]]) {
    const along = fx ? tz : tx, bh = Math.min(22, (GT - POD) * 0.8), bw = bh / 4.4, s0 = -(along - 1.4 - bw / 2);
    const out = (fx ? tx : tz) + 0.5, px = fx ? fx * out : (sx > 0 ? -1 : 1) * -s0, pz = fz ? fz * out : (sz > 0 ? -1 : 1) * -s0;
    const yaw = fx ? (fx > 0 ? PI / 2 : -PI / 2) : (fz > 0 ? 0 : PI), ox = Math.sin(yaw), oz = Math.cos(yaw);
    parts.push(at(metal(bw + 0.3, bh + 0.3, 0.2, 0x141619), px, POD + 1.5 + bh / 2, pz, yaw));
    boards.push({ x: px + ox * 0.11, y: POD + 1.5 + bh / 2, z: pz + oz * 0.11, yaw, w: bw, h: bh, vertical: true, kind: 'v' });
  }

  // the store's name on the fascia, square to the crossing on the curve; its lights on the pavement
  {
    const r = Rb + 0.32, bw = 3.6, bh = 0.8;
    parts.push(at(metal(0.12, bh + 0.2, bw + 0.2, 0x141619), arcX + dx * r, L1 + 0.25 + (L2 - L1 - 0.25) / 2, arcZ + dz * r, Math.atan2(-dz, dx)));
    boards.push({ x: arcX + dx * (r + 0.07), y: L1 + 0.25 + (L2 - L1 - 0.25) / 2, z: arcZ + dz * (r + 0.07), yaw: Math.atan2(dx, dz), w: bw, h: bh, kind: 'h', tile: H_TILE.white });
    lamps.push(lampAt(arcX + dx * (Rb + 4), 2.6, arcZ + dz * (Rb + 4), WARM, 60, 24, 2.0));   // the pavement, not the podium glass
  }
  // floodlights along the crown rim over the big curve, and on the two far corners
  for (const a of [-0.6, 0.6]) {
    const ca = Math.cos(a), sa = Math.sin(a), rx = dx * ca - dz * sa, rz = dz * ca + dx * sa;
    parts.push(at(metal(0.5, 0.35, 0.5, 0x2b2e33), arcX + rx * (Rb + 0.5), H + 0.2, arcZ + rz * (Rb + 0.5)));
    lamps.push(lampAt(arcX + rx * (Rb + 0.5), H + 0.1, arcZ + rz * (Rb + 0.5), [1.0, 0.95, 0.86], 28, 20, 3.4));   // the four star glares; the light itself kept off the fins
  }
  return finish(parts, finishOf(grnd, 0.1), { boards, lamps, height: H, floors: N + 3 });
}

/** Rows of lightboxes up a face between y0 and top, the width `W` centred at s0 along it: the sign-stack street face. Returns nothing; pushes parts, boards, lamps. */
function lightboxRows(parts, boards, lamps, rnd, pick, f, s0, W, y0, top, out = 0) {
  let y = y0, row = 0;
  while (y < top - 1.6) {
    const t = pick([2.0, 2.4, 2.8]);
    let n = Math.max(1, Math.round(W / (t * 4.2 + 0.3))), bw = W / n - 0.3, bh = clamp(bw / 4.2, 1.2, 3.4);
    while (bw / bh > 5.8) { n++; bw = W / n - 0.3; bh = clamp(bw / 4.2, 1.2, 3.4); }
    if (bh + 0.28 > top - y) break;
    for (let k = 0; k < n; k++) {
      const s = s0 - W / 2 + (W / n) * (k + 0.5), c = pick(NEON);
      proud(parts, box(bw + 0.18, bh + 0.18, 0.3, 0x141418, c, 0.9, flickerOf(rnd)), f, s, y + bh / 2 + 0.14, out, 0.3);
      const [x, z] = on(f, s, out + 0.32);
      boards.push({ x, y: y + bh / 2 + 0.14, z, yaw: f.yaw, w: bw, h: bh, kind: 'h' });
    }
    if (row % 2) { const [lx, lz] = on(f, s0, 1.5); lamps.push(lampAt(lx, y + bh / 2, lz, pick(NEON), 60, 22, 1.6)); }
    y += bh + 0.28 + 0.25; row++;
  }
}
/** The corner's two street faces, the one that looks most at the crossing first. */
function streetFaces(F, sx, sz, ctx) {
  const a = F[sx > 0 ? 0 : 1], b = F[sz > 0 ? 2 : 3];
  if (!ctx.toward) return [a, b];
  const d = (f) => f.n[0] * ctx.toward[0] + f.n[1] * ctx.toward[1];
  return d(a) >= d(b) ? [a, b] : [b, a];
}
/** Tate-kanban on the corner the two street faces share: the red drugstore blade, two boards stacked, lettered both faces. */
function cornerBlade(parts, boards, F, sx, sz, hw, hd, H, tile = V_TILE.red, n = 2) {
  const bw = 1.2, bh = Math.min(6.2, (H - 7) / n - 0.4);
  if (bh < 3) return;
  // on the long face, at its end by the corner, standing out 1.1 m from the boards
  const x = sx * (hw + 1.1), z = sz * (hd - 0.2);
  for (let k = 0; k < n; k++) {
    const y = H - 1.6 - bh / 2 - k * (bh + 0.4);
    parts.push(at(box(1.5, bh + 0.2, 0.22, 0x141418, tile === V_TILE.red ? [1.0, 0.15, 0.12] : [1, 1, 1], 0.9), x, y, z));
    for (const side of [-1, 1]) boards.push({ x, y, z: z + side * 0.12, yaw: side > 0 ? 0 : PI, w: bw, h: bh, vertical: true, kind: 'v', tile });
  }
  for (const y of [H - 1.9, H - 1.2 - n * (bh + 0.4)]) parts.push(at(metal(0.4, 0.12, 0.12, 0x2b2e33), sx * (hw + 0.2), y, z));
}

/**
 * The sign corner (the research pass: the Taiseido building at the mouth of
 * Center-gai). The face that looks at the crossing, bottom to top: a glazed
 * bookshop under a flat blue canopy; a white fascia lightbox (書店); a poster
 * zone -- a dark panel and a portrait poster in a grey frame; a grey louvre
 * band; a BOWED screen assembly standing off the wall with blue header and
 * foot bands; a light-grey crown with a row of small windows; and on the roof
 * the tall board, blue over green, on a steel frame a metre over the parapet.
 * The other street face carries rows of lightboxes round the corner and the
 * red drugstore blade on the corner. 8 storeys of 3.4 m + a 1.8 m crown.
 */
export function buildTokyoSignStack(seed, hw, hd, h, ctx = {}) {
  if (ctx.variant === 'screens') return buildTokyoScreensCorner(seed, hw, hd, h, ctx);
  const rnd = stream(seed, 0x5157), grnd = stream(seed, 0x5158);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const parts = [], boards = [], lamps = [];
  /* `street`: the same stack for the streets off the crossing (Arun: the new
     corners were right but the old walk-ups and towers round them "pull it
     down"). Its own wall, canopy, fascia and roof -- the corner's blue-over-
     green board and bookshop are the corner's. */
  const street = ctx.variant === 'street';
  /* A street stack takes the plot's height (6-13 storeys) so the district is
     not one 29 m cornice line; the corner is the photo's eight. */
  const n = street ? clamp(Math.round((h - 1.8) / 3.4), 6, 13) : 8;
  const H = n * 3.4 + 1.8, wall = street ? pick([0xe8e8e6, 0xe9dcc6, 0xd6e0e6, 0xf0d9d2, 0xdcdcc4, 0xc9d8cf]) : 0xe8e8e6;   // + cream, pale blue, blush, sage (2026-09-24)
  const canopy = street ? pick([[0x2a57c8, [0.12, 0.3, 1.0]], [0xc8283c, [1.0, 0.2, 0.25]], [0x1f7a4a, [0.2, 0.9, 0.45]], [0x202226, [1.0, 0.8, 0.4]], [0xd8a018, [1.0, 0.75, 0.2]]]) : [0x2a57c8, [0.12, 0.3, 1.0]];
  const [sx, sz] = crossingCorner(ctx, hd, rnd);
  const F = faces(hw, hd), [fa, fb] = streetFaces(F, sx, sz, ctx);
  parts.push(at(box(2 * hw, H, 2 * hd, wall), 0, H / 2, 0));
  ring(parts, 0, 0, hw, hd, H, 0.6, 0.2, wall);

  // ---- the crossing face (fa)
  const W = fa.w - 0.4;
  shopPane(parts, fa, 0, 1.8, W - 0.6, 3.2, WARM, 0.65);                                        // the bookshop, open to the pavement
  proud(parts, box(fa.w, 0.4, 0.8, canopy[0], canopy[1], 0.35), fa, 0, 3.4, 0, 0.8);      // the flat canopy (blue on the corner)
  proud(parts, box(W, 2.0, 0.3, 0xf2f2ee, [1, 1, 1], 0.35), fa, 0, 5.1, 0, 0.3);                  // the white fascia box
  { const bw = Math.min(W - 0.4, 7.6), [x, z] = on(fa, 0, 0.32); boards.push({ x, y: 5.1, z, yaw: fa.yaw, w: bw, h: clamp(bw / 4.2, 0.8, 1.8), kind: 'h', tile: street ? undefined : H_TILE.books }); }
  if (n < 8) lightboxRows(parts, boards, lamps, rnd, pick, fa, 0, W, 6.5, H - 1.2);   // too low for the screen: signs to the parapet
  else {
  {
    // the poster zone: a dark panel, then a portrait poster in a grey frame (the centre of a screen ad, printed)
    const pw = Math.min(7.0, W - 2.9), ph = Math.min(6.8, pw * 0.97), px = W / 2 - pw / 2 - 0.2, y = 6.5 + ph / 2;
    proud(parts, box(2.5, ph, 0.2, 0x3a3d42), fa, -W / 2 + 1.25, y, 0, 0.2);
    proud(parts, metal(pw + 0.4, ph + 0.4, 0.2, 0x7a7d82), fa, px, y, 0, 0.2);
    const [x, z] = on(fa, px, 0.22);
    boards.push({ x, y, z, yaw: fa.yaw, w: pw, h: ph, kind: 's', crop: pw / ph / 2 });
  }
  for (let k = 0; k < 8; k++) proud(parts, metal(W, 0.06, 0.15, 0xa8abb0), fa, 0, 13.4 + k * 0.25, 0, 0.15);   // the louvre band
  {
    // the screen assembly: a bowed 16:9 screen 0.8 m off the wall, blue header and foot bands, oversailing the neighbour a little
    const sw = Math.min(W + 1.2, 10.24), sag = 0.4, R = (sw * sw / 4 + sag * sag) / (2 * sag);
    const [cx, cz] = on(fa, 0.6, 0.8), tile = Math.floor(rnd() * 8);
    const scr = curvedScreen(parts, boards, cx, cz, fa.yaw, 16.2, sw, tile, 6, { radius: R, crop: 0.89, depth: 0.4 });
    for (const yy of [15.75, scr.top + 0.45]) { const [bx, bz] = on(fa, 0.6, 0.8 + sag / 2); parts.push(at(box(sw + 0.6, 0.9, sag + 0.5, 0x1d4fb8, [0.15, 0.35, 1.0], 0.35), bx, yy, bz, fa.yaw)); }
    for (const e of [-1, 1]) { const [bx, bz] = on(fa, 0.6 + e * (sw / 2 - 0.4), 0.4); parts.push(at(metal(0.3, scr.top - 15.3, 0.8, 0x2b2e33), bx, 15.3 + (scr.top - 15.3) / 2, bz, fa.yaw)); }
    const [lx, lz] = on(fa, 0, 4);
    lamps.push(lampAt(lx, 15.2, lz, [0.84, 0.9, 1.0], 100, 36, 2.2));   // at the foot band, not on the picture
  }
  for (let k = 0; k < 5; k++) pane(parts, fa, -2 + k, 25.5, 0.6, 0.6, 0x27313a, grnd() < 0.5 ? COOL : null, 0.2, 0.9);   // the crown's small windows
  for (let st = 8; st < n; st++) pane(parts, fa, 0, st * 3.4 + 1.7, W - 1.2, 1.4, 0x27313a, grnd() < 0.4 ? COOL : null, 0.16, grnd());   // a taller stack's upper storeys
  }

  // ---- the other street face: rows of lightboxes round the corner, the shop at its foot
  const Wb = fb.w - 1.2, sb = -(fb.t[0] * sx + fb.t[1] * sz) * 0.2;
  shopPane(parts, fb, 0, 2.0, fb.w - 1.4, 3.4, WARM, 0.55);
  lightboxRows(parts, boards, lamps, rnd, pick, fb, sb, Wb, 5.6, H - 2.4);
  cornerBlade(parts, boards, F, fb === F[0] || fb === F[1] ? sx : sx, sz, hw, hd, H);

  // ---- the plain faces: a window strip a storey
  for (const f of F) {
    if (f === fa || f === fb) continue;
    for (let st = 1; st < n; st++) pane(parts, f, 0, st * 3.4 + 1.7, f.w - 1.6, 1.4, 0x27313a, grnd() < 0.4 ? COOL : null, 0.16, grnd());
  }

  // ---- the roof board: blue over green, 9.5 x 10.5, on a steel frame a metre over the parapet, facing the crossing
  //      (a street stack rolls its own pair, one billboard, or a bare roof)
  const roof = street ? rnd() : 0;
  const PAIRS = [[0x0a53b5, H_TILE.blue, [0.15, 0.35, 1.0], 0x00964b, H_TILE.green, [0.1, 0.9, 0.4]], [0xd7141f, H_TILE.red, [1.0, 0.15, 0.12], 0xffd200, H_TILE.yellow, [1.0, 0.85, 0.2]],
    [0xf5f3ec, H_TILE.white, [1, 1, 1], 0xd7141f, H_TILE.red, [1.0, 0.15, 0.12]], [0xe5007e, H_TILE.magenta, [1.0, 0.2, 0.7], 0xf5f3ec, H_TILE.white, [1, 1, 1]]];
  const pr = street ? pick(PAIRS) : PAIRS[0];
  if (roof < 0.45) {
    const bw = Math.min(fa.w * 0.95, 9.5), ph = bw * 0.55, [x, z] = on(fa, 0, -1.2), y1 = H + 1.6 + ph / 2, y2 = y1 + ph + 0.1;
    for (const [yy, hex, em, tile] of [[y1, pr[3], pr[5], pr[4]], [y2, pr[0], pr[2], pr[1]]]) {
      parts.push(at(box(bw, ph, 0.45, hex, em, 0.55), x, yy, z, fa.yaw));
      const [bx, bz] = on(fa, 0, -1.2 + 0.24), tw = bw * 0.9;
      boards.push({ x: bx, y: yy, z: bz, yaw: fa.yaw, w: tw, h: tw / 4.2, kind: 'h', tile });
    }
    for (const e of [-1, -1 / 3, 1 / 3, 1]) { const [px, pz] = on(fa, e * (bw / 2 - 0.2), -1.6); parts.push(at(metal(0.3, y2 + ph / 2 - H, 0.3, 0x2b2e33), px, H + (y2 + ph / 2 - H) / 2, pz)); }
    const [lx, lz] = on(fa, 0, 3);
    lamps.push(lampAt(lx, y1 - ph / 2 - 0.3, lz, [0.3, 0.6, 1.0], 90, 40, 2.4));   // under the green board
  } else if (roof < 0.75) {
    // one billboard on a frame (a 2:1 screen or a lightbox), as most roofs off the crossing carry
    const bw = Math.min(fa.w * 0.9, 12), bh = bw / 2, [x, z] = on(fa, 0, -1.4), y = H + 1.5 + bh / 2;
    parts.push(at(metal(bw + 0.4, bh + 0.4, 0.4, 0x141619), x, y, z, fa.yaw));
    const [bx, bz] = on(fa, 0, -1.4 + 0.22);
    boards.push({ x: bx, y, z: bz, yaw: fa.yaw, w: bw, h: bh, kind: 's' });
    for (const e of [-1, 1]) { const [px, pz] = on(fa, e * (bw / 2 - 0.4), -1.7); parts.push(at(metal(0.3, 1.6, 0.3, 0x2b2e33), px, H + 0.8, pz)); }
  }
  const roofTop = roof < 0.45 ? 1.6 + 2 * Math.min(fa.w * 0.95, 9.5) * 0.55 + 0.1 : roof < 0.75 ? 1.7 + Math.min(fa.w * 0.9, 12) / 2 : 0.6;
  return finish(parts, finishOf(grnd, 0.3), { boards, lamps, height: H + roofTop, floors: n + 1 });
}

/**
 * The Shibuhachi corner (the research pass: two nine-storey slabs whose roofs
 * carry one band of screens round the corner, 32-50 m up): a flat screen over
 * the face toward the crossing (1.4:1, crop 0.7) and a CURVED one over the
 * other street face (1.32:1, sagitta 2.5 m), meeting at the corner. Under them
 * a warm-grey grid with red-framed windows, a white parapet band, the sign
 * stack of the upper floors round both faces, ribbon windows below, a yellow
 * pier and a gold-lit shopfront at the foot, a pink lightbox high on the
 * crossing face and a long vertical poster at the far end of the side face.
 */
function buildTokyoScreensCorner(seed, hw, hd, h, ctx = {}) {
  const rnd = stream(seed, 0x5c7e), grnd = stream(seed, 0x5c7f);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const parts = [], boards = [], lamps = [];
  const SH = 3.3, H = 9 * SH, wall = 0xc8c7c0;
  const [sx, sz] = crossingCorner(ctx, hd, rnd);
  const F = faces(hw, hd), [fa, fb] = streetFaces(F, sx, sz, ctx);
  parts.push(at(box(2 * hw, H, 2 * hd, wall), 0, H / 2, 0));
  ring(parts, 0, 0, hw, hd, H, 1.4, 0.25, 0xe8e8e4);

  for (const f of F) {
    const street = f === fa || f === fb, W = f.w - 0.6;
    if (street) {
      // the foot: a gold-lit shopfront and a yellow pier by the corner; ribbon windows on floors 3-5
      shopPane(parts, f, 0, 3.2, W - 3.0, 5.8, [1.0, 0.78, 0.4], 0.75);
      const cornerS = (f.t[0] * sx + f.t[1] * sz) > 0 ? 1 : -1;
      proud(parts, box(2.5, 6.6, 0.3, 0xe8b820), f, cornerS * (W / 2 - 1.2), 3.3, 0, 0.3);
      for (let st = 2; st < 5; st++) {
        pane(parts, f, 0, st * SH + 1.6, W - 0.8, 1.9, 0x718481, grnd() < 0.5 ? WARM : null, 0.3, grnd());
        proud(parts, box(W, 0.6, 0.15, 0xe8e8e4), f, 0, st * SH + 0.3, 0, 0.15);
      }
      // the upper floors: lightboxes on the tenant floors, round both faces
      lightboxRows(parts, boards, lamps, rnd, pick, f, 0, W - 0.4, 5 * SH + 0.3, H - 0.5);
    } else {
      // the plain faces: a grid of red-framed windows, 3.5 m bays
      const nb = Math.max(1, Math.round(W / 3.5)), p = W / nb;
      for (let st = 1; st < 9; st++) for (let b = 0; b < nb; b++) {
        const s = -W / 2 + p * (b + 0.5);
        proud(parts, metal(Math.min(2.8, p - 0.7) + 0.16, 2.06, 0.06, 0xb8322c), f, s, st * SH + 1.7, 0, 0.06);
        pane(parts, f, s, st * SH + 1.7, Math.min(2.8, p - 0.7), 1.9, 0x3a4550, grnd() < 0.35 ? WARM : null, 0.2, grnd(), 0.07);
      }
    }
  }
  // the pink lightbox high on the crossing face, and the long vertical poster at the far end of the side face
  {
    const bw = Math.min(9.5, fa.w * 0.5), bh = bw / 4.2, farS = -(fa.t[0] * sx + fa.t[1] * sz > 0 ? 1 : -1) * (fa.w / 2 - bw / 2 - 0.6);
    proud(parts, box(bw + 0.2, bh + 0.2, 0.35, 0x141418, [1.0, 0.45, 0.7], 0.9), fa, farS, H - 3.6, 0.3, 0.35);
    const [x, z] = on(fa, farS, 0.67);
    boards.push({ x, y: H - 3.6, z, yaw: fa.yaw, w: bw, h: bh, kind: 'h', tile: H_TILE.magenta });
    const lw = 4.0, lh = Math.min(22.4, H - 6), farB = -(fb.t[0] * sx + fb.t[1] * sz > 0 ? 1 : -1) * (fb.w / 2 - lw / 2 - 0.4);
    proud(parts, box(lw + 0.3, lh + 0.3, 0.3, 0x141418, [1, 1, 1], 0.6), fb, farB, H - 0.8 - lh / 2, 0.3, 0.3);
    const [vx, vz] = on(fb, farB, 0.62);
    boards.push({ x: vx, y: H - 0.8 - lh / 2, z: vz, yaw: fb.yaw, w: lw, h: lh, vertical: true, kind: 'v', tile: Math.floor(rnd() * 24) });
  }
  cornerBlade(parts, boards, F, sx, sz, hw, hd, H, V_TILE.white, 1);

  // the band of screens: flat over fa, curved over fb, their feet 1.8 m over the roof on a truss
  const y0 = H + 1.8;
  {
    const sw = fa.w + 1.0, crop = 0.7, sh = sw / (2 * crop), [cx, cz] = on(fa, 0, -1.0), tile = Math.floor(rnd() * 8);
    parts.push(at(metal(sw + 0.5, sh + 0.5, 0.5, 0x0c0d10), cx, y0 + sh / 2, cz, fa.yaw));
    const [bx, bz] = on(fa, 0, -0.74);
    boards.push({ x: bx, y: y0 + sh / 2, z: bz, yaw: fa.yaw, w: sw, h: sh, kind: 's', tile, crop });
    for (const k of [-1, 0, 1]) { const [px, pz] = on(fa, k * (sw / 2 - 1.0), -1.5); parts.push(at(metal(0.25, y0 - H, 0.25, 0x2b2e33), px, H + (y0 - H) / 2, pz)); }
    for (const k of [-0.35, 0.35]) { const [lx, lz] = on(fa, k * sw, 0); lamps.push(lampAt(lx, y0 + sh + 0.6, lz, [1.0, 0.95, 0.86], 40, 20, 3.2)); }
    const [spx, spz] = on(fa, 0, 12);
    lamps.push(lampAt(spx, 12, spz, [0.62, 0.48, 1.0], 170, 55, 0));
  }
  {
    const sw = fb.w + 0.6, sag = Math.min(2.5, sw * 0.12), R = (sw * sw / 4 + sag * sag) / (2 * sag), [cx, cz] = on(fb, 0, -0.9), tile = Math.floor(rnd() * 8);
    const scr = curvedScreen(parts, boards, cx, cz, fb.yaw, y0, sw, tile, 8, { radius: R, crop: 0.66, depth: 0.5 });
    for (const k of [-1, 0, 1]) { const [px, pz] = on(fb, k * (sw / 2 - 1.0), -1.4); parts.push(at(metal(0.25, y0 - H, 0.25, 0x2b2e33), px, H + (y0 - H) / 2, pz)); }
    for (const k of [-0.35, 0.35]) { const [lx, lz] = on(fb, k * sw, sag); lamps.push(lampAt(lx, scr.top + 0.6, lz, [1.0, 0.95, 0.86], 40, 20, 3.2)); }
    const [spx, spz] = on(fb, 0, 12);
    lamps.push(lampAt(spx, 12, spz, [0.62, 0.48, 1.0], 170, 55, 0));
  }
  return finish(parts, finishOf(grnd, 0.2), { boards, lamps, height: H + 1.8 + (fa.w + 1.0) / 1.4, floors: 9 });
}

/**
 * The corner ad drum (the research pass: MAGNET by SHIBUYA109's corner): a
 * 10 m podium with a 1.6:1 screen standing out from it under a magenta frame,
 * a drum (up to 7 m across) set into the crossing corner and wrapped in one lit
 * colour -- a flat yellow or a white-lit ad -- with an open steel crown, and a
 * blue mirror-glass slab behind it, taller than the drum.
 */
export function buildTokyoAdDrum(seed, hw, hd, h, ctx = {}) {
  const rnd = stream(seed, 0xadd0), grnd = stream(seed, 0xadd1);
  const parts = [], boards = [], lamps = [];
  const [sx, sz] = crossingCorner(ctx, hd, rnd);
  const POD = 10, D = Math.min(7, 2 * Math.min(hw, hd) - 1.0), R = D / 2, DTOP = 34, GLASS_H = 44;
  const cx = sx * (hw - R - 0.3), cz = sz * (hd - R - 0.3);
  const wrap = rnd() < 0.5 ? [0xf6ce46, [1.0, 0.82, 0.25]] : [0xf3f1f7, [1, 1, 1]];

  // the podium, its shop glass, and the screen out front under its frame
  parts.push(at(box(2 * hw, POD, 2 * hd, 0x9a9ca0), 0, POD / 2, 0));
  const F = faces(hw, hd), [fa, fb] = streetFaces(F, sx, sz, ctx);
  for (const f of [fa, fb]) shopPane(parts, f, 0, 2.2, f.w - 1.2, 3.8, WARM, 0.6);
  {
    const sw = Math.min(11, fa.w + 1.4), crop = 0.8, sh = sw / (2 * crop), [x, z] = on(fa, 0, 1.0 + 0.25);
    parts.push(at(box(sw + 1.0, sh + 1.0, 0.5, 0xc8283c, MAGENTA, 1.2), x, 3 + sh / 2, z, fa.yaw));
    const [bx, bz] = on(fa, 0, 1.0 + 0.52);
    boards.push({ x: bx, y: 3 + sh / 2, z: bz, yaw: fa.yaw, w: sw, h: sh, kind: 's', crop });
    for (const e of [-1, 1]) { const [px, pz] = on(fa, e * (sw / 2), 0.5); parts.push(at(metal(0.3, 0.3, 1.0, 0x2b2e33), px, 3 + sh, pz, fa.yaw)); }
    const [lx, lz] = on(fa, 0, 6);
    lamps.push(lampAt(lx, 5, lz, [1.0, 0.3, 0.6], 120, 30, 0));
  }
  // the blue glass slab behind, then the drum in the corner in front of it
  {
    const bx0 = -sx * hw * 0.35, bz0 = -sz * hd * 0.35, gx = hw * 0.65, gz = hd * 0.65;
    parts.push(at(box(2 * gx, GLASS_H - POD, 2 * gz, 0x1d4486, null, 1, 0, SURF.PAINT), bx0, POD + (GLASS_H - POD) / 2, bz0));
    for (const f of facesAt(bx0, bz0, gx, gz)) for (let y = POD + 1; y < GLASS_H - 1; y += 2.0) {
      const n = Math.max(1, Math.round(f.w / 2)), p = f.w / n;
      for (let k = 0; k < n; k++) pane(parts, f, -f.w / 2 + p * (k + 0.5), y + 1, p - 0.08, 1.92, 0x2552ab, grnd() < 0.2 ? COOL : null, 0.18, 0.95, 0.04);
    }
  }
  {
    const seg = 24, drum = new Shape(), cap = new Shape(), y0 = POD, y1 = DTOP;
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * 2 * PI, a1 = ((k + 1) / seg) * 2 * PI, am = (a0 + a1) / 2;
      const p0 = [cx + R * Math.cos(a0), cz + R * Math.sin(a0)], p1 = [cx + R * Math.cos(a1), cz + R * Math.sin(a1)];
      drum.quad([p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], [Math.cos(am), 0, Math.sin(am)], [[k / seg, 0], [(k + 1) / seg, 0], [(k + 1) / seg, 1], [k / seg, 1]]);
      cap.tri([cx, y1, cz], [p0[0], y1, p0[1]], [p1[0], y1, p1[1]], [0, 1, 0]);
    }
    parts.push(shaped(drum, wrap[0], wrap[1], 0.75), shaped(cap, 0x55585c));
    // the open steel crown: posts and two rings, whole boxes (seen from inside too)
    const crown = new Shape();
    const ring8 = roundLoop(R, R, R, 1.2).map((p) => ({ ...p, x: p.x + cx, z: p.z + cz }));
    for (const y of [y1 + 1.2, y1 + 2.8]) loopBar(crown, ring8, y, 0.2, 0.25);
    parts.push(shaped(crown, 0x3a3d42));
    for (let k = 0; k < 8; k++) { const a = (k / 8) * 2 * PI; parts.push(at(metal(0.2, 3.0, 0.2, 0x3a3d42), cx + (R + 0.12) * Math.cos(a), y1 + 1.5, cz + (R + 0.12) * Math.sin(a))); }
    for (const a of [-0.5, 0.5]) { const t = Math.atan2(sz, sx) + a; lamps.push(lampAt(cx + (R + 1.2) * Math.cos(t), y1 + 3.2, cz + (R + 1.2) * Math.sin(t), [1.0, 0.95, 0.86], 50, 24, 3.2)); }
    lamps.push(lampAt(cx + sx * (R + 6), 16, cz + sz * (R + 6), wrap[1], 110, 40, 0));   // the wrap's glow on the corner
  }
  return finish(parts, finishOf(grnd, 0.2), { boards, lamps, height: GLASS_H, floors: 11 });
}

/**
 * The vista drum (the research pass: SHIBUYA109, 150 m down the street from
 * the crossing): a silver cylinder, 10.5 m across and 47 m tall (less on a
 * smaller plot), hard-edged panels, a crown band over a recessed groove with
 * a magenta mark facing the crossing, a curved poster band below it, a column
 * of small dark slots, and two low pale-grey wings.
 */
export function buildTokyoVistaDrum(seed, hw, hd, h, ctx = {}) {
  const rnd = stream(seed, 0x1090), grnd = stream(seed, 0x1091);
  const parts = [], boards = [], lamps = [];
  const D = Math.min(10.5, 2 * Math.min(hw, hd) - 0.6), R = D / 2, H = Math.min(47, D * 4.5), CROWN = H * 0.8, WING = 8;
  const tw = ctx.toward ?? [1, 0], face = Math.atan2(tw[1], tw[0]), fx = Math.cos(face), fz = Math.sin(face);
  // the wings: two low blocks either side, at the back half
  parts.push(at(box(2 * hw, WING, 2 * hd, 0xa1abae), -fx * R * 0.3, WING / 2, -fz * R * 0.3));
  for (const f of faces(hw, hd)) shopPane(parts, f, 0, 2.2, f.w - 1.2, 3.6, WARM, 0.55);
  // the drum: 32 hard-edged panels, the body and the crown band apart, a dark groove between
  const seg = 32, body = new Shape(), band = new Shape(), groove = new Shape(), cap = new Shape();
  const ring = (s, y0, y1, r) => {
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * 2 * PI, a1 = ((k + 1) / seg) * 2 * PI, am = (a0 + a1) / 2;
      s.quad([r * Math.cos(a0), y0, r * Math.sin(a0)], [r * Math.cos(a1), y0, r * Math.sin(a1)], [r * Math.cos(a1), y1, r * Math.sin(a1)], [r * Math.cos(a0), y1, r * Math.sin(a0)], [Math.cos(am), 0, Math.sin(am)], [[k / seg * PI * r * 2, y0], [(k + 1) / seg * PI * r * 2, y0], [(k + 1) / seg * PI * r * 2, y1], [k / seg * PI * r * 2, y1]]);
    }
  };
  ring(body, WING, CROWN - 0.3, R);
  ring(groove, CROWN - 0.3, CROWN, R - 0.3);
  ring(band, CROWN, H, R);
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * 2 * PI, a1 = ((k + 1) / seg) * 2 * PI;
    cap.tri([0, H, 0], [R * Math.cos(a0), H, R * Math.sin(a0)], [R * Math.cos(a1), H, R * Math.sin(a1)], [0, 1, 0]);
    // the groove's lip, top and foot, so its recess is closed
    for (const [y, up] of [[CROWN, -1], [CROWN - 0.3, 1]]) groove.quad([(R - 0.3) * Math.cos(a0), y, (R - 0.3) * Math.sin(a0)], [(R - 0.3) * Math.cos(a1), y, (R - 0.3) * Math.sin(a1)], [R * Math.cos(a1), y, R * Math.sin(a1)], [R * Math.cos(a0), y, R * Math.sin(a0)], [0, up, 0]);
  }
  parts.push(shaped(body, 0xd9dde2, null, 1, 0, SURF.PAINT + 0.25), shaped(band, 0xe4e7ea, null, 1, 0, SURF.PAINT + 0.25), shaped(groove, 0x3a3d42), shaped(cap, 0x6d7074));
  // the mark on the crown band, facing the crossing, magenta at night
  {
    const w = D * 0.8, bh = w / 4.2, r = R + 0.06, x = fx * r, z = fz * r, yaw = Math.atan2(fx, fz), y = CROWN + (H - CROWN) * 0.55;
    parts.push(at(box(w + 0.2, bh + 0.2, 0.12, 0x141418, [1.0, 0.18, 0.8], 1.6), x - fx * 0.05, y, z - fz * 0.05, yaw));
    boards.push({ x: x + fx * 0.02, y, z: z + fz * 0.02, yaw, w, h: bh, kind: 'h', tile: H_TILE.mall });
    lamps.push(lampAt(fx * (R + 3), y - bh / 2 - 0.4, fz * (R + 3), [1.0, 0.3, 0.85], 80, 40, 2.6));
  }
  // the poster band on the crossing side, curved to the drum, 100 degrees of it
  {
    const Rs = R + 0.04, half = 0.87, sw = 2 * Rs * Math.sin(half), arc = 2 * Rs * half, crop = Math.min(1, arc / (2 * Math.min(CROWN - WING - 6, D * 1.2)));
    const yaw = Math.atan2(fx, fz), cx = fx * Rs * Math.cos(half), cz = fz * Rs * Math.cos(half);
    curvedScreen(parts, boards, cx, cz, yaw, WING + 1.0, sw, Math.floor(rnd() * 8), 6, { radius: Rs, crop, depth: 0.06 });
  }
  // a column of small dark slots on the crossing axis, below the poster
  for (let y = WING + 1.0 - 0.1; y > WING - 0.1 && y > 5; y -= 4.5) { /* the wings cover the drum's foot */ }
  lamps.push(lampAt(fx * (R + 10), 10, fz * (R + 10), [0.84, 0.9, 1.0], 90, 40, 0));
  return finish(parts, finishOf(grnd, 0.2), { boards, lamps, height: H, floors: 12 });
}

/* ========================================================== DISPATCHER */

/**
 * Every type, with the plot it needs (min frontage, min depth: below that a
 * forced type falls back to the walk-up rather than build a negative box)
 * and its triangle budget IN ITS NICHE -- the ceiling test/tokyoTypes.test.js
 * holds it to over 50 seeds (forced anywhere with ?tokyotype, the test's
 * ceiling is the walk-up's own worst). The walk-up's is the figure its own
 * test lives with.
 */
export const TOKYO_TYPES = {
  walkup:  { build: (s, hw, hd, h) => buildTokyoBuilding(s, hw, hd, h), min: [4, 4], budget: 12000 },
  tower:   { build: buildTokyoTower, min: [12, 12], budget: 6500 },
  pencil:  { build: buildTokyoPencil, min: [4, 6], budget: 2000 },
  mansion: { build: buildTokyoMansion, min: [9, 9], budget: 6000 },
  carpark: { build: buildTokyoCarPark, min: [16, 16], budget: 5500 },
  machiya: { build: buildTokyoMachiya, min: [3.5, 5], budget: 3200 },
  depato:  { build: buildTokyoDepato, min: [16, 12], budget: 2600 },
  // the Shibuya set pieces: never rolled, handed to the scramble's corners (ctx.hero) or forced with ?tokyotype
  qfront:    { build: buildTokyoQFront, min: [14, 14], budget: 6500 },
  signstack: { build: buildTokyoSignStack, min: [7, 7], budget: 2500 },
  screens:   { build: (s, hw, hd, h, ctx = {}) => buildTokyoSignStack(s, hw, hd, h, { ...ctx, variant: 'screens' }), min: [7, 7], budget: 3500 },
  addrum:    { build: buildTokyoAdDrum, min: [7, 7], budget: 3500 },
  // the sign-covered mid-rise of the streets round the crossing: rolled only near it (ctx.near, pickTokyoType)
  street:    { build: (s, hw, hd, h, ctx = {}) => buildTokyoSignStack(s, hw, hd, h, { ...ctx, variant: 'street' }), min: [7, 7], budget: 2500 },
  drum:      { build: buildTokyoVistaDrum, min: [9, 9], budget: 2500 },
};

/* ?tokyotype=machiya (etc.) builds every Little Tokyo plot as that type where
   it fits -- for checking a type in the game; ?tokyotype=walkup is the street
   as it was before this file. */
const FORCED = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('tokyotype') : null;

/**
 * Which type a plot gets. Pure. Weights against the walk-up's 1.0, each new
 * type only where its building makes sense:
 *   tower    the planner's tallest plots (h >= 70 m: the 'tower' blocks)
 *   pencil   a narrow frontage (<= 12 m: the 'row' blocks run 8.5-10.2)
 *   machiya  a small, LOW plot (h <= 23.5, <= 16 m front): the gaps in the wall
 *   mansion  the mid-rise plots (30-70 m)
 *   carpark  a deep, wide plot that is not a tower (both sides >= 16 m)
 *   depato   a big front on a mid/tall plot, nearly twice as likely on a corner
 * The roll comes from its own stream, so the walk-up a plot keeps is the
 * building it had before (same seed, same generator). Census over the real
 * district in test/tokyoTypes.test.js.
 */
export function pickTokyoType(seed, hw, hd, h, ctx = {}) {
  const force = ctx.force ?? FORCED ?? ctx.hero;   // ?tokyotype=walkup still shows the street as it was, heroes included
  const fits = (t) => TOKYO_TYPES[t] && 2 * hd >= TOKYO_TYPES[t].min[0] && 2 * hw >= TOKYO_TYPES[t].min[1];
  if (force && TOKYO_TYPES[force]) return fits(force) ? force : 'walkup';
  const F = 2 * hd, D = 2 * hw, small = Math.min(F, D);
  /* Within 160 m of the Shibuya crossing (ctx.near, districtWorld) the street
     is the photos': sign-covered mid-rises, pencils, the odd walk-up or store
     -- no office tower, mansion, car park or machiya. Its own stream. */
  if (ctx.near != null) {
    const wn = { street: 1.4, walkup: small >= 40 ? 0 : 0.5 };
    if (F <= 12) wn.pencil = 0.9;
    if (F >= 22 && D >= 16) wn.depato = 0.3;
    /* Past the crossing's own streets (Arun, 2026-09-24: "new builds are great
       but again we have old buildings which's pulling down") the same stream
       runs the whole district, with the skyline kept: office towers on the
       tallest plots, the odd mansion block among the mid-rises. */
    if (ctx.near >= 160) {
      if (wn.walkup) wn.walkup = 0.35;
      if (h >= 70 && small >= 12) wn.tower = ctx.block === 'tower' ? 1.4 : 1.0;
      if (F >= 11 && h >= 40 && h < 70) wn.mansion = 0.25;
    }
    const names = Object.keys(wn).filter(fits);
    let sum = 0; for (const k of names) sum += wn[k];
    let r = stream(seed, 0x5b1a)() * sum;
    for (const k of names) { r -= wn[k]; if (r < 0) return k; }
    return fits('street') ? 'street' : 'walkup';
  }
  let corner = false;
  if (ctx.probe) corner = ctx.probe(0, hd + 4) < 3 || ctx.probe(0, -hd - 4) < 3;
  /* A walk-up stretched over a 99 m plot is 17,788 triangles of one window
     repeated (the district's worst building, measured): a plot that big is a
     tower on a podium or a store. */
  const w = { walkup: small >= 40 ? 0.15 : 1 };
  if (h >= 70 && small >= 12) w.tower = ctx.block === 'tower' ? 1.6 : 1.2;
  if (F <= 12 && h >= 14) w.pencil = 0.8;
  if (F <= 16 && D <= 30 && h <= 23.5) w.machiya = 0.8;
  if (F >= 11 && h >= 30 && h < 70) w.mansion = 0.7;
  if (small >= 16 && h < 62) w.carpark = 0.4;
  if (F >= 22 && D >= 16 && h >= 30) w.depato = corner ? 0.55 : 0.3;
  const names = Object.keys(w).filter(fits);
  let sum = 0;
  for (const k of names) sum += w[k];
  let r = stream(seed, 0x70c1)() * sum;
  for (const k of names) { r -= w[k]; if (r < 0) return k; }
  return 'walkup';
}

/**
 * Build one Little Tokyo plot: pick its type and build it. Returns the
 * buildTokyoBuilding record plus `type`.
 *   ctx.probe(bx, bz)  signed tarmac depth at a point in the BUILDING's frame
 *                      (+X street): the corner-seeking types use it
 *   ctx.block          the block type ('row' | 'mid' | 'tower')
 *   ctx.force          a type name, overriding the roll (tests, ?tokyotype)
 */
export function buildTokyoLot(seed, hw, hd, h, ctx = {}) {
  const type = pickTokyoType(seed, hw, hd, h, ctx);
  const b = TOKYO_TYPES[type].build(seed, hw, hd, h, ctx);
  b.type = type;
  return b;
}
