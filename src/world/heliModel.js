import * as THREE from 'three';
import { attribute, positionLocal, vec3, vec4, float, abs, mix, select, step, smoothstep, floor, max } from 'three/tsl';
import { toTex } from './textures.js';

/**
 * The helicopter, rebuilt (2026-09-23): one twin-engine light helicopter in
 * the H135 mould, shared by the police air unit (game/helicopter.js) and the
 * one you fly (game/flight.js), in two liveries. It replaces two copies of a
 * ~30-mesh model made of spheres and boxes, whose canopy was a transmission
 * MeshPhysicalMaterial -- a second render of the opaque scene every frame it
 * was on screen.
 *
 *   fuselage  one smooth pod-and-boom loft (superellipse sections, spline
 *             through key stations); windscreen, chin windows and cabin side
 *             windows cut from the SAME surface, so glass sits flush
 *   cowling   engine deck with intakes and twin exhausts, mast fairing
 *   tail      fenestron shroud (an extruded fin with a real duct) and fin,
 *             T-stabiliser with endplates, stator struts; the fan spins in the
 *             `tail` group about Z (lateral) -- the old tail spun about X
 *   skids     tube runners with upturned toes, arched cross tubes, steps
 *   police    FLIR ball, Nightsun searchlight, livery + POLICE lettering
 *             conformed to the cabin side
 *   rotor     four tapered blades with tip caps, flexbeam hub, dome; the
 *             translucent blur disc is per helicopter (flight.js fades it)
 *
 * Draws: hull 1, rotor 1, disc 1, fan 1, beacon 1, strobe 1, lettering 1.
 * Nav lights are per the rules of the air -- red on the LEFT (+Z), green on
 * the right; the old model had them the other way round.
 *
 * Model space: +X forward, +Y up, +Z left; the group origin is 1.25 m above
 * the skids (flight.js rests at ground + minGroundClearance = 1.25).
 */

export const SKID_Y = -1.25;
export const ROTOR_AT = new THREE.Vector3(0, 1.62, 0);
export const FAN_AT = new THREE.Vector3(-6.62, 0.58, 0);
export const ROTOR_R = 5.1;

const K = { paint: 0, glass: 1, dark: 2, steel: 3, rotor: 4, hazard: 5, navRed: 6, navGreen: 7, lamp: 8, lens: 9 };

/* --------------------------------------------------------------- kit */

class Parts {
  constructor() { this.list = []; }
  add(geo, kind, matrix = null) {
    if (geo.index === null) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
    if (matrix) geo.applyMatrix4(matrix);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const n = geo.attributes.position.count, tag = new Float32Array(n).fill(kind);
    geo.setAttribute('aKind', new THREE.BufferAttribute(tag, 1));
    geo.clearGroups();
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'aKind'].includes(name)) geo.deleteAttribute(name);
    this.list.push(geo);
    return geo;
  }
  build() {
    const names = ['position', 'normal', 'uv', 'aKind'];
    let n = 0, ni = 0;
    for (const p of this.list) { n += p.attributes.position.count; ni += p.index.count; }
    const out = new THREE.BufferGeometry();
    for (const name of names) {
      const size = this.list[0].attributes[name].itemSize, arr = new Float32Array(n * size);
      let o = 0;
      for (const p of this.list) { const a = p.attributes[name]; arr.set(a.array.subarray(0, a.count * size), o); o += a.count * size; }
      out.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    const index = n > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let o = 0, base = 0;
    for (const p of this.list) {
      const src = p.index.array;
      for (let i = 0; i < p.index.count; i++) index[o + i] = src[i] + base;
      o += p.index.count; base += p.attributes.position.count;
      p.dispose();
    }
    out.setIndex(new THREE.BufferAttribute(index, 1));
    out.computeBoundingSphere();
    return out;
  }
}

const m4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

function cyl(rTop, rBot, len, seg, axis = 'y', open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, seg, 1, open);
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  else if (axis === 'z') g.rotateX(Math.PI / 2);
  return g;
}

