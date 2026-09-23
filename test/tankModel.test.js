import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildTankModel, tankTriangles, rollTracks, MUZZLE_X, TANK_GROUND, _internals } from '../src/world/tankModel.js';

const meshesOf = (t) => [t.group, t.turretGroup, t.barrelGroup].flatMap((o) => o.children.filter((c) => c.isMesh));

test('the tank is five meshes under 15k triangles, every one with UVs', () => {
  const t = buildTankModel();
  const meshes = meshesOf(t);
  assert.equal(meshes.length, 5, 'hull, wheels, tracks, turret, barrel: five draws');
  for (const m of meshes) {
    assert.ok(m.geometry.index, `${m.name} is indexed`);
    assert.ok(m.geometry.attributes.uv, `${m.name} carries UVs (CLAUDE.md rule 4)`);
    assert.ok(m.castShadow && m.receiveShadow, `${m.name} casts and receives`);
  }
  assert.ok(tankTriangles() < 15000, `triangles ${tankTriangles()}`);
});

test('every triangle faces outward (the first track band was wound inside out)', () => {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), f = new THREE.Vector3(), n = new THREE.Vector3(), v = new THREE.Vector3();
  for (const m of meshesOf(buildTankModel())) {
    const g = m.geometry, p = g.attributes.position, nn = g.attributes.normal, ix = g.index.array;
    let wrong = 0, total = 0;
    for (let i = 0; i < ix.length; i += 3) {
      a.fromBufferAttribute(p, ix[i]); b.fromBufferAttribute(p, ix[i + 1]); c.fromBufferAttribute(p, ix[i + 2]);
      f.subVectors(b, a).cross(v.subVectors(c, a));
      if (f.lengthSq() < 1e-12) continue;
      n.fromBufferAttribute(nn, ix[i]).add(v.fromBufferAttribute(nn, ix[i + 1])).add(v.fromBufferAttribute(nn, ix[i + 2]));
      total++;
      if (f.dot(n) <= 0) wrong++;
    }
    assert.ok(wrong / total < 0.01, `${m.name}: ${wrong} of ${total} triangles face against their normals`);
  }
});

test('the tracks sit on the ground and wrap the wheels; the muzzle is ahead of the hull', () => {
  const path = _internals.trackPath();
  const ys = path.map((p) => p[1]);
  assert.ok(Math.abs(Math.min(...ys) - (_internals.WHEEL_Y - _internals.WHEEL_R)) < 1e-6, 'the inner run touches the road wheels');
  const t = buildTankModel();
  const box = new THREE.Box3().setFromObject(t.group);
  assert.ok(Math.abs(box.min.y - TANK_GROUND) < 0.02, `the lowest point is the ground (${box.min.y.toFixed(3)} vs ${TANK_GROUND})`);
  t.group.updateMatrixWorld(true);
  const muzzle = t.barrelGroup.localToWorld(new THREE.Vector3(MUZZLE_X, 0, 0));
  assert.ok(muzzle.x > 5.5, `muzzle ${muzzle.x.toFixed(2)} m ahead of the hull centre (the nose is at 3.44)`);
  rollTracks(t, 1.5, -0.5);
  assert.equal(t.running[0].userData.trackL, 1.5);
  assert.equal(t.running[1].userData.trackR, -0.5);
});
