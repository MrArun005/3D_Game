import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildUmbrellaGeometry, umbrellaOpen, Umbrellas } from '../src/world/umbrellas.js';

test('the umbrella is indexed, carries real UVs, and every triangle winds the way its normals point', () => {
  const g = buildUmbrellaGeometry();
  assert.ok(g.index && g.index.count % 3 === 0);
  for (const k of ['position', 'normal', 'uv', 'color']) assert.ok(g.attributes[k], k);
  const uv = g.attributes.uv.array;
  assert.ok(uv.some((v) => v !== 0), 'UVs are not all zero (rule 4)');
  const tris = g.index.count / 3;
  assert.ok(tris > 60 && tris < 140, `${tris} triangles`);
  const pos = g.attributes.position, nn = g.attributes.normal, ix = g.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), f = new THREE.Vector3(), n = new THREE.Vector3(), v = new THREE.Vector3();
  let wrong = 0;
  for (let i = 0; i < ix.length; i += 3) {
    a.fromBufferAttribute(pos, ix[i]); b.fromBufferAttribute(pos, ix[i + 1]); c.fromBufferAttribute(pos, ix[i + 2]);
    f.subVectors(b, a).cross(v.subVectors(c, a));
    if (f.lengthSq() < 1e-12) continue;
    n.fromBufferAttribute(nn, ix[i]).add(v.fromBufferAttribute(nn, ix[i + 1])).add(v.fromBufferAttribute(nn, ix[i + 2]));
    if (f.dot(n) <= 0) wrong++;
  }
  assert.equal(wrong, 0);
  g.computeBoundingBox();
  assert.ok(g.boundingBox.max.y > 2.1 && g.boundingBox.max.y < 2.3, 'the canopy clears a 1.76 m head');
  assert.ok(g.boundingBox.min.y > 1.0, "nothing drags on the ground");
});

test('who opens an umbrella: nobody in a drizzle, most people in a downpour, the same people first', () => {
  const share = (k) => { let n = 0; for (let i = 0; i < 1000; i++) n += umbrellaOpen(i, k) ? 1 : 0; return n / 1000; };
  assert.equal(share(0), 0);
  assert.equal(share(0.3), 0);
  assert.ok(share(1) > 0.65 && share(1) < 0.85, `${share(1)} at full rain`);
  // monotone: whoever has one open at 0.6 still has it at 0.9
  for (let i = 0; i < 1000; i++) if (umbrellaOpen(i, 0.6)) assert.ok(umbrellaOpen(i, 0.9));
});

test('the layer: one zero-scaled instance when dry, one per open umbrella in the rain, colours follow the person', () => {
  const scene = new THREE.Scene(), n = 64;
  const u = new Umbrellas(scene, n);
  assert.equal(u.mesh.count, 1, 'dry: one instance kept so it is compiled at boot');
  const m = new THREE.Matrix4(), s = new THREE.Vector3();
  u.mesh.getMatrixAt(0, m); s.setFromMatrixScale(m);
  assert.equal(s.length(), 0, 'and it is zero-scaled');
  const root = new Float32Array(n * 4), anim = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { root.set([i * 2, 0, 5, i * 0.3], i * 4); anim.set([0, 1, 1, 0], i * 4); }
  anim[3 * 4 + 1] = 3;       // one person down: no umbrella
  anim[5 * 4 + 2] = 0;       // one hidden
  const open = u.update(root, anim, n, 1);
  let want = 0;
  for (let i = 0; i < n; i++) if (i !== 3 && i !== 5 && umbrellaOpen(i, 1)) want++;
  assert.equal(open, want);
  assert.equal(u.mesh.count, want);
  // slot k draws the k-th open person, at their position, in their own colour, however many opened before them
  const col = u.mesh.instanceColor.array;
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (i === 3 || i === 5 || !umbrellaOpen(i, 1)) continue;
    u.mesh.getMatrixAt(k, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    assert.ok(Math.hypot(p.x - i * 2, p.z - 5) < 0.45, `slot ${k} sits with person ${i}`);
    assert.deepEqual([...col.slice(k * 3, k * 3 + 3)], [...u.palette.slice(i * 3, i * 3 + 3)]);
    k++;
  }
  // and when it stops, back to the one invisible instance
  assert.equal(u.update(root, anim, n, 0.2), 0);
  assert.equal(u.mesh.count, 1);
  u.dispose();
});
