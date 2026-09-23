import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildHeliModel, heliTriangles, SKID_Y, _internals } from '../src/world/heliModel.js';

test('both liveries build the parts flight.js and helicopter.js drive, under 9k triangles', () => {
  for (const livery of ['police', 'civil']) {
    const h = buildHeliModel({ livery });
    for (const part of ['group', 'rotor', 'tail', 'disc', 'beacon', 'tailStrobe']) assert.ok(h[part], `${livery}: ${part}`);
    assert.ok(heliTriangles(livery) < 9000, `${livery}: ${heliTriangles(livery)} triangles`);
    h.group.traverse((o) => { if (o.isMesh) assert.ok(o.geometry.attributes.uv, `${o.name || o.geometry.type} carries UVs`); });
  }
});

test('the skids sit exactly at the rest height, and every triangle faces outward', () => {
  const h = buildHeliModel({ livery: 'police' });
  const box = new THREE.Box3().setFromObject(h.group);
  assert.ok(Math.abs(box.min.y - SKID_Y) < 0.005, `lowest point ${box.min.y.toFixed(3)} vs ${SKID_Y} (flight.js rests at ground + 1.25)`);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), f = new THREE.Vector3(), n = new THREE.Vector3(), v = new THREE.Vector3();
  h.group.traverse((m) => {
    if (!m.isMesh || !m.geometry.attributes.aKind) return;
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
  });
});

test('nav lights follow the rules of the air: red on the left (+Z), green on the right', () => {
  const h = buildHeliModel({ livery: 'civil' });
  const hull = h.group.children.find((o) => o.name === 'heli-hull');
  const kind = hull.geometry.attributes.aKind, pos = hull.geometry.attributes.position;
  let red = 0, green = 0;
  for (let i = 0; i < kind.count; i++) {
    if (kind.getX(i) === _internals.K.navRed) red += Math.sign(pos.getZ(i));
    if (kind.getX(i) === _internals.K.navGreen) green += Math.sign(pos.getZ(i));
  }
  assert.ok(red > 0, 'red nav light on the left');
  assert.ok(green < 0, 'green nav light on the right');
});
