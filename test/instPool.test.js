import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { InstPool } from '../src/world/instPool.js';

/* The chunk streamer recycles InstancedMeshes because three compiles its node
   state per InstancedMesh OBJECT: the same object drawn again costs nothing,
   a new one a full TSL build (world/instPool.js). These pin the contract the
   streamer relies on. */
const geo = new THREE.BoxGeometry(1, 1, 1), mat = new THREE.MeshStandardMaterial();

test('a released mesh is handed out again for the same geometry + material, and only when it fits', () => {
  const pool = new InstPool();
  const a = pool.take(geo, mat, 8, true, true);
  assert.equal(a.count, 8);
  assert.ok(a.instanceMatrix.count >= 16, 'capacity is rounded up so eight can serve eleven');
  assert.equal(pool.give(a, true), true);
  const b = pool.take(geo, mat, 11, true, true);
  assert.equal(b, a, 'the same object comes back');
  assert.equal(b.count, 11);
  pool.give(b, true);
  const c = pool.take(geo, mat, 40, true, true);
  assert.notEqual(c, a, '40 instances do not fit a 16-instance mesh');
  assert.ok(c.instanceMatrix.count >= 40);
  const d = pool.take(geo, mat, 8, false, true);
  assert.notEqual(d, a, 'a non-casting request is a different key');
  const e = pool.take(geo, new THREE.MeshStandardMaterial(), 8, true, true);
  assert.notEqual(e, a, 'another material is a different key');
});

test('the warmest fitting mesh goes first: one that has cast, then one that was drawn, then a hidden one', () => {
  const pool = new InstPool();
  const cold = pool.take(geo, mat, 4, true), drawn = pool.take(geo, mat, 4, true), cast = pool.take(geo, mat, 4, true);
  cold.visible = false;                       // sat hidden in its chunk (a ring-2 parked LOD)
  drawn.castShadow = false; cast.castShadow = true;
  pool.give(cold, true); pool.give(drawn, true); pool.give(cast, true);
  assert.equal(pool.take(geo, mat, 4, true), cast);
  assert.equal(pool.take(geo, mat, 4, true), drawn);
  assert.equal(pool.take(geo, mat, 4, true), cold);
});

test('a mesh comes back clean: visible, default layers, no shadow flags, no stale userData', () => {
  const pool = new InstPool();
  const m = pool.take(geo, mat, 4);
  m.visible = false; m.castShadow = true; m.receiveShadow = true; m.renderOrder = 2; m.name = 'parkedFar:van';
  m.layers.enable(3); m.userData.shell = true;
  pool.give(m, true);
  const n = pool.take(geo, mat, 4);
  assert.equal(n, m);
  assert.deepEqual([n.visible, n.castShadow, n.receiveShadow, n.renderOrder, n.name, n.layers.mask, n.userData.shell], [true, false, false, 0, '', 1, undefined]);
});

test('a mesh still waiting to be let into the frame gets its layers back and is not counted as drawn', () => {
  const pool = new InstPool();
  const m = pool.take(geo, mat, 4);
  m.userData.coldMask = m.layers.mask; m.layers.mask = 0;      // districtWorld parks a cold mesh on no layer
  pool.give(m, true);
  assert.equal(m.layers.mask, 1);
  assert.equal(m.userData.coldMask, undefined);
  assert.ok(!m.userData.pooled.main, 'never drawn');
});

test('meshes with their own per-instance attributes keep the geometry and take new data', () => {
  const pool = new InstPool();
  let made = 0;
  const make = () => { made++; return new THREE.PlaneGeometry(1, 1); };
  const a = pool.takeOwned('sign', make, mat, 3, { aTile: 2 });
  InstPool.fill(a, 'aTile', new Float32Array([1, 2, 3, 4, 5, 6]));
  assert.ok(a.geometry.attributes.aTile.isInstancedBufferAttribute);
  assert.ok(a.geometry.userData.owned, 'freed with the mesh if the pool lets it go');
  const v = a.geometry.attributes.aTile.version;
  pool.give(a, true);
  const b = pool.takeOwned('sign', make, mat, 5, { aTile: 2 });
  assert.equal(b, a);
  assert.equal(made, 1, 'no second geometry');
  InstPool.fill(b, 'aTile', new Float32Array(10).fill(9));
  assert.equal(b.geometry.attributes.aTile.array[9], 9);
  assert.ok(b.geometry.attributes.aTile.version > v, 'the new data is flagged for upload');
});

test('the pool is bounded, and a mesh it did not make is refused', () => {
  const pool = new InstPool({ perKey: 2, total: 3 });
  const ms = [0, 1, 2].map(() => pool.take(geo, mat, 4));
  assert.deepEqual(ms.map((m) => pool.give(m)), [true, true, false], 'two per key');
  assert.equal(pool.give(new THREE.InstancedMesh(geo, mat, 4)), false);
  pool.dispose();
  assert.equal(pool.size, 0);
});

test('a clone marked owned does not mark the shared geometry it was cloned from', () => {
  // BufferGeometry.clone() shares userData: `clone.userData.owned = true` flagged assets.geo.box itself
  const shared = new THREE.BoxGeometry(1, 1, 1);
  const pool = new InstPool();
  const m = pool.takeOwned('shell', () => shared.clone(), mat, 4, { aUvScale: 2 });
  assert.equal(m.geometry.userData.owned, true);
  assert.equal(shared.userData.owned, undefined, 'the shared original stays unowned');
  const plain = pool.take(shared, mat, 4);
  assert.ok(plain.userData.pooled, 'and can still be pooled');
});
