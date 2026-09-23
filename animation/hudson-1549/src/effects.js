// Everything that moves besides the aircraft: the flock, smoke and flame,
// spray and foam at the ditching, the evacuation, the ferries.
// All of it is a pure function of flight time; emitters are precomputed.
import * as THREE from 'three';
import { rng } from './rng.js';
import { planeState, STRIKE_FT, DITCH_FT, STOP_FT, smooth, clamp } from './timeline.js';
import { softSprite, puffSprite, canvas, tex } from './textures.js';
import { ll } from './geo.js';

const G = 9.81;
// Body-frame point -> world, for a planeState.
const toWorld = (S, x, y, z) => S.pos.clone().addScaledVector(S.f, x).addScaledVector(S.u, y).addScaledVector(S.r, z);

// ---- the flock ------------------------------------------------------------------
const HIT_L = STRIKE_FT, HIT_R = STRIKE_FT + 0.09;
export class Geese {
  constructor(scene) {
    const R = rng(38);
    const S = planeState(STRIKE_FT);
    this.vel = S.rh.clone().multiplyScalar(-1).applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.5).multiplyScalar(17);
    this.birds = [];
    this.hits = [];
    const body = new THREE.MeshStandardMaterial({ color: 0x6e604f, roughness: 0.9 });
    const black = new THREE.MeshStandardMaterial({ color: 0x151412, roughness: 0.8 });
    const belly = new THREE.MeshStandardMaterial({ color: 0xb8ad9c, roughness: 0.9 });
    const bodyGeo = new THREE.SphereGeometry(0.5, 12, 8).scale(1.1, 0.42, 0.42);
    const neckGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.55, 6).rotateZ(-1.0).translate(0.62, 0.18, 0);
    const headGeo = new THREE.SphereGeometry(0.085, 8, 6).scale(1.5, 1, 1).translate(0.88, 0.36, 0);
    const tailGeo = new THREE.ConeGeometry(0.12, 0.3, 6).rotateZ(Math.PI / 2).translate(-0.6, 0.02, 0);
    const wingShape = new THREE.Shape([new THREE.Vector2(0.2, 0), new THREE.Vector2(-0.18, 0), new THREE.Vector2(-0.28, 0.85), new THREE.Vector2(0.05, 0.8)]);
    const wingGeo = new THREE.ShapeGeometry(wingShape).rotateX(Math.PI / 2);
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x5f5244, roughness: 0.9, side: THREE.DoubleSide });
    // Designated strikes: into each engine inlet, one on the nose, one on a wing.
    const targets = [
      [HIT_L, 3.7, -2.25, -5.75], [HIT_L + 0.02, 3.7, -2.0, -5.4], [HIT_L + 0.05, 3.7, -2.5, -6.1],
      [HIT_R, 3.7, -2.25, 5.75], [HIT_R + 0.03, 3.7, -2.0, 6.0],
      [STRIKE_FT - 0.06, 18.6, 0.2, 0.3], [STRIKE_FT + 0.03, 0.5, -0.8, 11.0],
    ];
    const N = 34;
    for (let i = 0; i < N; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(bodyGeo, i % 5 ? body : belly), new THREE.Mesh(neckGeo, black), new THREE.Mesh(headGeo, black), new THREE.Mesh(tailGeo, black));
      const wl = new THREE.Mesh(wingGeo, wingMat), wr = new THREE.Mesh(wingGeo, wingMat);
      wr.scale.z = -1;
      g.add(wl, wr);
      g.scale.setScalar(1.05);
      let P0, hitAt = null;
      if (i < targets.length) {
        const [t, x, y, z] = targets[i];
        const at = toWorld(planeState(t), x, y, z);
        P0 = at.clone().addScaledVector(this.vel, -(t - STRIKE_FT));
        hitAt = t;
        this.hits.push({ t, pos: at, i });
      } else {
        // Loose skein around the strike point, clear of the airframe.
        let x, y, z;
        do { x = -30 + R() * 120; y = -18 + R() * 30; z = -45 + R() * 90; } while (Math.abs(z) < 21 && Math.abs(y) < 8 && x > -25 && x < 40);
        P0 = toWorld(S, x, y, z);
      }
      this.birds.push({ g, wl, wr, P0, hitAt, phase: R() * 6.28, rate: 2.6 + R() * 0.8 });
      scene.add(g);
    }
    this.yaw = Math.atan2(-this.vel.z, this.vel.x);
    // Feathers from each strike.
    const n = this.hits.length * 40;
    this.fpos = new Float32Array(n * 3);
    this.fgeo = new THREE.BufferGeometry();
    this.fgeo.setAttribute('position', new THREE.BufferAttribute(this.fpos, 3));
    this.feathers = new THREE.Points(this.fgeo, new THREE.PointsMaterial({ color: 0x8c8378, size: 0.35, map: softSprite(), transparent: true, depthWrite: false }));
    this.feathers.frustumCulled = false;
    scene.add(this.feathers);
    this.fdata = [];
    for (const h of this.hits) for (let k = 0; k < 40; k++) {
      this.fdata.push({ t: h.t, p: h.pos, v: new THREE.Vector3(R() - 0.5, R() * 0.6, R() - 0.5).multiplyScalar(14).add(this.vel) });
    }
  }
  update(ft) {
    const visible = ft > STRIKE_FT - 40 && ft < STRIKE_FT + 25;
    for (const b of this.birds) {
      const alive = visible && (b.hitAt === null || ft < b.hitAt);
      b.g.visible = alive;
      if (!alive) continue;
      b.g.position.copy(b.P0).addScaledVector(this.vel, ft - STRIKE_FT);
      b.g.rotation.set(0, this.yaw, 0);
      const flap = Math.sin(ft * b.rate * 6.283 + b.phase);
      b.wl.rotation.x = 0.1 + flap * 0.65;
      b.wr.rotation.x = -(0.1 + flap * 0.65);
    }
    let alive = 0;
    this.fdata.forEach((f, i) => {
      const a = ft - f.t;
      if (a < 0 || a > 5) { this.fpos[i * 3 + 1] = -1e5; return; }
      const drag = (1 - Math.exp(-a * 1.5)) / 1.5;
      this.fpos[i * 3] = f.p.x + f.v.x * drag;
      this.fpos[i * 3 + 1] = f.p.y + f.v.y * drag - 1.5 * a * a;
      this.fpos[i * 3 + 2] = f.p.z + f.v.z * drag;
      alive++;
    });
    this.fgeo.attributes.position.needsUpdate = true;
    this.feathers.visible = alive > 0;
  }
}

