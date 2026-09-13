import test from 'node:test';
import assert from 'node:assert/strict';
import { wetTarmacLook } from '../src/world/textures.js';
import { KERB_ROWS, OQ_KIT, PARK_KIT } from '../src/world/dressing.js';

test('dry tarmac is matte and almost-flat — wet=0 must not write the half-wet gloss', () => {
  const d = wetTarmacLook(0);
  assert.equal(d.roughness, 0.82);
  assert.equal(d.envMapIntensity, 0.25);
  assert.equal(d.normalScale, 0.28);
});

test('wet tarmac mirrors and fades the bump so grain does not read as cobbles', () => {
  const w = wetTarmacLook(1);
  /* 0.22, not 0.14: a mirror-sharp highlight on a normal-mapped road seen at a
     grazing angle aliases, and that shimmer IS the flickering road. Still wet
     enough to mirror neon. */
  assert.ok(Math.abs(w.roughness - 0.22) < 1e-9, `wet roughness ${w.roughness}`);
  assert.ok(Math.abs(w.envMapIntensity - 3.7) < 1e-9, `wet env ${w.envMapIntensity}`);
  assert.ok(w.normalScale < 0.2, `wet bump ${w.normalScale} still proud enough to cobble`);
  assert.ok(w.normalScale > 0.1, 'wet bump should not go to zero (a mirror sheet)');
});

test('night-dry tarmac is glossy enough for coloured point lights, not cobble-wet', () => {
  const n = wetTarmacLook(0, 1);
  assert.ok(n.roughness < 0.55 && n.roughness > 0.35, `night dry roughness ${n.roughness}`);
  assert.equal(n.envMapIntensity, 0.25);
  assert.equal(n.normalScale, 0.28);
  const d = wetTarmacLook(0, 0);
  assert.equal(d.roughness, 0.82);
});

test('wet is clamped', () => {
  assert.deepEqual(wetTarmacLook(-1), wetTarmacLook(0));
  assert.deepEqual(wetTarmacLook(2), wetTarmacLook(1));
  assert.deepEqual(wetTarmacLook(undefined), wetTarmacLook(0));
});

test('dressing no longer plants the kit cube tree', () => {
  const names = [
    ...KERB_ROWS.map((r) => r.asset),
    ...OQ_KIT.map((r) => r.asset),
    ...PARK_KIT.map((r) => r.asset),
  ];
  assert.ok(!names.includes('props/tree_broadleaf'), names.filter((n) => n.includes('tree')).join(','));
});
