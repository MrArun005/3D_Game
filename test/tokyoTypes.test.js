import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../src/core/rng.js';
import { TOKYO_TYPES, buildTokyoLot, pickTokyoType } from '../src/world/tokyoTypes.js';
import { buildTokyoBuilding, frontRotation, ensureSurf, SURF, buildShrine } from '../src/world/tokyo.js';
import { District } from '../src/world/district.js';
import { styleFor } from '../src/world/artBuildings.js';

const NEW = ['tower', 'pencil', 'mansion', 'carpark', 'machiya', 'depato'];
/* A plot in each type's niche (see pickTokyoType), varied per seed: [hw, hd, h].
   hw is half the DEPTH back from the street, hd half the FRONTAGE. */
const NICHE = {
  tower: (r) => [8 + r() * 12, 8 + r() * 12, 70 + r() * 90],
  pencil: (r) => [4.5 + r() * 9.5, 2.5 + r() * 2.8, 16 + r() * 14],
  mansion: (r) => [5.5 + r() * 9, 5.5 + r() * 9, 30 + r() * 38],
  carpark: (r) => [9 + r() * 6, 9 + r() * 6, 20 + r() * 40],
  machiya: (r) => [3 + r() * 11, 2.5 + r() * 5.5, 17 + r() * 6],
  depato: (r) => [8 + r() * 7, 11 + r() * 5, 30 + r() * 40],
};
/* A side street on +Z for half the seeds: the corner-seeking types (mansion corridor, depato atrium) read it. */
const probeFor = (seed, hd) => (seed % 2 ? (x, z) => (z > hd + 1 ? -2 : 25) : undefined);
const plotsOf = (type, n = 50) => {
  const out = [];
  for (let s = 1; s <= n; s++) {
    const r = mulberry32(s * 7919 + type.length);
    const [hw, hd, h] = NICHE[type](r);
    out.push({ seed: s * 104729 + 17, hw, hd, h });
  }
  return out;
};
const build = (type, p) => buildTokyoLot(p.seed, p.hw, p.hd, p.h, { force: type, probe: probeFor(p.seed, p.hd) });

const ATTRS = ['position', 'normal', 'uv', 'color', 'emit', 'flick', 'surf'];
function fnv(arrays) {
  let h = 0x811c9dc5;
  for (const a of arrays) {
    const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193); }
  }
  return h >>> 0;
}

test('every new type builds for 50 seeds: indexed, every attribute present and finite, surf kinds valid, inside its budget', (t) => {
  for (const type of NEW) {
    let sum = 0, max = 0;
    for (const p of plotsOf(type)) {
      const b = build(type, p);
      assert.equal(b.type, type);
      const g = b.geo;
      assert.ok(g.index, `${type}: indexed`);
      for (const a of ATTRS) {
        assert.ok(g.attributes[a], `${type}: ${a} attribute`);
        const arr = g.attributes[a].array;
        for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) assert.fail(`${type} seed ${p.seed}: ${a}[${i}] = ${arr[i]}`);
      }
      const nn = g.attributes.normal.array;
      for (let i = 0; i < nn.length; i += 3) {
        const l = Math.hypot(nn[i], nn[i + 1], nn[i + 2]);
        if (Math.abs(l - 1) > 0.02) assert.fail(`${type}: normal ${i / 3} has length ${l}`);
      }
      const sf = g.attributes.surf.array;
      for (let i = 0; i < sf.length; i++) {
        const k = Math.floor(sf[i]), v = sf[i] - k;
        if (k < SURF.WALL || k > SURF.PAINT || v < 0.04 || v > 0.86) assert.fail(`${type}: surf ${sf[i]} is no kind the facade material reads`);
      }
      assert.ok(b.tris <= TOKYO_TYPES[type].budget, `${type} seed ${p.seed} (${p.hw.toFixed(1)} x ${p.hd.toFixed(1)}, h ${p.h.toFixed(0)}): ${b.tris} triangles over its ${TOKYO_TYPES[type].budget}`);
      assert.ok(b.tris > 300, `${type}: ${b.tris} triangles is not a building`);
      assert.ok(b.height > 5 && b.floors >= 2, `${type}: height ${b.height}, floors ${b.floors}`);
      g.computeBoundingBox();
      const bb = g.boundingBox;
      assert.ok(b.height <= bb.max.y + 0.01 && b.height >= bb.max.y * 0.6, `${type}: height ${b.height.toFixed(1)} vs top ${bb.max.y.toFixed(1)}`);
      assert.ok(bb.min.y > -0.35, `${type}: ${bb.min.y.toFixed(2)} below the kerb`);
      // a fire stair stands 1.4 m off the back (as the walk-up's does), signs and canopies up to 2.5 m over a pavement
      assert.ok(bb.min.x > -p.hw - 1.6 && bb.max.x < p.hw + 3.0 && bb.min.z > -p.hd - 2.2 && bb.max.z < p.hd + 2.2, `${type}: parts flung off the plot (${bb.min.x.toFixed(1)}..${bb.max.x.toFixed(1)} x ${bb.min.z.toFixed(1)}..${bb.max.z.toFixed(1)})`);
      for (const lp of b.lamps) assert.ok([lp.x, lp.y, lp.z, lp.intensity, lp.range].every(Number.isFinite) && lp.range >= 20 && Number.isInteger(lp.colour), `${type}: lamp`);
      sum += b.tris; max = Math.max(max, b.tris);
      g.dispose();
    }
    t.diagnostic(`${type}: mean ${(sum / 50).toFixed(0)} / max ${max} triangles over 50 seeds (budget ${TOKYO_TYPES[type].budget})`);
  }
});

