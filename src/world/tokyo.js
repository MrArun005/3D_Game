import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { attribute, materialReference, time, sin, step, mix, float, uv, texture, vec2, vec3, floor, fract, min, max, abs, smoothstep, select, normalMap, normalView, positionWorld, fwidth } from 'three/tsl';
import { mulberry32 } from '../core/rng.js';
import { setTokyoSignNight } from './tokyoSigns.js';
import { cv, toTex, normalFromCanvas } from './textures.js';

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
 * One building is one merged geometry: faces (the Quads writer below: only
 * the faces that can be seen) plus painted boxes and cylinders, every part
 * carrying real UVs (rule 4) and two per-vertex attributes -- `color`
 * (albedo) and `emit` (what glows at night: lit windows, shopfront glass,
 * neon, the kanban faces). Every building in a chunk merges into ONE mesh
 * drawn with ONE material (tokyoFacadeMaterial: vertex colour + emissive from
 * the `emit` attribute), so a whole district of them is one draw per chunk.
 *
 * Triangles, measured 2026-09-23 after the facade pass (recessed windows,
 * bands, cornices, pilasters, balconies, a set-back or glazed top storey, the
 * roof kit, the ground floor fixed): on the district's own 219 Little Tokyo
 * footprints mean 3504 -> 4416 a building, max 18390 -> 18206, all of them
 * together 0.77M -> 0.97M; over 200 seeds of test/tokyo.test.js's spread,
 * mean 2770 -> 3499, max 8972 -> 10352. Generation time did not move
 * (~5.4 ms a building either way, node, four interleaved runs within 5%):
 * the extra faces cost what skipping BoxGeometry and mergeGeometries saves.
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
  // 2026-09-24: real colour -- tile teal, terracotta, sand, slate blue, sage, clay, charcoal, ochre (was eight greys)
  [0x2f5d58, 0x21423e], [0x9a6b5e, 0x734f45], [0xa89a82, 0x857a66], [0x4d5a66, 0x37414a],
  [0x46604e, 0x324538], [0x8c7a64, 0x6b5d4c], [0x2a2c33, 0x1c1e23], [0x9c7a56, 0x78603f],
];
/* The pale masses of the Shibuya day stills: stone, blue-grey and cream, about
   half a stop over the brightest wall above -- not the first pass's 1.5 stops.
   Office slabs with ribbon glass wear these; a few others do too. */
const LIGHT = [[0xc9c3b6, 0xa39e92], [0xb3c0c8, 0x8e9aa2], [0xd2c4a2, 0xab9f82]];
const MAGENTA = [1.0, 0.25, 0.75], CYAN = [0.2, 0.9, 1.0];
// weighted by repetition: the cover art is six parts magenta/cyan to four of everything else
const NEON = [MAGENTA, CYAN, MAGENTA, CYAN, MAGENTA, CYAN, [1.0, 0.85, 0.2], [0.95, 0.95, 1.0], [1.0, 0.3, 0.2], [0.5, 1.0, 0.4]];
const WARM = [1.0, 0.82, 0.55], COOL = [0.72, 0.85, 1.0];
const _c = new THREE.Color();

/* Surface kinds for tokyoFacadeMaterial (2026-09-23, the owner's "GTA level
   visualization"). The street read as untextured boxes: one vertex colour per
   part, the same roughness on a wall, a window and an air-con unit, and
   windows that were flat navy squares. One float per vertex, constant over a
   part: the integer is the kind, the fraction a variant, kept inside
   0.05..0.85 so floor() cannot straddle an integer after interpolation.
     0 LEGACY  no attribute (the kit towers merged into the same mesh): as before
     1 WALL    tile or plaster detail at METRE UVs, the building picks which
     2 GLASS   normalised UVs: frame, transom, curtains or blinds; smooth enough
               to hold the sky, which is most of what a GTA window is
     3 PAINT   metal, plastic, sign boxes: smooth, no detail texture. Its
               fraction picks a painted pattern (PAINT_VARIANT, 2026-09-23):
               0.05 plain, 0.25 1 m panel seams, 0.45 8 cm ribs, 0.65 12 cm
               slats -- so every PAINT part made before still reads plain */
export const SURF = { LEGACY: 0, WALL: 1, GLASS: 2, PAINT: 3, DISPLAY: 4, SASH: 5 };   // DISPLAY: a lit shop window with its stock; SASH: a painted timber sash window (tokyoFacadeMaterial)

/** Add `color`, `emit`, `flick` and `surf` attributes to a geometry, flat. `flick` > 0 marks a part whose glow buzzes (the phase is the value). */
function paint(geo, hex, emit = null, k = 1, flick = 0, surf = SURF.PAINT + 0.05) {
  _c.setHex(hex);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3), em = new Float32Array(n * 3), fl = new Float32Array(n), sf = new Float32Array(n).fill(surf);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    if (emit) { em[i * 3] = emit[0] * k; em[i * 3 + 1] = emit[1] * k; em[i * 3 + 2] = emit[2] * k; }
    fl[i] = flick;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('emit', new THREE.BufferAttribute(em, 3));
  geo.setAttribute('flick', new THREE.BufferAttribute(fl, 1));
  geo.setAttribute('surf', new THREE.BufferAttribute(sf, 1));
  return geo;
}
/* Metre UVs. BoxGeometry spans 0..1 on each of its six faces whatever its
   size, so a detail texture would stretch one tile across a 30 m wall. Face
   order px nx py ny pz nz, four vertices each: +-X faces run u along depth,
   +-Y along width (v along depth), +-Z along width; v is height on the sides. */
function metreBox(geo, w, h, d) {
  const uv = geo.attributes.uv, per = uv.count / 6;
  const S = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let i = 0; i < uv.count; i++) { const s = S[Math.floor(i / per)]; uv.setXY(i, uv.getX(i) * s[0], uv.getY(i) * s[1]); }
  return geo;
}
function metrePlane(geo, w, h) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
  return geo;
}
/** A flicker phase for a part, or 0: about one glowing part in seven buzzes. */
const flickerOf = (rnd) => (rnd() < 0.15 ? 0.5 + rnd() * 6 : 0);
/** A box: WALL (detail texture) unless it glows or `surf` says otherwise -- a lightbox is plastic, not plaster. */
const box = (w, h, d, hex, emit, k, flick, surf = emit ? SURF.PAINT : SURF.WALL) => paint(metreBox(new THREE.BoxGeometry(w, h, d), w, h, d), hex, emit, k, flick, surf + 0.05);
/** Painted metal: air-con units, rails, brackets, frames. */
const metal = (w, h, d, hex) => box(w, h, d, hex, null, 1, 0, SURF.PAINT);
const cyl = (r, h, hex, seg = 10) => paint(new THREE.CylinderGeometry(r, r, h, seg), hex);
/** A quad facing +Z in its own frame, then turned to face `ry` about Y and moved. */
const quad = (w, h, hex, emit, k, flick, surf = SURF.WALL) => paint(metrePlane(new THREE.PlaneGeometry(w, h), w, h), hex, emit, k, flick, surf + 0.05);
/** A pane of glass: normalised UVs for the frame, `r` (0..1, seeded per window) picks curtains, blinds or clear. */
const glass = (w, h, hex, emit, k, r) => paint(new THREE.PlaneGeometry(w, h), hex, emit, k, 0, SURF.GLASS + 0.05 + 0.8 * r);
/** A lit shop window with its stock (SURF.DISPLAY, drawn by tokyoFacadeMaterial): `hex` is the shop's light, `r` seeds the shelves. */
const display = (w, h, hex, emit, k, r) => paint(new THREE.PlaneGeometry(w, h), hex, emit, k, 0, SURF.DISPLAY + 0.05 + 0.8 * r);
/** One finish per building: every upright WALL face takes `variant` (< 0.45 plaster, >= 0.45 tile); tops take plaster. */
function wallFinish(geo, variant) {
  const s = geo.attributes.surf, n = geo.attributes.normal;
  for (let i = 0; i < s.count; i++) {
    if (Math.floor(s.getX(i)) !== SURF.WALL) continue;
    s.setX(i, SURF.WALL + (Math.abs(n.getY(i)) > 0.5 ? 0.1 : variant));
  }
}
/** Give a geometry built elsewhere (the kit towers) the attribute the Tokyo mesh merges on: LEGACY, drawn as it always was. */
export function ensureSurf(geo) {
  if (!geo.attributes.surf) geo.setAttribute('surf', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count), 1));
  return geo;
}
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

/** faces() about another centre: the set-back top storey and the penthouse are boxes of their own. */
const facesAt = (cx, cz, hw, hd) => faces(hw, hd).map((f) => ({ ...f, cx, cz }));

/* ---- Faces, not boxes (2026-09-23, "the buildings still read as boxes") ----
   A window with depth is a hole: four reveals, the glass at the back of them
   and a sill in front. Built from BoxGeometry that is a dozen boxes a window,
   six faces each where one or two can ever be seen -- and every one a
   BufferGeometry through mergeGeometries, which was already most of the
   ~6 ms a building took to generate. `Quads` writes faces straight into flat
   arrays carrying the attribute set paint() gives (position, normal, uv,
   color, emit, flick, surf -- so the kit towers, the shrine and the street
   poles still merge with it) and emits only the faces it is told to. Every
   quad has metre UVs, projected flat, so the tile courses run on unbroken
   across a band, a pier and the next band; and every quad is wound to face
   the normal it is given -- the winding is computed, not assumed (the first
   tank track was inside out). */
const lin = (hex) => { _c.setHex(hex); return [_c.r, _c.g, _c.b]; };
/** Metre UVs by planar projection: an upright face runs u along it (to the right seen from outside) and v up; a flat one takes x/z. `o` moves the origin (a panel tank's seams start at its corner). */
function muv(p, n, o) {
  const x = p[0] - (o ? o[0] : 0), y = p[1] - (o ? o[1] : 0), z = p[2] - (o ? o[2] : 0);
  return Math.abs(n[1]) > 0.5 ? [x, n[1] > 0 ? -z : z] : [x * n[2] - z * n[0], y];
}
/* A point on a face (faces() above; facesAt() adds a centre): `a` along it,
   `o` proud of its plane -- negative is into the wall. */
const fX = (f, a, o) => (f.cx ?? 0) + f.n[0] * (f.off + o) + f.t[0] * a;
const fZ = (f, a, o) => (f.cz ?? 0) + f.n[1] * (f.off + o) + f.t[1] * a;
const AXIS = { X: [1, 0, 0], x: [-1, 0, 0], Y: [0, 1, 0], y: [0, -1, 0], Z: [0, 0, 1], z: [0, 0, -1] };
/* The surf values the new parts use (SURF + the variant fraction). PAINT's
   fraction picks a pattern tokyoFacadeMaterial draws (PAINT_VARIANT). */
export const PAINT_VARIANT = { PLAIN: 0.05, PANEL: 0.25, RIBS: 0.45, SLATS: 0.65 };
const S_WALL = SURF.WALL + 0.05, S_PAINT = SURF.PAINT + PAINT_VARIANT.PLAIN;
const S_PANEL = SURF.PAINT + PAINT_VARIANT.PANEL, S_RIBS = SURF.PAINT + PAINT_VARIANT.RIBS, S_SLATS = SURF.PAINT + PAINT_VARIANT.SLATS;