function chamferBox(w, h, d, c = 0.02) {
  c = Math.min(c, w / 3, h / 3, d / 3);
  const hw = w / 2 - c, hh = h / 2 - c;
  const s = new THREE.Shape();
  s.moveTo(-hw, -hh - c); s.lineTo(hw, -hh - c); s.lineTo(hw + c, -hh); s.lineTo(hw + c, hh); s.lineTo(hw, hh + c);
  s.lineTo(-hw, hh + c); s.lineTo(-hw - c, hh); s.lineTo(-hw - c, -hh); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * c, bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelOffset: -c, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -(d - 2 * c) / 2);
  return g;
}

/** Catmull-Rom through key stations, per parameter: a smooth fuselage from a handful of numbers. */
function spline(keys, steps) {
  const out = [];
  const P = (i) => keys[Math.max(0, Math.min(keys.length - 1, i))];
  for (let i = 0; i < keys.length - 1; i++) {
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const a = P(i - 1), b = P(i), c = P(i + 1), d = P(i + 2);
      out.push(b.map((_, j) => 0.5 * ((2 * b[j]) + (-a[j] + c[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t2 + (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * t3)));
    }
  }
  out.push(keys[keys.length - 1].slice());
  return out;
}

/* A section: [x, yc, halfWidth, top, bottom, squareness]. */
function sectionPoint(st, t) {
  const [x, yc, hw, top, bot, n] = st;
  const c = Math.cos(t), s = Math.sin(t);
  const z = hw * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
  const y = yc + (s >= 0 ? top : bot) * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
  return [x, y, z];
}

/** The half-width of a section at height y (for decals that must lie on the skin). */
function sectionZ(st, y) {
  const [, yc, hw, top, bot, n] = st;
  const rel = Math.min(0.999, Math.abs((y - yc) / (y >= yc ? top : bot)));
  const s = Math.pow(rel, n / 2), c = Math.sqrt(Math.max(0, 1 - s * s));
  return hw * Math.pow(c, 2 / n);
}

/**
 * Loft stations into a skin, one kind per quad from `classify(x, rel, z)`
 * (rel: -1 at the keel .. +1 at the roof); smooth normals over the grid, each
 * quad its own four vertices so kinds split cleanly; triangles wound outward.
 */
function loftSkin(P, stations, N, classify) {
  const S = stations.length;
  const grid = stations.map((st) => Array.from({ length: N }, (_, k) => sectionPoint(st, (k / N) * Math.PI * 2)));
  // smooth vertex normals: average of the faces around each grid point
  const fn = [];
  for (let i = 0; i < S - 1; i++) {
    fn.push([]);
    for (let k = 0; k < N; k++) {
      const a = grid[i][k], b = grid[i + 1][k], c = grid[i + 1][(k + 1) % N];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
      // outward = away from the section's axis
      const cyv = (a[1] + c[1]) / 2 - stations[i][1], cz = (a[2] + c[2]) / 2;
      const sgn = (ny * cyv + nz * cz) >= 0 ? 1 : -1;
      const l = Math.hypot(nx, ny, nz) || 1;
      fn[i].push([sgn * nx / l, sgn * ny / l, sgn * nz / l]);
    }
  }
  const vn = grid.map((row, i) => row.map((_, k) => {
    const acc = [0, 0, 0];
    for (const qi of [i - 1, i]) { if (qi < 0 || qi >= S - 1) continue; for (const qk of [(k - 1 + N) % N, k]) { const f = fn[qi][qk]; acc[0] += f[0]; acc[1] += f[1]; acc[2] += f[2]; } }
    const l = Math.hypot(...acc) || 1;
    return [acc[0] / l, acc[1] / l, acc[2] / l];
  }));
  const x0 = stations[0][0], xl = stations[S - 1][0] - x0 || 1;
  const byKind = new Map();
  for (let i = 0; i < S - 1; i++) for (let k = 0; k < N; k++) {
    const k2 = (k + 1) % N;
    const q = [grid[i][k], grid[i + 1][k], grid[i + 1][k2], grid[i][k2]];
    const qn = [vn[i][k], vn[i + 1][k], vn[i + 1][k2], vn[i][k2]];
    const xm = (q[0][0] + q[1][0]) / 2, ym = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4, zm = (q[0][2] + q[1][2] + q[2][2] + q[3][2]) / 4;
    const st = stations[i];
    const rel = (ym - st[1]) / (ym >= st[1] ? st[3] : st[4]);
    const kind = classify(xm, rel, zm);
    let b = byKind.get(kind);
    if (!b) byKind.set(kind, (b = { p: [], n: [], u: [], i: [] }));
    const base = b.p.length / 3;
    q.forEach((v, j) => { b.p.push(...v); b.n.push(...qn[j]); b.u.push((v[0] - x0) / xl, (j === 2 || j === 3 ? k + 1 : k) / N); });
    // winding: face normal (from the order) against the smooth normal
    const f = fn[i][k];
    const u = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]], w = [q[2][0] - q[0][0], q[2][1] - q[0][1], q[2][2] - q[0][2]];
    const cr = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    if (cr[0] * f[0] + cr[1] * f[1] + cr[2] * f[2] >= 0) b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else b.i.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  for (const [kind, b] of byKind) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
    g.setIndex(b.i);
    P.add(g, kind);
  }
}

