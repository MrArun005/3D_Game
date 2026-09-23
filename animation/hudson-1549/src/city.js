// New York, as far as the camera needs it: water, land, ~30,000 buildings,
// the George Washington Bridge, the Palisades and LaGuardia's runways.
import * as THREE from 'three';
import { rng } from './rng.js';
import {
  ll, toLatLon, inPoly, isWater, MANHATTAN, CENTRAL_PARK, LGA_FIELD, NJ_SHORE_PTS,
  PLACES, palisadesHeight, westOfNJShore,
} from './geo.js';
import {
  GROUND, groundTexture, masonryTexture, glassTexture, waterNormals, runwayTexture, canvas, tex,
} from './textures.js';
import { LAND_Y, RWY_DIR } from './timeline.js';

// ---- building batches ---------------------------------------------------------
const TILE = 3000;
class Batch {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; }
  quad(a, b, c, d, n, uvs, col) {
    const base = this.pos.length / 3;
    for (const p of [a, b, c, d]) { this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.col.push(col[0], col[1], col[2]); }
    this.uv.push(...uvs);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  mesh(mat) {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }
}

class Buildings {
  constructor() { this.tiles = new Map(); }
  tile(x, z) {
    const k = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    if (!this.tiles.has(k)) this.tiles.set(k, { masonry: new Batch(), glass: new Batch(), roof: new Batch() });
    return this.tiles.get(k);
  }
  // A box standing on y0, footprint w (local x) by d (local z), rotated yaw about Y.
  box(cx, cz, w, d, h, yaw, y0, col, glass) {
    const t = this.tile(cx, cz);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (lx, lz, y) => [cx + lx * c - lz * s, y, cz + lx * s + lz * c];
    const hw = w / 2, hd = d / 2, y1 = y0 + h;
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    const walls = glass ? t.glass : t.masonry;
    const tileW = glass ? 24 : 12;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
      const len = Math.hypot(bx - ax, bz - az);
      const nx = (bz - az) / len, nz = -(bx - ax) / len;
      const n = [nx * c - nz * s, 0, nx * s + nz * c];
      const u1 = len / tileW, v1 = h / 24;
      walls.quad(P(bx, bz, y0), P(ax, az, y0), P(ax, az, y1), P(bx, bz, y1), n, [u1, 0, 0, 0, 0, v1, u1, v1], col);
    }
    const rc = [col[0] * 0.55, col[1] * 0.55, col[2] * 0.55];
    t.roof.quad(P(-hw, hd, y1), P(hw, hd, y1), P(hw, -hd, y1), P(-hw, -hd, y1), [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], rc);
  }
  build(group) {
    const mas = new THREE.MeshStandardMaterial({ map: masonryTexture(), vertexColors: true, roughness: 0.85 });
    const gla = new THREE.MeshStandardMaterial({ map: glassTexture(), vertexColors: true, roughness: 0.22, metalness: 0.5, envMapIntensity: 1.2 });
    const roof = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    let n = 0;
    for (const t of this.tiles.values()) {
      for (const [b, m] of [[t.masonry, mas], [t.glass, gla], [t.roof, roof]]) {
        const mesh = b.mesh(m); if (mesh) { group.add(mesh); n++; }
      }
    }
    return n;
  }
}

const gauss = (dx, dz, s) => Math.exp(-(dx * dx + dz * dz) / (2 * s * s));
const WALL_TONES = [[0.86, 0.80, 0.72], [0.78, 0.70, 0.62], [0.70, 0.56, 0.46], [0.62, 0.62, 0.62], [0.88, 0.86, 0.82], [0.56, 0.44, 0.38], [0.74, 0.72, 0.68]];
const GLASS_TONES = [[0.75, 0.82, 0.9], [0.62, 0.7, 0.78], [0.8, 0.8, 0.78], [0.55, 0.65, 0.7]];