/* ?tokyotype= forces a type onto any plot it fits, niche or not. The ceiling
   here is the walk-up's own worst on the real district (17,788, the 99 m plot):
   no forced type may be worse than what that plot already builds. */
test('forced onto every real plot shape it fits, no type builds worse than the walk-up already does', () => {
  const data = JSON.parse(readFileSync(new URL('../public/halstead-bay.district.json', import.meta.url)));
  const d = new District(data);
  const sizes = [];
  for (const bl of data.blocks) if (bl.district === 'LITTLE TOKYO') for (const g of d.buildingsOf(bl.id)) sizes.push([g.w / 2, g.d / 2], [g.d / 2, g.w / 2]);
  let worst = 0, at = '';
  for (const type of NEW) {
    for (let i = 0; i < sizes.length; i += 3) {
      const [hw, hd] = sizes[i], [mf, md] = TOKYO_TYPES[type].min;
      if (2 * hd < mf || 2 * hw < md) continue;
      const b = buildTokyoLot(i * 131 + 7, hw, hd, 160, { force: type });
      if (b.tris > worst) { worst = b.tris; at = `${type} ${(2 * hd).toFixed(0)} x ${(2 * hw).toFixed(0)}`; }
      b.geo.dispose();
    }
  }
  assert.ok(worst < 12000, `${at}: ${worst} triangles`);
});

test('every triangle winds the way its normals point (the first tank track was inside out)', () => {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), f = new THREE.Vector3(), n = new THREE.Vector3(), v = new THREE.Vector3();
  for (const type of NEW) {
    for (const p of plotsOf(type, 12)) {
      const g = build(type, p).geo, pos = g.attributes.position, nn = g.attributes.normal, ix = g.index.array;
      let wrong = 0, total = 0;
      for (let i = 0; i < ix.length; i += 3) {
        a.fromBufferAttribute(pos, ix[i]); b.fromBufferAttribute(pos, ix[i + 1]); c.fromBufferAttribute(pos, ix[i + 2]);
        f.subVectors(b, a).cross(v.subVectors(c, a));
        if (f.lengthSq() < 1e-12) continue;
        n.fromBufferAttribute(nn, ix[i]).add(v.fromBufferAttribute(nn, ix[i + 1])).add(v.fromBufferAttribute(nn, ix[i + 2]));
        total++;
        if (f.dot(n) <= 0) wrong++;
      }
      assert.equal(wrong, 0, `${type} seed ${p.seed}: ${wrong} of ${total} triangles face against their normals`);
      g.dispose();
    }
  }
});

/* Outward, measured the way a camera sees it: cast rays at the building from
   outside -- level from all four sides, straight down, and 45 degrees down from
   each side -- and the FIRST surface each ray meets must face the ray. The
   facade material is single-sided, so a back face met first is a hole: you
   would see through the building to whatever is behind it. */