// ---- sprite pool: smoke, mist -------------------------------------------------------
export class Puffs {
  constructor(scene) {
    this.pool = [];
    const maps = [puffSprite(3), puffSprite(4), puffSprite(5)];
    for (let i = 0; i < 360; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: maps[i % 3], transparent: true, depthWrite: false, color: 0xffffff, fog: true }));
      s.visible = false; scene.add(s); this.pool.push(s);
    }
    const R = rng(5);
    this.list = [];
    // Engine smoke: dark, trailing, for several seconds after each strike.
    for (const [side, t0] of [[-1, HIT_L], [1, HIT_R]]) {
      for (let k = 0; k < 110; k++) {
        const tb = t0 + k * 0.07 + R() * 0.03;
        const S = planeState(tb);
        const p = toWorld(S, -2.4, -2.25, side * 5.75);
        const strength = Math.exp(-k * 0.035) * (0.6 + R() * 0.4);
        this.list.push({ tb, p, v: S.f.clone().multiplyScalar(-6).add(new THREE.Vector3(R() - 0.5, R() * 0.5, R() - 0.5)), life: 7, s0: 2.2, s1: 11,
          o: 0.55 * strength, c0: [0.16, 0.15, 0.14], c1: [0.55, 0.55, 0.56], rot: R() * 6 });
      }
    }
    // Ditching mist: white, low, growing.
    for (let k = 0; k < 170; k++) {
      const tb = DITCH_FT + Math.pow(R(), 1.7) * 8.5;
      const S = planeState(tb);
      const side = R() < 0.5 ? -1 : 1;
      const p = toWorld(S, -6 + R() * 14, 0, side * (2 + R() * 9));
      p.y = 1 + R() * 3;
      const v = S.r.clone().multiplyScalar(side * (3 + R() * 6)).addScaledVector(S.f, S.speed * (0.15 + R() * 0.2)).add(new THREE.Vector3(0, 1.5 + R() * 2, 0));
      this.list.push({ tb, p, v, life: 5 + R() * 3, s0: 5, s1: 22, o: 0.6, c0: [0.95, 0.96, 0.97], c1: [0.9, 0.92, 0.94], rot: R() * 6, drag: 0.8 });
    }
    this.list.sort((a, b) => a.tb - b.tb);
  }
  update(ft) {
    let n = 0;
    for (const q of this.list) {
      const a = ft - q.tb;
      if (a < 0 || a > q.life || n >= this.pool.length) continue;
      const s = this.pool[n++];
      const k = a / q.life;
      const d = q.drag ? (1 - Math.exp(-a * q.drag)) / q.drag : a;
      s.position.copy(q.p).addScaledVector(q.v, d);
      s.scale.setScalar(q.s0 + (q.s1 - q.s0) * Math.sqrt(k));
      s.material.opacity = q.o * Math.min(1, a * 4) * (1 - k) * (1 - k * 0.3);
      s.material.color.setRGB(...q.c0.map((c, i) => c + (q.c1[i] - c) * k));
      s.material.rotation = q.rot + a * 0.2;
      s.visible = true;
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].visible = false;
  }
}

