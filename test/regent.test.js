import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

/* Kingsway's Regent Street frontages (world/regent.js): the plan against the
   real district file, the geometry the way the tank and the Tokyo buildings
   are checked (winding, finite attributes, real UVs, no holes seen from
   outside, glass that looks at air, no z-fighting), the budgets, and the
   wiring through a REAL DistrictWorld chunk build.

   districtWorld pulls in glare.js's SpriteNodeMaterial -- three/webgpu -- and
   tokyo.js's facade material is a node material, so this process aliases
   exactly 'three' to 'three/webgpu' the way vite.config.js does, then imports
   everything dynamically (the same recipe as test/compactStreaming.test.js).
   The facade material paints its detail on a canvas and the art materials
   load textures: a do-nothing 2D context and element stand in. */
register('data:text/javascript,' + encodeURIComponent(
  "export async function resolve(s, c, next) { return next(s === 'three' ? 'three/webgpu' : s, c); }"), import.meta.url);
const ctx2d = new Proxy({}, {
  get: (o, k) => (k === 'getImageData' || k === 'createImageData' ? (w, h) => ({ data: new Uint8ClampedArray((w || 1) * (h || 1) * 4) })
    : String(k).startsWith('create') ? () => ({ addColorStop() {} }) : () => {}),
});
globalThis.document ??= {
  createElement: () => ({ getContext: () => ctx2d, width: 0, height: 0 }),
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {} }),
};
const warn = console.warn;
console.warn = (...a) => { if (!/Failed to parse URL|fetch/.test(String(a[1] ?? a[0]))) warn(...a); };

const THREE = await import('three');
const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
const { District } = await import('../src/world/district.js');
const { COMPACT_POLY, makePlayArea } = await import('../src/world/playArea.js');
const { planRegent, regentPlan, regentChunk, regentGeometry, regentEnabled, FRONT, area2 } = await import('../src/world/regent.js');
const { SURF, tokyoWarmGeometry } = await import('../src/world/tokyo.js');

const read = () => JSON.parse(readFileSync(new URL('../public/halstead-bay.district.json', import.meta.url)));
const city = new District(read(), { play: COMPACT_POLY });
const plan = regentPlan(city);
const play = makePlayArea(COMPACT_POLY);
const KW = city.data.districts.find((d) => d.name === 'KINGSWAY').boundary;
const inPoly = (poly, x, z) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
/** Points over a convex footprint part: its vertices, its edges every 2 m, its inside on a 3 m lattice. */
function samples(ring) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
  for (let x = Math.min(...xs) + 1.5; x < Math.max(...xs); x += 3) for (let z = Math.min(...zs) + 1.5; z < Math.max(...zs); z += 3) if (inPoly(ring, x, z)) out.push([x, z]);
  return out;
}
const sat = (A, B, eps = 0.05) => {
  for (const P of [A, B]) for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length], nx = q[1] - p[1], nz = p[0] - q[0], l = Math.hypot(nx, nz) || 1;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const v of A) { const d = (v[0] * nx + v[1] * nz) / l; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const v of B) { const d = (v[0] * nx + v[1] * nz) / l; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 <= b0 + eps || b1 <= a0 + eps) return false;
  }
  return true;
};

test('the plan lines Kingsway: 200+ buildings on 6 km of frontage, corners with every crown', () => {
  const s = plan.stats;
  assert.ok(plan.buildings.length >= 200, `${plan.buildings.length} buildings`);
  assert.ok(s.frontage > 6000, `${s.frontage.toFixed(0)} m of frontage`);
  assert.ok(s.corners >= 50, `${s.corners} corner buildings`);
  const feats = new Set(plan.buildings.filter((b) => b.kind === 'corner').map((b) => b.feature));
  for (const f of ['dome', 'attic', 'clock', 'flag']) assert.ok(feats.has(f), `a ${f} on some corner`);
  const shapes = new Set(plan.buildings.filter((b) => b.kind === 'corner').map((b) => b.shape));
  for (const f of ['chamfer', 'round', 'square']) assert.ok(shapes.has(f), `a ${f} corner`);
  for (const b of plan.buildings) {
    if (b.kind !== 'plot') continue;
    assert.ok(b.width >= 6 && b.width <= 44.5, `plot ${b.width.toFixed(1)} m wide`);
    assert.ok(b.depth >= 8 && b.depth <= 22.01, `plot ${b.depth.toFixed(1)} m deep`);
  }
  // every building is owned by the chunk its centroid stands in, and that chunk is one the compact city builds
  for (const [k, list] of plan.byChunk) for (const b of list) assert.equal(k, `${Math.floor(b.cx / 256)},${Math.floor(b.cz / 256)}`);
});

