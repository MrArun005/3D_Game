// An Airbus A320-214, built from numbers: 37.6 m long, 34.1 m span, 3.95 m
// fuselage. Body frame: +X nose, +Y up, +Z right wing. Origin on the fuselage
// axis near the wing root.
import * as THREE from 'three';
import { liveryTexture, tailTexture, fanTexture } from './textures.js';

const XMIN = -18.6, XMAX = 18.9, R0 = 1.98;

function fuselageSection(x) {
  if (x > 13.5) {
    const t = Math.min(1, (x - 13.5) / (XMAX - 13.5));
    return { r: R0 * Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.3))), cy: -0.38 * Math.pow(t, 1.6) };
  }
  if (x < -8) {
    const t = Math.min(1, (-8 - x) / (-8 - XMIN));
    return { r: R0 * (1 - 0.8 * Math.pow(t, 1.35)), cy: 1.2 * Math.pow(t, 1.45) };
  }
  return { r: R0, cy: 0 };
}

// Joins rings of equal length into a closed-loop skin.
// Triangles (s,k),(s+1,k),(s,k+1) face along (station dir) x (loop dir).
function skin(rings, uvs, flip = false, closeLoop = true) {
  const n = rings[0].length;
  const pos = [], uv = [], idx = [];
  rings.forEach((ring, s) => ring.forEach((p, k) => { pos.push(p.x, p.y, p.z); uv.push(...uvs(s, k)); }));
  const K = closeLoop ? n - 1 : n - 1;
  for (let s = 0; s < rings.length - 1; s++) for (let k = 0; k < K; k++) {
    const a = s * n + k, b = (s + 1) * n + k, c = s * n + k + 1, d = (s + 1) * n + k + 1;
    if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function fuselageGeometry() {
  const xs = [];
  for (let i = 0; i <= 90; i++) {
    const t = i / 90;
    // Denser at both ends.
    const e = t < 0.5 ? 0.5 * Math.pow(2 * t, 0.8) : 1 - 0.5 * Math.pow(2 * (1 - t), 0.8);
    xs.push(XMIN + (XMAX - XMIN) * e);
  }
  const M = 48;
  const rings = xs.map((x) => {
    const { r, cy } = fuselageSection(x);
    const ring = [];
    for (let j = 0; j <= M; j++) {
      const a = (j / M) * Math.PI * 2;
      ring.push(new THREE.Vector3(x, cy - r * 1.04 * Math.cos(a), r * Math.sin(a)));
    }
    return ring;
  });
  return skin(rings, (s, k) => [(xs[s] - XMIN) / (XMAX - XMIN), k / M]);
}

// NACA 00xx half-thickness.
const naca = (c) => 5 * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1015 * c ** 4);

// A lifting surface. station(s) -> { le, te (Vector3), t (thickness ratio), n (thickness axis) }.
function airfoil(station, { S = 14, C = 14, flip = false, bottom = 0.7 } = {}) {
  const rings = [];
  const cs = [];
  for (let i = 0; i <= C; i++) cs.push(0.5 - 0.5 * Math.cos(Math.PI * i / C));
  for (let s = 0; s <= S; s++) {
    const { le, te, t, n } = station(s / S);
    const chord = le.distanceTo(te);
    const ring = [];
    const pt = (c, sign) => le.clone().lerp(te, c).addScaledVector(n, sign * naca(c) * t * chord * (sign < 0 ? bottom : 1));
    for (let i = C; i >= 0; i--) ring.push(pt(cs[i], 1));      // top, TE -> LE
    for (let i = 1; i <= C; i++) ring.push(pt(cs[i], -1));     // bottom, LE -> TE
    rings.push(ring);
  }
  const L = rings[0].length;
  const g = skin(rings, (s, k) => {
    const c = k <= C ? cs[C - k] : cs[k - C];
    return [c, s / S];
  }, flip, false);
  // Tip cap, both windings (one is always culled).
  const last = rings[S], pos = g.attributes.position.array;
  const base = pos.length / 3;
  const ctr = last.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / L);
  const p2 = Array.from(pos), uv2 = Array.from(g.attributes.uv.array), idx = Array.from(g.index.array);
  p2.push(ctr.x, ctr.y, ctr.z); uv2.push(0.5, 1);
  last.forEach((p) => { p2.push(p.x, p.y, p.z); uv2.push(0.5, 1); });
  for (let k = 0; k < L - 1; k++) idx.push(base, base + 1 + k, base + 2 + k, base, base + 2 + k, base + 1 + k);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(p2, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv2, 2));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0), RIGHT = V(0, 0, 1);

