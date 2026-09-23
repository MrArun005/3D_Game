/* What the catalogue costs a boot (2026-09-23). Two things were fetched for
   nothing: four library materials no asset names (hair, cloth_trouser,
   shoe_leather, face_skin -- 12 PNGs, 4.86 MB), and characters/hero, which
   the tier-1 warm pulled in through /hero/ (7.33 MB with its two LODs) and
   nothing places. Both rules read the manifest, so they hold across a
   re-ingest; these tests read the shipped files. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { Catalogue, usedMaterials, spawnEssential, dressCarMaterials } from '../src/world/catalogue.js';

const manifest = JSON.parse(fs.readFileSync('public/models/manifest.json', 'utf8'));
const library = JSON.parse(fs.readFileSync('public/textures/library.json', 'utf8'));
const UNUSED = ['cloth_trouser', 'face_skin', 'hair', 'shoe_leather'];

test('usedMaterials: every material a manifest asset names, the car dressing and the fallbacks -- and not the four nobody names', () => {
  const used = usedMaterials(manifest);
  const skipped = Object.keys(library.materials).filter((n) => !used.has(n)).sort();
  assert.deepEqual(skipped, UNUSED);
  for (const a of Object.values(manifest.assets)) for (const m of a.materials || []) assert.ok(used.has(m), m);
  for (const n of ['concrete_cast', 'foliage', 'bark']) assert.ok(used.has(n), `${n}: a catalogue fallback`);
});

test('the car dressing only asks for materials usedMaterials keeps', () => {
  const asked = [];
  const cat = { materials: { size: 1, get: (n) => { asked.push(n); } } };
  const m = () => new THREE.MeshStandardMaterial();
  dressCarMaterials(cat, { paint: m(), rubber: m(), chrome: m(), alloy: m(), glass: m(), skin: m(), shirt: m() });
  assert.ok(asked.length >= 7);
  const used = usedMaterials(manifest);
  for (const n of asked) assert.ok(used.has(n), `dressCarMaterials reads ${n}`);
});

test('spawnEssential: the street kit warms, characters/hero does not; nothing else changed from the old regex', () => {
  const old = (k) => /hero|tokyo|pencil|sakura|ginkgo|lamp|signal|barrier|sign|bench|bin|tree|corvette/i.test(k);
  assert.equal(spawnEssential('characters/hero', manifest.assets['characters/hero']), false);
  for (const k of ['vegetation/tree_sakura', 'props/lamp_local', 'props/traffic_signal', 'props/bench', 'props/bin', 'buildings/tokyo_neon_tower']) {
    assert.equal(spawnEssential(k, manifest.assets[k]), true, k);
  }
  const changed = Object.keys(manifest.assets).filter((k) => old(k) !== spawnEssential(k, manifest.assets[k]));
  assert.deepEqual(changed, ['characters/hero']);
});

test('Catalogue.load builds only the used materials (87 textures, not 99); ?allmats builds all 33', async () => {
  const serve = async (url) => {
    const body = fs.readFileSync('public' + url);
    return { ok: true, status: 200, json: async () => JSON.parse(body), arrayBuffer: async () => body.buffer };
  };
  const requested = [];
  const realLoad = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = function (url) { requested.push(url); const t = new THREE.Texture(); t.image = { complete: true, width: 1 }; return t; };
  const fetchWas = globalThis.fetch;
  globalThis.fetch = serve;
  const info = console.info; console.info = () => {};
  try {
    const c = await new Catalogue().load({ hasFeature: () => false, backend: {} });
    assert.equal(c.materials.size, Object.keys(library.materials).length - UNUSED.length);
    for (const n of UNUSED) assert.ok(!c.materials.has(n), `${n} is not built`);
    const unusedFiles = UNUSED.flatMap((n) => ['albedo', 'normal', 'orm'].map((k) => library.materials[n][k]).filter(Boolean));
    assert.equal(unusedFiles.length, 12);
    for (const f of unusedFiles) assert.ok(!requested.includes(f), `${f} is never fetched`);
    const before = requested.length;
    assert.equal(before, 87, 'three maps each for 29 materials');
    requested.length = 0;
    globalThis.location = { search: '?allmats' };
    const all = await new Catalogue().load({ hasFeature: () => false, backend: {} });
    assert.equal(all.materials.size, Object.keys(library.materials).length);
    assert.equal(requested.length, before + 12);
  } finally {
    THREE.TextureLoader.prototype.load = realLoad;
    globalThis.fetch = fetchWas;
    delete globalThis.location;
    console.info = info;
  }
});