function manhattan(B) {
  const R = rng(1549);
  const o = ll(40.7580, -73.9855), a29 = 29 * Math.PI / 180;
  const along = [Math.sin(a29), -Math.cos(a29)], across = [Math.cos(a29), Math.sin(a29)];
  // Box local x runs along `across` (the streets), local z along `along` (the avenues).
  const yaw = Math.atan2(across[1], across[0]);
  const mid = PLACES.midtown, dt = PLACES.downtown;
  let count = 0;
  for (let a = -13000; a <= 14000; a += 80) {
    for (let b = -3500; b <= 3500; b += 65) {
      const cx = o.x + along[0] * a + across[0] * b, cz = o.z + along[1] * a + across[1] * b;
      const p = { x: cx, z: cz };
      if (!inPoly(p, MANHATTAN) || inPoly(p, CENTRAL_PARK)) continue;
      const w = 26 + R() * 34, d = 34 + R() * 26;
      // Keep the whole footprint on the island.
      let ok = true;
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const q = { x: cx + across[0] * sx * w / 2 + along[0] * sz * d / 2, z: cz + across[1] * sx * w / 2 + along[1] * sz * d / 2 };
        if (!inPoly(q, MANHATTAN) || isWater(q)) { ok = false; break; }
      }
      if (!ok || R() < 0.06) continue;
      const { lat } = toLatLon(cx, cz);
      const peak = Math.max(gauss(cx - mid.x, cz - mid.z, 1350) * 250, gauss(cx - dt.x, cz - dt.z, 650) * 230);
      let h = lat > 40.80 ? 14 + R() * 26 : 16 + R() * 30;
      h = Math.max(h, peak * (0.3 + 0.7 * Math.pow(R(), 0.8)));
      if (R() < 0.015 && peak > 60) h *= 1.5;
      const glass = h > 90 ? R() < 0.62 : R() < 0.08;
      const tone = glass ? GLASS_TONES[Math.floor(R() * GLASS_TONES.length)] : WALL_TONES[Math.floor(R() * WALL_TONES.length)];
      const col = tone.map((c) => c * (0.9 + R() * 0.15));
      if (h > 120) {
        const h0 = h * (0.45 + R() * 0.2);
        B.box(cx, cz, w, d, h0, yaw, LAND_Y, col, glass);
        B.box(cx, cz, w * 0.72, d * 0.72, h - h0, yaw, LAND_Y + h0, col, glass);
      } else B.box(cx, cz, w, d, h, yaw, LAND_Y, col, glass);
      count++;
    }
  }
  return count;
}

// Outer boroughs and New Jersey: low, dense, the odd tower.
function surroundings(B) {
  const R = rng(77);
  let count = 0;
  const half = 14500;
  for (let x = -half; x <= half; x += 118) for (let z = -half - 1500; z <= half; z += 118) {
    if (R() < 0.12) continue;
    const cx = x + (R() - 0.5) * 60, cz = z + (R() - 0.5) * 60;
    const p = { x: cx, z: cz };
    if (isWater(p) || inPoly(p, MANHATTAN) || inPoly(p, LGA_FIELD)) continue;
    const ph = palisadesHeight(p);
    if (ph > 0.5 && ph < 91) continue;              // on the cliff face
    const west = westOfNJShore(p);
    const w = 18 + R() * 34, d = 18 + R() * 34;
    let h = 7 + R() * 14;
    if (R() < 0.06) h = 30 + R() * 45;               // Bronx co-ops, Queens towers
    if (west > 0 && west < 700 && R() < 0.25) h = 22 + R() * 50;   // the Jersey waterfront
    // Keep clear of the water's edge.
    let ok = true;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) if (isWater({ x: cx + sx * w * 0.7, z: cz + sz * d * 0.7 })) { ok = false; break; }
    if (!ok) continue;
    const glass = h > 60 && R() < 0.4;
    const tone = glass ? GLASS_TONES[Math.floor(R() * GLASS_TONES.length)] : WALL_TONES[Math.floor(R() * WALL_TONES.length)];
    B.box(cx, cz, w, d, h, R() * 0.4 - 0.2 + 0.5, LAND_Y + ph, tone.map((c) => c * (0.85 + R() * 0.2)), glass);
    count++;
  }
  return count;
}

// A few skyline shapes people recognise.
function landmarks(group, mats) {
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); group.add(m); return m; };
  const yaw = -29 * Math.PI / 180;
  const E = PLACES.empire;
  const tiers = [[130, 60, 25], [95, 50, 60], [70, 42, 200], [50, 36, 250], [34, 28, 262], [20, 20, 320]];
  let y = LAND_Y;
  const empire = new THREE.Group();
  for (const [w, d, top] of tiers) {
    const h = top - (y - LAND_Y);
    const m = add(new THREE.BoxGeometry(w, h, d), mats.stone, 0, y + h / 2, 0);
    empire.add(m); y += h;
  }
  empire.add(add(new THREE.CylinderGeometry(4, 7, 50, 12), mats.stone, 0, y + 25, 0));
  empire.add(add(new THREE.CylinderGeometry(0.6, 1.2, 62, 8), mats.steel, 0, y + 50 + 31, 0));
  empire.position.set(E.x, 0, E.z); empire.rotation.y = yaw;
  group.add(empire);
  const C = PLACES.chrysler;
  const chrysler = new THREE.Group();
  chrysler.add(add(new THREE.BoxGeometry(62, 60, 62), mats.stone, 0, LAND_Y + 30, 0));
  chrysler.add(add(new THREE.BoxGeometry(40, 200, 40), mats.stone, 0, LAND_Y + 160, 0));
  for (let i = 0; i < 6; i++) chrysler.add(add(new THREE.CylinderGeometry(18 - i * 2.8, 20 - i * 2.8, 12, 4), mats.steel, 0, LAND_Y + 266 + i * 11, 0));
  chrysler.add(add(new THREE.ConeGeometry(3, 55, 8), mats.steel, 0, LAND_Y + 355, 0));
  chrysler.children.forEach((m) => (m.rotation.y = Math.PI / 4));
  chrysler.position.set(C.x, 0, C.z); chrysler.rotation.y = yaw;
  group.add(chrysler);
}