function wing(side) {
  const dih = Math.tan(5.1 * Math.PI / 180);
  const rootZ = 1.7, tipZ = 17.05;
  return airfoil((s) => {
    // Inboard trailing-edge extension (the "yehudi") out to the kink at 6.3 m.
    const z = rootZ + (tipZ - rootZ) * s;
    const leX = 3.0 - (z - rootZ) * Math.tan(27 * Math.PI / 180);
    const kink = 6.3;
    const teX = z < kink ? -4.4 + (z - rootZ) * 0.05 : -4.17 - (z - kink) * Math.tan(20 * Math.PI / 180) * 1.05;
    const tipChord = 1.55;
    const te = Math.min(teX, leX - tipChord - (1 - s) * 0.5);
    const y = -1.25 + (z - rootZ) * dih;
    return { le: V(leX, y, side * z), te: V(te, y + 0.05, side * z), t: 0.15 - 0.05 * s, n: UP };
  }, { S: 18, C: 16, flip: side < 0 });
}
function stabiliser(side) {
  return airfoil((s) => {
    const z = 0.5 + 5.7 * s;
    const le = -13.6 - z * Math.tan(30 * Math.PI / 180);
    const chord = 3.6 - 2.2 * s;
    const y = 0.95 + z * Math.tan(6 * Math.PI / 180);
    return { le: V(le, y, side * z), te: V(le - chord, y, side * z), t: 0.1, n: UP };
  }, { S: 8, C: 10, flip: side < 0 });
}
function fin() {
  return airfoil((s) => {
    const y = 1.2 + 6.8 * s;
    const le = -11.6 - (y - 1.2) * Math.tan(36 * Math.PI / 180);
    const chord = 6.3 - 4.1 * s;
    return { le: V(le, y, 0), te: V(le - chord, y, 0), t: 0.11, n: RIGHT };
  }, { S: 10, C: 12, flip: true });
}

