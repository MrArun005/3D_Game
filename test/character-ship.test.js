/* The first K press in the shipped build made the on-foot hero invisible
   (2026-09-23). K cycles NAMED_CHARACTERS from index 1 -- Valerie, whose model
   is /models/avatar/female.wardrobe.glb -- and vite.config.js prunes
   models/avatar from dist. Character.swap disposes the old body first, the
   load 404s, and onFail had no listener: no body, no fallback. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CHARACTERS, NAMED_CHARACTERS, shippedPersonas, DEV_ONLY_PREFIX } from '../src/game/character.js';
import { OnFoot } from '../src/game/onfoot.js';

/** vite.config.js's DIST_PRUNE list, read from the file (it is not exported). */
const distPrune = () => {
  const src = fs.readFileSync('vite.config.js', 'utf8');
  const m = src.match(/const DIST_PRUNE = \[([^\]]*)\]/);
  assert.ok(m, 'vite.config.js still declares DIST_PRUNE');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};

test('DEV_ONLY_PREFIX is a directory the build prunes', () => {
  assert.ok(distPrune().some((p) => DEV_ONLY_PREFIX === `/${p}/`), `${DEV_ONLY_PREFIX} in ${distPrune().join(', ')}`);
});

test('the shipped cast never asks for a pruned file; dev keeps all five', () => {
  const pruned = distPrune();
  const cast = shippedPersonas(NAMED_CHARACTERS, true);
  assert.ok(cast.length >= 2, 'K still has somebody to cycle to');
  for (const p of cast) {
    const url = CHARACTERS[p.index];
    assert.ok(!pruned.some((d) => url.startsWith(`/${d}/`) || url === `/${d}`), `${p.id}: ${url} ships`);
  }
  assert.ok(!cast.some((p) => p.id === 'valerie'));
  assert.equal(cast[0], NAMED_CHARACTERS[0], 'the boot persona is still first, so K starts from it');
  assert.deepEqual(shippedPersonas(NAMED_CHARACTERS, false), NAMED_CHARACTERS);
});

test('a model that fails to load brings the block figure back while you are on foot', async () => {
  const was = GLTFLoader.prototype.load;
  GLTFLoader.prototype.load = function (_url, _l, _p, onError) { queueMicrotask(() => onError(new Error('404 (test)'))); };
  const warn = console.warn; console.warn = () => {};
  try {
    const foot = new OnFoot(new THREE.Scene());
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(foot.group.visible, false, 'in the car: nothing shows');
    foot.active = true;
    foot.character.swap(9);   // the pruned wardrobe avatar
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(foot.group.visible, true, 'the load failed: the block figure stands in');
  } finally { GLTFLoader.prototype.load = was; console.warn = warn; }
});