// ---- George Washington Bridge -------------------------------------------------------
function latticeTexture() {
  const [c, g] = canvas(128, 512);
  g.fillStyle = '#7f8588';
  g.fillRect(0, 0, 128, 512);
  g.globalCompositeOperation = 'destination-out';
  for (let y = 0; y < 512; y += 64) {
    for (const [x0, x1] of [[10, 118]]) {
      g.beginPath(); g.moveTo(x0, y + 8); g.lineTo(x1, y + 8); g.lineTo(64, y + 32); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(x0, y + 56); g.lineTo(x1, y + 56); g.lineTo(64, y + 32); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(x0, y + 14); g.lineTo(x0, y + 50); g.lineTo(58, y + 32); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(x1, y + 14); g.lineTo(x1, y + 50); g.lineTo(70, y + 32); g.closePath(); g.fill();
    }
  }
  g.globalCompositeOperation = 'source-over';
  const t = tex(c, { repeat: true });
  return t;
}
function gwb(group) {
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a9094, roughness: 0.6, metalness: 0.5 });
  const lattice = new THREE.MeshStandardMaterial({ map: latticeTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 });
  const nj = PLACES.gwbNJ, ny = PLACES.gwbNY, anj = PLACES.gwbAnchNJ, any = PLACES.gwbAnchNY;
  const axis = new THREE.Vector3(ny.x - nj.x, 0, ny.z - nj.z).normalize();
  const side = new THREE.Vector3(-axis.z, 0, axis.x);
  const yaw = Math.atan2(-axis.z, axis.x);
  const DECK = 65, TOP = 184, HALF = 17;
  const bridge = new THREE.Group();
  const put = (m, p, y) => { m.position.set(p.x, y, p.z); m.rotation.y = yaw; bridge.add(m); return m; };
  for (const t of [nj, ny]) {
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(11, TOP, 11), lattice);
      leg.geometry.attributes.uv.array.forEach((v, i, arr) => { if (i % 2) arr[i] = v * TOP / 40; });
      put(leg, { x: t.x + side.x * s * HALF, z: t.z + side.z * s * HALF }, TOP / 2);
    }
    for (const y of [DECK - 8, 110, 150, TOP - 4]) put(new THREE.Mesh(new THREE.BoxGeometry(8, 7, HALF * 2), steel), t, y);
  }
  // Deck: upper roadway plus the 1962 lower deck, as one deep box.
  const len = Math.hypot(any.x - anj.x, any.z - anj.z) + 120;
  const mid = { x: (anj.x + any.x) / 2, z: (anj.z + any.z) / 2 };
  put(new THREE.Mesh(new THREE.BoxGeometry(len, 9, 36), steel), mid, DECK - 4.5);
  put(new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, 34), new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9 })), mid, DECK + 0.25);
  // Anchorages.
  for (const a of [anj, any]) put(new THREE.Mesh(new THREE.BoxGeometry(70, DECK + 8, 60), new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.9 })), a, (DECK + 8) / 2);
  // Main cables and suspenders.
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x70767a, roughness: 0.5, metalness: 0.6 });
  const suspPts = [];
  for (const s of [-1, 1]) {
    const off = (p) => new THREE.Vector3(p.x + side.x * s * HALF, 0, p.z + side.z * s * HALF);
    const A = off(anj), T1 = off(nj), T2 = off(ny), B = off(any);
    const pts = [];
    const seg = (p, q, y0, y1, sag, n) => {
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const v = p.clone().lerp(q, t);
        v.y = y0 + (y1 - y0) * t - sag * 4 * t * (1 - t);
        pts.push(v);
      }
    };
    seg(A, T1, DECK + 6, TOP, 12, 10);
    seg(T1, T2, TOP, TOP, TOP - DECK - 6, 60);
    seg(T2, B, TOP, DECK + 6, 12, 10);
    const curve = new THREE.CatmullRomCurve3(pts);
    bridge.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 200, 0.9, 6), cableMat));
    for (let i = 1; i < 60; i++) {
      const t = i / 60;
      const v = T1.clone().lerp(T2, t);
      const y = TOP - (TOP - DECK - 6) * 4 * t * (1 - t);
      suspPts.push(v.x, y, v.z, v.x, DECK, v.z);
    }
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(suspPts, 3));
  bridge.add(new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: 0x5e6468 })));
  group.add(bridge);
}