class Quads {
  constructor() { this.P = []; this.N = []; this.U = []; this.C = []; this.E = []; this.L = []; this.S = []; this.I = []; this.n = 0; }
  /** One quad: four corners in order round it, their UVs, the outward normal it must face (the winding is turned to match), and paint. */
  quad(c, uv, n, rgb, emit, flick, surf) {
    const a = c[0], b = c[1], d = c[3];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const flip = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] < 0;
    for (let i = 0; i < 4; i++) {
      const p = c[i];
      this.P.push(p[0], p[1], p[2]); this.N.push(n[0], n[1], n[2]); this.U.push(uv[i][0], uv[i][1]);
      this.C.push(rgb[0], rgb[1], rgb[2]);
      if (emit) this.E.push(emit[0], emit[1], emit[2]); else this.E.push(0, 0, 0);
      this.L.push(flick); this.S.push(surf);
    }
    const k = this.n;
    if (flip) this.I.push(k, k + 2, k + 1, k, k + 3, k + 2); else this.I.push(k, k + 1, k + 2, k, k + 2, k + 3);
    this.n += 4;
  }
  /** The face of an axis-aligned box that looks along `n`. */
  face(x0, x1, y0, y1, z0, z1, n, rgb, emit, flick, surf, org) {
    let c;
    if (n[0]) { const x = n[0] > 0 ? x1 : x0; c = [[x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]]; }
    else if (n[1]) { const y = n[1] > 0 ? y1 : y0; c = [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]]; }
    else { const z = n[2] > 0 ? z1 : z0; c = [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]]; }
    this.quad(c, c.map((p) => muv(p, n, org)), n, rgb, emit, flick, surf);
  }
  /** An axis-aligned box in the building's frame, only the faces in `mask` (X x Y y Z z = +X -X ...). */
  box(x0, x1, y0, y1, z0, z1, hex, surf, mask, emit = null, flick = 0, org = null) {
    const rgb = lin(hex);
    for (const ch of mask) this.face(x0, x1, y0, y1, z0, z1, AXIS[ch], rgb, emit, flick, surf, org);
  }
  /**
   * A box on face `f`: `a0..a1` along it, `y0..y1` up, `o0..o1` out from its
   * plane. `mask` in the face's own terms: F out, B in, L/R toward -/+ along,
   * T top, D underside. A reveal is the L or R of the pier beside the glass.
   */
  fbox(f, a0, a1, y0, y1, o0, o1, hex, surf, mask, emit = null, flick = 0) {
    const xa = fX(f, a0, o0), xb = fX(f, a1, o1), za = fZ(f, a0, o0), zb = fZ(f, a1, o1);
    const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), z0 = Math.min(za, zb), z1 = Math.max(za, zb);
    const rgb = lin(hex), n = f.n, t = f.t;
    for (const ch of mask) {
      const d = ch === 'F' ? [n[0], 0, n[1]] : ch === 'B' ? [-n[0], 0, -n[1]] : ch === 'R' ? [t[0], 0, t[1]] : ch === 'L' ? [-t[0], 0, -t[1]] : ch === 'T' ? [0, 1, 0] : [0, -1, 0];
      this.face(x0, x1, y0, y1, z0, z1, d, rgb, emit, flick, surf);
    }
  }
  /** A pane on face `f` at depth `o`: normalised UVs for the glass shader's frame, `r` its curtains. */
  glass(f, a0, a1, y0, y1, o, hex, emit, k, r) {
    const c = [[fX(f, a1, o), y0, fZ(f, a1, o)], [fX(f, a0, o), y0, fZ(f, a0, o)], [fX(f, a0, o), y1, fZ(f, a0, o)], [fX(f, a1, o), y1, fZ(f, a1, o)]];
    this.quad(c, [[0, 0], [1, 0], [1, 1], [0, 1]], [f.n[0], 0, f.n[1]], lin(hex), emit ? [emit[0] * k, emit[1] * k, emit[2] * k] : null, 0, SURF.GLASS + 0.05 + 0.8 * r);
  }
  /**
   * A rectangular ring about (cx, cz): outer half sizes ox/oz, inner ix/iz,
   * y0..y1. mask: T top, D underside, O outer walls, I inner walls. Floor
   * bands, cornices, parapets, copings, fences: 8 triangles a side at most,
   * no corner where two boxes overlap and fight.
   */
  ring(cx, cz, ox, oz, ix, iz, y0, y1, hex, surf, mask) {
    const rgb = lin(hex);
    const flat = (y, up) => {
      const n = [0, up ? 1 : -1, 0];
      for (const q of [[[ix, iz], [ox, oz], [ox, -oz], [ix, -iz]], [[-ix, -iz], [-ox, -oz], [-ox, oz], [-ix, iz]],
        [[-ix, iz], [-ox, oz], [ox, oz], [ix, iz]], [[ix, -iz], [ox, -oz], [-ox, -oz], [-ix, -iz]]]) {
        const c = q.map(([x, z]) => [cx + x, y, cz + z]);
        this.quad(c, c.map((p) => muv(p, n)), n, rgb, null, 0, surf);
      }
    };
    if (mask.includes('T')) flat(y1, true);
    if (mask.includes('D')) flat(y0, false);
    if (mask.includes('O')) for (const ch of 'XxZz') this.face(cx - ox, cx + ox, y0, y1, cz - oz, cz + oz, AXIS[ch], rgb, null, 0, surf);
    if (mask.includes('I')) {
      this.face(cx + ix, cx + ix, y0, y1, cz - iz, cz + iz, AXIS.x, rgb, null, 0, surf);
      this.face(cx - ix, cx - ix, y0, y1, cz - iz, cz + iz, AXIS.X, rgb, null, 0, surf);
      this.face(cx - ix, cx + ix, y0, y1, cz + iz, cz + iz, AXIS.z, rgb, null, 0, surf);
      this.face(cx - ix, cx + ix, y0, y1, cz - iz, cz - iz, AXIS.Z, rgb, null, 0, surf);
    }
  }
  /** A square-section member from a to b, `t` thick, sides only (8 triangles): masts, lattice braces, struts. */
  beam(a, b, t, hex, surf = S_PAINT) {
    let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-6) return;
    dx /= L; dy /= L; dz /= L;
    let ux = 1, uz = 0;
    if (Math.abs(dy) < 0.95) { const k = Math.hypot(dx, dz); ux = -dz / k; uz = dx / k; }   // d x up: level, across the member
    const vx = -uz * dy, vy = uz * dx - ux * dz, vz = ux * dy;                           // u x d
    const h = t / 2, rgb = lin(hex);
    for (const [nx, ny, nz, ex, ey, ez] of [[ux, 0, uz, vx, vy, vz], [vx, vy, vz, -ux, 0, -uz], [-ux, 0, -uz, -vx, -vy, -vz], [-vx, -vy, -vz, ux, 0, uz]]) {
      const c = [];
      for (const [p, s] of [[a, -1], [a, 1], [b, 1], [b, -1]]) c.push([p[0] + (nx + s * ex) * h, p[1] + (ny + s * ey) * h, p[2] + (nz + s * ez) * h]);
      this.quad(c, [[0, 0], [t, 0], [t, L], [0, L]], [nx, ny, nz], rgb, null, 0, surf);
    }
  }
  /** A paint()ed geometry, already placed: appended as it is. */
  geo(g) {
    const A = g.attributes, k = this.n, cnt = A.position.count;
    const cp = (dst, src) => { for (let i = 0; i < src.length; i++) dst.push(src[i]); };
    cp(this.P, A.position.array); cp(this.N, A.normal.array); cp(this.U, A.uv.array);
    cp(this.C, A.color.array); cp(this.E, A.emit.array); cp(this.L, A.flick.array); cp(this.S, A.surf.array);
    if (g.index) { const ix = g.index.array; for (let i = 0; i < ix.length; i++) this.I.push(ix[i] + k); }
    else for (let i = 0; i < cnt; i++) this.I.push(k + i);
    this.n += cnt;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.P), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.N), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.U), 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.C), 3));
    g.setAttribute('emit', new THREE.BufferAttribute(new Float32Array(this.E), 3));
    g.setAttribute('flick', new THREE.BufferAttribute(new Float32Array(this.L), 1));
    g.setAttribute('surf', new THREE.BufferAttribute(new Float32Array(this.S), 1));
    g.setIndex(new THREE.BufferAttribute(this.n > 65535 ? new Uint32Array(this.I) : new Uint16Array(this.I), 1));
    return g;
  }
}

const LAUNDRY = [0xf2f2ee, 0x9fc2e0, 0xe8a0b4, 0xf0d890, 0x6f8fb0, 0xd9d9d0];
const GREENS = [0x3f6b34, 0x4f7a3a, 0x2f5a30, 0x5d7f3f];

/**
 * Build one building. Returns { geo, boards, lamps, height, floors, tris, style }.
 *   hw, hd   half footprint along local X (street axis) and Z
 *   h        the planner's height; snapped to whole storeys
 * boards: [{ x, y, z, yaw, w, h, kind, vertical? }] in the local frame for the Tokyo atlas.
 * style: what was rolled (window style, cornice, top storey, roof kit...), for tests and screenshots.
 */
/* Lamp intensities are HALVED from the first pass (2026-09-14): 150-220 against
   the pool's own default of 60 meant a wall 3 m from a kanban was floodlit, and
   the building beside the camera read at mean luminance 0.445 where the
   reference still is 0.211 -- a green wall lit green, not a dark wall wearing a
   green sign. The sign should be the bright thing; the wall it hangs on should
   be what the sign is bright AGAINST. */