function castAt(geo) {
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  const bb = geo.boundingBox, rc = new THREE.Raycaster(), o = new THREE.Vector3(), d = new THREE.Vector3();
  let hits = 0, back = 0;
  const bad = [], seen = { 1: 0, 2: 0, 3: 0 };   // what the level rays see first, by surf kind
  const cast = (level = false) => {
    rc.set(o, d);
    const hit = rc.intersectObject(mesh, false)[0];
    if (!hit) return;
    hits++;
    if (level) seen[Math.floor(geo.attributes.surf.array[hit.face.a])]++;
    if (hit.face.normal.dot(d) >= 0) { back++; if (bad.length < 4) bad.push(`(${hit.point.x.toFixed(2)}, ${hit.point.y.toFixed(2)}, ${hit.point.z.toFixed(2)}) dir (${d.x.toFixed(2)}, ${d.y.toFixed(2)}, ${d.z.toFixed(2)})`); }
  };
  const W = 60, step = 1.0317;   // off any round number, so a ray never runs exactly along a wall plane
  for (let y = 0.37; y < bb.max.y; y += step) {
    for (let s = bb.min.z + 0.2113; s < bb.max.z; s += step) { o.set(bb.max.x + W, y, s); d.set(-1, 0, 0); cast(true); o.set(bb.min.x - W, y, s); d.set(1, 0, 0); cast(true); }
    for (let s = bb.min.x + 0.2113; s < bb.max.x; s += step) { o.set(s, y, bb.max.z + W); d.set(0, 0, -1); cast(true); o.set(s, y, bb.min.z - W); d.set(0, 0, 1); cast(true); }
  }
  const k = Math.SQRT1_2;
  for (let x = bb.min.x + 0.1319; x < bb.max.x; x += step) {
    for (let z = bb.min.z + 0.1319; z < bb.max.z; z += step) {
      o.set(x, bb.max.y + 5, z); d.set(0, -1, 0); cast();
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { o.set(x - dx * W, bb.max.y + 5 + W, z - dz * W); d.set(dx * k, -k, dz * k).normalize(); cast(); }
    }
  }
  return { hits, back, bad, seen };
}

const SEEN = {};   // the level rays' first hits by surf kind, per type: the glass/wall/paint test reads it
test('seen from outside, the nearest surface always faces the camera: no holes, nothing inside out', () => {
  for (const type of NEW) {
    SEEN[type] = { 1: 0, 2: 0, 3: 0 };
    for (const p of plotsOf(type, 3)) {
      const b = build(type, p);
      const { hits, back, bad, seen } = castAt(b.geo);
      assert.ok(hits > 200, `${type}: only ${hits} rays hit`);
      assert.equal(back, 0, `${type} seed ${p.seed}: ${back} of ${hits} rays meet a back face first, e.g. ${bad.join('; ')}`);
      for (const k of [1, 2, 3]) SEEN[type][k] += seen[k];
      b.geo.dispose();
    }
  }
});

/* A pane is buried when what lies in front of it FACES it -- a wall's face. A
   lattice or a sill in front of a window is met from behind or edge-on, and is
   the point of a lattice. */
test('every pane of glass looks out at open air, not into a wall', () => {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3();
  const rc = new THREE.Raycaster();
  for (const type of NEW) {
    for (const p of plotsOf(type, 4)) {
      const g = build(type, p).geo, pos = g.attributes.position, sf = g.attributes.surf.array, ix = g.index.array;
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      g.computeBoundingSphere();
      let panes = 0, buried = 0;
      const bad = [];
      for (let i = 0; i < ix.length; i += 3) {
        if (Math.floor(sf[ix[i]]) !== SURF.GLASS) continue;
        a.fromBufferAttribute(pos, ix[i]); b.fromBufferAttribute(pos, ix[i + 1]); c.fromBufferAttribute(pos, ix[i + 2]);
        n.subVectors(b, a).cross(m.subVectors(c, a));
        if (n.lengthSq() < 1e-10) continue;
        n.normalize();
        m.copy(a).add(b).add(c).divideScalar(3).addScaledVector(n, 0.004);
        rc.set(m, n); rc.far = 0.25;
        panes++;
        const hit = rc.intersectObject(mesh, false).find((q) => q.face.normal.dot(n) < 0);
        if (hit) { buried++; if (bad.length < 3) bad.push(`(${m.x.toFixed(2)}, ${m.y.toFixed(2)}, ${m.z.toFixed(2)})`); }
      }
      assert.ok(panes > 0, `${type}: ${panes} glass triangles`);
      assert.ok(buried / panes < 0.02, `${type} seed ${p.seed}: ${buried} of ${panes} glass triangles face a wall within 25 cm, e.g. ${bad.join('; ')}`);
      g.dispose();
    }
  }
});

