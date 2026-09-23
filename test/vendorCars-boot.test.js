/* The boot fetches the traffic fleet and nothing else (2026-09-23).
   vendorCars.loadVendorCars used to pre-cache every body in BODIES -- all
   eight Sketchfab cars, 57 MB -- and installed three weight-0 traffic styles
   built from them. These tests record every URL the loaders are asked for
   (each load fails at once, so nothing is parsed) and hold the boot to the
   CC0 fleet; the one body you drive is loadHeroSkin's own fetch. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { loadVendorCars, loadHeroSkin, bootBodyIds, bootStyles, bodyNeedsDownload, BODIES, KENNEY_CARS, DEFAULT_BODY } from '../src/world/vendorCars.js';

const urls = [], seen = new Set();   // this test's requests; every request in the file (the fetch caches keep a failed promise, so a body asks once)
const fail = (url, onError) => { urls.push(url); seen.add(url); onError?.(new Error('offline (test)')); };
GLTFLoader.prototype.load = function (url, _onLoad, _onProgress, onError) { fail(url, onError); };
OBJLoader.prototype.load = function (url, _onLoad, _onProgress, onError) { fail((this.path || '') + url, onError); };
MTLLoader.prototype.load = function (url, _onLoad, _onProgress, onError) { fail((this.path || '') + url, onError); };

const quietly = async (fn) => {
  const warn = console.warn, info = console.info;
  console.warn = () => {}; console.info = () => {};
  try { return await fn(); } finally { console.warn = warn; console.info = info; }
};
const stubAssets = () => ({ geo: { stunt: { sedan: { occupant: {} } } }, mat: {} });
const fileOf = (id) => BODIES[id].file;

test('bootBodyIds: the spawnable CC0 fleet, no Sketchfab body, the police cruiser included', () => {
  const ids = bootBodyIds();
  assert.ok(ids.length > 0);
  assert.equal(ids.filter((id) => id.startsWith('s-')).length, 0, `no s- body at boot: ${ids.join(', ')}`);
  assert.ok(ids.includes(KENNEY_CARS.police), 'the cruiser has no weight key and still installs');
  const styles = bootStyles().map(([k]) => k);
  for (const k of ['chev1', 'chev2', 'chev3']) assert.ok(!styles.includes(k), `${k} is weight 0: never picked, never installed`);
});

test('a default boot requests no /sketchfab/ file, only the traffic styles that can spawn', async () => {
  urls.length = 0;
  await quietly(() => loadVendorCars(stubAssets()));
  assert.ok(urls.length > 0, 'it asked for the fleet');
  assert.deepEqual(urls.filter((u) => u.includes('/sketchfab/')), [], 'no NC body downloads at boot');
  const allowed = new Set(bootBodyIds().map(fileOf));
  for (const u of urls) {
    const file = u.split('/').pop().replace(/\.(glb|obj|mtl)$/, '');
    assert.ok(allowed.has(file), `${u} belongs to a spawnable style`);
  }
});

test('the hero skin fetches exactly its own body', async () => {
  urls.length = 0;
  const hull = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.3, 1.9));
  new THREE.Group().add(hull);
  const hero = { userData: { hull } };
  const ok = await quietly(() => loadHeroSkin(stubAssets(), hero, DEFAULT_BODY));
  assert.equal(ok, false, 'the stub loader fails it');
  const sketch = urls.filter((u) => u.includes('/sketchfab/'));
  assert.deepEqual(sketch, [`/models/vendor/sketchfab/${fileOf(DEFAULT_BODY)}.glb`]);
});

test('a garage fit keeps the old body on while the new one loads (here it never lands: the load fails)', async () => {
  /* garage.js #fit removed the skin BEFORE the await. With the loft already
     hidden under a Sketchfab skin, the car was invisible for the whole
     download -- and for good if the download failed. */
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  try {
    const { Garage } = await import('../src/game/garage.js');
    const root = new THREE.Group(), shell = new THREE.Group(), hull = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.3, 1.9));
    shell.add(hull); root.add(shell);
    const skin = new THREE.Group(); root.add(skin);
    const hero = { userData: { hull, skin } };
    const flashes = [];
    const garage = new Garage({ cash: 0, persist() {} }, stubAssets(), hero, null, { flash: (m) => flashes.push(m) });
    await quietly(() => garage.wear('s-monza'));
    assert.equal(hero.userData.skin, skin, 'the old skin is still the skin');
    assert.equal(skin.parent, root, 'and still on the car');
    assert.deepEqual(flashes, ['GARAGE · DELIVERING…', 'GARAGE CLOSED']);
  } finally { delete globalThis.localStorage; }
});