/* ------------------------------------------------------------ fuselage */

/* Key stations: [x, yc, halfWidth, top, bottom, squareness]. Nose at +3.0,
   cabin 1.64 wide, roof 0.90, keel -0.82, then the boom tapers into the shroud. */
const HULL_KEYS = [
  [3.02, -0.32, 0.03, 0.03, 0.03, 2.0],
  [2.88, -0.26, 0.32, 0.34, 0.38, 2.2],
  [2.58, -0.16, 0.56, 0.62, 0.62, 2.4],
  [2.12, -0.06, 0.73, 0.80, 0.76, 2.6],
  [1.50, 0.00, 0.80, 0.88, 0.82, 2.8],
  [0.60, 0.02, 0.82, 0.88, 0.84, 3.0],
  [-0.40, 0.02, 0.80, 0.86, 0.84, 3.0],
  [-1.10, 0.08, 0.72, 0.78, 0.66, 2.8],
  [-1.62, 0.20, 0.50, 0.60, 0.40, 2.6],
  [-2.15, 0.30, 0.34, 0.40, 0.27, 2.4],
  [-3.50, 0.42, 0.25, 0.27, 0.21, 2.2],
  [-5.00, 0.52, 0.19, 0.21, 0.17, 2.1],
  [-6.05, 0.57, 0.155, 0.17, 0.145, 2.0],
  [-6.30, 0.58, 0.05, 0.05, 0.05, 2.0],
];
const HULL = spline(HULL_KEYS, 3);

/** The hull section at x (nearest spline station): decals conform to it. */
function hullAt(x) {
  let best = HULL[0], d = Infinity;
  for (const st of HULL) { const e = Math.abs(st[0] - x); if (e < d) { d = e; best = st; } }
  return best;
}

function glassOf(x, rel, z) {
  const az = Math.abs(z);
  // windscreen and roof glazing, split by a centre post
  if (x > 0.92 && x < 2.93 && rel > -0.30 && !(az < 0.045 && rel > 0.2)) return K.glass;
  // chin windows below it
  if (x > 1.55 && x < 2.72 && rel > -0.78 && rel <= -0.30 && az > 0.12) return K.glass;
  // cabin side windows (sliding doors), a B-pillar between them
  if (x > -0.95 && x < 0.80 && rel > 0.04 && rel < 0.74 && az > 0.45 && !(x > -0.13 && x < 0.03)) return K.glass;
  return K.paint;
}

