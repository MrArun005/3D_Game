import * as THREE from 'three';
import {
  attribute, uniform, positionGeometry, normalGeometry, normalLocal, positionLocal, uv,
  vec3, vec4, float, sin, cos, abs, mix, select, step, smoothstep, fract, floor, clamp, max, Fn,
  mx_noise_float,
} from 'three/tsl';

/**
 * The Rhino, rebuilt (2026-09-23): a modern main battle tank in the Leopard 2A6
 * mould, authored in code at GTA IV-era density -- ~11k triangles, FIVE draws.
 *
 *   hull     chamfered lower hull + sponsons, glacis, skirts in five panels,
 *            driver's hatch and periscopes, headlight clusters, tow hooks,
 *            engine-deck grilles, fender boxes, rear lights
 *   wheels   7 road wheels a side (rubber-tyred, dished), a toothed drive
 *            sprocket at the rear, an idler at the front -- spun in the vertex
 *            stage about each wheel's own centre (aWheel), per side
 *   tracks   one band per side fitted round the wheels (the convex hull of
 *            their circles, as a real track sits), link pattern drawn from the
 *            distance along the loop, scrolled per side (skid steer)
 *   turret   wedge-armoured faceted turret with bustle, mantlet, commander's
 *            cupola + periscopes, panoramic and gunner's sights, loader's MG,
 *            smoke dischargers, bustle rack with stowage, antennas
 *   barrel   120 mm L/44: collar, thermal-sleeve segments and clamps, bore
 *            evacuator, muzzle with the bore visible
 *
 * One material family (MeshStandardNodeMaterial) shades every part from a
 * per-vertex kind + grime tag: NATO three-tone camo from object-space noise on
 * the armour, gunmetal, rubber, glass, lamps, canvas; mud toward the ground.
 * Geometry and materials are built once and shared by every tank; the two
 * track offsets are per-OBJECT uniforms read from mesh.userData, so two tanks
 * never share a track phase.
 *
 * Model space: +X forward, +Y up, +Z left (the project convention). The group
 * origin sits 0.65 m above the ground (TankVehicle keeps y = ground + 0.65),
 * so every coordinate below is authored from the GROUND and shifted by -0.65.
 */

export const TANK_GROUND = -0.65;              // the ground, in group space
export const TURRET_AT = new THREE.Vector3(-0.25, 1.26 + TANK_GROUND, 0);   // the turret ring, on the deck
export const BARREL_AT = new THREE.Vector3(1.45, 0.36, 0);                  // the trunnion, in turret space
export const MUZZLE_X = 5.35;                  // the muzzle face, in barrel space
export const HALF_TRACK = 1.55;                // track centreline |z|

/* Kinds: what a vertex is made of. */
const K = { armour: 0, steel: 1, rubber: 2, glass: 3, lamp: 4, canvas: 5, track: 6, red: 7, bore: 8 };

/* ------------------------------------------------------------ geometry kit */

/** Accumulates parts for one mesh; every part is tagged (kind, grime by height above the ground). */
class Parts {
  constructor(groundY) { this.groundY = groundY; this.list = []; }
  add(geo, kind, matrix = null, extra = null, grime = null) {
    if (matrix) geo.applyMatrix4(matrix);
    if (!geo.index) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const pos = geo.attributes.position, n = pos.count, tag = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const h = pos.getY(i) - this.groundY;                  // metres above the ground
      tag[i * 2] = kind;
      tag[i * 2 + 1] = grime ?? THREE.MathUtils.clamp((1.25 - h) / 1.15, 0, 1);   // grime: 1 at the ground, 0 above ~1.25 m
    }
    geo.setAttribute('aTag', new THREE.BufferAttribute(tag, 2));
    if (extra) for (const [name, size, fill] of extra) {
      const a = new Float32Array(n * size);
      for (let i = 0; i < n; i++) fill(a, i * size, i);
      geo.setAttribute(name, new THREE.BufferAttribute(a, size));
    }
    // drop anything the merge does not carry (Extrude's groups, etc.)
    geo.clearGroups();
    this.list.push(geo);
    return geo;
  }
  build(names = ['position', 'normal', 'uv', 'aTag']) {
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

const m4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));