test('bodyNeedsDownload: only a Sketchfab body nobody has asked for yet', () => {
  assert.equal(bodyNeedsDownload(KENNEY_CARS.sedan), false, 'the CC0 fleet is in memory after the boot');
  assert.equal(bodyNeedsDownload(DEFAULT_BODY), false, 'the hero skin test above already fetched it');
  assert.equal(bodyNeedsDownload('s-monza'), false, 'fetched (and failed) once: asking again is instant');
  assert.equal(bodyNeedsDownload('s-f40-comp'), true);
  assert.equal(bodyNeedsDownload('no-such-body'), false);
});

test('the garage flashes: DELIVERING only for a real download, nothing from a superseded fit, nothing on the race grid', async () => {
  /* Review 2026-09-23: DELIVERING flashed on every s- fit (a cached refit and
     the race grid's equipRaceCar too), and a second N press mid-download made
     the first fit flash GARAGE CLOSED. */
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  try {
    const { Garage } = await import('../src/game/garage.js');
    const make = () => {
      const root = new THREE.Group(), shell = new THREE.Group(), hull = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.3, 1.9));
      shell.add(hull); root.add(shell);
      const flashes = [];
      const garage = new Garage({ cash: 0, persist() {} }, stubAssets(), { userData: { hull } }, null, { flash: (m) => flashes.push(m) });
      return { garage, flashes };
    };
    // two fits in flight: the first is superseded and stays silent, the second reports its own failure once
    const a = make();
    await quietly(() => Promise.all([a.garage.wear('s-f40-comp'), a.garage.wear('s-corvette-c6r')]));
    assert.deepEqual(a.flashes, ['GARAGE · DELIVERING…', 'GARAGE · DELIVERING…', 'GARAGE CLOSED']);
    // a refit of a body already fetched is not a delivery
    const b = make();
    await quietly(() => b.garage.wear('s-f40-comp'));
    assert.deepEqual(b.flashes, ['GARAGE CLOSED']);
    // the race grid: no garage lines at all (raceCircuit says RACEDAY)
    const c = make();
    assert.ok(bodyNeedsDownload('s-porsche-gt3r'));
    await quietly(() => c.garage.equipRaceCar('s-porsche-gt3r'));
    assert.deepEqual(c.flashes, []);
  } finally { delete globalThis.localStorage; }
});

test('?precache restores the old instant-garage boot', async () => {
  urls.length = 0;
  const before = new Set(seen);
  globalThis.location = { search: '?precache' };
  try { await quietly(() => loadVendorCars(stubAssets())); } finally { delete globalThis.location; }
  const bodies = Object.keys(BODIES).filter((id) => id.startsWith('s-')).map((id) => `/models/vendor/sketchfab/${fileOf(id)}.glb`);
  // the bodies the tests above already asked for sit in the fetch cache; every other one is requested now
  const fresh = bodies.filter((u) => !before.has(u));
  assert.ok(fresh.length >= 3, `the tests above asked for five of the eight; the rest wait for the flag (${fresh.length})`);
  for (const u of fresh) assert.ok(urls.includes(u), `${u} pre-cached`);
});
