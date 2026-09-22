import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { layQuad, MAX } from '../src/world/skidmarks.js';

// The pre-2026-09-22 inline write, kept verbatim as the reference: the ranged
// path must put the same floats in the same places.
function refQuad(p, al, slot, a, b, strength, y) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L = Math.hypot(dx, dz) || 1;
  const nx = (-dz / L) * 0.12, nz = (dx / L) * 0.12;
  const i = slot * 18, yy = y + 0.012;
  p[i] = a[0] + nx; p[i + 1] = yy; p[i + 2] = a[1] + nz;
  p[i + 3] = b[0] + nx; p[i + 4] = yy; p[i + 5] = b[1] + nz;
  p[i + 6] = b[0] - nx; p[i + 7] = yy; p[i + 8] = b[1] - nz;
  p[i + 9] = a[0] + nx; p[i + 10] = yy; p[i + 11] = a[1] + nz;
  p[i + 12] = b[0] - nx; p[i + 13] = yy; p[i + 14] = b[1] - nz;
  p[i + 15] = a[0] - nx; p[i + 16] = yy; p[i + 17] = a[1] - nz;
  for (let k = 0; k < 6; k++) al[slot * 6 + k] = strength;
}

function attrs() {
  return [new THREE.BufferAttribute(new Float32Array(MAX * 18), 3), new THREE.BufferAttribute(new Float32Array(MAX * 6), 1)];
}

test('skidmarks: ranged write lands the same floats as the whole-buffer write, across the ring wrap', () => {
  const [P, A] = attrs();
  const rp = new Float32Array(MAX * 18), ra = new Float32Array(MAX * 6);
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  let head = 0;
  for (let n = 0; n < 10000; n++) {
    const a = [rnd() * 4000, rnd() * 3000], b = [a[0] + rnd() - 0.5, a[1] + rnd() - 0.5], s = rnd(), y = rnd() * 8;
    const slot = head++ % MAX;
    layQuad(P, A, slot, a, b, s, y);
    refQuad(rp, ra, slot, a, b, s, y);
  }
  assert.deepEqual(P.array, rp);
  assert.deepEqual(A.array, ra);
});

test('skidmarks: one laying frame uploads 192 B, not 86,400 B; wrap slots are separate ranges', () => {
  const [P, A] = attrs();
  layQuad(P, A, MAX - 1, [0, 0], [1, 0], 1, 0);   // last slot ...
  layQuad(P, A, 0, [1, 0], [2, 0], 1, 0);         // ... then the first: not contiguous
  assert.deepEqual(P.updateRanges, [{ start: (MAX - 1) * 18, count: 18 }, { start: 0, count: 18 }]);
  assert.deepEqual(A.updateRanges, [{ start: (MAX - 1) * 6, count: 6 }, { start: 0, count: 6 }]);
  const bytes = [...P.updateRanges, ...A.updateRanges].reduce((t, r) => t + r.count * 4, 0);
  assert.equal(bytes, 192);
  assert.equal((P.array.length + A.array.length) * 4, 86400);   // what needsUpdate alone re-sent
  P.clearUpdateRanges(); A.clearUpdateRanges();                 // what the backend does after the write
  assert.equal(P.updateRanges.length, 0);
});

test('skidmarks: 10k lays (20k quads) microbench', () => {
  const [P, A] = attrs();
  let head = 0;
  const t0 = performance.now();
  for (let n = 0; n < 10000; n++) {
    const x = n * 0.35;
    layQuad(P, A, head++ % MAX, [x, 0], [x + 0.35, 0], 0.5, 0);
    layQuad(P, A, head++ % MAX, [x, 1.56], [x + 0.35, 1.56], 0.5, 0);
    if (P.updateRanges.length > 64) { P.clearUpdateRanges(); A.clearUpdateRanges(); }   // the update() guard
    P.clearUpdateRanges(); A.clearUpdateRanges();                                       // the backend, once a frame
  }
  const ms = performance.now() - t0;
  console.log(`skidmarks microbench: 10k lays in ${ms.toFixed(2)} ms (${(ms / 10).toFixed(4)} us/lay); ranged 192 B/lay vs 86,400 B/lay whole-buffer`);
  assert.ok(ms < 500);
});