test('nothing stands on a road or its pavement, outside the compact city or Kingsway, on water or a deck, or at the hospital and precinct doors', () => {
  const doors = city.places.filter((p) => inPoly(KW, p.x, p.y) && city.tarmacDepth(p.x, p.y) > 1);
  assert.ok(doors.length >= 2, 'the hospital and the precinct stand off the road in Kingsway');
  let n = 0;
  for (const b of plan.buildings) {
    for (const part of b.parts) {
      for (const [x, z] of samples(part)) {
        n++;
        const d = city.tarmacDepth(x, z);   // SIGNED: negative on the carriageway
        if (d < FRONT - 0.36) assert.fail(`${b.kind} at (${x.toFixed(1)}, ${z.toFixed(1)}) is ${d.toFixed(2)} m from a kerb: on the pavement or the road`);
        if (!(play.probe(x, z).d < -5.9)) assert.fail(`(${x.toFixed(1)}, ${z.toFixed(1)}) is within 6 m of the compact city's wall, or outside it`);
        if (!inPoly(KW, x, z)) assert.fail(`(${x.toFixed(1)}, ${z.toFixed(1)}) is outside Kingsway`);
        if (city.inOpenWater(x, z) || city.elevationAt(x, z) > 0.05) assert.fail(`(${x.toFixed(1)}, ${z.toFixed(1)}) is on water or a deck`);
        for (const p of doors) if (Math.hypot(p.x - x, p.y - z) < 10) assert.fail(`(${x.toFixed(1)}, ${z.toFixed(1)}) stands on ${p.name}'s doorstep`);
      }
    }
  }
  assert.ok(n > 20000, `${n} footprint samples`);
});

test('nothing overlaps a block (Little Tokyo keeps its own) or another building', () => {
  for (const bl of city.blocks) {
    const ca = Math.cos(bl.angle || 0), sa = Math.sin(bl.angle || 0), r = Math.hypot(bl.w, bl.h) / 2 + 30;
    for (const b of plan.buildings) {
      if (Math.abs(b.cx - bl.x) > r || Math.abs(b.cz - bl.y) > r) continue;
      for (const part of b.parts) for (const [x, z] of samples(part)) {
        const dx = x - bl.x, dz = z - bl.y;
        if (Math.abs(dx * ca + dz * sa) < bl.w / 2 + 1 && Math.abs(-dx * sa + dz * ca) < bl.h / 2 + 1) assert.fail(`${b.kind} at (${x.toFixed(1)}, ${z.toFixed(1)}) is on block ${bl.id} (${bl.district})`);
      }
    }
  }
  const B = plan.buildings;
  let pairs = 0;
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
    if (Math.abs(B[i].cx - B[j].cx) > 90 || Math.abs(B[i].cz - B[j].cz) > 90) continue;
    pairs++;
    for (const a of B[i].parts) for (const c of B[j].parts) if (sat(a, c)) assert.fail(`buildings ${i} (${B[i].kind}) and ${j} (${B[j].kind}) overlap near (${B[i].cx.toFixed(0)}, ${B[i].cz.toFixed(0)})`);
  }
  assert.ok(pairs > 1000, `${pairs} neighbouring pairs checked`);
});

