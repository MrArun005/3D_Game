import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { attribute, materialReference } from 'three/tsl';
import { mulberry32 } from '../core/rng.js';

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
 * positions for the shared sign atlas quads (world/signs.js, the same
 * instanced mesh the rest of the city uses, with the atlas's Tokyo tiles), so
 * the kanban read as ラーメン and カラオケ, not as coloured slabs.
 *
 * Local frame: origin at the footprint centre on the ground, +X is the
 * street side, footprint is 2hw (along X) by 2hd (along Z). Deterministic
 * per seed (CLAUDE.md: seeded randomness only).
 */

export const GROUND_H = 4.2;   // shopfront storey
export const FLOOR_H = 3.1;    // every storey above

// facade palettes: [wall, band], Tokyo's tile and render greys and creams with the odd brown or teal
const WALLS = [
  [0xd9d4c7, 0xbcb6a8], [0xb8b2a6, 0x9b958a], [0x8c8f93, 0x6f7276], [0x6b4f3a, 0x52392a],
  [0x4b6a6e, 0x3a5457], [0xe8e2d3, 0xcfc8b8], [0x9d7b6a, 0x7d5f50], [0x7a8794, 0x5f6b77],
];
const NEON = [[1.0, 0.25, 0.75], [0.2, 0.9, 1.0], [1.0, 0.85, 0.2], [0.95, 0.95, 1.0], [1.0, 0.3, 0.2], [0.5, 1.0, 0.4]];
const WARM = [1.0, 0.82, 0.55], COOL = [0.72, 0.85, 1.0];
const _c = new THREE.Color();

/** Add `color` and `emit` attributes to a geometry, flat. */
function paint(geo, hex, emit = null, k = 1) {
  _c.setHex(hex);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3), em = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    if (emit) { em[i * 3] = emit[0] * k; em[i * 3 + 1] = emit[1] * k; em[i * 3 + 2] = emit[2] * k; }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('emit', new THREE.BufferAttribute(em, 3));
  return geo;
}
const box = (w, h, d, hex, emit, k) => paint(new THREE.BoxGeometry(w, h, d), hex, emit, k);
const cyl = (r, h, hex, seg = 10) => paint(new THREE.CylinderGeometry(r, r, h, seg), hex);
/** A quad facing +Z in its own frame, then turned to face `ry` about Y and moved. */
const quad = (w, h, hex, emit, k) => paint(new THREE.PlaneGeometry(w, h), hex, emit, k);
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
 * boards: [{ x, y, z, yaw, w, h }] in the local frame for the sign atlas.
 */