function nacelle(mats) {
  const g = new THREE.Group();
  const prof = [[0.78, 2.45], [0.9, 2.56], [1.0, 2.5], [1.07, 2.2], [1.08, 1.4], [1.0, 0.2], [0.86, -1.1], [0.74, -1.55]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const shell = new THREE.LatheGeometry(prof, 40);
  shell.rotateZ(-Math.PI / 2);
  g.add(new THREE.Mesh(shell, mats.nacelle));
  const inlet = new THREE.LatheGeometry([new THREE.Vector2(0.79, 2.46), new THREE.Vector2(0.78, 1.5)], 40);
  inlet.rotateZ(-Math.PI / 2);
  g.add(new THREE.Mesh(inlet, mats.dark));
  const plug = new THREE.ConeGeometry(0.42, 1.1, 24);
  plug.rotateZ(Math.PI / 2); plug.translate(-2.0, 0, 0);
  g.add(new THREE.Mesh(plug, mats.metal));
  const nozzle = new THREE.CylinderGeometry(0.72, 0.72, 0.1, 32, 1, true);
  nozzle.rotateZ(Math.PI / 2); nozzle.translate(-1.5, 0, 0);
  g.add(new THREE.Mesh(nozzle, mats.dark));
  const fanGeo = new THREE.CircleGeometry(0.78, 40);
  fanGeo.rotateY(Math.PI / 2);
  const fan = new THREE.Mesh(fanGeo, mats.fan);
  fan.position.x = 1.6;
  g.add(fan);
  const spinner = new THREE.ConeGeometry(0.27, 0.55, 24);
  spinner.rotateZ(-Math.PI / 2); spinner.translate(1.88, 0, 0);
  g.add(new THREE.Mesh(spinner, mats.spinner));
  const pylon = new THREE.BoxGeometry(3.0, 0.9, 0.34);
  pylon.translate(0.9, 1.2, 0);
  g.add(new THREE.Mesh(pylon, mats.wing));
  return { group: g, fan };
}

function gear(mats) {
  const g = new THREE.Group();
  const strut = (x, z, y0, y1) => {
    const c = new THREE.CylinderGeometry(0.12, 0.12, y0 - y1, 10);
    c.translate(x, (y0 + y1) / 2, z);
    g.add(new THREE.Mesh(c, mats.metal));
  };
  const wheel = (x, y, z, r) => {
    const w = new THREE.CylinderGeometry(r, r, 0.36, 20);
    w.rotateX(Math.PI / 2); w.translate(x, y, z);
    g.add(new THREE.Mesh(w, mats.tyre));
  };
  for (const s of [-1, 1]) {
    strut(-0.8, s * 3.8, -1.2, -3.1);
    wheel(-0.8, -3.13, s * 3.55, 0.57); wheel(-0.8, -3.13, s * 4.05, 0.57);
  }
  strut(13.5, 0, -1.6, -3.3);
  wheel(13.5, -3.32, -0.22, 0.38); wheel(13.5, -3.32, 0.22, 0.38);
  return g;
}

export function buildAircraft() {
  const livery = liveryTexture(XMIN, XMAX);
  const mats = {
    body: new THREE.MeshStandardMaterial({ map: livery, roughness: 0.32, metalness: 0.08 }),
    wing: new THREE.MeshStandardMaterial({ color: 0xc3c8ce, roughness: 0.42, metalness: 0.35 }),
    tail: new THREE.MeshStandardMaterial({ map: tailTexture(), roughness: 0.35, metalness: 0.05 }),
    nacelle: new THREE.MeshStandardMaterial({ color: 0xdadde1, roughness: 0.3, metalness: 0.2, side: THREE.DoubleSide }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.7, side: THREE.DoubleSide }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.35, metalness: 0.8 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }),
    fan: new THREE.MeshStandardMaterial({ map: fanTexture(), roughness: 0.5, metalness: 0.5 }),
    spinner: new THREE.MeshStandardMaterial({ color: 0xd9dcdf, roughness: 0.3, metalness: 0.3 }),
  };
  const root = new THREE.Group();
  root.add(new THREE.Mesh(fuselageGeometry(), mats.body));
  for (const s of [-1, 1]) {
    root.add(new THREE.Mesh(wing(s), mats.wing));
    root.add(new THREE.Mesh(stabiliser(s), mats.wing));
    // Wingtip fence: a small plate above and below the tip.
    const fence = new THREE.BufferGeometry();
    const y = -1.25 + (17.05 - 1.7) * Math.tan(5.1 * Math.PI / 180);
    const x0 = 3.0 - 15.35 * Math.tan(27 * Math.PI / 180);
    fence.setAttribute('position', new THREE.Float32BufferAttribute([
      x0 + 0.3, y - 0.4, s * 17.08, x0 - 1.7, y - 0.1, s * 17.08, x0 - 1.4, y + 0.9, s * 17.08,
      x0 + 0.3, y - 0.4, s * 17.08, x0 - 1.4, y + 0.9, s * 17.08, x0 - 1.7, y - 0.1, s * 17.08,
    ], 3));
    fence.computeVertexNormals();
    root.add(new THREE.Mesh(fence, mats.tail));
  }
  root.add(new THREE.Mesh(fin(), mats.tail));

  const fans = [];
  const engines = [];
  for (const s of [-1, 1]) {
    const n = nacelle(mats);
    n.group.position.set(1.2, -2.25, s * 5.75);
    root.add(n.group);
    fans.push({ mesh: n.fan, side: s });
    engines.push({ side: s, inlet: V(3.7, -2.25, s * 5.75), exhaust: V(-1.8, -2.25, s * 5.75) });
  }
  const gearGroup = gear(mats);
  root.add(gearGroup);

  // Navigation lights, beacons, strobes.
  const lamp = (color, x, y, z, r = 0.12) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ color }));
    m.position.set(x, y, z); root.add(m); return m;
  };
  const tipX = 3.0 - 15.35 * Math.tan(27 * Math.PI / 180) - 0.3;
  const tipY = -1.25 + 15.35 * Math.tan(5.1 * Math.PI / 180);
  lamp(0xff2020, tipX, tipY, -17.1); lamp(0x20ff40, tipX, tipY, 17.1);
  const strobes = [lamp(0xffffff, tipX - 0.4, tipY, -17.12, 0.1), lamp(0xffffff, tipX - 0.4, tipY, 17.12, 0.1)];
  const beacons = [lamp(0xff2a10, 0, 2.08, 0, 0.14), lamp(0xff2a10, 2, -2.08, 0, 0.14)];

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  for (const l of [...strobes, ...beacons]) l.castShadow = false;

  return {
    root, fans, engines, gear: gearGroup, mats,
    // angles: fan rotation per engine [left, right], already integrated by the caller.
    update(ft, angles) {
      for (const f of fans) f.mesh.rotation.x = -angles[f.side < 0 ? 0 : 1];
      gearGroup.visible = ft < 38;
      const blink = (ft % 1.2) < 0.08;
      strobes.forEach((s) => (s.visible = blink && ft < 345));
      const b = ((ft + 0.6) % 1.0) < 0.12;
      beacons.forEach((s) => (s.visible = b));
    },
  };
}