/** A box with every edge chamfered by c (an octagon-profile extrusion, bevelled front and back). */
function chamferBox(w, h, d, c = 0.03) {
  c = Math.min(c, w / 3, h / 3, d / 3);
  const hw = w / 2 - c, hh = h / 2 - c;
  const s = new THREE.Shape();
  s.moveTo(-hw, -hh - c); s.lineTo(hw, -hh - c); s.lineTo(hw + c, -hh); s.lineTo(hw + c, hh); s.lineTo(hw, hh + c);
  s.lineTo(-hw, hh + c); s.lineTo(-hw - c, hh); s.lineTo(-hw - c, -hh); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * c, bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelOffset: -c, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -(d - 2 * c) / 2);
  return g;
}

/** A side-profile polygon [[x, y], ...] (ground coordinates) extruded across z from -w/2 to w/2, edges chamfered. */
function profileSolid(points, w, c = 0.05, groundShift = TANK_GROUND) {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y + groundShift)));
  const g = new THREE.ExtrudeGeometry(s, { depth: w - 2 * c, bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelOffset: -c, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -(w - 2 * c) / 2);
  return g;
}

/** A top-view polygon [[x, z], ...] extruded up from y0 to y1, edges chamfered. */
function plan(points, y0, y1, c = 0.05) {
  const s = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(s, { depth: y1 - y0 - 2 * c, bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelOffset: -c, bevelSegments: 1, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);                // extrusion +Z -> +Y; shape y -> -z (hence -z above)
  g.translate(0, y0 + c, 0);
  return g;
}

/** A cylinder along an axis: 'x', 'y' or 'z'. */
function cyl(rTop, rBot, len, seg, axis = 'y', open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, seg, 1, open);
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  else if (axis === 'z') g.rotateX(Math.PI / 2);
  return g;
}

/**
 * A lathe profile [[r, t], ...] turned about an axis ('x', 'y' or 'z'), t
 * running along it, with HARD edges: every profile segment gets its own ring of
 * vertices and its own normal. (LatheGeometry shares a vertex between adjacent
 * segments, so a wheel's flat face and its rim blend into one smooth normal and
 * the wheel shades like a ball.)
 */