function buildHull(livery) {
  const P = new Parts();
  loftSkin(P, HULL, 28, glassOf);

  // cowling / engine deck, with the mast fairing
  const COWL = spline([
    [0.72, 0.92, 0.28, 0.06, 0.10, 3.0],
    [0.50, 1.00, 0.52, 0.20, 0.20, 3.4],
    [0.00, 1.04, 0.58, 0.24, 0.24, 3.6],
    [-1.00, 1.03, 0.55, 0.23, 0.24, 3.6],
    [-1.80, 0.99, 0.45, 0.18, 0.20, 3.2],
    [-2.12, 0.94, 0.28, 0.10, 0.14, 3.0],
  ], 2);
  loftSkin(P, COWL, 20, () => K.paint);
  P.add(new THREE.SphereGeometry(0.30, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), K.paint, m4(0, 1.26, 0, 0, 0, 0, 1, 0.55, 1));
  P.add(cyl(0.10, 0.12, 0.40, 10), K.steel, m4(ROTOR_AT.x, 1.42, 0));
  // intakes and exhausts
  for (const side of [1, -1]) {
    P.add(chamferBox(0.70, 0.16, 0.04, 0.012), K.dark, m4(-0.55, 1.07, side * 0.575));
    for (let i = 0; i < 5; i++) P.add(new THREE.BoxGeometry(0.02, 0.13, 0.02), K.steel, m4(-0.83 + i * 0.14, 1.07, side * 0.595));
    P.add(cyl(0.10, 0.11, 0.26, 12, 'x', true), K.dark, m4(-2.12, 1.00, side * 0.22, 0, side * 0.18, 0));
  }

  // fenestron shroud and fin: one extruded outline with a duct through it
  {
    const s = new THREE.Shape();
    const pts = [[-5.92, 0.34], [-6.30, -0.02], [-6.95, -0.06], [-7.28, 0.30], [-7.34, 0.90], [-7.58, 2.12], [-7.22, 2.22], [-6.72, 1.30], [-6.08, 0.92]];
    pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
    s.closePath();
    const duct = new THREE.Path(); duct.absarc(FAN_AT.x, FAN_AT.y, 0.47, 0, Math.PI * 2, true); s.holes.push(duct);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.30, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelOffset: -0.02, bevelSegments: 2, curveSegments: 20 });
    g.translate(0, 0, -0.15);
    P.add(g, K.paint);
    // the duct's lining, and three stator struts
    P.add(cyl(0.475, 0.475, 0.36, 24, 'z', true), K.dark, m4(FAN_AT.x, FAN_AT.y, 0, 0, 0, 0, 1, 1, 1));
    for (let i = 0; i < 3; i++) {
      const a = Math.PI * 0.5 + (i / 3) * Math.PI * 2;
      P.add(new THREE.BoxGeometry(0.40, 0.035, 0.03), K.dark, m4(FAN_AT.x + Math.cos(a) * 0.24, FAN_AT.y + Math.sin(a) * 0.24, -0.1, 0, 0, a));
    }
    P.add(cyl(0.11, 0.11, 0.12, 12, 'z'), K.dark, m4(FAN_AT.x, FAN_AT.y, -0.1));
  }
  // horizontal stabiliser with endplates (nav lights on them)
  P.add(chamferBox(0.56, 0.07, 2.50, 0.02), K.paint, m4(-5.30, 0.46, 0));
  for (const side of [1, -1]) {
    P.add(chamferBox(0.46, 0.44, 0.04, 0.01), K.paint, m4(-5.36, 0.53, side * 1.25, 0, 0, 0.1));
    P.add(chamferBox(0.07, 0.05, 0.05, 0.01), side > 0 ? K.navRed : K.navGreen, m4(-5.10, 0.50, side * 1.285));
  }

  // skids: runners with upturned toes, two arched cross tubes, steps
  for (const side of [1, -1]) {
    const z = side * 1.02;
    const path = new THREE.CurvePath();
    path.add(new THREE.QuadraticBezierCurve3(new THREE.Vector3(2.02, -0.98, z), new THREE.Vector3(1.86, -1.21, z), new THREE.Vector3(1.50, -1.21, z)));
    path.add(new THREE.LineCurve3(new THREE.Vector3(1.50, -1.21, z), new THREE.Vector3(-1.62, -1.21, z)));
    P.add(new THREE.TubeGeometry(path, 26, 0.045, 7, false), K.steel);
    P.add(new THREE.SphereGeometry(0.045, 7, 4), K.steel, m4(-1.62, -1.21, z));
    P.add(chamferBox(0.34, 0.03, 0.16, 0.01), K.dark, m4(0.35, -1.02, side * 0.92));
    P.add(cyl(0.02, 0.02, 0.2, 6), K.steel, m4(0.35, -1.11, side * 0.97));
  }
  for (const x of [1.05, -0.95]) {
    const arch = new THREE.CatmullRomCurve3([
      [x, -1.21, 1.02], [x, -1.06, 0.99], [x, -0.92, 0.80], [x, -0.87, 0.42], [x, -0.87, -0.42], [x, -0.92, -0.80], [x, -1.06, -0.99], [x, -1.21, -1.02],
    ].map((p) => new THREE.Vector3(...p)));
    P.add(new THREE.TubeGeometry(arch, 24, 0.05, 7, false), K.steel);
  }

  // nose: pitot tubes, a wiper stub, the belly antenna
  for (const side of [1, -1]) P.add(cyl(0.012, 0.018, 0.30, 6, 'x'), K.steel, m4(2.70, 0.02, side * 0.30));
  P.add(chamferBox(0.36, 0.14, 0.02, 0.005), K.dark, m4(-2.9, 0.20, 0, 0, 0, 0.35));
  P.add(cyl(0.006, 0.01, 0.9, 5), K.steel, m4(-2.6, 0.95, 0, 0, 0, -0.35));

  if (livery === 'police') {
    // FLIR ball under the nose, window forward
    P.add(cyl(0.07, 0.08, 0.16, 10), K.dark, m4(2.28, -0.80, 0));
    P.add(new THREE.SphereGeometry(0.20, 14, 10), K.steel, m4(2.28, -1.00, 0));
    P.add(new THREE.SphereGeometry(0.12, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), K.lens, m4(2.42, -1.00, 0, 0, 0, -Math.PI / 2, 1, 0.45, 1));
    // Nightsun searchlight on the right, under the cabin
    P.add(chamferBox(0.30, 0.08, 0.10, 0.02), K.dark, m4(1.45, -0.80, -0.70));
    P.add(cyl(0.16, 0.13, 0.36, 14, 'x'), K.dark, m4(1.48, -0.94, -0.78, 0, 0, -0.3));
    P.add(cyl(0.135, 0.135, 0.02, 14, 'x'), K.lamp, m4(1.66, -1.00, -0.78, 0, 0, -0.3));
  }
  return P.build();
}