test('every street face looks at its road; neighbours share their party walls, round the curve too; one cornice line a run', () => {
  let turned = 0;
  const runs = new Map();
  for (const b of plan.buildings) {
    if (b.kind !== 'plot') continue;
    // the street edge F0 -> F1's outward normal, from the ring's own winding, points at the carriageway
    const ring = b.parts[0], sg = area2(ring) > 0 ? 1 : -1, i = ring.findIndex((p) => p === b.F0), j = ring.findIndex((p) => p === b.F1);
    assert.ok(i >= 0 && j >= 0, 'the ring carries the street corners');
    const [a, c] = (j === (i + 1) % 4) ? [b.F0, b.F1] : [b.F1, b.F0];
    const dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz), nx = (sg * dz) / l, nz = (-sg * dx) / l;
    const mx = (b.F0[0] + b.F1[0]) / 2, mz = (b.F0[1] + b.F1[1]) / 2;
    assert.ok(nx * -b.away[0] + nz * -b.away[1] > 0.99, 'the outward normal is the road side');
    assert.ok(city.tarmacDepth(mx + nx * 5.5, mz + nz * 5.5) < 0, `5.5 m out from the facade at (${mx.toFixed(0)}, ${mz.toFixed(0)}) is not the carriageway`);
    if (b.right && b.right.kind === 'plot') {
      const r = b.right;
      assert.ok(Math.hypot(r.F0[0] - b.F1[0], r.F0[1] - b.F1[1]) < 1e-6, 'neighbours share a front corner');
      if (Math.abs(r.depth - b.depth) < 1e-6) assert.ok(Math.hypot(r.B0[0] - b.B1[0], r.B0[1] - b.B1[1]) < 1e-6, 'and, as deep, the back corner: the party wall is one line');
      const turn = Math.abs(Math.atan2(b.u[0] * r.u[1] - b.u[1] * r.u[0], b.u[0] * r.u[0] + b.u[1] * r.u[1]));
      if (turn > 0.004) turned++;
    }
    (runs.get(b.run) ?? runs.set(b.run, []).get(b.run)).push(b);
  }
  /* The avenue bends ~1.4 degrees a vertex, so a street wall of 12-40 m plots
     turns at a few party walls -- and between them the chords must stay on
     the building line: FRONT behind the kerb, within the sagitta, all along
     the curve. That is what "follows the curve" means here. */
  assert.ok(turned >= 3, `${turned} party walls where the street wall bends with the road`);
  for (const b of plan.buildings) {
    if (b.kind !== 'plot' || city.data.roads[b.road].points.length < 3) continue;
    for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const x = b.F0[0] + (b.F1[0] - b.F0[0]) * f, z = b.F0[1] + (b.F1[1] - b.F0[1]) * f, d = city.tarmacDepth(x, z);
      assert.ok(Math.abs(d - FRONT) < 0.3, `a facade on curved road ${b.road} stands ${d.toFixed(2)} m from the kerb, not ${FRONT}`);
    }
  }
  for (const [ri, list] of runs) {
    const base = plan.runs[ri].st;
    for (const b of list) {
      assert.ok(Math.abs(b.style.floors - base.floors) <= 1, 'a storey either way of the run');
      assert.equal(b.style.ground, base.ground); assert.equal(b.style.upper, base.upper); assert.equal(b.style.mezz, base.mezz);
    }
  }
});

test('deterministic: a second parse of the district file plans the same street wall', () => {
  const again = planRegent(new District(read(), { play: COMPACT_POLY }));
  assert.equal(again.buildings.length, plan.buildings.length);
  for (let i = 0; i < plan.buildings.length; i++) {
    const a = plan.buildings[i], b = again.buildings[i];
    assert.equal(a.seed, b.seed); assert.equal(a.kind, b.kind); assert.equal(a.chunk, b.chunk);
    assert.deepEqual(a.parts, b.parts);
  }
});

/* ---- geometry ---- */
const chunks = [...plan.byChunk.keys()].map((k) => {
  const g = regentChunk(city, k);
  let r;
  do { r = g.next(); } while (!r.done);
  return { k, ...r.value };
});
const ATTRS = ['position', 'normal', 'uv', 'color', 'emit', 'flick', 'surf'];

