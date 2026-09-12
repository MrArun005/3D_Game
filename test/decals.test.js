import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { District } from '../src/world/district.js';
import { buildDecals, decalUv, texDecalAtlas, DECAL_TILES, KIND } from '../src/world/decals.js';

/* Wear decals (Phase 3). The atlas and the node material need a canvas and a
   GPU, so this covers the half that can be wrong without one: where the
   decals land, how many, and whether two chunks agree about a shared road. */

const data = JSON.parse(readFileSync(new URL('../public/halstead-bay.district.json', import.meta.url)));
const city = new District(data);

// a 256 m chunk downtown, and the segments the streamer would hand us for it
const CH = 256;
const cx = 2304, cz = 1408;                       // Kingsway / Little Tokyo, dense
const bounds = { x0: cx, z0: cz, x1: cx + CH, z1: cz + CH };
const segs = city.segmentsNear(cx + CH / 2, cz + CH / 2, CH);
const built = buildDecals(segs, city, 11, { bounds });

test('a chunk of road gets wear, inside one draw and inside the budget', () => {
  assert.ok(segs.length > 3, `segments near the chunk ${segs.length}`);
  assert.ok(built.count > 20, `decals ${built.count}`);
  assert.ok(built.count <= 400, `decals ${built.count} over the 400 budget`);
  assert.equal(built.matrices.length, built.count);
  assert.equal(built.tiles.length, built.count * 2);
  assert.equal(built.fades.length, built.count);
});