/* ---------------------------------------------------------------- rotors */

function buildRotor() {
  const P = new Parts();
  P.add(cyl(0.26, 0.29, 0.12, 16), K.steel);
  P.add(new THREE.SphereGeometry(0.17, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), K.dark, m4(0, 0.06, 0, 0, 0, 0, 1, 0.8, 1));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const flex = chamferBox(0.55, 0.06, 0.15, 0.015);
    P.add(flex, K.dark, m4(Math.cos(a) * 0.45, 0, -Math.sin(a) * 0.45, 0, a, 0));
    // blade: tapered chord, a slight pitch, a hazard-painted cap
    const L = ROTOR_R - 0.65 - 0.35;
    const blade = new THREE.BoxGeometry(L, 0.045, 0.32, 10, 1, 1);
    const pos = blade.attributes.position;
    for (let v = 0; v < pos.count; v++) { const t = (pos.getX(v) + L / 2) / L; pos.setZ(v, pos.getZ(v) * (1 - 0.22 * t)); }
    blade.computeVertexNormals();
    // pitch about the blade's own span (X), then turn it to its azimuth: Euler XYZ would pitch the
    // 90-degree blades about the WORLD X and lift their tips 14 cm off their caps
    const place = (r) => new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationX(0.07)).setPosition(Math.cos(a) * r, 0.01, -Math.sin(a) * r);
    P.add(blade, K.rotor, place(0.65 + L / 2));
    P.add(chamferBox(0.35, 0.046, 0.25, 0.01), K.hazard, place(ROTOR_R - 0.175));
  }
  return P.build();
}