test('every chunk: indexed, finite, unit normals, real surf kinds, wound to its normals, metre UVs', () => {
  let wrong = 0, total = 0, zeroUv = 0, verts = 0;
  for (const c of chunks) {
    const g = c.geo;
    assert.ok(g.index, 'indexed');
    for (const a of ATTRS) {
      assert.ok(g.attributes[a], `${c.k}: ${a}`);
      for (const v of g.attributes[a].array) if (!Number.isFinite(v)) assert.fail(`${c.k}: ${a} holds ${v}`);
    }
    const P = g.attributes.position.array, N = g.attributes.normal.array, U = g.attributes.uv.array, S = g.attributes.surf.array, I = g.index.array;
    for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]); if (Math.abs(l - 1) > 0.02) assert.fail(`${c.k}: normal of length ${l}`); }
    for (const v of S) { const k = Math.floor(v), f = v - k; if (k < SURF.WALL || k > SURF.PAINT || f < 0.04 || f > 0.86) assert.fail(`${c.k}: surf ${v}`); }
    for (let i = 0; i < U.length; i += 2) { verts++; if (U[i] === 0 && U[i + 1] === 0) zeroUv++; }
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, d = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      if (cx * cx + cy * cy + cz * cz < 1e-14) continue;
      total++;
      if (cx * (N[a] + N[b] + N[d]) + cy * (N[a + 1] + N[b + 1] + N[d + 1]) + cz * (N[a + 2] + N[b + 2] + N[d + 2]) <= 0) wrong++;
    }
    // metre UVs: a wall's u runs over tens of metres, not 0..1
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < U.length; i += 2) if (Math.floor(S[i / 2]) === SURF.WALL) { lo = Math.min(lo, U[i]); hi = Math.max(hi, U[i]); }
    assert.ok(hi - lo > 40, `${c.k}: wall u spans ${(hi - lo).toFixed(1)} m`);
  }
  assert.equal(wrong, 0, `${wrong} of ${total} triangles face against their normals`);
  assert.ok(zeroUv / verts < 0.02, `${zeroUv} of ${verts} vertices at uv (0, 0)`);
});

test('the triangle budget: per building, per chunk, the whole street wall (and +1 draw a chunk)', () => {
  /* Measured 2026-09-23 on the shipped district: 253 buildings, 475k
     triangles, mean 1876 (plots 1529, corners 2613), worst chunk (8,4) 58.6k
     over 29 buildings, 66 triangles a metre of frontage. The ceilings sit
     ~6-12% over. One mesh a chunk -- one draw -- is the contract districtWorld
     relies on. */
  let tot = 0, n = 0, worst = 0;
  for (const c of chunks) { tot += c.tris; n += c.count; worst = Math.max(worst, c.tris); assert.ok(c.geo.index.count / 3 === c.tris); }
  assert.ok(tot < 520000, `${tot} triangles`);
  assert.ok(worst < 62000, `worst chunk ${worst}`);
  assert.ok(tot / n < 2100, `mean ${Math.round(tot / n)} a building`);
  for (const b of plan.buildings.slice(0, 60)) { const g = regentGeometry([b]); assert.ok(g.tris < 5200, `${b.kind} ${g.tris} triangles`); g.geo.dispose(); }
});

test('it merges with the Tokyo mesh: the same attribute set as tokyo.js paint()', () => {
  const g = regentGeometry(plan.buildings.slice(0, 3));
  const m = mergeGeometries([tokyoWarmGeometry(), g.geo], false);
  assert.ok(m, 'mergeGeometries accepts both');
  for (const a of ATTRS) assert.ok(m.attributes[a], a);
});

/* Isolated buildings (neighbours taken away, so every party wall is built
   whole): each crown, each corner shape, and plots of every style. */