function turned(profile, seg, axis = 'y') {
  const pos = [], nor = [], uvs = [], idx = [];
  const n = profile.length;
  for (let k = 0; k < n - 1; k++) {
    const [r0, t0] = profile[k], [r1, t1] = profile[k + 1];
    const dr = r1 - r0, dt = t1 - t0, l = Math.hypot(dr, dt) || 1;
    const nr = dt / l, nt = -dr / l;                  // outward for a profile running up the axis
    const base = pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos.push(r0 * s, t0, r0 * c, r1 * s, t1, r1 * c);
      nor.push(nr * s, nt, nr * c, nr * s, nt, nr * c);
      uvs.push(i / seg, k / (n - 1), i / seg, (k + 1) / (n - 1));
    }
    for (let i = 0; i < seg; i++) { const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  else if (axis === 'z') g.rotateX(Math.PI / 2);
  return g;
}

/* ---------------------------------------------------------------- running gear */

const WHEEL_R = 0.30, WHEEL_Y = 0.39;                          // road wheels: bottom at 0.09, on the track's inner face (TRACK_T above the road)
const WHEEL_X = [-2.55, -1.75, -0.95, -0.15, 0.65, 1.45, 2.25];
const SPROCKET = { x: -3.05, y: 0.62, r: 0.34 };
const IDLER = { x: 3.02, y: 0.52, r: 0.30 };
const TRACK_T = 0.09, TRACK_W = 0.64;                          // band thickness, width

/** The inner-surface path of the track: the convex hull of every wheel circle, counter-clockwise in (x, y). */
function trackPath() {
  const pts = [];
  const ring = (cx, cy, r) => { for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  for (const x of WHEEL_X) ring(x, WHEEL_Y, WHEEL_R);
  ring(SPROCKET.x, SPROCKET.y, SPROCKET.r);
  ring(IDLER.x, IDLER.y, IDLER.r);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  upper.pop(); lower.pop();
  return lower.concat(upper);                                  // CCW: the bottom run runs +X, the top run -X
}

/** The track band for one side: outer, inner and both edges, u = metres along the loop. */
function trackBand(zc) {
  const path = trackPath(), n = path.length;
  // outward normals: the average of the two adjacent edge normals (CCW: outward is (dy, -dx))
  const nor = path.map((p, i) => {
    const a = path[(i - 1 + n) % n], b = path[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [dy / l, -dx / l];
  });
  const outer = path.map((p, i) => [p[0] + nor[i][0] * TRACK_T, p[1] + nor[i][1] * TRACK_T]);
  const s = [0];
  for (let i = 1; i <= n; i++) { const a = outer[i - 1], b = outer[i % n]; s.push(s[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const pos = [], nrm = [], uvs = [], idx = [];
  const z0 = zc - TRACK_W / 2, z1 = zc + TRACK_W / 2;
  // one strip per face kind: [points, zA, zB, normal fn, v range]
  const strip = (P, za, zb, N, v0, v1, flip) => {
    const base = pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const k = i % n, p = P(k), nn = N(k);
      pos.push(p[0], p[1] + TANK_GROUND, za, p[0], p[1] + TANK_GROUND, zb);
      nrm.push(nn[0], nn[1], nn[2], nn[0], nn[1], nn[2]);
      uvs.push(s[i], v0, s[i], v1);
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  };
  strip((k) => outer[k], z0, z1, (k) => [nor[k][0], nor[k][1], 0], 0, 1, false);          // tread face (v 0..1)
  strip((k) => path[k], z0, z1, (k) => [-nor[k][0], -nor[k][1], 0], 2, 3, true);         // inner face (v 2..3)
  // edges: a quad strip from inner to outer at each z face (v 4)
  for (const [z, sgn] of [[z1, 1], [z0, -1]]) {
    const base = pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      pos.push(path[k][0], path[k][1] + TANK_GROUND, z, outer[k][0], outer[k][1] + TANK_GROUND, z);
      nrm.push(0, 0, sgn, 0, 0, sgn);
      uvs.push(s[i], 4, s[i], 4);
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      if (sgn > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  // the strips above are wound clockwise seen from outside: turn every triangle round once (checked: .wind test in tankTriangles' test)
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return { geo: g, length: s[n] };
}

/**
 * Road wheel: a dished steel disc with a rubber tyre (a groove for the track's
 * guide horns between the twin rims), turned about Z. Two lathes so the kinds
 * split cleanly; 12 sides -- the skirts and the track hide the rim, what reads
 * is the hub and the dish.
 */
function roadWheel(seg = 12) {
  const disc = turned([[0.001, -0.125], [0.085, -0.125], [0.115, -0.145], [0.255, -0.145], [0.255, 0.145], [0.115, 0.145], [0.085, 0.125], [0.001, 0.125]], seg, 'z');
  const tyre = turned([[0.255, -0.15], [WHEEL_R, -0.13], [WHEEL_R, -0.04], [0.262, -0.04], [0.262, 0.04], [WHEEL_R, 0.04], [WHEEL_R, 0.13], [0.255, 0.15]], seg, 'z');
  return { disc, tyre };
}

/** Drive sprocket: two toothed rings on a hub, turned about Z. */
function sprocket(side, teeth = 11) {
  const out = [];
  const s = new THREE.Shape(), r0 = SPROCKET.r - 0.05, r1 = SPROCKET.r + 0.02;
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2, da = Math.PI * 2 / teeth;
    const pts = [[r0, a], [r1, a + da * 0.28], [r1, a + da * 0.52], [r0, a + da * 0.8]];
    pts.forEach(([r, t], j) => { const x = Math.cos(t) * r, y = Math.sin(t) * r; if (i === 0 && j === 0) s.moveTo(x, y); else s.lineTo(x, y); });
  }
  s.closePath();
  const hole = new THREE.Path(); hole.absarc(0, 0, 0.12, 0, Math.PI * 2, true); s.holes.push(hole);
  for (const z of [-0.13, 0.07]) {
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: false, curveSegments: 4 });
    g.translate(0, 0, z);
    out.push(g);
  }
  out.push(cyl(0.15, 0.15, 0.30, 12, 'z'));
  out.push(cyl(0.09, 0.11, 0.08, 10, 'z').translate(0, 0, side * 0.18));   // hub cap, outboard
  return out;
}

/* ------------------------------------------------------------------ hull */

function buildHull() {
  const P = new Parts(TANK_GROUND);
  const G = (y) => y + TANK_GROUND;
  // lower hull between the tracks: belly, lower glacis, upper glacis, deck, rear plate
  P.add(profileSolid([[2.72, 0.48], [3.44, 0.94], [3.40, 1.02], [-3.32, 1.02], [-3.30, 0.62], [-3.08, 0.48]], 2.24, 0.05), K.armour);
  // the upper hull over the tracks: glacis to deck to the rear overhang
  P.add(profileSolid([[3.42, 0.97], [3.36, 1.05], [2.02, 1.27], [-3.02, 1.27], [-3.38, 1.12], [-3.36, 0.97]], 3.80, 0.05), K.armour);
  // skirts: five panels a side, the front one raked; a hand's width proud of the tyres
  const panels = [[-3.02, -1.86], [-1.84, -0.68], [-0.66, 0.50], [0.52, 1.68], [1.70, 2.86]];
  for (const side of [1, -1]) {
    const z = side * 1.935;                                    // clear of the track's outer edge (1.87)
    for (const [x0, x1] of panels) {
      P.add(chamferBox(x1 - x0, 0.64, 0.05, 0.012), K.armour, m4((x0 + x1) / 2, G(0.86), z));
    }
    // nose panel over the idler, its lower edge higher than the skirt's
    P.add(chamferBox(0.50, 0.42, 0.05, 0.012), K.armour, m4(3.13, G(0.97), z));
    // fender boxes along the sponson top
    P.add(chamferBox(1.6, 0.22, 0.34, 0.03), K.armour, m4(-0.2, G(1.38), side * 1.52));
    P.add(chamferBox(0.9, 0.24, 0.34, 0.03), K.armour, m4(-2.25, G(1.39), side * 1.52));
    // headlight cluster on the front of the fender: housing, two lenses, a guard
    P.add(chamferBox(0.22, 0.20, 0.34, 0.03), K.armour, m4(3.05, G(1.20), side * 1.46));
    for (const dz of [-0.08, 0.08]) P.add(cyl(0.055, 0.055, 0.03, 10, 'x'), K.lamp, m4(3.17, G(1.20), side * 1.46 + dz));
    // tow hooks
    P.add(chamferBox(0.16, 0.12, 0.10, 0.02), K.steel, m4(3.44, G(0.80), side * 0.72));
    // rear lights and a rear tow eye
    P.add(chamferBox(0.05, 0.10, 0.16, 0.01), K.red, m4(-3.38, G(1.15), side * 1.45));
    P.add(chamferBox(0.14, 0.12, 0.10, 0.02), K.steel, m4(-3.38, G(0.70), side * 0.75));
    // mud flap at the rear of each track
    P.add(chamferBox(0.03, 0.46, 0.66, 0.01), K.rubber, m4(-3.52, G(0.80), side * HALF_TRACK));   // behind the sprocket's wrap (-3.46)
  }
  // driver's hatch on the glacis top, three periscopes ahead of it
  P.add(cyl(0.27, 0.29, 0.05, 16), K.armour, m4(2.05, G(1.29), 0.42));
  for (const dz of [-0.2, 0, 0.2]) P.add(chamferBox(0.08, 0.07, 0.15, 0.015), K.glass, m4(2.36, G(1.26), 0.42 + dz, 0, 0, 0.18));
  // engine deck: two grilles with slats, an access plate between
  for (const side of [1, -1]) {
    P.add(chamferBox(1.55, 0.03, 0.78, 0.01), K.steel, m4(-2.15, G(1.285), side * 0.52));
    for (let i = 0; i < 9; i++) P.add(new THREE.BoxGeometry(0.035, 0.05, 0.74), K.steel, m4(-2.85 + i * 0.175, G(1.30), side * 0.52));
  }
  P.add(chamferBox(0.9, 0.03, 0.5, 0.01), K.armour, m4(-0.95, G(1.285), 0));
  // exhaust grille on the rear plate
  P.add(chamferBox(0.06, 0.34, 1.7, 0.01), K.steel, m4(-3.36, G(0.97), 0));
  for (let i = 0; i < 7; i++) P.add(new THREE.BoxGeometry(0.03, 0.30, 0.02), K.steel, m4(-3.39, G(0.97), -0.75 + i * 0.25));
  return P.build();
}

function buildWheels() {
  const P = new Parts(TANK_GROUND);
  const G = (y) => y + TANK_GROUND;
  const { disc, tyre } = roadWheel(12);
  const wheelAttr = (cx, cy, r) => [['aWheel', 3, (a, o) => { a[o] = cx; a[o + 1] = cy; a[o + 2] = r; }]];
  for (const side of [1, -1]) {
    const zc = side * HALF_TRACK;
    for (const x of WHEEL_X) {
      // one grime value per wheel: a height gradient across a turning disc read as a ball
      P.add(disc.clone(), K.armour, m4(x, G(WHEEL_Y), zc), wheelAttr(x, G(WHEEL_Y), WHEEL_R), 0.55);
      P.add(tyre.clone(), K.rubber, m4(x, G(WHEEL_Y), zc), wheelAttr(x, G(WHEEL_Y), WHEEL_R), 0.7);
    }
    // idler: a road wheel, steel-rimmed
    P.add(disc.clone(), K.armour, m4(IDLER.x, G(IDLER.y), zc), wheelAttr(IDLER.x, G(IDLER.y), IDLER.r), 0.5);
    P.add(tyre.clone(), K.steel, m4(IDLER.x, G(IDLER.y), zc), wheelAttr(IDLER.x, G(IDLER.y), IDLER.r), 0.7);
    // sprocket
    for (const g of sprocket(side)) P.add(g, K.steel, m4(SPROCKET.x, G(SPROCKET.y), zc), wheelAttr(SPROCKET.x, G(SPROCKET.y), SPROCKET.r), 0.6);
  }
  disc.dispose(); tyre.dispose();
  return P.build(['position', 'normal', 'uv', 'aTag', 'aWheel']);
}

function buildTracks() {
  const P = new Parts(TANK_GROUND);
  let length = 0;
  for (const side of [1, -1]) { const t = trackBand(side * HALF_TRACK); length = t.length; P.add(t.geo, K.track); }
  const geo = P.build();
  geo.userData.loop = length;
  return geo;
}

/* ---------------------------------------------------------------- turret */

function buildTurret() {
  const P = new Parts(-(1.26));                               // turret space: y = 0 is the deck, 1.26 m up
  // the body: faceted, with the bustle behind
  P.add(plan([[1.30, 0.40], [1.02, 1.30], [-1.05, 1.36], [-1.26, 1.20], [-1.32, 1.04], [-2.34, 1.00], [-2.46, 0.84],
    [-2.46, -0.84], [-2.34, -1.00], [-1.32, -1.04], [-1.26, -1.20], [-1.05, -1.36], [1.02, -1.30], [1.30, -0.40]], 0.02, 0.74, 0.07), K.armour);
  // wedge armour modules either side of the mantlet
  for (const side of [1, -1]) {
    P.add(plan([[1.28, side * 0.42], [1.02, side * 1.30], [2.02, side * 0.46]], 0.10, 0.66, 0.04), K.armour);
  }
  // mantlet
  P.add(chamferBox(0.46, 0.50, 0.74, 0.05), K.armour, m4(1.42, 0.36, 0));
  // commander's cupola (right), periscopes round it, the hatch
  P.add(cyl(0.38, 0.40, 0.18, 18), K.armour, m4(-0.35, 0.83, -0.55));
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * 0.85 + (i / 6) * Math.PI * 1.7;
    P.add(chamferBox(0.10, 0.08, 0.14, 0.015), K.glass, m4(-0.35 + Math.cos(a) * 0.36, 0.86, -0.55 - Math.sin(a) * 0.36, 0, a, 0));
  }
  P.add(cyl(0.30, 0.31, 0.06, 18), K.armour, m4(-0.35, 0.95, -0.55));
  // panoramic sight on its post, window forward
  P.add(cyl(0.12, 0.15, 0.20, 12), K.armour, m4(0.40, 0.84, -0.86));
  P.add(chamferBox(0.34, 0.28, 0.34, 0.04), K.armour, m4(0.40, 1.08, -0.86));
  P.add(chamferBox(0.02, 0.14, 0.24, 0.005), K.glass, m4(0.575, 1.09, -0.86));
  // gunner's sight box, window forward
  P.add(chamferBox(0.52, 0.24, 0.34, 0.04), K.armour, m4(0.92, 0.86, -0.50));
  P.add(chamferBox(0.02, 0.14, 0.26, 0.005), K.glass, m4(1.185, 0.87, -0.50));
  // loader's hatch (left) and the MG on its pintle
  P.add(cyl(0.33, 0.34, 0.06, 18), K.armour, m4(-0.35, 0.78, 0.58));
  P.add(cyl(0.025, 0.025, 0.34, 8), K.steel, m4(-0.02, 0.92, 0.58));
  P.add(chamferBox(0.36, 0.10, 0.08, 0.015), K.steel, m4(0.10, 1.10, 0.58));
  P.add(cyl(0.012, 0.014, 0.60, 8, 'x'), K.steel, m4(0.56, 1.11, 0.58));
  P.add(chamferBox(0.12, 0.10, 0.10, 0.01), K.canvas, m4(0.02, 1.06, 0.66));
  // smoke dischargers: two banks of three tubes on each cheek, raked forward and up
  for (const side of [1, -1]) for (let r = 0; r < 2; r++) for (let i = 0; i < 3; i++) {
    const tube = cyl(0.045, 0.045, 0.22, 8, 'x');
    P.add(tube, K.steel, m4(0.52 - i * 0.12, 0.48 + r * 0.11, side * (1.40 + r * 0.02), 0, side * -0.35, 0.45));
  }
  // bustle rack: frame, a rolled tarp, crates, two jerrycans
  for (const side of [1, -1]) {
    P.add(new THREE.BoxGeometry(0.62, 0.035, 0.035), K.steel, m4(-2.76, 0.60, side * 1.02));
    P.add(new THREE.BoxGeometry(0.62, 0.035, 0.035), K.steel, m4(-2.76, 0.22, side * 1.02));
    P.add(new THREE.BoxGeometry(0.035, 0.42, 0.035), K.steel, m4(-3.06, 0.41, side * 1.02));
  }
  P.add(new THREE.BoxGeometry(0.035, 0.035, 2.04), K.steel, m4(-3.06, 0.60, 0));
  P.add(new THREE.BoxGeometry(0.035, 0.035, 2.04), K.steel, m4(-3.06, 0.22, 0));
  P.add(cyl(0.16, 0.16, 0.55, 12, 'z'), K.canvas, m4(-2.78, 0.40, 0.33));
  P.add(chamferBox(0.42, 0.30, 0.46, 0.03), K.canvas, m4(-2.80, 0.39, -0.62));
  P.add(chamferBox(0.36, 0.24, 0.30, 0.03), K.armour, m4(-2.80, 0.36, -0.16));
  for (const dz of [0.72, 0.88]) P.add(chamferBox(0.28, 0.36, 0.14, 0.02), K.armour, m4(-2.82, 0.41, dz));
  // antennas and their bases; the crosswind sensor mast
  for (const side of [1, -1]) {
    P.add(cyl(0.05, 0.06, 0.08, 10), K.steel, m4(-2.05, 0.78, side * 0.84));
    P.add(cyl(0.008, 0.013, 2.3, 5), K.steel, m4(-2.05, 1.97, side * 0.84));
  }
  P.add(cyl(0.02, 0.025, 0.40, 6), K.steel, m4(-1.35, 0.94, 0));
  P.add(chamferBox(0.08, 0.05, 0.08, 0.01), K.steel, m4(-1.35, 1.15, 0));
  // grab rails along the turret sides
  for (const side of [1, -1]) P.add(cyl(0.018, 0.018, 1.6, 6, 'x'), K.steel, m4(-0.4, 0.62, side * 1.40));
  return P.build();
}

function buildBarrel() {
  const P = new Parts(-(1.26 + 0.36));
  // collar at the mantlet, then the sleeved tube tapering toward the muzzle
  const prof = [[0.001, -0.30], [0.16, -0.30], [0.16, 0.12], [0.13, 0.14], [0.13, 0.46], [0.108, 0.48]];
  let x = 0.48, r = 0.108;
  const rings = [1.30, 2.05, 3.55, 4.25];
  for (const rx of rings) {
    prof.push([r, rx - 0.03], [r + 0.012, rx - 0.02], [r + 0.012, rx + 0.02], [r - 0.004, rx + 0.03]);
    r -= 0.004;
  }
  // bore evacuator at 2.55-3.15
  prof.splice(prof.findIndex(([, t]) => t > 2.4), 0, [0.100, 2.45], [0.142, 2.58], [0.142, 3.05], [0.098, 3.18]);
  prof.sort((a, b) => a[1] - b[1]);
  prof.push([0.090, 4.92], [0.104, 4.95], [0.104, MUZZLE_X - 0.02], [0.098, MUZZLE_X], [0.062, MUZZLE_X], [0.062, MUZZLE_X - 0.35]);
  P.add(turned(prof, 16, 'x'), K.steel);
  // bore: the dark inside of the muzzle
  P.add(cyl(0.062, 0.062, 0.02, 12, 'x'), K.bore, m4(MUZZLE_X - 0.34, 0, 0));
  // muzzle reference sensor on top
  P.add(chamferBox(0.10, 0.05, 0.06, 0.01), K.steel, m4(MUZZLE_X - 0.18, 0.125, 0));
  return P.build();
}

/* -------------------------------------------------------------- materials */

let shared = null;
/* Under plain three (node --test) there are no node materials: fall back to the
   classic one, on which the node assignments below are inert. The browser build
   aliases three -> three/webgpu, where they are real. */
const NodeMaterial = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;

function bodyColour(kind, grime, pl) {
  const ka = floor(kind.add(0.5));   // an interpolated varying: round before comparing (world/figure.js has the story)
  // NATO three-tone camo in object space: green base, brown and black blotches
  const p = pl.mul(0.62);
  const n1 = mx_noise_float(p), n2 = mx_noise_float(p.add(vec3(17.3, 3.1, 9.7)));
  const green = vec3(0.105, 0.125, 0.075), brown = vec3(0.14, 0.10, 0.06), black = vec3(0.032, 0.034, 0.03);
  let camo = mix(green, brown, smoothstep(0.10, 0.16, n1));
  camo = mix(camo, black, smoothstep(0.34, 0.40, n2));
  // a faint large-scale fade so no panel is one flat colour
  camo = camo.mul(float(0.9).add(mx_noise_float(pl.mul(2.3)).mul(0.08)));
  const steel = vec3(0.045, 0.047, 0.05), rubber = vec3(0.022, 0.022, 0.024), glass = vec3(0.02, 0.035, 0.05);
  const lamp = vec3(0.85, 0.82, 0.70), canvas = vec3(0.20, 0.18, 0.11), trackC = vec3(0.07, 0.066, 0.06), red = vec3(0.45, 0.03, 0.02);
  const base = select(ka.equal(K.armour), camo, select(ka.equal(K.steel), steel, select(ka.equal(K.rubber), rubber,
    select(ka.equal(K.glass), glass, select(ka.equal(K.lamp), lamp, select(ka.equal(K.canvas), canvas,
      select(ka.equal(K.track), trackC, select(ka.equal(K.red), red, vec3(0.005)))))))));
  const mud = vec3(0.10, 0.082, 0.058);
  const g = grime.mul(select(ka.equal(K.glass).or(ka.equal(K.lamp)).or(ka.equal(K.red)), float(0.25), float(0.8)));
  return { ka, colour: mix(base, mud, g), g };
}

function bodyPBR(m, ka, g) {
  m.roughnessNode = mix(select(ka.equal(K.armour), float(0.68), select(ka.equal(K.steel), float(0.42), select(ka.equal(K.rubber), float(0.92),
    select(ka.equal(K.glass), float(0.06), select(ka.equal(K.lamp), float(0.12), select(ka.equal(K.canvas), float(0.95), float(0.6))))))), float(0.95), g);
  m.metalnessNode = mix(select(ka.equal(K.steel), float(0.65), select(ka.equal(K.track), float(0.55), float(0.0))), float(0), g);
}

function makeMaterials() {
  const aTag = attribute('aTag', 'vec2');

  // hull, turret, barrel
  const body = new NodeMaterial({ roughness: 0.7, metalness: 0 });
  body.name = 'tank';
  {
    const { ka, colour, g } = bodyColour(aTag.x, aTag.y, positionLocal);
    body.colorNode = vec4(colour, 1);
    bodyPBR(body, ka, g);
  }

  // per-object track travel (metres), per side; TankVehicle writes mesh.userData.trackL / trackR
  const travelL = uniform(0).onObjectUpdate(({ object }) => object.userData.trackL ?? 0);
  const travelR = uniform(0).onObjectUpdate(({ object }) => object.userData.trackR ?? 0);

  // wheels: each vertex turns about its own wheel's centre by the distance its side has rolled
  const wheels = new NodeMaterial({ roughness: 0.7, metalness: 0 });
  wheels.name = 'tank-wheels';
  {
    const aWheel = attribute('aWheel', 'vec3');
    wheels.positionNode = Fn(() => {
      const d = select(positionGeometry.z.greaterThan(0), travelL, travelR);
      const a = d.negate().div(aWheel.z).toVar(), c = cos(a).toVar(), s = sin(a).toVar();
      const q = positionGeometry.sub(vec3(aWheel.x, aWheel.y, 0)).toVar();
      const n = normalGeometry.toVar();
      normalLocal.assign(vec3(n.x.mul(c).sub(n.y.mul(s)), n.x.mul(s).add(n.y.mul(c)), n.z));
      return vec3(q.x.mul(c).sub(q.y.mul(s)), q.x.mul(s).add(q.y.mul(c)), q.z).add(vec3(aWheel.x, aWheel.y, 0));
    })();
    const { ka, colour, g } = bodyColour(aTag.x, aTag.y, positionGeometry);   // camo stays on the wheel as it turns
    wheels.colorNode = vec4(colour, 1);
    bodyPBR(wheels, ka, g);
  }

  // tracks: links drawn from the distance along the loop, scrolled by the side's travel
  const tracks = new NodeMaterial({ roughness: 0.6, metalness: 0.5 });
  tracks.name = 'tank-tracks';
  {
    const t = uv();
    const d = select(positionLocal.z.greaterThan(0), travelL, travelR);
    const s = t.x.add(d);                                      // CCW loop: the ground run moves -s as the tank drives
    const link = fract(s.div(0.155));
    const gap = smoothstep(0.0, 0.07, link).mul(smoothstep(1.0, 0.9, link));           // dark seams between links
    const face = step(t.y, 1.5);                               // tread face (v 0..1) vs inner (2..3) and edges (4)
    const inner = step(1.5, t.y).mul(step(t.y, 3.5));
    // tread face: rubber pads either side of the centre guide
    const across = fract(t.y);
    const pad = face.mul(step(0.12, across).mul(step(across, 0.44)).add(step(0.56, across).mul(step(across, 0.88))));
    const guide = inner.mul(step(0.44, across).mul(step(across, 0.56))).mul(step(0.35, link).mul(step(link, 0.65)));
    const steel = vec3(0.060, 0.057, 0.052), rubber = vec3(0.020, 0.020, 0.022);
    let c = mix(steel, rubber, pad).mul(mix(0.25, 1, gap));
    c = mix(c, vec3(0.10, 0.096, 0.09), guide);
    const mud = vec3(0.085, 0.07, 0.05);
    // caked on the tread and the edges, a film on the inner face
    tracks.colorNode = vec4(mix(c, mud, float(0.30).add(face.mul(0.30)).mul(mix(0.6, 1, gap))), 1);
    tracks.roughnessNode = mix(float(0.62), float(0.95), pad.max(face.mul(0.6)));
    tracks.metalnessNode = mix(float(0.35), float(0.0), pad.max(face.mul(0.7)));
  }
  return { body, wheels, tracks };
}

function sharedKit() {
  if (shared) return shared;
  shared = {
    geo: { hull: buildHull(), wheels: buildWheels(), tracks: buildTracks(), turret: buildTurret(), barrel: buildBarrel() },
    mat: makeMaterials(),
  };
  return shared;
}

/**
 * A tank: { group, turretGroup, barrelGroup, running: [wheels, tracks] }.
 * Positions: group origin 0.65 m above the ground; turretGroup at TURRET_AT;
 * barrelGroup at BARREL_AT inside it; the muzzle at (MUZZLE_X, 0, 0) in
 * barrel space. `roll(tank, dL, dR)` advances the tracks and wheels.
 */
export function buildTankModel() {
  const { geo, mat } = sharedKit();
  const mesh = (g, m, name) => { const o = new THREE.Mesh(g, m); o.name = name; o.castShadow = true; o.receiveShadow = true; return o; };
  const group = new THREE.Group();
  group.name = 'RhinoTank';
  const hull = mesh(geo.hull, mat.body, 'tank-hull');
  const wheels = mesh(geo.wheels, mat.wheels, 'tank-wheels');
  const tracks = mesh(geo.tracks, mat.tracks, 'tank-tracks');
  group.add(hull, wheels, tracks);
  const turretGroup = new THREE.Group();
  turretGroup.position.copy(TURRET_AT);
  turretGroup.add(mesh(geo.turret, mat.body, 'tank-turret'));
  const barrelGroup = new THREE.Group();
  barrelGroup.position.copy(BARREL_AT);
  barrelGroup.add(mesh(geo.barrel, mat.body, 'tank-barrel'));
  turretGroup.add(barrelGroup);
  group.add(turretGroup);
  for (const o of [wheels, tracks]) { o.userData.trackL = 0; o.userData.trackR = 0; }
  return { group, turretGroup, barrelGroup, running: [wheels, tracks] };
}

/** Advance both tracks (metres rolled, left and right) on a built model. */
export function rollTracks(model, dL, dR) {
  for (const o of model.running) { o.userData.trackL += dL; o.userData.trackR += dR; }
}

/** Triangles in one tank (budget line and the test). */
export function tankTriangles() {
  const { geo } = sharedKit();
  return Object.values(geo).reduce((n, g) => n + g.index.count / 3, 0);
}

export const _internals = { K, trackPath, WHEEL_X, WHEEL_R, WHEEL_Y, SPROCKET, IDLER };