// ---- Palisades ---------------------------------------------------------------------
function palisades(group, groundTex) {
  const rows = [];
  const pts = NJ_SHORE_PTS.slice(0, 6);  // north of ~40.79
  const samples = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 40);
    for (let k = 0; k < n; k++) samples.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n });
  }
  // Offsets west of the shore and whether the vertex is on the face or the top.
  const OFF = [58, 64, 80, 96, 110, 125, 3200];
  const pos = [], uv = [], col = [], idx = [];
  const R = rng(9);
  let along = 0;
  samples.forEach((p, i) => {
    if (i) along += Math.hypot(p.x - samples[i - 1].x, p.z - samples[i - 1].z);
    const row = [];
    for (const d of OFF) {
      const q = { x: p.x - d, z: p.z };
      const h = palisadesHeight({ x: q.x, z: q.z });
      const y = LAND_Y + (d >= 110 ? palisadesHeight({ x: p.x - 400, z: p.z }) : h) + (d > 64 && d < 110 ? (R() - 0.5) * 3 : 0);
      pos.push(q.x, y, q.z);
      const top = d >= 110;
      uv.push(top ? (q.x - (GROUND.cx - GROUND.size / 2)) / GROUND.size : along / 50,
        top ? (q.z - (GROUND.cz - GROUND.size / 2)) / GROUND.size : y / 30);
      const shade = 0.75 + R() * 0.25;
      if (d > 1000) col.push(1, 1, 1); else if (top) col.push(0.5, 0.47, 0.42); else col.push(0.44 * shade, 0.39 * shade, 0.34 * shade);
      row.push(pos.length / 3 - 1);
    }
    rows.push(row);
  });
  for (let i = 0; i < rows.length - 1; i++) for (let k = 0; k < OFF.length - 1; k++) {
    const a = rows[i][k], b = rows[i + 1][k], c = rows[i][k + 1], d = rows[i + 1][k + 1];
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Top uses the ground painting (world-aligned); the face uses vertex colour over a streak map.
  const [c, cg] = canvas(64, 256);
  cg.fillStyle = '#fff'; cg.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 400; i++) { cg.fillStyle = `rgba(0,0,0,${R() * 0.25})`; cg.fillRect(R() * 64, R() * 256, 1 + R() * 2, 10 + R() * 60); }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide, map: groundTex, flatShading: true });
  const faceMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide, map: tex(c, { repeat: true }), flatShading: true });
  // Split into face (first OFF columns) and top by index groups.
  const faceQuads = (rows.length - 1) * 5 * 6, topQuads = (rows.length - 1) * 1 * 6;
  const reordered = [];
  for (let i = 0; i < rows.length - 1; i++) for (let k = 0; k < 5; k++) reordered.push(...idx.slice((i * 6 + k) * 6, (i * 6 + k) * 6 + 6));
  for (let i = 0; i < rows.length - 1; i++) reordered.push(...idx.slice((i * 6 + 5) * 6, (i * 6 + 5) * 6 + 6));
  g.setIndex(reordered);
  g.addGroup(0, faceQuads, 0); g.addGroup(faceQuads, topQuads, 1);
  const m = new THREE.Mesh(g, [faceMat, mat]);
  m.receiveShadow = true;
  group.add(m);
}