export function buildTokyoBuilding(seed, hw, hd, h) {
  const rnd = mulberry32((seed * 2654435761) >>> 0);
  const grnd = mulberry32((seed * 2246822519 + 0x27d4eb2f) >>> 0);   // the glass's own stream: curtains, blinds (rnd's sequence, i.e. the layout, is untouched)
  /* The structure's own stream (2026-09-23): window style, bands, cornice,
     columns, the top storey, balconies, pipes and the roof kit. Its own, so
     retuning a roof never re-rolls which windows are lit or which sign goes up. */
  const frnd = mulberry32((seed * 3266489917 + 0x165667b1) >>> 0);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const fpick = (a) => a[Math.floor(frnd() * a.length)];
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
  const F = faces(hw, hd), front = F[0], bk = F[1];
  const Q = new Quads();
  const recess = 1.35;

  /* 0. THE STRUCTURE (2026-09-23). The owner's screenshots: "flat window
     squares on flat walls". Every storey above the shops is now a skin with
     holes in it -- a band under the sills, piers between the windows, a band
     over the heads -- standing R (0.12-0.18 m) proud of the glass, so each
     window has four reveals that catch the sun on one side and shade on the
     other, the thing that makes a GTA IV facade read as built. Behind the
     glass a core box stands 6 cm further in, so a hairline crack at a
     T-junction in the skin shows wall, never sky. The street and both kerb
     faces are skinned; the back (the block's interior, the face least seen)
     keeps flat glass 3.5 cm proud and a flat wall -- it is a third of the
     windows and would be a third of the cost. Per building, rolled on frnd:
       window     punched (the old rhythm), paired (two lights, a mullion) or
                  strip (the office ribbon); sides punched, or strip on half
                  the strip-fronted
       sills      projecting precast sills on the street face, 4 in 5
       bands      a slab-edge band with a real overhang every storey, every
                  third, or only over the shops
       cornice    a stepped cornice, a deep slab edge, or a plain coping
       columns    corner pilasters proud of both faces, 3 in 10
       top        a set-back top storey on a terrace, or a glazed penthouse
       balconies  a continuous "mansion" balcony run on residential street
                  faces, slab + balustrade, with the AC unit, laundry and
                  pots that are on every one of them in Tokyo
     Measured over 200 seeds at the district's own footprints: see the header. */
  const R = 0.12 + frnd() * 0.06, Rc = R + 0.06;
  const frontWin = ribbon ? 'strip' : residential ? (frnd() < 0.55 ? 'punched' : 'paired') : fpick(['punched', 'paired', 'strip']);
  const sideWin = frontWin === 'strip' ? (frnd() < 0.5 ? 'strip' : 'punched') : frontWin === 'paired' && frnd() < 0.5 ? 'paired' : 'punched';
  const sills = frontWin !== 'strip' && frnd() < 0.8;
  const showroom = !residential && frontWin !== 'strip' && frnd() < 0.3;   // an office slab's first floor glazed end to end: a cafe, a showroom
  const bandMode = fpick(['every', 'every', 'third', 'third', 'first']);
  const bandH = 0.17 + frnd() * 0.03, bandP = 0.08 + frnd() * 0.05;   // never 0.16: the colonnade soffit's underside is at GROUND_H - 0.16
  const cornice = fpick(['step', 'slab', 'coping']);
  const cH = cornice === 'slab' ? 0.26 : 0.22, cP = cornice === 'slab' ? 0.26 + frnd() * 0.1 : 0.17;
  const columns = frnd() < 0.3, colC = 0.42 + frnd() * 0.12, colP = 0.16;   // colP clears every band (<= 0.13) so bands die into the pilaster
  const colHex = columns && frnd() < 0.5 ? fpick(LIGHT)[1] : band;
  let top = floors >= 6 && frnd() < 0.14 ? 'penthouse' : floors >= 5 && frnd() < 0.2 ? 'setback' : null;
  const sbF = 1.6 + frnd() * 0.8, sbS = 0.5 + frnd() * 0.4, sbP = 1.0 + frnd() * 0.6;
  if (top === 'setback' && (2 * hw - sbF - sbS < 3.6 || 2 * hd - 2 * sbS < 3.6)) top = null;
  if (top === 'penthouse' && (2 * hw - 2 * sbP < 3.6 || 2 * hd - 2 * sbP < 3.6)) top = null;
  const sTop = top ? floors - 2 : floors - 1;   // the main mass's last storey
  const Hm = floorY(sTop + 1);                   // its roof; H itself when there is no top storey
  const frontBalc = residential && hd >= 4.4 && frnd() < 0.7;
  const balcStyle = fpick(['solid', 'panel', 'louvre']);
  const ph = 0.55 + frnd() * 0.45;               // parapet
  const margin = columns ? colC + 0.22 : 0.6;    // a face's first window from its corner

  /* Openings along a face, [-w/2 + margin, w/2 - margin], sorted: punched (a
     bay per 2.4 m on the street, 3.4 m elsewhere, the glass 55% of it),
     paired (two lights either side of a 0.24 m mullion, a group per 1.8
     bays) or strip (one opening the run of the face, a pane per bay: the
     glass shader's frame draws the mullions). */
  const layout = (w, style, pitch0) => {
    const u0 = -w / 2 + margin, u1 = w / 2 - margin, L = u1 - u0, out = [];
    if (style === 'strip') {
      const n = Math.max(1, Math.round(L / pitch0)), panes = [];
      for (let i = 0; i < n; i++) panes.push([u0 + (L * i) / n, u0 + (L * (i + 1)) / n]);
      out.push({ a0: u0, a1: u1, panes, strip: true });
    } else if (style === 'paired') {
      const nG = Math.max(1, Math.floor(L / (pitch0 * 1.8) + 0.3)), pg = L / nG, ww = Math.min(1.2, pg * 0.3);
      for (let g = 0; g < nG; g++) {
        const c = u0 + pg * (g + 0.5);
        for (const s of [-1, 1]) { const m = c + s * (0.12 + ww / 2); out.push({ a0: m - ww / 2, a1: m + ww / 2 }); }
      }
    } else {
      const n = Math.max(1, Math.floor(L / pitch0 + 0.3)), p = L / n, ww = Math.min(1.4, p * 0.55);
      for (let b = 0; b < n; b++) { const c = u0 + p * (b + 0.5); out.push({ a0: c - ww / 2, a1: c + ww / 2 }); }
    }
    for (const o of out) o.panes ??= [[o.a0, o.a1]];
    return out;
  };

  /* The street face's plan, rolled BEFORE the facade: the balconies have to
     know which storeys carry tenant boards and where the video screen hangs. */
  const endA = rnd() < 0.5 ? -1 : 1, endB = -endA;
  const signColor = neon ?? pick(NEON);
  const stairs = floors >= 3 && rnd() < 0.3;
  const shuttered = rnd() < 0.18;
  let screen = null;
  {
    const want = floors >= 12 ? rnd() < 0.7 : floors >= 7 ? rnd() < 0.35 : false;
    const bw = Math.min(2 * hd - 4.8, floors >= 12 ? 12 : 9), bh = bw / 2;   // 4.8: the bezel clears a tall kanban at end A
    const sb = Math.max(2, Math.floor(floors * 0.45));
    if (want && bw >= 4.5 && sb <= sTop && floorY(sb) + bh + 0.8 < Hm) screen = { bw, bh, sb, by: floorY(sb) + 0.3 + bh / 2 };
  }
  const frontReg = layout(front.w, frontWin, 2.4);
  // the balcony run: the street face's middle bays, clear of the kanban at both ends (end A's flat board reaches hd - 2.15)
  const run = frontBalc ? frontReg.filter((o) => Math.max(Math.abs(o.a0), Math.abs(o.a1)) <= hd - 2.65) : [];
  const runA0 = run.length ? Math.max(-(hd - 2.2), run[0].a0 - 0.45) : 0, runA1 = run.length ? Math.min(hd - 2.2, run[run.length - 1].a1 + 0.45) : 0;
  const tenants = [];   // storeys with a tenant lightbox in the spandrel
  const tw = Math.min(3.0, (2 * hd - 3.5) * 0.8), tz = endA * -0.45;
  if (tw >= 1.6 && rnd() < 0.75) {
    const last = Math.min(screen ? screen.sb - 1 : floors, sTop, run.length ? 3 : 9);   // a residential slab lets two or three floors of offices, then it is flats
    for (let st = 1; st <= last; st++) if (rnd() >= 0.2) tenants.push(st);
  }
  const balcS = new Set();
  if (run.length) {
    for (let s = Math.max(2, (tenants.length ? tenants[tenants.length - 1] : 0) + 1); s <= sTop; s++) {
      if (screen && floorY(s) - 0.3 < screen.by + screen.bh / 2 + 0.3 && floorY(s) + 2.0 > screen.by - screen.bh / 2 - 0.3) continue;
      balcS.add(s);
    }
  }
  const winLit = () => (rnd() < 0.3 ? (rnd() < 0.7 ? WARM : COOL) : null);

  // 1. GROUND FLOOR: the recessed colonnade and the mass behind it
  /* The open shop's room used to sit INSIDE the ground-floor mass: the mass
     ran to hw - recess and the room's back wall stood 1.2 m behind that, so
     from the street every "room you can see into" was a flat wall with a lamp
     in front of it. The mass now stops behind the room, and two end walls
     close its sides. Shuttered fronts keep the old line. */
  const roomD = recess - 0.15;
  const massX1 = shuttered ? hw - recess : hw - recess - roomD;
  parts.push(at(box(massX1 + hw, GROUND_H, 2 * hd, wall), (massX1 - hw) / 2, GROUND_H / 2, 0));
  if (!shuttered) {
    Q.box(massX1, hw - recess, 0, GROUND_H, hd - 0.4, hd, wall, S_WALL, 'XZz');
    Q.box(massX1, hw - recess, 0, GROUND_H, -hd, -hd + 0.4, wall, S_WALL, 'XZz');
  }
  /* Colonnade soffit ceiling, exactly the colonnade now: it ran 2 cm past
     the facade on three sides and 2 cm into the mass, and wherever two faces
     share a plane they fight. The first-floor band covers its outer edge. */
  parts.push(at(box(recess, 0.16, 2 * hd, band), hw - recess / 2, GROUND_H - 0.08, 0));
  // Structural support pillars along curb line X = hw - 0.22
  const numPillars = Math.max(2, Math.floor(2 * hd / 4.0) + 1);
  for (let p = 0; p < numPillars; p++) {
    const pz = -hd + 0.5 + (p / (numPillars - 1)) * (2 * hd - 1.0);
    parts.push(at(box(0.44, GROUND_H - 0.16, 0.44, band), hw - 0.22, (GROUND_H - 0.16) / 2, pz));   // up to the soffit's underside, not through it
    parts.push(at(box(0.50, 0.35, 0.50, 0x14161a), hw - 0.22, 0.175, pz));
  }
  /* A stepped plinth round the back and both sides (the street side is the
     colonnade): 0.34 m at 0.10 out, then 0.13 m at 0.15, the lower step
     running 6 cm further toward the street. Every offset is chosen off
     another part's plane -- the kerb faces' stallrisers and shutters stand
     0.08 out and the corner pilasters 0.16, and a shared plane is a z-fight. */
  for (const [o, ph0, end] of [[0.1, 0.34, 0.5], [0.15, 0.13, 0.44]]) {
    Q.box(-hw - o, -hw, 0, ph0, -hd - o, hd + o, band, S_WALL, 'xYZz');
    Q.box(-hw, hw - end, 0, ph0, hd, hd + o, band, S_WALL, 'ZYX');
    Q.box(-hw, hw - end, 0, ph0, -hd - o, -hd, band, S_WALL, 'zYX');
  }

  // 2. THE UPPER STOREYS: skinned street and kerb faces, a flat back
  const acs = [], smallBalc = [];
  /* One skinned face: A0..A1 is its run (the street face owns both front
     corners; the kerb faces stop at its inner plane), cap0/cap1 the depth of
     the end closing the corner strip (R where it meets a skin, Rc where it
     meets the flat back, so the slot between skin and core is shut). */
  const skin = (fi, A0, A1, cap0, cap1) => {
    const f = F[fi], p0 = fi === 0 ? 2.4 : 3.4;
    const reg = fi === 0 ? frontReg : layout(f.w, sideWin, p0);
    const alt = showroom ? layout(f.w, 'strip', p0) : null;
    const rows = [];
    for (let s = 1; s <= sTop; s++) {
      const fy = floorY(s), O = [];
      for (const o of s === 1 && alt ? alt : reg) {
        let sill = fy + (o.strip ? 0.65 : 0.9), door = false;
        if (fi === 0) { if (balcS.has(s) && run.includes(o)) { sill = fy + 0.05; door = true; } }
        else if (!o.strip && s >= 3) {
          // storey 3 up: the kerb kanban reach ~10 m. A small balcony on a flat, or an air-con unit under the window
          const r = frnd();
          if (residential && s >= 4 && r < 0.16) { sill = fy + 0.05; door = true; smallBalc.push({ f, a0: o.a0, a1: o.a1, fy }); }
          else if (r > 0.82) acs.push({ f, a: (o.a0 + o.a1) / 2 + (frnd() - 0.5) * 0.3, fy });
        }
        O.push({ a0: o.a0, a1: o.a1, panes: o.panes, strip: !!o.strip, sill, head: fy + 2.2, door });
      }
      let sm = Infinity;
      for (const o of O) sm = Math.min(sm, o.sill);
      rows.push({ O, sillMin: sm, headMax: fy + 2.2 });
    }
    // bands: GROUND_H up to the first sills, head to sill between storeys, the last heads up to the roof. Their undersides and tops are the head and sill reveals.
    for (let i = 0; i <= rows.length; i++) {
      const y0 = i === 0 ? GROUND_H : rows[i - 1].headMax, y1 = i === rows.length ? Hm : rows[i].sillMin;
      Q.fbox(f, A0, A1, y0, y1, -R, 0, wall, S_WALL, 'F' + (i > 0 ? 'D' : '') + (i < rows.length ? 'T' : ''));
    }
    for (const { O, sillMin, headMax } of rows) {
      for (let i = 0; i <= O.length; i++) {   // the piers, whose sides are the side reveals
        const g0 = i === 0 ? A0 : O[i - 1].a1, g1 = i === O.length ? A1 : O[i].a0;
        if (g1 - g0 > 1e-4) Q.fbox(f, g0, g1, sillMin, headMax, -R, 0, wall, S_WALL, 'F' + (i > 0 ? 'L' : '') + (i < O.length ? 'R' : ''));
      }
      for (const o of O) {
        if (o.sill > sillMin + 1e-4) Q.fbox(f, o.a0, o.a1, sillMin, o.sill, -R, 0, wall, S_WALL, 'FT');   // a window beside the doors: the wall under it
        for (const [q0, q1] of o.panes) Q.glass(f, q0, q1, o.sill, o.head, -R, o.strip ? 0x22384a : 0x0c121a, winLit(), 0.16, o.strip ? 0.9 : grnd());
        // a precast sill 7 cm proud: front and underside, the two faces a street camera looks up at
        if (sills && fi === 0 && !o.door && !o.strip) Q.fbox(f, o.a0 - 0.08, o.a1 + 0.08, o.sill - 0.06, o.sill, 0, 0.07, band, S_PAINT, 'FD');
      }
    }
    if (cap0) Q.fbox(f, A0, A0, GROUND_H, Hm, -cap0, 0, wall, S_WALL, 'L');
    if (cap1) Q.fbox(f, A1, A1, GROUND_H, Hm, -cap1, 0, wall, S_WALL, 'R');
    return reg;
  };
  skin(0, -hd, hd, R, R);
  const sideRegs = { 2: skin(2, -(hw - R), hw, 0, Rc), 3: skin(3, -hw, hw - R, Rc, 0) };
  Q.box(-hw, hw - Rc, GROUND_H, Hm, -(hd - Rc), hd - Rc, wall, S_WALL, 'XxZz');   // the core: behind the glass, and the back wall itself
  Q.box(-hw, hw, Hm, Hm, -hd, hd, wall, S_WALL, 'Y');                             // the roof
  // the back: flat glass on the core's face, as the whole building used to be
  const backReg = layout(bk.w, frontWin === 'paired' ? 'paired' : 'punched', 3.4);
  for (let s = 1; s <= sTop; s++) {
    const fy = floorY(s);
    for (const o of backReg) {
      Q.glass(bk, o.a0, o.a1, fy + 0.9, fy + 2.2, 0.035, 0x0c121a, winLit(), 0.16, grnd());
      if (stairs && o.a0 < -bk.w / 2 + 2.3) continue;   // the fire stair's landings
      const r = frnd();
      if (residential && s >= 2 && r < 0.14) smallBalc.push({ f: bk, a0: o.a0, a1: o.a1, fy, flat: true });
      else if (r > 0.8) acs.push({ f: bk, a: (o.a0 + o.a1) / 2 + (frnd() - 0.5) * 0.3, fy });
    }
  }
  // floor bands: a slab edge standing out bandP (0.08-0.13 m) just under the floor line, over the shops always
  for (let s = 1; s <= sTop; s++) {
    if (s === 1 || bandMode === 'every' || (bandMode === 'third' && s % 3 === 1)) Q.ring(0, 0, hw + bandP, hd + bandP, hw, hd, floorY(s) - bandH, floorY(s), band, S_WALL, 'TDO');
  }
  // the cornice, then the parapet with a metal coping
  if (cornice === 'step') Q.ring(0, 0, hw + 0.08, hd + 0.08, hw, hd, Hm - 0.42, Hm - cH, band, S_WALL, 'DO');
  if (cornice !== 'coping') Q.ring(0, 0, hw + cP, hd + cP, hw, hd, Hm - cH, Hm, band, S_WALL, 'TDO');
  {
    const po = cornice === 'coping' ? 0 : 0.03, pin = R + 0.12;   // flush with the wall when nothing is under it, or the parapet's underside would be a slit
    Q.ring(0, 0, hw + po, hd + po, hw - pin, hd - pin, Hm, Hm + ph, wall, S_WALL, 'OI');
    Q.ring(0, 0, hw + po + 0.05, hd + po + 0.05, hw - pin - 0.05, hd - pin - 0.05, Hm + ph, Hm + ph + 0.06, 0x8c9094, S_PAINT, 'TDOI');
  }
  // corner pilasters -- not on the street corner at end A, which the tall kanban owns
  if (columns) {
    const y1 = cornice === 'coping' ? Hm + ph + 0.12 : Hm - cH;   // under the cornice, or up through the coping as piers
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      if (sx > 0 && sz === endA) continue;
      const x0 = sx > 0 ? hw - colC : -hw - colP, x1 = sx > 0 ? hw + colP : -hw + colC;
      const z0 = sz > 0 ? hd - colC : -hd - colP, z1 = sz > 0 ? hd + colP : -hd + colC;
      Q.box(x0, x1, sx > 0 ? GROUND_H : 0, y1, z0, z1, colHex, S_WALL, 'XxZzY' + (sx > 0 ? 'y' : ''));
    }
  }
  // balconies: the street face's run, one per storey from above the tenant boards
  const balustrade = (f, a0, a1, fy, D, ends) => {
    const y0 = fy + 0.02, y1 = fy + 1.05;
    if (balcStyle === 'solid') Q.fbox(f, a0, a1, y0, y1, D - 0.1, D, wall, S_WALL, 'FTLR');
    else if (balcStyle === 'panel') {   // frosted panels under a rail, the 8 cm gap at the foot every glass balustrade has
      Q.fbox(f, a0, a1, y0 + 0.08, y1 - 0.06, D - 0.05, D - 0.03, 0xa9b9be, S_PAINT, 'F');
      Q.fbox(f, a0, a1, y1 - 0.06, y1, D - 0.07, D, 0x8a8f95, S_PAINT, 'FTDLR');
    } else Q.fbox(f, a0, a1, y0, y1, D - 0.05, D, 0x43474d, S_SLATS, 'FTLR');   // aluminium louvres
    // the returns stop at the balustrade's back, so no two faces share a plane
    if (ends) for (const [r0, r1] of [[a0, a0 + 0.08], [a1 - 0.08, a1]]) Q.fbox(f, r0, r1, y0, y1, 0, D - (balcStyle === 'solid' ? 0.1 : 0.07), balcStyle === 'solid' ? wall : 0x43474d, balcStyle === 'solid' ? S_WALL : S_PAINT, 'LRT');
  };
  const acUnit = (f, a, y, o) => {   // an outdoor unit: a box and its fan, 12 triangles
    Q.fbox(f, a - 0.39, a + 0.39, y, y + 0.55, o, o + 0.28, 0xc9ccd1, S_PAINT, 'FTDLR');
    Q.fbox(f, a - 0.3, a + 0.12, y + 0.07, y + 0.48, o + 0.285, o + 0.285, 0x2a2d31, S_PAINT, 'F');
  };
  if (balcS.size) {
    const D = 1.05, gaps = [];
    for (let i = 0; i + 1 < run.length; i++) if (run[i + 1].a0 - run[i].a1 > 0.9) gaps.push((run[i].a1 + run[i + 1].a0) / 2);
    for (const s of balcS) {
      const fy = floorY(s);
      Q.fbox(front, runA0, runA1, fy - 0.14, fy + 0.02, 0, D, band, S_WALL, 'FTDLR');
      balustrade(front, runA0, runA1, fy, D, true);
      if (gaps.length && frnd() < 0.55) acUnit(front, gaps[Math.floor(frnd() * gaps.length)], fy + 0.02, 0.05);
      if (frnd() < 0.4) {   // laundry on a pole, held off the wall on two arms
        const span = runA1 - runA0, la0 = runA0 + 0.3 + frnd() * span * 0.35, la1 = Math.min(runA1 - 0.3, la0 + Math.min(2.6, span * 0.5));
        if (la1 - la0 > 0.8) {
          Q.fbox(front, la0, la1, fy + 1.84, fy + 1.87, 0.5, 0.53, 0x9a9ea3, S_PAINT, 'FTD');
          for (const ax of [la0 + 0.06, la1 - 0.06]) Q.fbox(front, ax - 0.015, ax + 0.015, fy + 1.87, fy + 1.9, 0, 0.53, 0x9a9ea3, S_PAINT, 'FTDLR');
          const n = 2 + Math.floor(frnd() * 3), cw = Math.min(0.7, (la1 - la0) / n - 0.08);
          for (let i = 0; i < n; i++) {
            const c = la0 + ((i + 0.5) * (la1 - la0)) / n, hh = 0.5 + frnd() * 0.35;
            Q.fbox(front, c - cw / 2, c + cw / 2, fy + 1.84 - hh, fy + 1.84, 0.515, 0.515, fpick(LAUNDRY), S_PAINT, 'FB');
          }
        }
      }
      if (frnd() < 0.35) for (let i = 0; i < 2; i++) {   // pots at the balustrade, tall enough to show over it, one in each half of the run
        const c = runA0 + (runA1 - runA0) * (0.25 + 0.5 * i) + (frnd() - 0.5) * 0.2;
        Q.fbox(front, c - 0.17, c + 0.17, fy + 0.02, fy + 0.36, D - 0.46, D - 0.14, 0x7a5a40, S_PAINT, 'FTLR');
        const hh = 0.8 + frnd() * 0.5;
        parts.push(at(paint(new THREE.CylinderGeometry(0, 0.28, hh, 6, 1, true), fpick(GREENS)), fX(front, c, D - 0.3), fy + 0.36 + hh / 2, fZ(front, c, D - 0.3)));
      }
    }
  }
  /* One bay's balcony, 0.9 m deep, on a kerb face or the back. Neighbours on
     one storey join into one slab: their 0.3 m overhangs met (on a paired
     window, overlapped) and two slabs in one plane fought. */
  smallBalc.sort((p, q) => (p.f.name === q.f.name ? p.fy - q.fy || p.a0 - q.a0 : p.f.name < q.f.name ? -1 : 1));
  for (let i = smallBalc.length - 1; i > 0; i--) {
    const p = smallBalc[i - 1], q = smallBalc[i];
    if (p.f === q.f && p.fy === q.fy && q.a0 - p.a1 < 0.62) { p.a1 = Math.max(p.a1, q.a1); smallBalc.splice(i, 1); }
  }
  for (const b of smallBalc) {
    const a0 = b.a0 - 0.3, a1 = b.a1 + 0.3;
    Q.fbox(b.f, a0, a1, b.fy - 0.14, b.fy + 0.02, 0, 0.9, band, S_WALL, 'FTDLR');
    balustrade(b.f, a0, a1, b.fy, 0.9, false);
  }
  for (const a of acs) acUnit(a.f, a.a, a.fy + 0.2, 0.02);   // under the window, clear of the sill band and the floor band
  // drainpipes down the back corners: a hopper under the cornice, a shoe into the plinth
  if (frnd() < 0.75) {
    const n = frnd() < 0.4 ? 2 : 1, pin = columns ? colC + 0.12 : 0.32, pc = fpick([0x3b3f44, 0xb9b3a6, 0x6f7479]);
    const yTop = Hm - (cornice === 'coping' ? 0.1 : cH + (cornice === 'step' ? 0.2 : 0)) - 0.05;
    for (let i = 0; i < n; i++) {
      const a = (i === 0 ? 1 : -1) * (bk.w / 2 - pin);
      Q.fbox(bk, a - 0.05, a + 0.05, 0.2, yTop - 0.3, 0.05, 0.15, pc, S_PAINT, 'FLR');
      Q.fbox(bk, a - 0.12, a + 0.12, yTop - 0.3, yTop, 0.02, 0.26, pc, S_PAINT, 'FTDLR');   // the hopper: 0.24 wide, so it stops at a corner pilaster's face
      Q.fbox(bk, a - 0.08, a + 0.08, 0, 0.2, 0.05, 0.24, pc, S_PAINT, 'FTLR');
    }
  }
  // cable conduits up a kerb face on its widest pier, from a meter box over the fascia (the pole drops land here)
  if (sideWin !== 'strip' && frnd() < 0.5) {
    const fi = frnd() < 0.5 ? 2 : 3, O = sideRegs[fi];
    let a = null, g = 0.9;
    for (let i = 0; i + 1 < O.length; i++) { const gg = O[i + 1].a0 - O[i].a1; if (gg > g) { g = gg; a = (O[i].a1 + O[i + 1].a0) / 2; } }
    const y0 = floorY(showroom ? 2 : 1) + 1.2, y1 = Hm - 1.1;
    if (a !== null && y1 - y0 > 2) {
      for (const d of [-0.045, 0.045]) Q.fbox(F[fi], a + d - 0.025, a + d + 0.025, y0, y1, 0, 0.05, 0x55595e, S_PAINT, 'FLR');
      Q.fbox(F[fi], a - 0.2, a + 0.2, y0 - 0.55, y0, 0, 0.16, 0x9a9da2, S_PAINT, 'FTDLR');
    }
  }

  // an external steel stair on the back of three in ten: landings at every storey with a railing, a flight between, a stringer up the wall
  if (stairs) {
    const s0 = -bk.w / 2 + 1.4;
    const [sx, sz] = onFace(bk, s0 - 0.7, 1.35);
    parts.push(at(metal(0.08, Hm - 1.0, 0.08, 0x3a3d42), sx, (Hm - 1.0) / 2 + 0.5, sz));   // the stringer
    for (let s = 1; s <= sTop; s++) {
      const fy = floorY(s);
      Q.fbox(bk, s0 - 0.7, s0 + 0.7, fy + 0.01, fy + 0.09, 0, 1.4, 0x4a4d52, S_PAINT, 'FTDLR');
      // the rail runs ALONG the landing's outer edge (it stood across it, 1.4 m out past the landing)
      Q.fbox(bk, s0 - 0.7, s0 + 0.7, fy + 0.09, fy + 1.0, 1.36, 1.4, 0x3a3d42, S_SLATS, 'FTLR');
      if (s < sTop) Q.beam([fX(bk, s0 + 0.6, 0.95), fy + 0.09, fZ(bk, s0 + 0.6, 0.95)], [fX(bk, s0 - 0.6, 0.95), fy + FLOOR_H, fZ(bk, s0 - 0.6, 0.95)], 0.12, 0x3a3d42);   // the flight
    }
  }

  // 3. RECESSED STOREFRONT UNDER THE OVERHANG
  const shopX = hw - recess + 0.04;
  let konbiniFront = false;   // the awning below needs to know which shop this is
  if (shuttered) {
    // shuttered: a grey roller door tucked under the colonnade -- its slats are the paint's RIBS now (six rib boxes, 72 triangles, before)
    parts.push(at(quad(front.w - 0.6, 2.7, 0x8d9096, null, 1, 0, SURF.PAINT + PAINT_VARIANT.RIBS - 0.05), shopX, 1.65, 0, front.yaw));
  } else {
    // OPEN SHOP: a room you can see into (image 11), not a glowing glass sticker.
    const konbini = rnd() < 0.35;
    konbiniFront = konbini;
    const shop = konbini ? [1.0, 0.92, 0.72] : WARM;
    const roomW = Math.max(2.4, front.w - 0.8);
    parts.push(at(box(0.08, 2.55, roomW, konbini ? 0x3a3830 : 0x3a2e24, shop, 0.85), shopX - roomD, 1.4, 0));
    parts.push(at(box(roomD, 0.05, roomW, 0x2a241c, shop, 0.22), shopX - roomD / 2, 0.04, 0));
    parts.push(at(box(roomD, 0.08, roomW, 0x2a2618, shop, 0.55), shopX - roomD / 2, GROUND_H - 0.2, 0));
    parts.push(at(metal(0.08, 2.55, 0.08, 0x2a2a28), shopX - 0.02, 1.4, roomW / 2 - 0.04));
    parts.push(at(metal(0.08, 2.55, 0.08, 0x2a2a28), shopX - 0.02, 1.4, -roomW / 2 + 0.04));
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
  // the shutter box: the roller's housing across the head of the opening, under the awning
  Q.box(shopX, shopX + 0.22, 3.0, 3.2, -(front.w - 0.6) / 2, (front.w - 0.6) / 2, 0x5d6166, S_PAINT, 'XYyZz');
  // Store entrance door
  {
    const ds = (rnd() < 0.5 ? -1 : 1) * (front.w / 2 - 1.3);
    parts.push(at(metal(0.06, 2.5, 1.25, 0x2a2d33), shopX + 0.03, 1.25, ds));
    parts.push(at(glass(1.0, 2.2, 0x3c4a5a, [0.95, 0.9, 0.8], 0.22, 0.95), shopX + 0.066, 1.15, ds, front.yaw));   // 6 mm proud of the frame: at +0.06 it lay ON the frame's face and fought it
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
     h (4:1 lightbox), v (vertical kanban) or s (2:1 screen). Everything on
     the street face stops under Hm, the main roof: a set-back top storey
     stands 1.6-2.4 m behind it. */

  // end B: projecting vertical kanban, 1.15 m out from the wall on brackets
  {
    const proj = 1.15, topY = Hm - 1.0, px = hw + 0.25 + proj / 2;
    const pz = endB * Math.max(0.6, hd - 0.9);
    let y0 = 5.2;
    for (let i = 0; i < 4 && y0 + 2.6 < topY; i++) {
      const signH = Math.min(topY - y0, 3.4 + rnd() * 1.8);
      const y = y0 + signH / 2;
      y0 += signH + 0.9;
      if (i > 0 && rnd() < 0.3) continue;
      const c = i === 0 ? signColor : pick(NEON);
      parts.push(at(metal(proj, signH, 0.2, 0x181a1f), px, y, pz));                                               // the lightbox
      parts.push(at(box(0.07, signH + 0.1, 0.24, 0x111115, c, 2.4, flickerOf(rnd)), px + proj / 2, y, pz));       // a tube down its leading edge
      for (const dy of [signH / 2 - 0.3, 0.3 - signH / 2]) parts.push(at(metal(0.26, 0.08, 0.1, 0x2b2e34), hw + 0.13, y + dy, pz));   // brackets, from the facade plane out: 5 cm into it they lay on a window's sill reveal
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
  const bhA = Math.min(4.4 + rnd() * 2.2, Hm - 5.8);
  if (rnd() < 0.6 && bhA > 2.8) {
    const bw = 1.35 + rnd() * 0.45;
    const by = 5.2 + bhA / 2 + rnd() * Math.max(0, Math.min(0.6, Hm - 6.0 - bhA));   // above the fascia, clear of the cornice
    const along = endA * Math.max(0.4, hd - bw / 2 - 0.35);
    parts.push(at(box(0.14, bhA, bw, 0x141418, signColor, 1.9, flickerOf(rnd)), hw + 0.22, by, along));
    boards.push({ x: hw + 0.32, y: by, z: along, yaw: front.yaw, w: bw * 0.88, h: bhA * 0.92, vertical: true, kind: 'v' });
    lamps.push({
      x: hw + 1.4, y: 2.5, z: along * 0.3,
      colour: _c.setRGB(signColor[0], signColor[1], signColor[2]).getHex(),
      neon: true, intensity: 105, range: 34, glare: 2.5,
    });
  } else {
    const colH = Math.max(0, Hm - 5.5) * (0.74 + rnd() * 0.26);
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

  // middle, high: a video screen on some tall buildings -- the corner screens in the stills (planned above)
  if (screen) {
    parts.push(at(metal(0.25, screen.bh + 0.36, screen.bw + 0.36, 0x0d0e11), hw + 0.125, screen.by, 0));   // the bezel
    boards.push({ x: hw + 0.26, y: screen.by, z: 0, yaw: front.yaw, w: screen.bw, h: screen.bh, kind: 's' });
    lamps.push({ x: hw + 2.0, y: screen.by - screen.bh / 2, z: 0, colour: 0xd6e6ff, neon: true, intensity: 70, range: 28, glare: 2.0 });
  }

  /* middle: one tenant per storey, its lightbox in the spandrel between the
     windows -- 2.18-2.88 m over the floor, between the window heads (2.2)
     and the next floor band (which starts 2.9 up at the earliest). */
  for (const st of tenants) {
    const y = floorY(st) + 2.53;
    parts.push(at(metal(0.12, 0.7, tw + 0.1, 0x1a1b20), hw + 0.1, y, tz));
    boards.push({ x: hw + 0.17, y, z: tz, yaw: front.yaw, w: tw, h: 0.62, kind: 'h' });
  }

  // Awning extending from colonnade
  /* The konbini's awning is the three-stripe one the reference points at
     (green / orange / red over white), not a flat colour: it is the single most
     recognisable thing on a Japanese street at this scale. */
  const awningCol = konbiniFront ? 0xecf0f1 : pick([0xc0392b, 0x2e86de, 0xf1c40f, 0xecf0f1, 0x27ae60]);
  parts.push(at(metal(1.5, 0.08, front.w * 0.88, awningCol), hw - recess + 0.75, 3.25, 0));
  if (konbiniFront) {
    const sw = front.w * 0.88 / 3;
    const cols = [0x1f8a4c, 0xe8762a, 0xd5312a];
    for (let i = 0; i < 3; i++) {
      parts.push(at(metal(1.52, 0.05, sw * 0.92, cols[i]), hw - recess + 0.75, 3.30, -front.w * 0.44 + sw * (i + 0.5)));
    }
  }
  if (rnd() < 0.5) {
    const stripes = Math.max(2, Math.floor(front.w * 0.88 / 0.9));
    for (let i = 0; i < stripes; i += 2) parts.push(at(metal(1.51, 0.02, 0.42, 0xf4f4f0), hw - recess + 0.75, 3.30, -front.w * 0.44 + 0.45 + i * 0.9));
  }
  // string lights under colonnade
  if (rnd() < 0.33) {
    const n = Math.max(4, Math.floor(front.w / 0.9));
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), s = 4 * t * (1 - t);
      const along = -front.w * 0.42 + front.w * 0.84 * t;
      parts.push(at(box(0.09, 0.09, 0.09, 0x3a2a1a, [1.0, 0.72, 0.35], 1.3), hw - recess + 1.1, 3.97 - 0.35 * s, along));   // hung from the soffit's underside (4.04): at 4.2 the end bulbs were inside it
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
    parts.push(at(metal(0.85, 1.85, 1.0, 0xf4f4f6), hw - recess + 0.55, 0.925, vz));
    parts.push(at(glass(0.78, 1.25, 0x9fb7d8, [0.55, 0.75, 1.0], 0.9, 0.95), hw - recess + 0.98, 1.15, vz, front.yaw));
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
      parts.push(at(quad(f.w - 0.7, 2.7, 0x8d9096, null, 1, 0, SURF.PAINT + PAINT_VARIANT.RIBS - 0.05), gx, 1.5, gz, f.yaw));
      Q.fbox(f, -(f.w - 0.7) / 2, (f.w - 0.7) / 2, 2.87, 3.12, 0, 0.2, 0x5d6166, S_PAINT, 'FTDLR');   // its shutter box
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
        /* The glazing shows the shop (2026-09-25): it was one dark-brown pane,
           so by day (emit x 0.05) every side-street bay read as a brown board
           -- the flat panels either side of the spawn. Now the display pattern
           in the shop's warm light; the stock is seeded from the bay's own
           position, NOT a fresh rnd(), which would reshuffle everything this
           building rolls after it. */
        parts.push(at(display(bayW, 1.95, 0x9a8f7a, shop, 0.62, (Math.abs(along * 0.173 + f.w * 0.31)) % 1), bx2, 1.72, bz2, f.yaw));   // the glazing
        parts.push(at(quad(bayW, 0.55, 0x24201c), bx2, 0.42, bz2, f.yaw));               // stallriser, dark
        // the dark pier after it, standing 18 cm proud so the glass reads set back
        const e = along + bayW / 2;
        if (i < bays - 1) Q.fbox(f, e, e + pier, 0, 2.72, 0, 0.18, band, S_WALL, 'FLR');
      }
      const gw = (f.w - 0.8) / 2;
      Q.fbox(f, -f.w / 2 + 0.05, -gw, 0, 2.72, 0, 0.18, band, S_WALL, 'FLR');
      Q.fbox(f, gw, f.w / 2 - 0.05, 0, 2.72, 0, 0.18, band, S_WALL, 'FLR');
      Q.fbox(f, -f.w / 2 + 0.05, f.w / 2 - 0.05, 2.72, 3.1, 0, 0.2, band, S_WALL, 'FTDLR');   // the head over the bays: the shutter box
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
      const c = pick(NEON), fl = flickerOf(rnd), ky = 6.1 + rnd() * 0.6;
      /* FLAT to the wall: box(bw, bh, 0.16) turned by the face yaw puts its
         depth on the normal. It was box(0.16, bh, bw) -- a fin standing 1.35-1.8
         m out through its own board. The board now shares the box's centre
         (it sat at 6.3 against a box at 6.1-6.7) and a short building's kanban
         stops under its roof, or is left off. */
      const kh = Math.min(bh, 2 * (Hm - 0.6 - ky));
      if (kh < 2.2 * bw + 0.05) continue;
      parts.push(at(box(bw, kh, 0.16, 0x141418, c, 2.05, fl), kx, ky, kz, f.yaw));
      boards.push({ x: kx + f.n[0] * 0.1, y: ky, z: kz + f.n[1] * 0.1, yaw: f.yaw, w: bw * 0.86, h: kh * 0.9, vertical: true, kind: 'v' });
    }
  }

  // 5. THE TOP STOREY AND THE ROOF
  let roof = { x0: -hw, x1: hw, z0: -hd, z1: hd, y: Hm };
  const planter = (x0, x1, z0, z1, y) => {   // a concrete bed with soil and shrubs: the rooftop garden's unit
    Q.box(x0, x1, y, y + 0.42, z0, z1, 0x6d6a64, S_WALL, 'XxZz');
    Q.box(x0, x1, y + 0.4, y + 0.4, z0, z1, 0x3e4a2c, S_PAINT, 'Y');
    const n = Math.max(1, Math.min(5, Math.floor(((x1 - x0) * (z1 - z0)) / 0.6)));
    for (let i = 0; i < n; i++) {
      const r = Math.min(0.2 + frnd() * 0.25, (x1 - x0) / 2, (z1 - z0) / 2), hh = 0.5 + frnd() * 0.9;
      parts.push(at(paint(new THREE.CylinderGeometry(0, r, hh, 6, 1, true), fpick(GREENS)), x0 + r + frnd() * Math.max(0, x1 - x0 - 2 * r), y + 0.4 + hh / 2, z0 + r + frnd() * Math.max(0, z1 - z0 - 2 * r)));
    }
  };
  if (top === 'setback') {
    /* A set-back top floor on a terrace: the main parapet is its balustrade,
       two planters stand along it, sliding doors look out over the street. */
    const tx0 = -hw + sbS, tx1 = hw - sbF, tz0 = -hd + sbS, tz1 = hd - sbS;
    const tf = facesAt((tx0 + tx1) / 2, (tz0 + tz1) / 2, (tx1 - tx0) / 2, (tz1 - tz0) / 2);
    Q.box(tx0, tx1, Hm, H, tz0, tz1, wall, S_WALL, 'XxZzY');
    for (let fi = 0; fi < 4; fi++) {
      const f = tf[fi], doors = fi === 0;
      for (const o of layout(f.w, doors ? 'strip' : 'punched', doors ? 2.2 : 3.4)) {
        for (const [q0, q1] of o.panes) Q.glass(f, q0, q1, Hm + (doors ? 0.05 : 0.9), Hm + (doors ? 2.3 : 2.2), 0.035, 0x0c121a, winLit(), 0.16, grnd());
      }
    }
    Q.ring((tx0 + tx1) / 2, (tz0 + tz1) / 2, (tx1 - tx0) / 2 + 0.05, (tz1 - tz0) / 2 + 0.05, (tx1 - tx0) / 2 - 0.15, (tz1 - tz0) / 2 - 0.15, H, H + 0.4, band, S_WALL, 'TDOI');
    const px0 = tx1 + 0.35, px1 = hw - R - 0.25;
    if (px1 - px0 > 0.5) for (const s of [-1, 1]) { const c = s * (tz1 - tz0) * 0.25; planter(px0, px1, c - 0.7, c + 0.7, Hm); }
    roof = { x0: tx0, x1: tx1, z0: tz0, z1: tz1, y: H + 0 };
  } else if (top === 'penthouse') {
    /* A glazed penthouse: a pane every ~1.5 m on all four sides (the shader's
       frame makes the curtain wall), corner posts, a roof slab oversailing
       0.45 m. Lit a little more often than the floors below. */
    const tx0 = -hw + sbP, tx1 = hw - sbP, tz0 = -hd + sbP, tz1 = hd - sbP, y1 = H - 0.3;
    const tf = facesAt((tx0 + tx1) / 2, (tz0 + tz1) / 2, (tx1 - tx0) / 2, (tz1 - tz0) / 2);
    for (const f of tf) {
      const n = Math.max(1, Math.round(f.w / 1.5));
      for (let i = 0; i < n; i++) Q.glass(f, -f.w / 2 + (f.w * i) / n, -f.w / 2 + (f.w * (i + 1)) / n, Hm, y1, 0, 0x1d2b38, rnd() < 0.45 ? WARM : null, 0.16, 0.9);
    }
    for (const x of [tx0, tx1]) for (const z of [tz0, tz1]) Q.box(x - 0.08, x + 0.08, Hm, y1, z - 0.08, z + 0.08, 0x2e3136, S_PAINT, 'XxZz');
    Q.box(tx0 - 0.45, tx1 + 0.45, y1, H, tz0 - 0.45, tz1 + 0.45, band, S_WALL, 'XxZzYy');
    roof = { x0: tx0, x1: tx1, z0: tz0, z1: tz1, y: H };
  }

  /* The roof kit (2026-09-23), in four slots so nothing stands in anything
     else: back corners the lift's motor room (5+ storeys, else a shed) and a
     water tank -- a galvanised drum on a stand, or the Japanese FRP panel
     tank on steel beams -- front corners an antenna (a lattice mast on 8+
     storeys, else a mast and TV aerial, the red beacon either way) and the
     condensers, a rooftop garden in a slatted fence on low residential roofs,
     or a shed. A roof bigger than two slots a side splits them. A rooftop
     billboard keeps the back 1.6 m and stands clear over whatever is tallest. */
  const landmark = floors >= 18;
  const rzw = roof.z1 - roof.z0, ry = roof.y;
  const bb = (landmark || rnd() < 0.35) && rzw > 5;
  const kit = [];
  {
    const ix0 = roof.x0 + (bb ? 1.6 : 0.45) + (top ? 0 : R), ix1 = roof.x1 - 0.45 - (top ? 0 : R), iz0 = roof.z0 + 0.45 + (top ? 0 : R), iz1 = roof.z1 - 0.45 - (top ? 0 : R);
    const xm = (ix0 + ix1) / 2, zm = (iz0 + iz1) / 2, flipZ = frnd() < 0.5;
    const slot = (x0, x1, z0, z1) => ({ x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2 });
    const quadrant = (back, left) => { const zl = left !== flipZ; return slot(back ? ix0 : xm, back ? xm : ix1, zl ? iz0 : zm, zl ? zm : iz1); };
    const halves = (s) => (s.hx > 3.2 ? [slot(s.x0, s.cx, s.z0, s.z1), slot(s.cx, s.x1, s.z0, s.z1)] : [s]);
    const beacon = (x, y, z) => Q.box(x - 0.1, x + 0.1, y, y + 0.2, z - 0.1, z + 0.1, 0xff2030, S_PAINT, 'XxZzY', [2.8, 0.28, 0.42], 0.85);
    const bulkhead = (s) => {
      const hx = Math.min(1.2, s.hx - 0.12), hz = Math.min(1.3, s.hz - 0.12);
      if (hx < 0.7 || hz < 0.7) return 0;
      Q.box(s.cx - hx, s.cx + hx, ry, ry + 2.4, s.cz - hz, s.cz + hz, wall, S_WALL, 'XxZzY');
      Q.box(s.cx - hx - 0.12, s.cx + hx + 0.12, ry + 2.4, ry + 2.52, s.cz - hz - 0.12, s.cz + hz + 0.12, band, S_WALL, 'XxZzYy');
      Q.box(s.cx + hx + 0.01, s.cx + hx + 0.01, ry + 0.05, ry + 2.05, s.cz - 0.45, s.cz + 0.45, 0x2b2e33, S_PAINT, 'X');   // its door, onto the roof
      kit.push('bulkhead');
      return 2.52;
    };
    const shed = (s) => {
      const hx = Math.min(0.9, s.hx - 0.12), hz = Math.min(1.1, s.hz - 0.12);
      if (hx < 0.5 || hz < 0.5) return 0;
      Q.box(s.cx - hx, s.cx + hx, ry, ry + 2.1, s.cz - hz, s.cz + hz, 0x8e969c, S_SLATS, 'XxZzY');   // corrugated sheet
      Q.box(s.cx - hx - 0.12, s.cx + hx + 0.12, ry + 2.1, ry + 2.18, s.cz - hz - 0.12, s.cz + hz + 0.12, 0x5a5f66, S_PAINT, 'XxZzYy');
      Q.box(s.cx + hx + 0.01, s.cx + hx + 0.01, ry + 0.02, ry + 1.92, s.cz - 0.4, s.cz + 0.4, 0x4a4d52, S_PAINT, 'X');
      kit.push('shed');
      return 2.18;
    };
    const tankDrum = (s) => {
      const r = Math.min(0.85, Math.min(s.hx, s.hz) - 0.15);
      if (r < 0.4) return 0;
      const legH = 0.8 + frnd() * 0.4, th = 1.3 + frnd() * 0.5, col = fpick([0x9fa4aa, 0x6d8fa6, 0xc8c2b0]), yb = ry + legH;
      for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const lx = s.cx + dx * r * 0.62, lz = s.cz + dz * r * 0.62;
        Q.box(lx - 0.05, lx + 0.05, ry, yb, lz - 0.05, lz + 0.05, 0x3a3d42, S_PAINT, 'XxZz');
      }
      Q.box(s.cx - r * 1.05, s.cx + r * 1.05, yb, yb + 0.1, s.cz - r * 1.05, s.cz + r * 1.05, 0x3a3d42, S_PAINT, 'XxZzYy');
      parts.push(at(paint(new THREE.CylinderGeometry(r, r, th, 12, 1, true), col), s.cx, yb + 0.1 + th / 2, s.cz));
      parts.push(at(paint(new THREE.CylinderGeometry(0, r, 0.32, 12, 1, true), col), s.cx, yb + 0.1 + th + 0.16, s.cz));   // the drum's own radius: an overhang would show its open base from the street
      kit.push('tank-drum');
      return legH + 0.1 + th + 0.32;
    };
    const tankPanel = (s) => {   // whole-metre FRP panels, so the seams (PAINT_VARIANT.PANEL) land on its edges
      const W = Math.min(4, Math.floor(2 * s.hz - 0.3)), D = Math.min(3, Math.floor(2 * s.hx - 0.3));
      if (W < 2 || D < 2) return tankDrum(s);
      const x0 = s.cx - D / 2, z0 = s.cz - W / 2, y0 = ry + 0.25, col = fpick([0xd6cfbc, 0x9fb3c2, 0xc9c9c2]);
      for (const zb of [z0 + 0.35, z0 + W - 0.35]) Q.box(x0 - 0.1, x0 + D + 0.1, ry, y0, zb - 0.1, zb + 0.1, 0x3a3d42, S_PAINT, 'XxZzY');
      Q.box(x0, x0 + D, y0, y0 + 2, z0, z0 + W, col, S_PANEL, 'XxZzYy', null, 0, [x0, y0, z0]);
      Q.box(s.cx - 0.3, s.cx + 0.3, y0 + 2, y0 + 2.1, s.cz - 0.3, s.cz + 0.3, 0x7a7d80, S_PAINT, 'XxZzY');   // the manhole
      kit.push('tank-panel');
      return 2.35;
    };
    const antenna = (s, lattice) => {
      const cx = s.cx, cz = s.cz;
      if (lattice && Math.min(s.hx, s.hz) > 0.5) {
        const hm = 5 + frnd() * 4, r0 = Math.min(0.45, Math.min(s.hx, s.hz) * 0.6), r1 = 0.12, n = Math.max(3, Math.round(hm / 1.3));
        const leg = (k, t) => { const a = (k * 2 * Math.PI) / 3, r = r0 + (r1 - r0) * t; return [cx + Math.cos(a) * r, ry + hm * t, cz + Math.sin(a) * r]; };
        for (let k = 0; k < 3; k++) Q.beam(leg(k, 0), leg(k, 1), 0.07, 0x3a3d42);
        for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {   // a zig-zag up each face
          const k1 = (k + 1) % 3;
          Q.beam(leg(i % 2 ? k : k1, i / n), leg(i % 2 ? k1 : k, (i + 1) / n), 0.035, 0x4a4d52);
        }
        for (const k of [0, 1]) { const p = leg(k, 0.82); Q.box(p[0] - 0.05, p[0] + 0.05, p[1] - 0.45, p[1] + 0.45, p[2] - 0.12, p[2] + 0.12, 0xd8d8d4, S_PAINT, 'XxZzYy'); }   // panel antennas
        beacon(cx, ry + hm, cz);
        kit.push('lattice');
        return;
      }
      const hm = 3.2 + frnd() * 2.4;
      Q.beam([cx, ry, cz], [cx, ry + hm, cz], 0.07, 0x3a3d42);
      for (let i = 0; i < 2; i++) { const y = ry + hm - 0.35 - i * 0.7, l = 0.9 - i * 0.2; Q.beam([cx - l, y, cz], [cx + l, y, cz], 0.035, 0x5a5e64); }   // the aerial's booms
      beacon(cx, ry + hm, cz);
      kit.push('mast');
    };
    const hvac = (s) => {
      const n = s.hx * s.hz > 5 ? 2 : 1, w = Math.min(1.2, (2 * s.hz - 0.4) / n - 0.2), dx = Math.min(0.9, 2 * s.hx - 0.4);
      if (w < 0.5 || dx < 0.5) return 0;
      for (let i = 0; i < n; i++) {
        const cz = s.z0 + 0.2 + ((i + 0.5) * (2 * s.hz - 0.4)) / n;
        Q.box(s.cx - dx / 2, s.cx + dx / 2, ry, ry + 1.0, cz - w / 2, cz + w / 2, 0xb9bec4, S_RIBS, 'XxZzY');
        Q.box(s.cx - dx * 0.35, s.cx + dx * 0.35, ry + 1.005, ry + 1.005, cz - w * 0.4, cz + w * 0.4, 0x16181b, S_PAINT, 'Y');   // the fan
      }
      kit.push('hvac');
      return 1.0;
    };
    const garden = (s) => {
      if (s.hx < 0.9 || s.hz < 0.9) return hvac(s);
      const cx = s.cx, cz = s.cz, ox = s.hx - 0.05, oz = s.hz - 0.05;
      Q.ring(cx, cz, ox, oz, ox - 0.04, oz - 0.04, ry, ry + 0.9, 0x8b6b4a, S_SLATS, 'TOI');   // a slatted timber fence
      planter(cx - ox + 0.3, cx + ox - 0.3, cz - oz + 0.3, cz + oz - 0.3, ry);
      kit.push('garden');
      return 1.3;
    };
    let tall = 0;
    const bl = quadrant(true, true), br = quadrant(true, false), fl = quadrant(false, true), fr = quadrant(false, false);
    tall = Math.max(tall, floors >= 5 ? bulkhead(bl) : frnd() < 0.5 ? shed(bl) : 0);
    for (const s of halves(br)) tall = Math.max(tall, frnd() < 0.55 ? tankDrum(s) : tankPanel(s));
    const fls = halves(fl);
    antenna(fls[0], floors >= 8 && frnd() < 0.45);   // thin: it may stand in front of a billboard
    if (fls[1]) tall = Math.max(tall, hvac(fls[1]));
    tall = Math.max(tall, residential && floors <= 10 && frnd() < 0.55 ? garden(fr) : frnd() < 0.2 ? shed(fr) : hvac(fr));

    // a rooftop billboard on a third of them -- and on every landmark slab (18+ storeys), wider, with a neon frame
    if (bb) {
      const bw = Math.min(rzw - 1.2, landmark ? 14 : 9);
      const bh = Math.min(2.4, bw * 0.92 / 3.0);   // at least 3:1, or a narrow roof squashes the 4:1 tile's lettering
      /* On the main roof the legs stand in the parapet's own thickness: at a
         fixed 0.3 m in they met the coping's inner wall exactly when R = 0.18. */
      const xb = top ? roof.x0 + 0.3 : -hw + (R + 0.12) / 2, zc = (roof.z0 + roof.z1) / 2;
      const by = ry + Math.max(landmark ? 3.0 : 2.4, tall + 0.35) + bh / 2 + 0.2;   // clear over the tanks and the motor room
      if (landmark) { const nc = pick(NEON); parts.push(at(box(0.1, 0.12, bw + 0.4, 0x222222, nc, 1.3), xb + 0.04, by + bh / 2 + 0.35, zc), at(box(0.1, 0.12, bw + 0.4, 0x222222, nc, 1.3), xb + 0.04, by - bh / 2 - 0.35, zc)); }
      parts.push(at(metal(0.12, bh + 0.4, bw, 0x2b2e33), xb, by, zc));
      for (const sd of [-1, 1]) {
        const lz = zc + sd * (bw / 2 - 0.2);
        Q.box(xb - 0.05, xb + 0.05, ry, by + bh / 2 + 0.2, lz - 0.05, lz + 0.05, 0x2b2e33, S_PAINT, 'XxZz');   // the legs, up to the frame's top
        Q.beam([xb + 1.1, ry, lz], [xb + 0.05, by - bh / 2 - 0.1, lz], 0.06, 0x2b2e33);                        // a raking strut
      }
      boards.push({ x: xb + 0.08, y: by, z: zc, yaw: front.yaw, w: bw * 0.92, h: bh, kind: 'h' });
      kit.push('billboard');
    }
  }

  for (const p of parts) { Q.geo(p); p.dispose(); }
  const geo = Q.build();
  wallFinish(geo, grnd() < 0.55 ? 0.45 + grnd() * 0.4 : 0.05 + grnd() * 0.38);   // glazed tile on a little over half, plaster and board-marked concrete on the rest
  geo.computeBoundingSphere();
  const style = { residential, window: frontWin, sideWindow: sideWin, reveal: R, sills, showroom, bands: bandMode, cornice, columns, top, balconies: balcS.size, smallBalconies: smallBalc.length, shop: shuttered ? 'shutter' : 'open', roof: kit, stairs, mainRoof: Hm, recess, roomD };
  return { geo, boards, lamps, height: H, floors, tris: geo.index.count / 3, style };
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

/* The walls' detail, painted once (2026-09-23): a 4 m square at 128 px/m, DATA
   around 0.5 (the shader doubles it) so each building keeps its palette value.
     R  glazed nisho tile, 0.25 x 0.0625 m in running bond with 8 mm (1 px)
        grout, a tone per tile -- the commonest Tokyo mid-rise finish
     G  plaster / board-marked concrete: slow mottling, a joint every 2 m,
        form-tie holes on a 0.5 m grid in one panel in three
     B  weathering: rain streaks running down from random points, strongest
        where the water leaves the sill, fading down the wall
   Plus a normal map per finish from the same heights. ~1.5 MB of VRAM. */
let DETAIL = null;
function tokyoDetail() {
  if (DETAIL) return DETAIL;
  const N = 512, rnd = mulberry32(0x7c3a91);
  const lattice = (p, sd) => { const r = mulberry32(sd); const a = new Float32Array(p * p); for (let i = 0; i < a.length; i++) a[i] = r(); return a; };
  const vnoise = (a, p, x, y) => {   // smooth value noise, periodic in p lattice cells -- so the texture tiles
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const g = (i, j) => a[(((j % p) + p) % p) * p + (((i % p) + p) % p)];
    return (g(x0, y0) * (1 - sx) + g(x0 + 1, y0) * sx) * (1 - sy) + (g(x0, y0 + 1) * (1 - sx) + g(x0 + 1, y0 + 1) * sx) * sy;
  };
  const L8 = lattice(8, 11), L32 = lattice(32, 12), L128 = lattice(128, 13), tone = lattice(64, 14);
  const R = new Float32Array(N * N), G = new Float32Array(N * N), B = new Float32Array(N * N);
  const tileH = new Float32Array(N * N), plasH = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x, u = x / N, v = y / N;
      const mott = vnoise(L8, 8, u * 8, v * 8) * 0.6 + vnoise(L32, 32, u * 32, v * 32) * 0.3 + vnoise(L128, 128, u * 128, v * 128) * 0.1;
      const row = y >> 3, xx = (x + (row & 1) * 16) % N, col = xx >> 5;
      const grout = (xx & 31) === 0 || (y & 7) === 0;
      R[i] = grout ? 0.3 : 0.5 * (0.86 + tone[(row & 63) * 64 + (col & 63)] * 0.26) * (0.96 + mott * 0.08);
      tileH[i] = grout ? 0 : 1;
      const joint = (x & 255) < 2 || (y & 255) < 2;
      const tie = ((x >> 8) + (y >> 8)) % 3 === 0 && Math.hypot((x & 63) - 32, (y & 63) - 32) < 2.4;
      G[i] = joint ? 0.36 : tie ? 0.28 : 0.5 * (0.88 + mott * 0.24);
      plasH[i] = joint || tie ? 0.15 : 0.6 + mott * 0.2;
      B[i] = Math.max(0, mott - 0.55) * 0.5;   // a faint general dirt
    }
  }
  // rain streaks: canvas y grows DOWN the wall (CanvasTexture flips, so row 0 lands at the top of each 4 m band)
  for (let k = 0; k < 110; k++) {
    const x0 = rnd() * N, y0 = Math.floor(rnd() * N), len = 50 + rnd() * 280, w = 1 + rnd() * 3.5, a = 0.25 + rnd() * 0.55;
    for (let d = 0; d < len; d++) {
      const y = (y0 + d) % N, fall = 1 - d / len, cx = x0 + Math.sin((y0 + d) * 0.045 + k) * 0.9;
      for (let dx = -Math.ceil(w); dx <= Math.ceil(w); dx++) {
        const x = ((Math.round(cx) + dx) % N + N) % N, i = y * N + x;
        B[i] = Math.max(B[i], a * fall * Math.max(0, 1 - Math.abs(dx) / w));
      }
    }
  }
  const out = (fill) => {
    const c = cv(N, N), g = c.getContext('2d'), img = g.createImageData(N, N);
    for (let i = 0; i < N * N; i++) fill(img.data, i);
    g.putImageData(img, 0, 0);
    return c;
  };
  const b8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  const col = toTex(out((D, i) => { D[i * 4] = b8(R[i]); D[i * 4 + 1] = b8(G[i]); D[i * 4 + 2] = b8(B[i]); D[i * 4 + 3] = 255; }), false);
  const grey = (H) => out((D, i) => { const g = b8(H[i]); D[i * 4] = D[i * 4 + 1] = D[i * 4 + 2] = g; D[i * 4 + 3] = 255; });
  DETAIL = { col, tileN: normalFromCanvas(grey(tileH), 0.3), plasN: normalFromCanvas(grey(plasH), 0.6) };
  return DETAIL;
}