function buildFan() {
  const P = new Parts();
  P.add(cyl(0.09, 0.09, 0.14, 12, 'z'), K.steel);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const m = new THREE.Matrix4().makeRotationZ(a).multiply(new THREE.Matrix4().makeRotationX(0.35)).setPosition(Math.cos(a) * 0.26, Math.sin(a) * 0.26, 0.02);
    P.add(new THREE.BoxGeometry(0.36, 0.085, 0.018), K.rotor, m);   // pitched about its own radius, then turned
  }
  return P.build();
}

/* ------------------------------------------------------------- materials */

const NodeMaterial = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;   // plain three in node --test: inert nodes

function bodyMaterial(livery) {
  const m = new NodeMaterial({ roughness: 0.4, metalness: 0.2 });
  m.name = `heli-${livery}`;
  const k = floor(attribute('aKind', 'float').add(0.5));
  const p = positionLocal;
  // the livery: a slanted line along the cabin, rising toward the nose
  const line = p.y.sub(float(-0.30).add(p.x.mul(0.05)));
  const below = smoothstep(0.012, -0.012, line);
  const band = smoothstep(0.075, 0.06, abs(line.sub(0.055)));
  const boomBand = step(-4.75, p.x).mul(step(p.x, -4.30));
  let paint;
  if (livery === 'police') {
    const navy = vec3(0.010, 0.020, 0.052), white = vec3(0.78, 0.80, 0.84), blue = vec3(0.04, 0.16, 0.55);
    paint = mix(mix(navy, white, below), blue, band);
    paint = mix(paint, white, boomBand);
  } else {
    const graphite = vec3(0.022, 0.024, 0.027), belly = vec3(0.16, 0.165, 0.17), orange = vec3(0.85, 0.22, 0.015);
    paint = mix(mix(graphite, belly, below), orange, band);
    paint = mix(paint, orange, boomBand);
  }
  const glass = vec3(0.045, 0.068, 0.082), dark = vec3(0.018, 0.018, 0.02), steel = vec3(0.55, 0.57, 0.60), rotor = vec3(0.02, 0.022, 0.025);
  const hazard = vec3(0.85, 0.55, 0.02), red = vec3(0.9, 0.02, 0.02), green = vec3(0.02, 0.9, 0.1), lamp = vec3(0.95, 0.95, 0.9), lens = vec3(0.01, 0.015, 0.03);
  const base = select(k.equal(K.paint), paint, select(k.equal(K.glass), glass, select(k.equal(K.dark), dark, select(k.equal(K.steel), steel,
    select(k.equal(K.rotor), rotor, select(k.equal(K.hazard), hazard, select(k.equal(K.navRed), red, select(k.equal(K.navGreen), green,
      select(k.equal(K.lamp), lamp, lens)))))))));
  m.colorNode = vec4(base, 1);
  m.roughnessNode = select(k.equal(K.paint), float(0.46), select(k.equal(K.glass).or(k.equal(K.lens)), float(0.025),
    select(k.equal(K.steel), float(0.28), select(k.equal(K.rotor), float(0.45), float(0.6)))));
  m.metalnessNode = select(k.equal(K.steel), float(0.9), select(k.equal(K.paint), float(0.25), float(0.0)));
  // nav lights burn day and night; the lamp lens glows faintly
  m.emissiveNode = select(k.equal(K.navRed), vec3(3.0, 0.05, 0.05), select(k.equal(K.navGreen), vec3(0.05, 3.0, 0.3), select(k.equal(K.lamp), vec3(0.6), vec3(0))));
  return m;
}