/** Up-facing sloped WALL area by finish (the roof tile test), and whether any neon is painted as wall or glass. */
function surfaces(geo) {
  const pos = geo.attributes.position, sf = geo.attributes.surf.array, em = geo.attributes.emit.array, ix = geo.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3();
  const up = { tile: 0, plaster: 0 };
  let neonNotPaint = 0;
  for (let i = 0; i < ix.length; i += 3) {
    a.fromBufferAttribute(pos, ix[i]); b.fromBufferAttribute(pos, ix[i + 1]); c.fromBufferAttribute(pos, ix[i + 2]);
    n.subVectors(b, a).cross(m.subVectors(c, a));
    const A = n.length() / 2;
    if (A < 1e-8) continue;
    n.normalize();
    const kind = Math.floor(sf[ix[i]]), v = sf[ix[i]] - kind;
    if (kind === SURF.WALL && n.y > 0.3 && n.y < 0.97) up[v >= 0.45 ? 'tile' : 'plaster'] += A;
    if (em[ix[i] * 3] + em[ix[i] * 3 + 1] + em[ix[i] * 3 + 2] > 3 && kind !== SURF.PAINT) neonNotPaint++;
  }
  return { up, neonNotPaint };
}

/* Shares are of what a level camera SEES first (the ray test above), not of
   triangle area: the curtain wall's core box is wall under every pane, and
   counting it would call a glass tower 30% glass. */
test('glass, wall and paint go where they belong', () => {
  const tot = {};
  for (const type of NEW) {
    tot[type] = { tile: 0, plaster: 0 };
    for (const p of plotsOf(type, 10)) {
      const g = build(type, p).geo, s = surfaces(g);
      assert.equal(s.neonNotPaint, 0, `${type}: a neon tube is painted as ${s.neonNotPaint} wall/glass triangles -- the tile texture would crawl over it`);
      tot[type].tile += s.up.tile; tot[type].plaster += s.up.plaster;
      g.dispose();
    }
  }
  assert.ok(SEEN.tower, 'runs after the ray test');
  for (const type of NEW) for (const k of [1, 2]) if (type !== 'carpark' || k === 1) assert.ok(SEEN[type][k] > 0, `${type} shows no ${['', 'wall', 'glass'][k]}`);
  const share = (t, k) => SEEN[t][k] / (SEEN[t][1] + SEEN[t][2] + SEEN[t][3]);
  assert.ok(share('tower', 2) > 0.45, `the curtain wall is ${(100 * share('tower', 2)).toFixed(0)}% glass`);
  assert.ok(share('depato', 1) > share('depato', 2), 'a department store is stone first, glass second');
  assert.ok(share('carpark', 2) < 0.03, `a car park is ${(100 * share('carpark', 2)).toFixed(1)}% glass: its decks are open`);
  assert.ok(share('carpark', 1) > 0.3, 'a car park is concrete');
  // the machiya's pitched roofs are kawara: the tile finish, kept through the building's wall finish
  assert.ok(tot.machiya.tile > 5 * tot.machiya.plaster && tot.machiya.tile > 200, `machiya roof slopes: ${tot.machiya.tile.toFixed(0)} m^2 tile vs ${tot.machiya.plaster.toFixed(0)} plaster`);
});

test('every board on every type has a shape the Tokyo atlas draws', () => {
  const bad = [];
  let n = 0;
  for (const type of NEW) {
    for (const p of plotsOf(type)) {
      const b = build(type, p);
      for (const bd of b.boards) {
        n++;
        const k = bd.kind, asp = k === 'v' ? bd.h / bd.w : bd.w / bd.h;
        const ok = k === 'h' ? asp >= 2.8 && asp <= 6.2 : k === 'v' ? asp >= 2.3 && asp <= 5.6 : k === 's' ? Math.abs(asp - 2) < 0.05 : false;
        if (!ok || (k === 'v') !== !!bd.vertical || ![bd.x, bd.y, bd.z, bd.yaw].every(Number.isFinite)) bad.push(`${type} ${k} ${bd.w.toFixed(2)}x${bd.h.toFixed(2)}`);
      }
      b.geo.dispose();
    }
  }
  assert.ok(n > 600, `${n} boards`);
  assert.deepEqual(bad.slice(0, 6), [], `${bad.length} boards off their tile's shape`);
});

