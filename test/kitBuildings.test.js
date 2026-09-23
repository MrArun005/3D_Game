/* The Kenney kit buildings load only the kits a district builds with
   (2026-09-23). Every commercial share in KIT_DISTRICT is 0.0, yet all 35
   commercial GLBs (3.7 MB) were fetched, parsed and merged at boot. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { kitsInUse, loadKitBuildings, KIT_DISTRICT } from '../src/world/kitBuildings.js';

test('kitsInUse: the kits with a share above zero', () => {
  assert.deepEqual(kitsInUse(), ['suburban', 'industrial']);
  assert.ok(Object.values(KIT_DISTRICT).some(([k, s]) => k === 'commercial' && s === 0), 'the commercial rows exist, at zero');
  assert.deepEqual(kitsInUse({ A: ['commercial', 0.1], B: ['suburban', 0] }), ['commercial'], 'raise a share and the kit comes back');
});

test('loadKitBuildings requests no commercial file', async () => {
  const urls = [];
  const was = GLTFLoader.prototype.load;
  GLTFLoader.prototype.load = function (url, _l, _p, onError) { urls.push(url); onError(new Error('offline (test)')); };
  const warn = console.warn, info = console.info; console.warn = () => {}; console.info = () => {};
  try { await loadKitBuildings({}); } finally { GLTFLoader.prototype.load = was; console.warn = warn; console.info = info; }
  assert.equal(urls.filter((u) => u.includes('/commercial/')).length, 0);
  assert.equal(urls.filter((u) => u.includes('/suburban/')).length, 21);
  assert.equal(urls.filter((u) => u.includes('/industrial/')).length, 20);
});