export function buildTokyoBuilding(seed, hw, hd, h) {
  const rnd = mulberry32((seed * 2654435761) >>> 0);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const floors = Math.max(2, Math.min(14, Math.round((h - GROUND_H) / FLOOR_H) + 1));
  const H = GROUND_H + (floors - 1) * FLOOR_H;
  const floorY = (f) => (f === 0 ? 0 : GROUND_H + (f - 1) * FLOOR_H);   // bottom of storey f
  const [wall, band] = pick(WALLS);
  const residential = rnd() < 0.5;
  const neon = rnd() < 0.45 ? pick(NEON) : null;
  const parts = [], boards = [];
  const F = faces(hw, hd);

  // the mass and the storey bands
  parts.push(at(box(2 * hw, H, 2 * hd, wall), 0, H / 2, 0));
  for (let f = 1; f < floors; f++) parts.push(at(box(2 * hw + 0.08, 0.16, 2 * hd + 0.08, band), 0, floorY(f), 0));
  // the ground storey is a different skin: darker plinth and a fascia line
  parts.push(at(box(2 * hw + 0.06, 0.5, 2 * hd + 0.06, band), 0, 0.25, 0));

  // windows on every face above the ground storey; a fraction lit, warm or cool
  for (const f of F) {
    // the street face is dense (a window every 2.4 m); backs and sides are sparser (3.4 m) -- half the triangles where nobody looks up
    const bays = Math.max(1, Math.floor((f.w - 0.8) / (f.name === 'front' ? 2.4 : 3.4)));
    const pitch = f.w / bays;
    for (let s = 1; s < floors; s++) {
      for (let b = 0; b < bays; b++) {
        const along = -f.w / 2 + pitch * (b + 0.5);
        const lit = rnd() < 0.55;
        const em = lit ? (rnd() < 0.7 ? WARM : COOL) : null;
        const [x, z] = onFace(f, along, 0.035);
        parts.push(at(quad(Math.min(1.4, pitch * 0.55), 1.5, 0x131a24, em, 0.85), x, floorY(s) + 1.55, z, f.yaw));
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

  // the street face: shopfront glass, awning, fascia board, kanban columns, neon
  const front = F[0];
  const [gx, gz] = onFace(front, 0, 0.03);
  parts.push(at(quad(front.w - 0.6, 2.7, 0x1c2430, WARM, 0.5), gx, 1.65, gz, front.yaw));
  const awningCol = pick([0xc0392b, 0x2e86de, 0xf1c40f, 0xecf0f1, 0x27ae60]);
  const [ax, az] = onFace(front, 0, 0.7);
  parts.push(at(box(1.35, 0.08, front.w * 0.9, awningCol), ax, 3.25, az));
  boards.push({ x: front.off + 0.16, y: 3.85, z: 0, yaw: front.yaw, w: front.w * 0.82, h: 0.85 });   // the fascia
  const colH = Math.min(H - 5.5, 6 + rnd() * 8);
  if (colH > 3.5) {
    for (const side of [-1, 1]) {
      if (rnd() < 0.15) continue;
      const cz = side * (hd - 0.55);
      parts.push(at(box(0.28, colH, 0.95, 0xf2f2f2, [0.9, 0.9, 0.9], 0.5), hw + 0.18, 4.6 + colH / 2, cz));
      // a kanban is a stack of tenants: one panel per floor of the column, each its own tile (the caller picks the tile by position)
      const panelH = 1.15, n = Math.max(2, Math.floor((colH - 0.2) / (panelH + 0.08)));
      for (let i = 0; i < n; i++) boards.push({ x: hw + 0.335, y: 4.6 + 0.1 + panelH / 2 + i * (panelH + 0.08), z: cz, yaw: front.yaw, w: 0.9, h: panelH });
    }
  }
  // izakaya: a row of red paper lanterns under the awning, glowing
  if (rnd() < 0.35) {
    const n = 3 + Math.floor(rnd() * 3), span = front.w * 0.7;
    for (let i = 0; i < n; i++) {
      const [lx, lz] = onFace(front, -span / 2 + span * (i / Math.max(1, n - 1)), 0.55);
      parts.push(at(paint(new THREE.CylinderGeometry(0.17, 0.17, 0.32, 8), 0xc0392b, [1.0, 0.32, 0.12], 1.1), lx, 2.95, lz));
    }
  }
  if (neon) for (let s = 1; s < floors; s += 1 + Math.floor(rnd() * 2)) {
    const [nx, nz] = onFace(front, 0, 0.06);
    parts.push(at(box(0.06, 0.07, front.w * 0.96, 0x222222, neon, 1.4), nx, floorY(s) + 0.2, nz));
  }

  // the roof: parapet, tank, antenna, stair bulkhead, and a billboard frame on a third
  const pw = 0.22;
  parts.push(at(box(2 * hw + 0.1, 0.5, pw, band), 0, H + 0.25, hd), at(box(2 * hw + 0.1, 0.5, pw, band), 0, H + 0.25, -hd));
  parts.push(at(box(pw, 0.5, 2 * hd + 0.1, band), hw, H + 0.25, 0), at(box(pw, 0.5, 2 * hd + 0.1, band), -hw, H + 0.25, 0));
  const tx = -hw * 0.45, tz = hd * 0.4;
  parts.push(at(cyl(0.85, 1.5, 0xbfc3c9), tx, H + 1.35, tz), at(box(1.9, 0.6, 1.9, 0x6f7276), tx, H + 0.3, tz));
  parts.push(at(box(0.07, 3.6, 0.07, 0x3a3d42), hw * 0.55, H + 1.8, -hd * 0.5));
  parts.push(at(box(2.2, 2.4, 2.4, wall), -hw * 0.3, H + 1.2, -hd * 0.45));
  if (rnd() < 0.35 && 2 * hd > 5) {
    const bw = Math.min(2 * hd - 1.2, 9), by = H + 2.2;
    parts.push(at(box(0.12, 2.8, bw, 0x2b2e33), -hw + 0.3, by, 0));
    parts.push(at(box(0.08, 3.2, 0.08, 0x2b2e33), -hw + 0.3, H + 1.6, -bw / 2 + 0.2), at(box(0.08, 3.2, 0.08, 0x2b2e33), -hw + 0.3, H + 1.6, bw / 2 - 0.2));
    boards.push({ x: -hw + 0.38, y: by, z: 0, yaw: front.yaw, w: bw * 0.92, h: 2.4 });
  }

  const geo = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  geo.computeBoundingSphere();
  return { geo, boards, height: H, floors, tris: geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3 };
}

/**
 * Which side faces the street: sample a point 3 m outside each face and take
 * the one deepest into tarmac. Returns the rotation (about Y, radians) that
 * turns the generator's +X front onto that side. `probe(x, z)` is
 * district.tarmacDepth in the block's world frame; `toWorld(lx, lz)` maps the
 * footprint's local frame to world. Pure; tested.
 */
export function frontRotation(probe, toWorld, hw, hd) {
  const tests = [[hw + 3, 0, 0], [-hw - 3, 0, Math.PI], [0, hd + 3, -Math.PI / 2], [0, -hd - 3, Math.PI / 2]];
  let best = 0, bestD = -Infinity;
  for (const [lx, lz, rot] of tests) {
    const [x, z] = toWorld(lx, lz);
    const d = probe(x, z);
    if (d > bestD) { bestD = d; best = rot; }
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

let WIRE_MAT = null;
export function wireMaterial() { return (WIRE_MAT ??= new THREE.LineBasicMaterial({ color: 0x0f1113 })); }

/** One material for every Tokyo building: vertex colour albedo, `emit` attribute as emissive, dimmed by day through emissiveIntensity. */
let MAT = null;
export function tokyoMaterial() {
  if (MAT) return MAT;
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.84, metalness: 0.02, emissive: 0xffffff, emissiveIntensity: 1.0 });
  m.name = 'tokyo_facade';
  m.emissiveNode = attribute('emit', 'vec3').mul(materialReference('emissiveIntensity', 'float', m));
  MAT = m;
  return m;
}

/** 0 by day, 1 at night: the windows, neon and kanban faces come up with it. */
export function setTokyoNight(k) {
  if (MAT) MAT.emissiveIntensity = 0.05 + 1.15 * Math.max(0, Math.min(1, k));
}