test('every type merges with the walk-up, the shrine and a kit tower into one mesh: one attribute set', () => {
  const geos = NEW.map((type) => build(type, plotsOf(type, 1)[0]).geo);
  geos.push(buildTokyoBuilding(7, 6, 6, 30).geo, buildShrine(3).geo);
  const kit = new THREE.BoxGeometry(4, 20, 4);   // a kit tower as the chunk sees it: colour/emit/flick, no surf until ensureSurf
  const nk = kit.attributes.position.count;
  for (const [name, size] of [['color', 3], ['emit', 3], ['flick', 1]]) kit.setAttribute(name, new THREE.BufferAttribute(new Float32Array(nk * size), size));
  geos.push(ensureSurf(kit));
  const count = geos.reduce((s, g) => s + g.attributes.position.count, 0);
  const merged = mergeGeometries(geos, false);
  assert.ok(merged, 'mergeGeometries refused: an attribute set differs');
  assert.equal(merged.attributes.position.count, count);
  for (const g of geos) g.dispose();
  merged.dispose();
});

test('the same seed builds the same building; another seed a different one', () => {
  for (const type of NEW) {
    const [p, q] = plotsOf(type, 2);
    const A = build(type, p), B = build(type, p), C = build(type, { ...p, seed: q.seed });
    const key = (b) => fnv([b.geo.attributes.position.array, b.geo.attributes.color.array, b.geo.attributes.surf.array, b.geo.attributes.emit.array, new Float32Array(b.geo.index.array)]);
    assert.equal(key(A), key(B), `${type}: same seed, different geometry`);
    assert.deepEqual(A.boards, B.boards);
    assert.deepEqual(A.lamps, B.lamps);
    assert.notEqual(key(A), key(C), `${type}: another seed built the identical building`);
  }
});

test('a plot that rolls the walk-up gets exactly the building it had before', () => {
  let n = 0;
  for (let s = 1; s <= 400 && n < 20; s++) {
    const seed = s * 7777, [hw, hd, h] = [6 + (s % 7), 6 + (s % 5), 20 + (s % 9) * 5];
    if (pickTokyoType(seed, hw, hd, h) !== 'walkup') continue;
    n++;
    const a = buildTokyoLot(seed, hw, hd, h), b = buildTokyoBuilding(seed, hw, hd, h);
    assert.equal(a.type, 'walkup');
    assert.equal(fnv([a.geo.attributes.position.array, a.geo.attributes.color.array]), fnv([b.geo.attributes.position.array, b.geo.attributes.color.array]));
    assert.deepEqual(a.boards, b.boards);
  }
  assert.equal(n, 20);
});

test('a forced type that cannot fit the plot falls back to the walk-up, and a small plot never gets a type it cannot hold', () => {
  assert.equal(pickTokyoType(1, 3, 3, 90, { force: 'tower' }), 'walkup');
  assert.equal(pickTokyoType(1, 10, 10, 90, { force: 'tower' }), 'tower');
  assert.equal(pickTokyoType(1, 3, 3, 90, { force: 'nope' }) !== 'nope', true);
  for (let s = 1; s <= 300; s++) {
    const t = pickTokyoType(s * 31, 2 + (s % 5), 2 + (s % 7), 10 + (s % 13) * 10);
    const [mf, md] = TOKYO_TYPES[t].min;
    assert.ok(2 * (2 + (s % 7)) >= mf && 2 * (2 + (s % 5)) >= md, `${t} on a ${2 * (2 + (s % 7))} m front`);
  }
});

/* The real district: every Little Tokyo footprint districtWorld builds as
   ours, with the same height formula, front rotation and art-style exclusion
   (districtWorld.js HEIGHT / DISTRICT_SCALE / hash, replicated -- they are not
   exported). Arun's authored towers take a further 8% of plots when their GLBs
   load and fit; that roll happens before buildTokyoLot and is not counted. */
