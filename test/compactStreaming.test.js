import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

/* The compact city's streaming clip, read off a REAL DistrictWorld
   (world/districtWorld.js) -- not a copy of its rules. The review of the first
   cut found the far LOD and the chunk builds keyed by DIFFERENT cells: stand-ins
   by their own centre, buildings by their block's; far glare by the head's own
   cell, lamps by their segment's midpoint; and 17 long streets that ran into
   the city owned by a cell that never builds. The earlier test used the same
   wrong key as the code, so it could not see it. This one asks the streamer's
   own buckets (segByChunk / segPieces / blkByChunk / edgeByChunk) who builds
   what, and checks the far layer against that.

   The constructor builds the far city, whose glare is a SpriteNodeMaterial --
   three/webgpu. vite aliases exactly 'three' to 'three/webgpu'
   (vite.config.js); this process does the same with a resolve hook, then
   imports. Each test file runs in its own process, so nothing else sees it. */
register('data:text/javascript,' + encodeURIComponent(
  "export async function resolve(s, c, next) { return next(s === 'three' ? 'three/webgpu' : s, c); }"), import.meta.url);
// streakTexture paints a 128 px canvas; nothing else here touches the DOM
const ctx2d = new Proxy({}, { get: (o, k) => (String(k).startsWith('create') ? () => ({ addColorStop() {} }) : () => {}) });
globalThis.document ??= { createElement: () => ({ getContext: () => ctx2d, width: 0, height: 0 }) };
// the towers/terraces/industrial GLB fetches have no server here; they fail quietly
const warn = console.warn;
console.warn = (...a) => { if (!/Failed to parse URL|fetch/.test(String(a[1] ?? a[0]))) warn(...a); };

const THREE = await import('three');
const { District } = await import('../src/world/district.js');
const { DistrictWorld } = await import('../src/world/districtWorld.js');
const { COMPACT_POLY, pieceHas } = await import('../src/world/playArea.js');
const { farLampHeads } = await import('../src/world/dressing.js');

const read = () => JSON.parse(readFileSync(new URL('../public/halstead-bay.district.json', import.meta.url)));
const mat = () => new THREE.MeshStandardMaterial();
const stubAssets = () => ({
  mat: { tarmac: mat(), pole: mat(), beacon: mat() },
  geo: { box: new THREE.BoxGeometry(), lampCap: new THREE.BoxGeometry() },
  facades: new Proxy({}, { get: () => [mat()] }),
});
const city = new District(read(), { play: COMPACT_POLY });
const world = new DistrictWorld(new THREE.Scene(), stubAssets(), city, { day: true, keep: (x, z) => city.wall.probe(x, z).d < 128 });
const K = world.keptCells;
const cellOf = (x, z) => `${Math.floor(x / 256)},${Math.floor(z / 256)}`;

// who builds stretch t of segment i: every chunk whose bucket holds it and whose pieces cover t
const bucketsOf = new Map();
for (const [k, list] of world.segByChunk) for (const i of list) (bucketsOf.get(i) ?? bucketsOf.set(i, []).get(i)).push(k);
const builders = (i, t) => (bucketsOf.get(i) ?? []).filter((k) => pieceHas(world.segPieces.get(`${k}|${i}`) ?? null, t));

test('every stretch of road is built by exactly one chunk, and inside the city by one that streams', () => {
  let inside = 0, split = 0;
  city.segments.forEach((s, i) => {
    const L = Math.hypot(s.bx - s.ax, s.bz - s.az);
    if (world.segSplit[i]) split++;
    for (let t = 2; t < L; t += 8) {
      const b = builders(i, t);
      assert.equal(b.length, 1, `segment ${i} at ${t.toFixed(0)} m: ${b.length} builders (photo mode would draw it ${b.length === 0 ? 'nowhere' : 'twice'})`);
      const x = s.ax + (s.bx - s.ax) * t / L, z = s.az + (s.bz - s.az) * t / L;
      if (city.play.contains(x, z)) { inside += 8; assert.ok(K.has(b[0]), `road inside the city at (${x.toFixed(0)},${z.toFixed(0)}) is never built`); }
    }
  });
  assert.equal(split, 48);   // 2026-09-24: Regent Street's side streets (district.js #regentSideStreets) cut three shallow diagonals back
  assert.ok(inside > 30000, `${inside} m of road inside sampled`);
});