// ---- LaGuardia -------------------------------------------------------------------------
function laguardia(group) {
  const runway = (a, b, label) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const g = new THREE.PlaneGeometry(45, len);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: runwayTexture(label), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3 }));
    m.position.set((a.x + b.x) / 2, LAND_Y + 0.06, (a.z + b.z) / 2);
    m.rotation.y = Math.atan2(-(b.x - a.x), -(b.z - a.z));
    m.receiveShadow = true;
    group.add(m);
    // Taxiway alongside.
    const t = new THREE.Mesh(new THREE.PlaneGeometry(23, len * 0.9).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x545250, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2 }));
    const side = new THREE.Vector3(b.z - a.z, 0, -(b.x - a.x)).normalize().multiplyScalar(185);
    t.position.set(m.position.x + side.x, LAND_Y + 0.04, m.position.z + side.z);
    t.rotation.y = m.rotation.y; t.receiveShadow = true;
    group.add(t);
  };
  // Winter grass over the infield, tiled at close range.
  const [gc, gg] = canvas(256, 256);
  const R = rng(4);
  gg.fillStyle = '#6d6a55'; gg.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    gg.fillStyle = `hsl(${40 + R() * 25}, ${12 + R() * 14}%, ${26 + R() * 22}%)`;
    gg.fillRect(R() * 256, R() * 256, 1 + R() * 2, 1 + R() * 3);
  }
  const gt = tex(gc, { repeat: true });
  gt.repeat.set(1 / 30, 1 / 30);
  const field = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(LGA_FIELD.map((q) => new THREE.Vector2(q.x, -q.z)))).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: gt, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }));
  field.position.y = LAND_Y + 0.02; field.receiveShadow = true;
  group.add(field);
  runway(PLACES.lgaRwy4, PLACES.lgaRwy22, '4');
  runway(PLACES.lgaRwy13, PLACES.lgaRwy31, '13');
  const grey = new THREE.MeshStandardMaterial({ color: 0xb4b2ac, roughness: 0.8 });
  const glassy = new THREE.MeshStandardMaterial({ color: 0x51606c, roughness: 0.2, metalness: 0.6 });
  const box = (lat, lon, w, h, d, yaw, mat = grey) => {
    const p = ll(lat, lon);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(p.x, LAND_Y + h / 2, p.z); m.rotation.y = yaw; m.receiveShadow = true; group.add(m);
  };
  const ry = Math.atan2(-RWY_DIR.x, -RWY_DIR.z);
  box(40.7728, -73.8738, 420, 18, 70, ry - Math.PI / 2 + 0.66);   // central terminal
  box(40.7722, -73.8712, 300, 12, 40, ry - Math.PI / 2 + 0.66, glassy);
  box(40.7745, -73.8835, 160, 22, 90, ry);                          // hangars
  box(40.7760, -73.8850, 160, 22, 90, ry);
  box(40.7700, -73.8650, 180, 14, 60, ry + 0.3);                    // Marine Air Terminal side
  const tp = ll(40.7738, -73.8783);
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 60, 12), grey);
  tower.position.set(tp.x, LAND_Y + 30, tp.z); group.add(tower);
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(9, 7, 7, 8), glassy);
  cab.position.set(tp.x, LAND_Y + 63, tp.z); group.add(cab);
}

// ---- assembly -------------------------------------------------------------------------
export function buildCity(scene) {
  const group = new THREE.Group();
  // Water: one big plane. Normals scroll with flight time.
  const wn = waterNormals();
  wn.repeat.set(3600, 3600);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(120000, 120000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x3a4846, roughness: 0.24, metalness: 0.0, normalMap: wn, normalScale: new THREE.Vector2(0.4, 0.4), envMapIntensity: 1.0 }),
  );
  water.receiveShadow = true;
  group.add(water);
  // Land: alpha-tested painting over the water. Clamped beyond its 32 km square.
  const gt = groundTexture();
  const lg = new THREE.PlaneGeometry(GROUND.size * 3, GROUND.size * 3, 3, 3).rotateX(-Math.PI / 2);
  const uv = lg.attributes.uv, p = lg.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    const x = p.getX(i) + GROUND.cx, z = p.getZ(i) + GROUND.cz;
    uv.setXY(i, (x - (GROUND.cx - GROUND.size / 2)) / GROUND.size, (z - (GROUND.cz - GROUND.size / 2)) / GROUND.size);
  }
  const land = new THREE.Mesh(lg, new THREE.MeshStandardMaterial({ map: gt, alphaTest: 0.5, roughness: 0.95 }));
  land.position.set(GROUND.cx, LAND_Y, GROUND.cz);
  land.receiveShadow = true;
  group.add(land);

  const B = new Buildings();
  const nm = manhattan(B), ns = surroundings(B);
  const meshes = B.build(group);
  landmarks(group, {
    stone: new THREE.MeshStandardMaterial({ color: 0xc9c1b1, roughness: 0.8 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xc0c6cc, roughness: 0.25, metalness: 0.9 }),
  });
  gwb(group);
  palisades(group, gt);
  laguardia(group);
  scene.add(group);
  console.log(`city: ${nm} Manhattan + ${ns} other buildings in ${meshes} meshes`);
  return {
    group,
    update(ft) {
      wn.offset.set(ft * 0.0025, ft * 0.0011);
    },
  };
}