// ---- spray -----------------------------------------------------------------------------
export class Spray {
  constructor(scene) {
    const R = rng(345);
    this.data = [];
    const bins = new Map();
    const stateAt = (t) => { const k = Math.round(t * 20); if (!bins.has(k)) bins.set(k, planeState(k / 20)); return bins.get(k); };
    for (let i = 0; i < 4200; i++) {
      const tb = DITCH_FT - 0.1 + Math.pow(R(), 2.1) * 9.5;
      const S = stateAt(tb);
      const eng = R() < 0.35;
      const side = R() < 0.5 ? -1 : 1;
      const x = eng ? 1.2 : -10 + R() * 18, z = eng ? side * 5.75 : side * R() * 2.2;
      const p = toWorld(S, x, 0, z); p.y = 0.2;
      const fade = Math.max(0.15, S.speed / 66);
      const v = new THREE.Vector3()
        .addScaledVector(S.r, side * (3 + R() * 14) * fade)
        .addScaledVector(S.f, S.speed * (0.1 + R() * 0.45))
        .add(new THREE.Vector3(0, (5 + R() * 16) * fade, 0));
      this.data.push({ tb, p, v });
    }
    const n = this.data.length;
    this.pos = new Float32Array(n * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(this.geo, new THREE.PointsMaterial({ color: 0xf2f5f7, size: 0.55, map: softSprite(), transparent: true, opacity: 0.9, depthWrite: false }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  update(ft) {
    const on = ft > DITCH_FT - 0.2 && ft < DITCH_FT + 16;
    this.points.visible = on;
    if (!on) return;
    this.data.forEach((d, i) => {
      const a = ft - d.tb;
      const y = d.p.y + d.v.y * a - 0.5 * G * a * a;
      if (a < 0 || y < -0.2) { this.pos[i * 3 + 1] = -1e5; return; }
      this.pos[i * 3] = d.p.x + d.v.x * a;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = d.p.z + d.v.z * a;
    });
    this.geo.attributes.position.needsUpdate = true;
  }
}

// ---- foam ---------------------------------------------------------------------------
function foamTexture(seed) {
  const [c, g] = canvas(256, 256);
  const R = rng(seed);
  for (let i = 0; i < 2200; i++) {
    const x = R() * 256, y = R() * 256, r = 1 + R() * 7;
    g.fillStyle = `rgba(255,255,255,${0.12 + R() * 0.35})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return tex(c, { repeat: true });
}
// Foam masked by a soft radial falloff, for a disc's own 0..1 UVs.
function foamRing() {
  const [c, g] = canvas(512, 512);
  const R = rng(9);
  for (let i = 0; i < 9000; i++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 250;
    const fall = Math.pow(1 - r / 250, 1.5);
    g.fillStyle = `rgba(255,255,255,${(0.1 + R() * 0.4) * fall})`;
    g.beginPath(); g.arc(256 + Math.cos(a) * r, 256 + Math.sin(a) * r, 1 + R() * 6, 0, Math.PI * 2); g.fill();
  }
  return tex(c);
}
export class Foam {
  constructor(scene) {
    const pts = [];
    for (let t = DITCH_FT; t <= STOP_FT; t += 0.25) pts.push(planeState(t));
    const pos = [], uv = [];
    let along = 0;
    pts.forEach((S, i) => {
      if (i) along += S.pos.distanceTo(pts[i - 1].pos);
      const w = 7 + 12 * (i / pts.length);
      for (const s of [-1, 1]) {
        pos.push(S.pos.x + S.rh.x * s * w, 0.05, S.pos.z + S.rh.z * s * w);
        uv.push(s < 0 ? 0 : 1, along / 30);
      }
    });
    const idx = [];
    for (let i = 0; i < pts.length - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    this.mat = new THREE.MeshStandardMaterial({ map: foamTexture(8), transparent: true, depthWrite: false, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    // A ring of churned water round the aircraft once it stops.
    this.ringMat = new THREE.MeshStandardMaterial({ map: foamRing(), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4 });
    this.ring = new THREE.Mesh(new THREE.CircleGeometry(30, 40).rotateX(-Math.PI / 2), this.ringMat);
    this.ring.renderOrder = 2;
    scene.add(this.ring);
  }
  update(ft, S) {
    this.mesh.visible = ft > DITCH_FT - 0.1;
    // Reveal the trail up to the aircraft, then let it fade over minutes.
    const k = clamp((ft - DITCH_FT) / (STOP_FT - DITCH_FT), 0, 1);
    this.mesh.geometry.setDrawRange(0, Math.floor(k * (this.mesh.geometry.index.count / 6)) * 6);
    this.mat.opacity = 0.9 * (1 - 0.9 * smooth(STOP_FT, STOP_FT + 250, ft));
    this.ring.visible = ft > DITCH_FT;
    this.ring.position.set(S.pos.x, 0.06, S.pos.z);
    this.ringMat.opacity = 0.7 * smooth(DITCH_FT + 2, DITCH_FT + 8, ft) * (1 - 0.6 * smooth(STOP_FT + 60, STOP_FT + 400, ft));
    this.ring.scale.setScalar(0.8 + 0.4 * smooth(DITCH_FT, STOP_FT + 60, ft));
  }
}

// ---- engine flame ------------------------------------------------------------------
export class Flames {
  constructor(aircraft) {
    const map = softSprite('rgba(255,170,60,1)', 'rgba(255,80,0,0)');
    this.sprites = [];
    for (const e of aircraft.engines) {
      for (const at of [e.exhaust, e.inlet]) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
        s.position.copy(at);
        aircraft.root.add(s);
        this.sprites.push({ s, side: e.side, inlet: at === e.inlet });
      }
    }
  }
  update(ft) {
    for (const q of this.sprites) {
      const t0 = q.side < 0 ? HIT_L : HIT_R;
      let k = 0;
      for (const [d, a] of [[0.02, 1], [0.3, 0.8], [0.62, 1], [1.0, 0.6], [1.5, 0.7], [2.3, 0.45]]) {
        const x = ft - t0 - d;
        if (x > 0) k += a * Math.exp(-x * 7);
      }
      if (q.inlet) k *= 0.5;
      q.s.visible = k > 0.02;
      q.s.scale.setScalar(2.5 + 5 * k);
      q.s.material.opacity = Math.min(1, k);
    }
  }
}

// ---- evacuation -------------------------------------------------------------------------
export class Evacuation {
  constructor(aircraft) {
    const R = rng(155);
    const root = aircraft.root;
    const coats = [0x1d2230, 0x262626, 0x3b2f28, 0x55585c, 0x6d1f25, 0x8a7a64, 0x2b3a2e, 0x1b2a45, 0xb7a58a];
    this.people = [];
    const bodyGeo = new THREE.CylinderGeometry(0.2, 0.24, 1.25, 8).translate(0, 0.62, 0);
    const headGeo = new THREE.SphereGeometry(0.13, 10, 8).translate(0, 1.42, 0);
    const N = 62;
    this.bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), N);
    this.heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xc89f86, roughness: 0.8 }), N);
    const dih = Math.tan(5.1 * Math.PI / 180);
    for (let i = 0; i < N; i++) {
      let p, seat = 'wing';
      if (i % 5 === 4) {
        // In a slide-raft at a forward door.
        const s = i % 2 ? 1 : -1;
        p = new THREE.Vector3(11.4 + R() * 2.2, -1.2, s * (3.4 + R() * 4.2));
        seat = 'raft';
      } else {
        const s = i % 2 ? 1 : -1;
        const z = 2.4 + R() * 9.5;
        const le = 3.0 - (z - 1.7) * 0.51, te = -4.2 - (z - 1.7) * 0.2;
        const x = te + 0.6 + R() * (le - te - 1.2);
        p = new THREE.Vector3(x, -1.25 + (z - 1.7) * dih + 0.22, s * z);
      }
      const col = new THREE.Color(R() < 0.12 ? 0xe0b52a : coats[Math.floor(R() * coats.length)]);
      this.bodies.setColorAt(i, col);
      this.people.push({ p, seat, t: 358 + i * 2.6 + R() * 2, yaw: R() * 6.28, sway: R() * 6.28 });
    }
    this.bodies.instanceColor.needsUpdate = true;
    this.bodies.castShadow = this.heads.castShadow = true;
    this.bodies.frustumCulled = this.heads.frustumCulled = false;
    root.add(this.bodies, this.heads);
    // Two slide-rafts at the forward doors.
    const raftMat = new THREE.MeshStandardMaterial({ color: 0xf2c21b, roughness: 0.6 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x5a5448, roughness: 0.9 });
    this.rafts = [-1, 1].map((s) => {
      const g = new THREE.Group();
      for (const [w, d, x, z] of [[3.0, 0.55, 0, -3], [3.0, 0.55, 0, 3], [0.55, 6.0, -1.25, 0], [0.55, 6.0, 1.25, 0]]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, d), raftMat); m.position.set(x, 0, z); g.add(m);
      }
      const fl = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.1, 5.8), floorMat); fl.position.y = -0.2; g.add(fl);
      g.position.set(12.5, -1.45, s * 5.4);
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      root.add(g);
      return g;
    });
    this.m = new THREE.Matrix4();
  }
  update(ft) {
    const deploy = smooth(357, 361, ft);
    for (const r of this.rafts) { r.visible = deploy > 0; r.scale.set(Math.max(0.01, deploy), Math.max(0.01, deploy), Math.max(0.01, deploy)); }
    const q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    this.people.forEach((h, i) => {
      const on = ft > h.t && (h.seat !== 'raft' || deploy > 0.9);
      sc.setScalar(on ? 1 : 0.0001);
      q.setFromEuler(new THREE.Euler(0.04 * Math.sin(ft * 1.3 + h.sway), h.yaw, 0.04 * Math.sin(ft * 1.1 + h.sway)));
      pos.copy(h.p);
      this.m.compose(pos, q, sc);
      this.bodies.setMatrixAt(i, this.m);
      this.heads.setMatrixAt(i, this.m);
    });
    this.bodies.instanceMatrix.needsUpdate = this.heads.instanceMatrix.needsUpdate = true;
  }
}

// ---- ferries ----------------------------------------------------------------------------
function cabinTexture() {
  const [c, g] = canvas(256, 64);
  g.fillStyle = '#f1f2f2'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#28323c';
  for (let x = 4; x < 256; x += 21) g.fillRect(x, 14, 16, 24);
  g.fillStyle = '#20407a'; g.fillRect(0, 52, 256, 6);
  return tex(c, { repeat: true });
}
function ferry(hullColor, stripe) {
  const g = new THREE.Group();
  const shape = new THREE.Shape([[-15, -4.6], [9, -4.6], [15, 0], [9, 4.6], [-15, 4.6]].map(([x, y]) => new THREE.Vector2(x, y)));
  const hull = new THREE.ExtrudeGeometry(shape, { depth: 3.2, bevelEnabled: false }).rotateX(-Math.PI / 2);
  const hm = new THREE.Mesh(hull, new THREE.MeshStandardMaterial({ color: hullColor, roughness: 0.5 }));
  hm.position.y = -1.1; g.add(hm);
  const st = new THREE.Mesh(new THREE.ExtrudeGeometry(new THREE.Shape([[-15.05, -4.65], [9.02, -4.65], [15.05, 0], [9.02, 4.65], [-15.05, 4.65]].map(([x, y]) => new THREE.Vector2(x, y))), { depth: 0.5, bevelEnabled: false }).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: stripe, roughness: 0.5 }));
  st.position.y = 1.2; g.add(st);
  const ct = cabinTexture();
  ct.repeat.set(2, 1);
  const cabinMat = new THREE.MeshStandardMaterial({ map: ct, roughness: 0.4 });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(19, 2.7, 8), cabinMat); cab.position.set(-2, 3.45, 0); g.add(cab);
  const wh = new THREE.Mesh(new THREE.BoxGeometry(6, 2.3, 5.4), cabinMat); wh.position.set(1.5, 5.95, 0); g.add(wh);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.25, 5.8), new THREE.MeshStandardMaterial({ color: 0x9aa2a8 })); roof.position.set(1.5, 7.2, 0); g.add(roof);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3), new THREE.MeshStandardMaterial({ color: 0x333333 })); mast.position.set(1.5, 8.7, 0); g.add(mast);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // Stern wash.
  const wash = new THREE.Mesh(new THREE.PlaneGeometry(55, 16).rotateX(-Math.PI / 2).translate(-43, 0.08, 0),
    new THREE.MeshStandardMaterial({ map: foamTexture(12), transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4 }));
  wash.renderOrder = 2;
  g.add(wash);
  return { g, wash };
}
export class Ferries {
  constructor(scene) {
    const P = (lat, lon) => { const p = ll(lat, lon); return new THREE.Vector3(p.x, 0, p.z); };
    // [start, launch ft, arrival ft, offset from the aircraft (fwd, right), colours]
    const spec = [
      [P(40.7768, -74.0112), 352, 585, [24, -30], 0xf4f4f2, 0x1d3f7a],   // from Weehawken
      [P(40.7590, -74.0030), 372, 612, [-8, 33], 0xf4f4f2, 0x1d3f7a],    // from Midtown W 39th St
      [P(40.7835, -73.9985), 392, 640, [52, 12], 0xf4f4f2, 0x7a1d1d],
      [P(40.7470, -74.0130), 385, 668, [-44, -26], 0xb3261e, 0x1a1a1a],  // a rescue boat
    ];
    this.boats = spec.map(([start, t0, t1, off, hull, stripe]) => {
      const b = ferry(hull, stripe);
      b.g.scale.setScalar(t1 > 660 ? 0.75 : 1);
      scene.add(b.g);
      return { ...b, start, t0, t1, off };
    });
  }
  update(ft) {
    for (const b of this.boats) {
      const S = planeState(Math.min(ft, b.t1));
      const target = S.pos.clone().setY(0).addScaledVector(S.fh, b.off[0]).addScaledVector(S.rh, b.off[1]);
      const k = smooth(b.t0, b.t1, ft);
      const p = b.start.clone().lerp(target, k);
      if (ft > b.t1) p.add(planeState(ft).pos.clone().setY(0).sub(S.pos.clone().setY(0)));
      const dir = target.clone().sub(b.start);
      let yaw = Math.atan2(-dir.z, dir.x);
      // Turn broadside to the aircraft over the last stretch.
      yaw += 0.9 * smooth(b.t1 - 60, b.t1, ft) * (b.off[1] > 0 ? 1 : -1);
      b.g.position.set(p.x, 0.15 * Math.sin(ft * 0.8 + b.t0), p.z);
      b.g.rotation.set(0.01 * Math.sin(ft * 0.7 + b.t0), yaw, 0.015 * Math.sin(ft * 0.9 + b.t1));
      const speed = (b.start.distanceTo(target) / (b.t1 - b.t0)) * 6 * k * (1 - k) * 4 / 6;
      b.wash.material.opacity = clamp(speed / 6, 0, 0.8);
      b.g.visible = ft > b.t0 - 30;
    }
  }
}
