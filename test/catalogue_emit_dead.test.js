import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { InstanceBatch } from '../src/world/catalogue.js';

/* The async emit() race (REVIEW-2026-09-09-GTA item 12): a chunk released or
   abandoned while its prop merge was pending got a mesh nobody would dispose
   and re-registered a dropped breakables key. districtWorld marks the group
   `userData.dead`; emit() must add nothing, dispose what it built and resolve
   null so the caller skips its landing work. */

const tri = () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  return g;
};
const stubCat = (geo) => ({
  batchRoot: null,
  fetchAsset: async () => [[{ geometry: geo, material: new THREE.MeshBasicMaterial() }]],
});

test('emit() into a live group adds the merged mesh and records tracked ranges', async () => {
  const geo = tri();
  const b = new InstanceBatch(stubCat(geo));
  b.trackNames = new Set(['props/bin']);
  const m = new THREE.Matrix4().makeTranslation(3, 0, 0);
  b.add('props/bin', m);
  const group = new THREE.Group();
  const out = await b.emit(group, { lod: 1 });
  assert.equal(out, group);
  assert.equal(group.children.length, 1);
  assert.ok(group.children[0].geometry.userData.owned, 'the merge is the chunk\'s own geometry');
  assert.equal(b.tracked.length, 1);
  assert.equal(b.tracked[0].ranges.length, 1, 'the breakable knows where its triangles landed');
});

test('emit() into a group marked dead before the fetch resolves builds nothing', async () => {
  const geo = tri();
  const b = new InstanceBatch(stubCat(geo));
  b.trackNames = new Set(['props/bin']);
  b.add('props/bin', new THREE.Matrix4());
  const group = new THREE.Group();
  const p = b.emit(group, { lod: 1 });
  group.userData.dead = true;   // released while the fetch is in flight
  assert.equal(await p, null, 'resolves null so districtWorld skips onBreakables');
  assert.equal(group.children.length, 0);
  assert.equal(b.tracked.length, 0, 'no phantom tracked record for breakables.registerChunk');
});

test('emit() into a group that dies during the merge macrotask disposes and adds nothing', async () => {
  const geo = tri();
  const b = new InstanceBatch(stubCat(geo));
  b.add('props/bin', new THREE.Matrix4());
  const group = new THREE.Group();
  const p = b.emit(group, { lod: 1 });
  // let the fetch microtasks settle, then kill the group before the setTimeout(0) merge runs
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  group.userData.dead = true;
  assert.equal(await p, null);
  assert.equal(group.children.length, 0);
});