test('kerbs and markings: every graph edge that reaches into the city is owned by a chunk that streams', () => {
  let n = 0;
  for (const [k, list] of world.edgeByChunk) for (const i of list) {
    if (!world.graph.edges[i].points.some(([x, z]) => city.play.contains(x, z))) continue;
    n++;
    assert.ok(K.has(k), `edge ${i} is built by ${k}, which never streams`);
  }
  assert.ok(n > 500, `${n} edges checked`);
});

test('far stand-ins: kept exactly where their BLOCK\'s chunk builds the real building', () => {
  /* Which block is each stand-in in? Found independently of #buildFarCity's
     loop: the block whose rotated rectangle holds the stand-in's centre. */
  const G = 64, grid = new Map();
  for (const bl of city.blocks) {
    const r = Math.hypot(bl.w, bl.h) / 2;
    for (let ix = Math.floor((bl.x - r) / G); ix <= Math.floor((bl.x + r) / G); ix++) {
      for (let iz = Math.floor((bl.y - r) / G); iz <= Math.floor((bl.y + r) / G); iz++) {
        const k = ix * 4096 + iz;
        (grid.get(k) ?? grid.set(k, []).get(k)).push(bl);
      }
    }
  }
  const blockAt = (x, z) => {
    const hits = (grid.get(Math.floor(x / G) * 4096 + Math.floor(z / G)) ?? []).filter((bl) => {
      const dx = x - bl.x, dz = z - bl.y, ca = Math.cos(bl.angle), sa = Math.sin(bl.angle);
      return Math.abs(dx * ca + dz * sa) <= bl.w / 2 + 1e-6 && Math.abs(-dx * sa + dz * ca) <= bl.h / 2 + 1e-6;
    });
    return hits.length === 1 ? hits[0] : null;
  };
  assert.equal(world.farKept.length, world.farAt.length);
  let checked = 0, byOwnCell = 0;
  world.farAt.forEach(([px, pz], j) => {
    const bl = blockAt(px, pz);
    if (!bl) return;
    checked++;
    assert.ok(world.blkByChunk.get(cellOf(bl.x, bl.y))?.includes(bl), 'blocks are built by the chunk of their centre');
    assert.equal(world.farKept[j], K.has(cellOf(bl.x, bl.y)), `stand-in ${j}: kept must be its block's chunk`);
    if (K.has(cellOf(px, pz)) !== world.farKept[j]) byOwnCell++;
  });
  assert.ok(checked > world.farAt.length * 0.95, `${checked} of ${world.farAt.length} stand-ins placed in one block`);
  assert.ok(byOwnCell >= 30, `the old own-centre key was wrong for ${byOwnCell} of them`);
});

test('far glare: a head is lit inside the ring exactly where no streaming chunk stands its lamp', () => {
  // the glare's own per-head flags, straight off the far sprite's `kept` attribute
  let sprite = null;
  world.far.traverse((o) => { if (o.isSprite && o.count > 1000) sprite = o; });
  assert.ok(sprite, 'the far glare sprite');
  const truth = farLampHeads(city, (s, i, t) => builders(i, t).some((k) => K.has(k)));
  assert.equal(sprite.count, truth.length);
  const flags = world.farGlareKept;
  assert.ok(flags && flags.length === truth.length, 'districtWorld keeps the flags it gave the shader');
  let mismatch = 0;
  truth.forEach((h, j) => { if ((flags[j] === 1) !== (h.kept === 1)) mismatch++; });
  assert.equal(mismatch, 0);
  const inside = truth.filter((h) => city.play.contains(h.x, h.z));
  assert.ok(inside.length > 600 && inside.every((h) => h.kept === 1), 'every head inside the city hands over to a chunk lamp');
});

test('without a clip nothing is split and everything is kept (the whole bay streams as before)', () => {
  const whole = new District(read());
  const w = new DistrictWorld(new THREE.Scene(), stubAssets(), whole, { day: true });
  assert.equal(w.keptCells, null);
  assert.ok(w.segSplit.every((sp) => sp === null));
  assert.equal(w.segPieces.size, 0);
  assert.ok(w.farKept.every(Boolean));
  assert.equal(w.farGlareKept, null, 'no per-head flags: the old far-glare shader');
  // and the segment buckets are the midpoint rule, untouched
  whole.segments.forEach((s, i) => {
    const k = cellOf((s.ax + s.bx) / 2, (s.az + s.bz) / 2);
    assert.ok(w.segByChunk.get(k).includes(i));
  });
});
