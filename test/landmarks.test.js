/* Landmarks by distance (2026-09-23). The three Sketchfab props (24.75 MB)
   were fetched the moment the district landed, 1.0-1.9 km from the spawn, and
   the scanned statues (14.32 MB requested) stood in the map's corner. Now the
   props load inside LOAD_R and hide past HIDE_R, the statues need ?statues,
   and a compact play area (district.play) only offers lots inside it. The
   loader is replaced by a recorder: props "load" as one box, so placement and
   the hide rule run for real; nothing touches the network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

/* The skyline pieces wear tokyoMaterial(), a MeshStandardNodeMaterial, which
   only three/webgpu has. The game builds with vite's exact-match alias
   (vite.config.js); this is the same alias as a node resolve hook, so every
   'three' below -- ours, GLTFLoader's -- is the one module the game runs on. */
register('data:text/javascript,' + encodeURIComponent(
  "export async function resolve(s, c, next) { return next(s === 'three' ? 'three/webgpu' : s, c); }"));
const THREE = await import('three');
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');

// the Tokyo arch and the bridge portal paint canvases: any 2D call is a no-op
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ addColorStop() {} })) });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx }), createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {} }) };

const urls = [];
GLTFLoader.prototype.load = function (url, onLoad, _p, onError) {
  urls.push(url);
  if (url.includes('/sketchfab/props/')) {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(6, 5, 6), new THREE.MeshStandardMaterial()));
    queueMicrotask(() => onLoad({ scene, animations: [] }));
  } else queueMicrotask(() => onError?.(new Error('offline (test)')));
};
globalThis.fetch = async () => ({ ok: true, headers: { get: () => 'model/gltf-binary' } });   // the HEAD check: "it is there"

const { Landmarks, landmarkWanted, LOAD_R, HIDE_R } = await import('../src/world/landmarks.js');

const quietly = async (fn) => {
  const warn = console.warn, info = console.info;
  console.warn = () => {}; console.info = () => {};
  try { return await fn(); } finally { console.warn = warn; console.info = info; }
};
const settle = () => new Promise((r) => setTimeout(r, 20));
const lot = (id, district, x, y, w) => ({ id, type: 'lot', district, x, y, w, h: w, angle: 0 });
const BLOCKS = [
  lot(1, 'OLD QUARTER', 1000, 0, 20),     // gun-shop (minW 8)
  lot(2, 'THE FLATS', 3000, 0, 40),       // supermarket (30)
  lot(3, 'VELLERY ROW', 5000, 0, 20),     // street-set (12)
  lot(4, 'KINGSWAY', 0, 300, 30),         // Kenney skyscraper-d (24)
  lot(5, 'STEELGATE', 0, -300, 30),       // Kenney water tower (20)
  lot(6, 'HARBOUR POINT', 300, 0, 30),    // Kenney windmill (20)
  lot(7, 'OLD QUARTER', 7000, 0, 50),     // Poly Haven tenement (44)
];
const district = (blocks = BLOCKS, play = null) => ({ blocks, play, tarmacDepth: () => 5 });
const build = (search = '', d = district()) => quietly(async () => { const l = new Landmarks(new THREE.Scene(), d, null, { search }); await settle(); return l; });
const sketch = () => urls.filter((u) => u.includes('/sketchfab/props/'));

test('landmarkWanted: load inside 900 m, draw inside 1200 m, never load twice', () => {
  assert.equal(LOAD_R, 900); assert.equal(HIDE_R, 1200);
  assert.deepEqual(landmarkWanted(899, false), { load: true, visible: true });
  assert.deepEqual(landmarkWanted(901, false), { load: false, visible: true });
  assert.deepEqual(landmarkWanted(1199, true), { load: false, visible: true });
  assert.deepEqual(landmarkWanted(1201, true), { load: false, visible: false });
  assert.equal(landmarkWanted(10, true).load, false, 'a loaded prop is only shown, never re-fetched');
});

test('construction fetches no Sketchfab prop and no statue; the Kenney skyline pieces still load at boot', async () => {
  urls.length = 0;
  const l = await build();
  assert.deepEqual(sketch(), []);
  assert.equal(urls.filter((u) => u.includes('/characters/')).length, 0, 'statues are ?statues only');
  assert.equal(urls.filter((u) => u.includes('/vendor/kenney/')).length, 3, 'skyscraper, water tower, windmill');
  assert.equal(l.picks.length, 7, 'every landmark still has its lot');
});

test('update() near a lot fetches exactly that prop; far away it hides, back near it shows without a re-fetch', async () => {
  urls.length = 0;
  const l = await build();
  await quietly(async () => { l.update(1000, 100); await settle(); });
  assert.deepEqual(sketch(), ['/models/vendor/sketchfab/props/gun-shop.glb']);
  const gun = l.picks.find((p) => p.lm.file === 'gun-shop');
  assert.equal(gun.state, 'placed');
  assert.equal(gun.wrap.visible, true);
  l.update(1000, 1300);   // 1300 m out, and no other prop within 900 m of here
  assert.equal(gun.wrap.visible, false, 'past 1200 m it is not drawn');
  await quietly(async () => { l.update(1000, 0); await settle(); });
  assert.equal(gun.wrap.visible, true);
  assert.equal(sketch().length, 1, 'shown again, not fetched again');
  // 899 m from the supermarket's lot starts it, 901 m from the street set does not
  urls.length = 0;
  await quietly(async () => { l.update(3000 - 899, 0); await settle(); });
  assert.deepEqual(sketch(), ['/models/vendor/sketchfab/props/supermarket.glb']);
  urls.length = 0;
  await quietly(async () => { l.update(5000 - 901, 0); await settle(); });
  assert.deepEqual(sketch(), []);
});

test('?landmarks=eager is the old boot: every prop at once, nothing hidden', async () => {
  urls.length = 0;
  const l = await build('?landmarks=eager');
  assert.deepEqual(sketch().sort(), ['gun-shop', 'street-set', 'supermarket'].map((f) => `/models/vendor/sketchfab/props/${f}.glb`));
  l.update(99999, 0);
  assert.ok(l.picks.filter((p) => p.wrap).every((p) => p.wrap.visible), 'eager never hides');
});

test('?statues brings the scanned figures back, cowboy.glb fetched once for its two placements', async () => {
  urls.length = 0;
  await build('?statues');
  const people = urls.filter((u) => u.includes('/characters/'));
  assert.deepEqual(people.sort(), ['/models/characters/cowboy.glb', '/models/characters/navy_jacket.glb']);
});

test('a compact play area offers only lots inside it, with no fallback to another district', async () => {
  const flatsOnly = [lot(10, 'THE FLATS', 100, 0, 40)];
  const full = await build('', district(flatsOnly));
  assert.deepEqual(full.picks.map((p) => [p.lm.file, p.lot.id]), [['gun-shop', 10]], 'full map: no Old Quarter lot, so the gun shop takes any lot that fits');
  const inside = { contains: (x) => x < 2000 };
  const compact = await build('', district(flatsOnly, inside));
  assert.deepEqual(compact.picks.map((p) => [p.lm.file, p.lot.id]), [['supermarket', 10]], 'compact: the gun shop is skipped, the Flats lot goes to the Flats');
  const outside = await build('', district(BLOCKS, inside));
  const files = outside.picks.map((p) => p.lm.file);
  assert.ok(!files.includes('supermarket') && !files.includes('street-set'), 'lots at x 3000 / 5000 are outside the play area');
  assert.ok(files.includes('gun-shop'));
});