test('every decal is on the tarmac, inside the chunk, flat and sanely sized', () => {
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (const m of built.matrices) {
    m.decompose(p, q, s);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), 'finite position');
    assert.ok(p.x >= bounds.x0 && p.x < bounds.x1 && p.z >= bounds.z0 && p.z < bounds.z1, `inside the chunk ${p.x},${p.z}`);
    assert.ok(city.tarmacDepth(p.x, p.z) <= -0.15, `on the road at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
    // the quad lies in the ground plane: its normal (local +Z) points up
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    assert.ok(n.y > 0.999, `flat, n.y=${n.y.toFixed(4)}`);
    assert.ok(s.x > 0.3 && s.x < 8 && s.y > 0.3 && s.y < 8, `size ${s.x.toFixed(2)} x ${s.y.toFixed(2)}`);
  }
});

test('every tile index is a real atlas cell', () => {
  for (let i = 0; i < built.count; i++) {
    const u = built.tiles[i * 2], v = built.tiles[i * 2 + 1];
    assert.ok(u >= 0 && u < 1 && v >= 0 && v < 1, `cell ${u},${v}`);
    assert.ok(built.fades[i] > 0.1 && built.fades[i] <= 1, `fade ${built.fades[i]}`);
  }
  for (const list of Object.values(KIND)) for (const t of list) assert.ok(t >= 0 && t < DECAL_TILES);
  assert.deepEqual(decalUv(DECAL_TILES), decalUv(0), 'the cell index wraps');
});

test('same seed, same wear; a different salt is different wear', () => {
  const a = buildDecals(segs, city, 11, { bounds });
  const c = buildDecals(segs, city, 12, { bounds });
  assert.equal(a.count, built.count);
  assert.deepEqual([...a.tiles], [...built.tiles]);
  assert.ok(a.matrices.every((m, i) => m.equals(built.matrices[i])), 'identical placement');
  assert.notDeepEqual([...c.tiles], [...built.tiles]);
});

test('a road across a chunk seam lays the same decals from either side -- no doubles', () => {
  /* The seed is per SEGMENT, so the neighbouring chunk generates the identical
     stream and `bounds` keeps only its own half. Placing from a chunk seed
     instead would draw two different sets of wear over the same tarmac. */
  const west = { x0: cx - CH, z0: cz, x1: cx, z1: cz + CH };
  const whole = { x0: cx - CH, z0: cz, x1: cx + CH, z1: cz + CH };
  const a = buildDecals(segs, city, 11, { bounds: west, max: 400 });
  const both = buildDecals(segs, city, 11, { bounds: whole, max: 800 });
  const key = (m) => { const p = new THREE.Vector3(); p.setFromMatrixPosition(m); return `${p.x.toFixed(3)},${p.z.toFixed(3)}`; };
  const inBoth = new Set(both.matrices.map(key));
  for (const m of a.matrices) assert.ok(inBoth.has(key(m)), `${key(m)} moved when the window changed`);
  for (const m of built.matrices) assert.ok(inBoth.has(key(m)), `${key(m)} moved when the window changed`);
  const east = new Set(built.matrices.map(key));
  for (const m of a.matrices) assert.ok(!east.has(key(m)), `${key(m)} drawn by both chunks`);
});

test('junctions wear worse than mid-block', () => {
  /* Junction wear comes from the nav graph's own nodes: a segment END is
     usually a polyline joint mid-block (of the 55 segments round this chunk,
     ZERO end inside it), so counting from endpoints measures nothing. */
  const nodes = city.graph.nodes.filter((n) => (n.kind === 'cross' || n.kind === 'tee')
    && n.x >= bounds.x0 - 16 && n.x < bounds.x1 + 16 && n.y >= bounds.z0 - 16 && n.y < bounds.z1 + 16);
  assert.ok(nodes.length >= 2, `junctions in the chunk ${nodes.length}`);
  const p = new THREE.Vector3();
  let atJunction = 0;
  for (const m of built.matrices) {
    p.setFromMatrixPosition(m);
    if (nodes.some((n) => Math.hypot(p.x - n.x, p.z - n.y) < 18)) atJunction++;
  }
  const area = Math.PI * 18 * 18 * nodes.length / (256 * 256);   // fraction of the chunk that is 'junction'
  assert.ok(atJunction / built.count > area * 1.6,
    `${(100 * atJunction / built.count).toFixed(0)}% of wear at junctions covering ${(100 * area).toFixed(0)}% of the chunk`);
});

test('an empty road list builds nothing, and the cap holds', () => {
  const none = buildDecals([], city, 1, { bounds });
  assert.equal(none.count, 0);
  assert.equal(none.tiles.length, 0);              // a zero-count InstancedMesh is a WebGPU crash: the caller must skip
  const capped = buildDecals(segs, city, 11, { bounds, max: 12 });
  assert.ok(capped.count <= 12, `cap ${capped.count}`);
});

test('the atlas painter draws all 16 cells, clipped to their own tile', () => {
  /* No browser here, so a recording 2D context stands in: this catches a typo
     or a NaN in 120 lines of canvas code that would otherwise ship a blank
     atlas and cost a play-test round trip. */
  const ops = [];
  let paints = 0;
  const num = (...a) => a.forEach((v) => {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `non-finite canvas argument in ${ops.at(-1)}`);
  });
  const rec = (name, paint = false) => (...a) => { ops.push(name); num(...a); if (paint) paints++; };
  const ctx = {
    save: rec('save'), restore: rec('restore'), translate: rec('translate'),
    beginPath: rec('beginPath'), closePath: rec('closePath'), clip: rec('clip'),
    rect: rec('rect'), moveTo: rec('moveTo'), lineTo: rec('lineTo'), arc: rec('arc'),
    quadraticCurveTo: rec('quadraticCurveTo'),
    fill: rec('fill', true), stroke: rec('stroke', true), fillRect: rec('fillRect', true),
    createRadialGradient: (...a) => { num(...a); return { addColorStop: (o, c) => { num(o); assert.ok(!/NaN/.test(c), c); } }; },
    createLinearGradient: (...a) => { num(...a); return { addColorStop: (o, c) => { num(o); assert.ok(!/NaN/.test(c), c); } }; },
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const had = 'document' in globalThis, prev = globalThis.document;
  globalThis.document = { createElement: () => canvas };
  try {
    const tex = texDecalAtlas();
    assert.equal(canvas.width, 1024); assert.equal(canvas.height, 1024);
    assert.equal(ops.filter((o) => o === 'save').length, 16, 'one clipped cell per tile');
    assert.equal(ops.filter((o) => o === 'restore').length, 16);
    assert.ok(paints > 16 * 4, `paint operations ${paints}`);
    assert.ok(tex.image === canvas, 'the texture wraps the atlas canvas');
  } finally {
    if (had) globalThis.document = prev; else delete globalThis.document;
  }
});

test('no decal hangs over the kerb, and none lies across a slope', () => {
  /* The centre being on tarmac is not enough: a kerb decal is placed 0.45 m
     inside the kerb and is over a metre wide. Measured over the whole district
     before the clearance test, 4.7% of the wear had a corner on the pavement
     and 1.7% sat on ground that rose more than the 12 mm lift across the quad
     -- one bridge approach rose 9.4 m end to end, i.e. a plate standing out of
     the road. tarmacDepth is the signed distance to the nearest road EDGE, so
     asking for w/2 of clearance costs nothing extra. */
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (const m of built.matrices) {
    m.decompose(p, q, s);
    assert.ok(city.tarmacDepth(p.x, p.z) <= -s.x / 2,
      `${s.x.toFixed(2)} m wide with only ${(-city.tarmacDepth(p.x, p.z)).toFixed(2)} m of tarmac at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
    const f = new THREE.Vector3(s.x / 2, 0, 0).applyQuaternion(q);
    const g = new THREE.Vector3(0, s.y / 2, 0).applyQuaternion(q);
    let lo = Infinity, hi = -Infinity;
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const e = city.elevationAt(p.x + f.x * a + g.x * b, p.z + f.z * a + g.z * b);
      lo = Math.min(lo, e); hi = Math.max(hi, e);
    }
    assert.ok(hi - lo <= 0.012, `${(hi - lo).toFixed(2)} m of fall under one quad at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
    assert.ok(p.y >= hi, `buried: quad at ${p.y.toFixed(3)} under ground at ${hi.toFixed(3)}`);
  }
});