/** "POLICE", white on clear, for the lettering decal (browser only: it needs a canvas). */
function letteringTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 96);
  g.fillStyle = '#0a1a3c';
  g.font = '900 78px "Arial Black", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('POLICE', 256, 52);
  const t = toTex(c, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** A grid decal lying ON the cabin side (each vertex pushed out to the loft's surface + 6 mm). */
function conformDecal(x0, x1, y0, y1, side) {
  const nx = 10, ny = 4, pos = [], uv = [], idx = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + (x1 - x0) * (i / nx), y = y0 + (y1 - y0) * (j / ny);
    const z = (sectionZ(hullAt(x), y) + 0.006) * side;
    pos.push(x, y, z);
    uv.push(side > 0 ? i / nx : 1 - i / nx, j / ny);    // reads front-to-back on the left, back-to-front mirrored right: both read left-to-right
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    if (side > 0) idx.push(a, b, d, a, d, c); else idx.push(a, d, b, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

let kit = null;
function sharedKit() {
  if (kit) return kit;
  kit = {
    hull: { police: buildHull('police'), civil: buildHull('civil') },
    rotor: buildRotor(),
    fan: buildFan(),
    mat: { police: bodyMaterial('police'), civil: bodyMaterial('civil') },
    lettering: null,
  };
  const tex = letteringTexture();
  if (tex) {
    const merged = new Parts();
    // below the side windows, on the white band, reading forward on both sides
    for (const side of [1, -1]) {
      const g = conformDecal(-1.05, 0.55, -0.66, -0.36, side);
      merged.add(g, 0);
    }
    kit.lettering = {
      geo: merged.build(),
      mat: new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.35, roughness: 0.35, metalness: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    };
  }
  return kit;
}

/**
 * A helicopter: { group, rotor, tail, disc, beacon, tailStrobe }, the parts
 * game/helicopter.js and game/flight.js drive. `livery` is 'police' or 'civil'.
 */
export function buildHeliModel({ livery = 'police' } = {}) {
  const K2 = sharedKit();
  const group = new THREE.Group();
  group.name = livery === 'police' ? 'PoliceHeli' : 'Helicopter';
  const hull = new THREE.Mesh(K2.hull[livery], K2.mat[livery]);
  hull.name = 'heli-hull'; hull.castShadow = true; hull.receiveShadow = true;
  group.add(hull);
  if (livery === 'police' && K2.lettering) {
    const text = new THREE.Mesh(K2.lettering.geo, K2.lettering.mat);
    text.name = 'heli-lettering';
    group.add(text);
  }

  const rotor = new THREE.Group();
  rotor.position.copy(ROTOR_AT);
  const blades = new THREE.Mesh(K2.rotor, K2.mat[livery]);
  blades.name = 'heli-rotor'; blades.castShadow = true;
  rotor.add(blades);
  // the blur: one translucent disc per helicopter (flight.js fades it with the rotor speed)
  const disc = new THREE.Mesh(new THREE.CircleGeometry(ROTOR_R, 40),
    new THREE.MeshBasicMaterial({ color: 0x9aabbd, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.012;
  rotor.add(disc);
  group.add(rotor);

  const tail = new THREE.Group();
  tail.position.copy(FAN_AT);
  const fan = new THREE.Mesh(K2.fan, K2.mat[livery]);
  fan.name = 'heli-fan';
  tail.add(fan);
  group.add(tail);

  // anti-collision beacon (red, cowling top) and tail strobe (white): own materials, the callers flash them
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 6),
    new THREE.MeshStandardMaterial({ color: 0xff3030, emissive: 0xff2020, emissiveIntensity: 3.0 }));
  beacon.position.set(-1.55, 1.24, 0);
  group.add(beacon);
  const tailStrobe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.07),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.0 }));
  tailStrobe.position.set(-7.52, 2.16, 0);
  group.add(tailStrobe);
  return { group, rotor, tail, disc, beacon, tailStrobe };
}

/** Triangles in one helicopter (budget line and the test). */
export function heliTriangles(livery = 'police') {
  const k = sharedKit();
  return [k.hull[livery], k.rotor, k.fan].reduce((n, g) => n + g.index.count / 3, 0);
}

export const _internals = { K, HULL, sectionZ, hullAt };