const alone = (() => {
  const pick = [], seen = new Set();
  for (const b of plan.buildings) {
    const key = b.kind === 'corner' ? `${b.shape}/${b.feature}` : `plot/${b.style.attic}/${b.style.mezz > 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pick.push(b.kind === 'plot' ? { ...b, left: null, right: null } : { ...b, nbrA: null, nbrB: null });
  }
  return pick;
})();

test('seen from outside, the nearest surface always faces the camera: no holes, nothing inside out', () => {
  assert.ok(alone.length >= 10, `${alone.length} kinds of building`);
  for (const b of alone) {
    const { geo } = regentGeometry([b]);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    const bb = geo.boundingBox, rc = new THREE.Raycaster(), o = new THREE.Vector3(), d = new THREE.Vector3();
    let hits = 0, back = 0;
    const bad = [];
    const cast = () => {
      rc.set(o, d);
      const hit = rc.intersectObject(mesh, false)[0];
      if (!hit) return;
      hits++;
      if (hit.face.normal.dot(d) >= 0) { back++; if (bad.length < 3) bad.push(`(${hit.point.x.toFixed(2)}, ${hit.point.y.toFixed(2)}, ${hit.point.z.toFixed(2)})`); }
    };
    const W = 60, step = 1.5317;
    for (let y = 0.37; y < bb.max.y; y += step) {
      for (let s = bb.min.z + 0.2113; s < bb.max.z; s += step) { o.set(bb.max.x + W, y, s); d.set(-1, 0, 0); cast(); o.set(bb.min.x - W, y, s); d.set(1, 0, 0); cast(); }
      for (let s = bb.min.x + 0.2113; s < bb.max.x; s += step) { o.set(s, y, bb.max.z + W); d.set(0, 0, -1); cast(); o.set(s, y, bb.min.z - W); d.set(0, 0, 1); cast(); }
    }
    const k = Math.SQRT1_2;
    for (let x = bb.min.x + 0.1319; x < bb.max.x; x += step * 1.5) for (let z = bb.min.z + 0.1319; z < bb.max.z; z += step * 1.5) {
      o.set(x, bb.max.y + 5, z); d.set(0, -1, 0); cast();
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { o.set(x - dx * W, bb.max.y + 5 + W, z - dz * W); d.set(dx * k, -k, dz * k).normalize(); cast(); }
    }
    assert.ok(hits > 300, `${b.kind}: only ${hits} rays hit`);
    assert.ok(back / hits < 0.002, `${b.kind} ${b.shape ?? ''} ${b.feature ?? ''}: ${back} of ${hits} rays meet a back face first, e.g. ${bad.join('; ')}`);
    geo.dispose();
  }
});

test('every pane of glass looks out at open air, not into a wall', () => {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3();
  const rc = new THREE.Raycaster();
  for (const bd of alone) {
    const { geo } = regentGeometry([bd]);
    const pos = geo.attributes.position, sf = geo.attributes.surf.array, ix = geo.index.array;
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    geo.computeBoundingSphere();
    let panes = 0, buried = 0;
    for (let i = 0; i < ix.length; i += 3) {
      if (Math.floor(sf[ix[i]]) !== SURF.GLASS) continue;
      a.fromBufferAttribute(pos, ix[i]); b.fromBufferAttribute(pos, ix[i + 1]); c.fromBufferAttribute(pos, ix[i + 2]);
      n.subVectors(b, a).cross(m.subVectors(c, a));
      if (n.lengthSq() < 1e-10) continue;
      n.normalize();
      m.copy(a).add(b).add(c).divideScalar(3).addScaledVector(n, 0.004);
      rc.set(m, n); rc.far = 0.25;
      panes++;
      if (rc.intersectObject(mesh, false).find((q) => q.face.normal.dot(n) < 0)) buried++;
    }
    assert.ok(panes > 20, `${bd.kind}: ${panes} glass triangles`);
    assert.ok(buried / panes < 0.02, `${bd.kind}: ${buried} of ${panes} glass triangles face a wall within 25 cm`);
    geo.dispose();
  }
});

test('no two faces share a plane facing the same way (z-fighting)', () => {
  /* Planes from the EMITTED normal (exact: every face of an edge's frame gets
     the same one) and positions taken relative to the building. The cross
     product of a 6 cm rustication groove, at float32 world positions near
     x = 2850, is off by ~3e-4 rad -- metres of plane offset -- which put
     unrelated planes in one bucket. Same facing (to 5 mrad), offsets within
     3 mm, and a 2D overlap of positive area: that pair fights. */
  for (const bd of alone) {
    const { geo } = regentGeometry([bd]);
    const P = geo.attributes.position.array, N = geo.attributes.normal.array, I = geo.index.array, buckets = new Map();
    for (let t = 0; t < I.length; t += 3) {
      const v = [I[t], I[t + 1], I[t + 2]].map((i) => [P[i * 3] - bd.cx, P[i * 3 + 1], P[i * 3 + 2] - bd.cz]);
      const u = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], w = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
      if (Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) < 1e-6) continue;
      const n = [N[I[t] * 3], N[I[t] * 3 + 1], N[I[t] * 3 + 2]], off = n[0] * v[0][0] + n[1] * v[0][1] + n[2] * v[0][2];
      if (n[1] < -0.9 && Math.abs(v[0][1] + 0.25) < 0.01) continue;   // undersides resting on the ground are never seen
      const key = n.map((x) => Math.round(x * 200)).join(',');
      const ax = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0], e1 = [ax[1] * n[2] - ax[2] * n[1], ax[2] * n[0] - ax[0] * n[2], ax[0] * n[1] - ax[1] * n[0]];
      const e1l = Math.hypot(...e1), e1n = e1.map((x) => x / e1l), e2 = [n[1] * e1n[2] - n[2] * e1n[1], n[2] * e1n[0] - n[0] * e1n[2], n[0] * e1n[1] - n[1] * e1n[0]];
      const tri = v.map((p) => [p[0] * e1n[0] + p[1] * e1n[1] + p[2] * e1n[2], p[0] * e2[0] + p[1] * e2[1] + p[2] * e2[2]]);
      tri.off = off; tri.at = [v[0][0] + bd.cx, v[0][1], v[0][2] + bd.cz];
      (buckets.get(key) ?? buckets.set(key, []).get(key)).push(tri);
    }
    let fights = 0;
    const where = [];
    const fmt = (p) => p.map((x) => x.toFixed(2)).join(', ');
    for (const list of buckets.values()) {
      list.sort((a, b) => a.off - b.off);
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length && list[j].off - list[i].off < 0.003; j++) {
        if (sat(list[i], list[j], 0.002)) { fights++; if (where.length < 3) where.push('(' + fmt(list[i].at) + ') and (' + fmt(list[j].at) + ')'); }
      }
    }
    assert.equal(fights, 0, `${bd.kind} ${bd.shape ?? ''} ${bd.feature ?? ''}: ${fights} overlapping coplanar pairs, e.g. at ${where.join('; ')}`);
    geo.dispose();
  }
});

test('collision boxes: districtWorld\'s shape, inside the footprint, never on a pavement, covering it', () => {
  let boxes = 0;
  for (const c of chunks) for (const bx of c.boxes) {
    boxes++;
    for (const k of ['x', 'z', 'angle', 'hw', 'hd', 'height']) assert.ok(Number.isFinite(bx[k]), k);
    assert.ok(bx.hw > 0.25 && bx.hd > 0.25 && bx.height > 14, `box ${bx.hw.toFixed(2)} x ${bx.hd.toFixed(2)} x ${bx.height.toFixed(1)}`);
    assert.ok(bx.art && bx.regent, 'tagged, so the kit dressing leaves the building alone');
    const ca = Math.cos(bx.angle), sa = Math.sin(bx.angle);
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = bx.x + (u * bx.hw - 0.05 * u) * ca - (v * bx.hd - 0.05 * v) * sa, z = bx.z + (u * bx.hw - 0.05 * u) * sa + (v * bx.hd - 0.05 * v) * ca;
      const d = city.tarmacDepth(x, z);
      if (d < FRONT - 0.7) assert.fail(`a box corner at (${x.toFixed(1)}, ${z.toFixed(1)}) is ${d.toFixed(2)} m from a kerb`);
    }
  }
  // what the boxes cover, against the footprints' own area
  let area = 0, cover = 0;
  for (const b of plan.buildings) for (const p of b.parts) area += Math.abs(area2(p)) / 2;
  for (const c of chunks) for (const bx of c.boxes) cover += 4 * bx.hw * bx.hd;
  assert.ok(cover / area > 0.85 && cover / area < 1.1, `boxes cover ${(100 * cover / area).toFixed(0)}% of the footprints`);
  assert.ok(boxes >= plan.buildings.length, `${boxes} boxes`);
});

test('shop lamps: one a lit building, under the fascia, a metre and more in front of the facade', () => {
  let n = 0;
  for (const c of chunks) for (const l of c.lamps) {
    n++;
    assert.ok([l.x, l.y, l.z, l.intensity, l.range].every(Number.isFinite) && Number.isInteger(l.colour), 'finite, an integer colour');
    assert.ok(l.y > 3 && l.y < 5.5, `lamp at y ${l.y.toFixed(2)}`);
    const d = city.tarmacDepth(l.x, l.z);
    assert.ok(d > 2 && d < FRONT - 0.5, `lamp ${d.toFixed(2)} m from the kerb (the facade is at ${FRONT})`);
  }
  assert.ok(n > plan.buildings.length * 0.7, `${n} lamps for ${plan.buildings.length} buildings`);
});

test('generation is sliced per building and each slice is cheap', () => {
  /* CPU time, not wall time: npm test runs ~70 files at once on 4 cores, and a
     wall-clock max there measures the neighbours (it read 34 ms once). Median
     and 90th percentile, warm; measured alone 2026-09-23: median ~0.4 ms,
     mean ~0.9, p95 ~2.8 (the domed and clocked corners). */
  const b = plan.buildings;
  regentGeometry(b.slice(0, 40));   // warm the JIT, as a streaming session is
  const ms = [];
  for (const x of b) { const t = process.cpuUsage(); const g = regentGeometry([x]); const d = process.cpuUsage(t); ms.push(d.user / 1000); g.geo.dispose(); }
  ms.sort((p, q) => p - q);
  const med = ms[Math.floor(ms.length / 2)], p90 = ms[Math.floor(ms.length * 0.9)];
  assert.ok(med < 2, `median ${med.toFixed(2)} ms of CPU a building`);
  assert.ok(p90 < 6, `90th percentile ${p90.toFixed(2)} ms`);
  // the chunk generator yields between buildings when its clock says so
  let yields = 0;
  const tick = function* () { yields++; yield; };
  const g = regentChunk(city, plan.buildings[0].chunk, tick);
  let r; do { r = g.next(); } while (!r.done);
  assert.equal(yields, plan.byChunk.get(plan.buildings[0].chunk).length, 'one tick a building');
});

test('districtWorld builds it: one regent mesh on the Tokyo material, its boxes in the chunk solids; ?noregent takes both away', async () => {
  const { DistrictWorld } = await import('../src/world/districtWorld.js');
  const { SHADOW_FAR_LAYER } = await import('../src/core/renderer.js');
  const mat = () => new THREE.MeshStandardMaterial();
  const kids = () => new Proxy({}, { get: (o, k) => (o[k] ??= new THREE.BoxGeometry()) });
  const stub = () => ({
    mat: new Proxy({}, { get: (o, k) => (o[k] ??= mat()) }),
    geo: new Proxy({}, { get: (o, k) => (o[k] ??= (k === 'species' || k === 'stunt' || k === 'parked' ? new Proxy({}, { get: (p, q) => (p[q] ??= kids()) }) : new THREE.BoxGeometry())) }),
    facades: new Proxy({}, { get: () => [mat()] }),
    base: { materials: new Proxy({}, { get: () => mat() }) },
  });
  const key = '9,5', [cx, cz] = [9 * 256 + 128, 5 * 256 + 128];
  const expect = plan.byChunk.get(key);
  assert.ok(expect && expect.length > 5, 'the test chunk has regent buildings');
  const build = () => {
    const d = new District(read(), { play: COMPACT_POLY });
    const w = new DistrictWorld(new THREE.Scene(), stub(), d, { day: true, keep: (x, z) => d.wall.probe(x, z).d < 128, radius: 0 });
    w.update(cx, cz, 0, 0);
    return w;
  };
  const w = build();
  const g = w.chunks.get(key);
  assert.ok(g, 'the chunk built');
  const meshes = [];
  g.traverse((o) => { if (o.isMesh && o.name === 'regent') meshes.push(o); });
  assert.equal(meshes.length, 1, 'one regent mesh: one draw');
  const rm = meshes[0];
  assert.equal(rm.material.name, 'tokyo_facade_detail');
  assert.ok(rm.castShadow && rm.receiveShadow && rm.userData.shell && rm.layers.isEnabled(SHADOW_FAR_LAYER) && rm.frustumCulled === false);
  assert.ok(rm.geometry.userData.owned, 'the release sweep frees it');
  const solids = w.solidsByChunk.get(key).filter((b) => b.regent);
  assert.ok(solids.length >= expect.length, `${solids.length} regent boxes in the chunk's solids`);
  // and off
  globalThis.location = { search: '?noregent' };
  try {
    assert.equal(regentEnabled(), false);
    const w2 = build(), g2 = w2.chunks.get(key);
    let any = 0;
    g2.traverse((o) => { if (o.name === 'regent') any++; });
    assert.equal(any, 0, 'no regent mesh');
    assert.equal(w2.solidsByChunk.get(key).filter((b) => b.regent).length, 0, 'no regent boxes');
  } finally { delete globalThis.location; }
});