/**
 * The Tokyo buildings' own material (2026-09-23): the same vertex colour and
 * `emit` night as tokyoMaterial, now shaded by what each part IS (the `surf`
 * attribute, see SURF). Walls take the tile or plaster detail with its relief
 * and weathering and a darker kerb splash zone; glass is smooth (roughness
 * 0.05, so it carries the sky and the low sun -- most of what reads as "real"
 * on a GTA street), with an aluminium frame, a transom and seeded curtains or
 * blinds; metal and sign boxes are smooth paint; LEGACY parts (no attribute)
 * shade exactly as tokyoMaterial did. One draw per chunk still; walls pay three
 * texture samples a pixel. vertexColors is OFF on purpose: the colour attribute
 * is read here, because a frame or a curtain must REPLACE the glass's navy,
 * not be multiplied by it.
 */
let FACADE = null;
export function tokyoFacadeMaterial() {
  if (FACADE) return FACADE;
  const T = tokyoDetail();
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0, emissive: 0xffffff, emissiveIntensity: 1.0 });
  m.name = 'tokyo_facade_detail';
  m.envMapIntensity = 1.15;
  const surf = attribute('surf', 'float'), kind = floor(surf), vari = fract(surf);
  const wall = step(0.5, kind).mul(step(kind, 1.5)), isGlass = step(1.5, kind).mul(step(kind, 2.5));
  const isPaint = step(2.5, kind).mul(step(kind, 3.5)), legacy = step(kind, 0.5);
  const isDisplay = step(3.5, kind).mul(step(kind, 4.5)), isSash = step(4.5, kind), paned = isGlass.add(isDisplay);   // paned: glass in an aluminium frame
  const base = attribute('color', 'vec3');

  // walls: the building's finish, shifted per building so no two show the same streaks
  const wuv = uv().mul(0.25).add(vec2(vari.mul(7.31), vari.mul(3.17)));
  const d = texture(T.col, wuv), tile = step(0.45, vari);
  const splash = mix(float(0.8), float(1), smoothstep(0.3, 1.6, positionWorld.y));
  const wallCol = base.mul(mix(d.g, d.r, tile).mul(2.0)).mul(d.b.mul(-0.45).add(1)).mul(splash);

  // glass: frame and transom in aluminium, a curtain on one side, blinds, or clear
  const g = uv();
  const edge = min(min(g.x, g.x.oneMinus()), min(g.y, g.y.oneMinus()));
  const frame = max(step(edge, 0.055), step(abs(g.y.sub(0.7)), 0.018));
  const curtain = max(step(vari, 0.22).mul(step(g.x, 0.42)), step(0.22, vari).mul(step(vari, 0.34)).mul(step(0.6, g.x)));
  const blind = step(0.34, vari).mul(step(vari, 0.46)).mul(step(0.42, g.y));
  const slat = step(0.5, fract(g.y.mul(22))).mul(0.18).add(0.82);
  const glassCol = mix(mix(mix(base, vec3(0.40, 0.34, 0.27), curtain), vec3(0.55, 0.55, 0.52).mul(slat), blind), vec3(0.30, 0.31, 0.33), frame);
  /* A SASH WINDOW (2026-09-25): Regent Street's upper windows were plain navy
     panes in an aluminium line, where London's terraces are a grid of white
     painted timber -- the frame, the meeting rail where the two sashes pass,
     a glazing bar up each (2-over-2). Same curtains and blinds behind it, same
     night glow through the glass only. Colour and mask only; no geometry. */
  const sashBars = max(max(step(edge, 0.06), step(abs(g.y.sub(0.5)), 0.022)), step(abs(g.x.sub(0.5)), 0.013));
  const sashCol = mix(mix(mix(base, vec3(0.40, 0.34, 0.27), curtain), vec3(0.55, 0.55, 0.52).mul(slat), blind), vec3(0.80, 0.78, 0.72), sashBars);

  /* Paint with a pattern (2026-09-23), picked by PAINT's fraction
     (PAINT_VARIANT): 1 m panel seams (the FRP water tanks), 8 cm ribs (roller
     shutters, louvres, condensers), 12 cm slats (timber fences, corrugated
     sheds). It needs metre UVs, which every part carries. Colour only, and
     faded out by the pattern's own screen-space rate before it can alias: a
     roller shutter 80 m off is a flat grey, not moire. It replaces the six
     rib boxes each shutter carried (72 triangles); plain paint (0.05) is
     untouched. A few ALU a pixel on paint parts, no texture. */
  const mu = uv();
  const pan = step(0.15, vari).mul(step(vari, 0.35)), rib = step(0.35, vari).mul(step(vari, 0.55)), sla = step(0.55, vari);
  const fadeOf = (x) => float(1).sub(smoothstep(0.3, 0.8, fwidth(x)));
  const seam = (x) => step(abs(fract(x.add(0.5)).sub(0.5)), 0.025).mul(fadeOf(x.mul(20)));
  const stripe = (x) => step(0.5, fract(x)).mul(fadeOf(x));
  const paintK = float(1).sub(pan.mul(max(seam(mu.x), seam(mu.y))).mul(0.4))
    .sub(rib.mul(stripe(mu.y.mul(12.5))).mul(0.3)).sub(sla.mul(stripe(mu.x.mul(8.3))).mul(0.3));

  /* A SHOP WINDOW WITH ITS STOCK (2026-09-25). A lit shop pane was one flat
     colour, so every Regent Street shopfront read as a beige board. Now the
     pane (its own 0..1 UV) shows the room behind it: three shelf rows of
     products in seeded widths, heights and colours, a dark shelf edge under
     each row, a lit ceiling strip across the top and a darker floor. The
     vertex colour is the shop's light, so the stock sits in it. It fades to
     the flat lit tone by its own screen rate before it can shimmer, and the
     night emit carries the same pattern. A dozen ALU a display pixel, no
     texture, no draws. */
  const dq = uv(), dr = dq.y.mul(3.0), drow = floor(dr), dfy = fract(dr);
  const dcx = dq.x.mul(7.0).add(drow.mul(3.7)).add(vari.mul(11.0));
  const dh = fract(sin(floor(dcx).mul(12.9898).add(drow.mul(78.233)).add(vari.mul(37.719))).mul(43758.5453));
  const dFade = fadeOf(dcx);
  const stock = step(0.1, dfy).mul(step(dfy, mix(float(0.38), float(0.82), dh))).mul(step(0.14, fract(dcx))).mul(dFade);
  const shelfEdge = step(dfy, 0.06).mul(dFade);
  const hue = fract(dh.mul(7.13));
  // muted (2026-09-25, first on-screen look): at full swing the stock read as pastel toy boxes; shop light carries more of it
  const stockCol = vec3(0.5).add(vec3(0.3).mul(vec3(hue, hue.add(0.33), hue.add(0.67)).mul(6.2832).cos())).mul(0.5).add(base.mul(0.5));
  const ceiling = smoothstep(0.87, 0.97, dq.y), floorBand = step(dq.y, 0.06);
  const displayCol = mix(mix(mix(mix(base.mul(0.8), stockCol, stock.mul(0.85)), base.mul(0.3), shelfEdge), base.mul(0.45), floorBand).add(base.mul(ceiling.mul(0.7))), vec3(0.30, 0.31, 0.33), frame);
  const displayGlow = mix(float(1), float(0.55).add(stock.mul(0.45)).add(ceiling.mul(0.9)).mul(shelfEdge.oneMinus()), isDisplay);

  m.colorNode = wallCol.mul(wall).add(glassCol.mul(isGlass)).add(displayCol.mul(isDisplay)).add(sashCol.mul(isSash)).add(base.mul(isPaint.mul(paintK).add(legacy)));
  m.roughnessNode = mix(float(0.9), float(0.55), tile).mul(wall)
    .add(mix(float(0.05), float(0.42), frame).mul(paned)).add(mix(float(0.05), float(0.55), sashBars).mul(isSash))
    .add(float(0.45).mul(isPaint)).add(float(0.48).mul(legacy));
  m.metalnessNode = float(0.22).mul(legacy);
  /* Relief on the walls only. Y is negated: the heights were painted with
     canvas y running DOWN the wall and the derivative frame's +v runs up, so
     unflipped the grout would read raised, lit from below. */
  const nm = normalMap(mix(texture(T.plasN, wuv), texture(T.tileN, wuv), tile).xyz, vec2(0.9, -0.9));
  m.normalNode = select(wall.greaterThan(0.5), nm, normalView);

  const ph = attribute('flick', 'float');
  const buzz = mix(float(1), float(0.45).add(float(0.55).mul(step(float(0.35), sin(time.mul(23).add(ph.mul(7)))))), step(float(0.01), ph));
  m.emissiveNode = attribute('emit', 'vec3').mul(materialReference('emissiveIntensity', 'float', m)).mul(buzz).mul(frame.mul(paned).add(sashBars.mul(isSash)).oneMinus()).mul(displayGlow);   // a lit room glows, its window frame does not; a display glows in its stock's pattern
  FACADE = m;
  return m;
}

/** A painted box carrying every attribute the Tokyo mesh has: what the boot warm-up compiles tokyoFacadeMaterial on. */
export function tokyoWarmGeometry() { return box(1, 1, 1, 0x808080); }

/** 0 by day, 1 at night: the windows, neon and kanban faces come up with it. */
export function setTokyoNight(k) {
  setTokyoSignNight(k);   // the boards (world/tokyoSigns.js) light up with the street
  const e = 0.05 + 1.45 * Math.max(0, Math.min(1, k));   // windows stay a texture (emit 0.16); neon at 2.4x blooms
  if (MAT) MAT.emissiveIntensity = e;
  if (FACADE) FACADE.emissiveIntensity = e;
}

export const TOKYO_KIT = { SURF, paint, box, metal, cyl, quad, glass, display, at, faces, onFace, wallFinish, flickerOf, WALLS, LIGHT, NEON, WARM, COOL, MAGENTA, CYAN, GROUND_H, FLOOR_H };
