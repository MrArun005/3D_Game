/**
 * Shared kit for the self-built building styles (world/buildings/*.js) --
 * the four reference boards Arun dropped in assets/art/building_*.jpg:
 * brick warehouse, CBD glass tower, office midrise, residential loft. Same
 * idea as world/tokyo.js: every building is plain geometry we author in
 * code, merged per chunk; no Kenney, no kit. Two differences from Tokyo:
 *
 *  1. Parts are grouped by MATERIAL KEY (brick, glass, concrete, plaster,
 *     metal, dark, timber, emit) instead of one vertex-coloured mesh, so a
 *     wall can wear the library's brick_red PBR set with a real normal map.
 *     districtWorld merges one mesh per key per chunk (<= 8 draws a chunk).
 *  2. Every part carries UVs in METRES (boxM scales BoxGeometry's per-face
 *     0..1 by the face size), so a tiled library texture repeats at its
 *     `tile` scale and never stretches -- hard rule 4 in CLAUDE.md.
 *
 * Contract every style module exports:
 *   build(seed, hw, hd, h) -> { parts: [{ geo, mat }], boards, lamps, height, floors }
 *   hw, hd  half footprint along local X (street axis) and Z; +X is the
 *           street face (districtWorld turns the building with frontRotation)
 *   h       the planner's height in metres; snap to whole storeys
 *   boards  [{ x, y, z, yaw, w, h, vertical? }] local-frame sign boards for
 *           the atlas quads (fascias, projecting signs); yaw as tokyo.js
 *   lamps   [{ x, y, z, colour }] local-frame light heads for the night pool
 *           and the glare sprites (entrance canopies, sign lights)
 * `emit` parts use the Tokyo attribute set (color + emit + flick) and are
 * drawn with tokyoMaterial(): lit windows, signs, canopy soffits.
 */
import * as THREE from 'three';

export const MAT_KEYS = ['brick', 'glass', 'concrete', 'plaster', 'metal', 'dark', 'timber', 'emit'];

const _c = new THREE.Color();

/** Add `color`, `emit`, `flick` attributes (the Tokyo set), flat. */
export function paint(geo, hex, emit = null, k = 1, flick = 0) {
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
export const flickerOf = (rnd) => (rnd() < 0.15 ? 0.5 + rnd() * 6 : 0);

/**
 * A box whose UVs are in metres. three's BoxGeometry lays its 24 vertices
 * out face by face (+x, -x, +y, -y, +z, -z; 4 vertices each) with 0..1 UVs;
 * we scale each face's UVs by that face's width and height so a 1 m tile
 * texture repeats once per metre on every side.
 */
export function boxM(w, h, d, hex = 0xffffff, emit = null, k = 1, flick = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];   // per face: [u extent, v extent]
  for (let i = 0; i < uv.count; i++) {
    const [su, sv] = dims[Math.floor(i / 4)];
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  return paint(g, hex, emit, k, flick);
}
/** A +Z-facing quad with metre UVs; turn it with at(..., ry). */
export function quadM(w, h, hex = 0xffffff, emit = null, k = 1, flick = 0) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
  return paint(g, hex, emit, k, flick);
}
/** A cylinder (tanks, columns, pipes); UVs already metre-ish enough for round parts. */
export const cylM = (r, h, hex = 0xffffff, seg = 12) => paint(new THREE.CylinderGeometry(r, r, h, seg), hex);

const _m = new THREE.Matrix4(), _e = new THREE.Euler();
/** Turn about Y then move, in place. */
export function at(geo, x, y, z, ry = 0) {
  if (ry) geo.applyMatrix4(_m.makeRotationFromEuler(_e.set(0, ry, 0)));
  geo.applyMatrix4(_m.makeTranslation(x, y, z));
  return geo;
}

/* The four faces in the local frame. `n` is the outward normal, `t` the
   along-face tangent, `w` the face width, `yaw` turns a +Z-facing quad to
   face outward (normal = (sin yaw, 0, cos yaw)). Front = +X = the street. */
export function faces(hw, hd) {
  return [
    { name: 'front', n: [1, 0], t: [0, 1], w: 2 * hd, yaw: Math.PI / 2, off: hw },
    { name: 'back', n: [-1, 0], t: [0, -1], w: 2 * hd, yaw: -Math.PI / 2, off: hw },
    { name: 'left', n: [0, 1], t: [-1, 0], w: 2 * hw, yaw: 0, off: hd },
    { name: 'right', n: [0, -1], t: [1, 0], w: 2 * hw, yaw: Math.PI, off: hd },
  ];
}
/** Point on a face: `s` along the face from its centre, `out` proud of the wall. */
export function onFace(f, s, out) {
  return [f.n[0] * (f.off + out) + f.t[0] * s, f.n[1] * (f.off + out) + f.t[1] * s];
}

/** Collect parts by material key: push(mat, geo). */
export class Parts {
  constructor() { this.list = []; }
  push(mat, geo) {
    if (!MAT_KEYS.includes(mat)) throw new Error(`artKit: unknown material key ${mat}`);
    this.list.push({ mat, geo });
    return geo;
  }
}