test('over the real district the walk-up stays commonest and each new type lands in its niche', (t) => {
  const data = JSON.parse(readFileSync(new URL('../public/halstead-bay.district.json', import.meta.url)));
  const d = new District(data);
  const HEIGHT = { tower: [34, 78], mid: [16, 30], row: [8, 13], yard: [7, 11], lot: [0, 0] };
  const hash = (x, z) => { const q = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return q - Math.floor(q); };
  const count = {}, tris = { before: 0, after: 0 }, signs = { before: 0, after: 0, lampsBefore: 0, lampsAfter: 0 };
  let plots = 0, maxAfter = 0, maxBefore = 0;
  for (const bl of data.blocks) {
    if (bl.district !== 'LITTLE TOKYO' || !HEIGHT[bl.type]) continue;
    const range = HEIGHT[bl.type], ca = Math.cos(bl.angle), sa = Math.sin(bl.angle);
    for (const g of d.buildingsOf(bl.id)) {
      const h = (range[0] + hash(g.x + bl.x, g.y + bl.y) * (range[1] - range[0])) * 2.2;
      const lx = g.x + g.w / 2, lz = g.y + g.d / 2, wx = bl.x + lx * ca - lz * sa, wz = bl.y + lx * sa + lz * ca;
      if (styleFor(bl, g, hash(wx * 0.53, wz * 0.91)) || g.w < 4 || g.d < 4) continue;
      const toWorld = (x, z) => [wx + x * ca - z * sa, wz + x * sa + z * ca];
      const rot = frontRotation((x, z) => d.tarmacDepth(x, z), toWorld, g.w / 2, g.d / 2);
      const swap = Math.abs(rot) > Math.PI / 4 && Math.abs(Math.abs(rot) - Math.PI) > 1e-6;
      const fhw = swap ? g.d / 2 : g.w / 2, fhd = swap ? g.w / 2 : g.d / 2;
      const c = Math.cos(rot), s = Math.sin(rot);
      const probe = (bx, bz) => d.tarmacDepth(...toWorld(bx * c + bz * s, -bx * s + bz * c));
      const seed = Math.floor(hash(wx * 0.71, wz * 0.29) * 1e9);
      const b = buildTokyoLot(seed, fhw, fhd, h, { block: bl.type, probe });
      const old = buildTokyoBuilding(seed, fhw, fhd, h);
      count[b.type] = (count[b.type] ?? 0) + 1;
      plots++;
      tris.after += b.tris; tris.before += old.tris;
      signs.before += old.boards.length; signs.after += b.boards.length; signs.lampsBefore += old.lamps.length; signs.lampsAfter += b.lamps.length;
      maxAfter = Math.max(maxAfter, b.tris); maxBefore = Math.max(maxBefore, old.tris);
      if (b.type === 'tower') assert.ok(h >= 70, `a tower on a ${h.toFixed(0)} m plot`);
      if (b.type === 'pencil') assert.ok(2 * fhd <= 12, `a pencil on a ${(2 * fhd).toFixed(1)} m front`);
      if (b.type === 'machiya') assert.ok(h <= 23.5, `a machiya on a ${h.toFixed(0)} m plot`);
      b.geo.dispose(); old.geo.dispose();
    }
  }
  t.diagnostic(`${plots} plots: ${JSON.stringify(count)}`);
  t.diagnostic(`triangles before ${tris.before} (mean ${(tris.before / plots).toFixed(0)}, max ${maxBefore}), after ${tris.after} (mean ${(tris.after / plots).toFixed(0)}, max ${maxAfter})`);
  t.diagnostic(`atlas boards ${signs.before} -> ${signs.after}, lamp heads ${signs.lampsBefore} -> ${signs.lampsAfter}`);
  // the new kinds are quieter than a walk-up (a mansion is not a sign tower); the street must still be mostly lettered
  assert.ok(signs.after > signs.before * 0.6, `the district lost too many signs: ${signs.before} -> ${signs.after}`);
  assert.ok(plots > 200, `${plots} Little Tokyo plots`);
  const walk = count.walkup ?? 0;
  for (const type of NEW) {
    assert.ok((count[type] ?? 0) >= 3, `${type}: ${count[type] ?? 0} plots`);
    assert.ok(walk > (count[type] ?? 0), `${type} (${count[type]}) outnumbers the walk-up (${walk})`);
  }
  assert.ok(walk / plots > 0.35 && walk / plots < 0.7, `walk-up share ${(walk / plots).toFixed(2)}`);
  assert.ok(tris.after <= tris.before * 1.1, `the district went ${tris.before} -> ${tris.after} triangles`);
});
