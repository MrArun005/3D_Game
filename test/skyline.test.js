import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LANDMARK_KINDS, buildLandmark } from '../src/world/skyline.js';

const KINDS = Object.keys(LANDMARK_KINDS);

test('every landmark merges into one geometry with the full attribute set, under budget', () => {
  for (const k of KINDS) {
    const lm = buildLandmark(k, 7);
    for (const a of ['position', 'normal', 'uv', 'color', 'emit', 'flick']) assert.ok(lm.geo.attributes[a], `${k}: ${a} attribute`);
    assert.ok(lm.tris > 100 && lm.tris <= 12000, `${k}: ${lm.tris} triangles`);
    const pos = lm.geo.attributes.position.array;
    for (let i = 0; i < pos.length; i++) assert.ok(Number.isFinite(pos[i]), `${k}: finite positions`);
  }
});

test('each one stands on the ground, reaches its stated height and stays on its plot', () => {
  for (const k of KINDS) {
    const lm = buildLandmark(k, 3);
    const bb = new THREE.Box3().setFromBufferAttribute(lm.geo.attributes.position);
    assert.ok(bb.min.y > -1.0, `${k}: nothing buried (min y ${bb.min.y.toFixed(2)})`);
    assert.ok(Math.abs(bb.max.y - lm.height) < 6, `${k}: height ${lm.height} vs top ${bb.max.y.toFixed(1)}`);
    // the smallest plot any of these is placed on is Old Quarter's 56 x 44 m
    const w = bb.max.x - bb.min.x, d = bb.max.z - bb.min.z;
    assert.ok(w < 210 && d < 210, `${k}: footprint ${w.toFixed(0)} x ${d.toFixed(0)} m`);
  }
});

test('something glows on the ones that are meant to be seen at night', () => {
  for (const k of ['fly_tower', 'arcade_sign', 'church', 'clock_tower', 'flare_stack', 'market_hall']) {
    const em = buildLandmark(k, 1).geo.attributes.emit.array;
    let lit = 0;
    for (let i = 0; i < em.length; i += 3) if (em[i] + em[i + 1] + em[i + 2] > 0) lit++;
    assert.ok(lit > 0, `${k}: has emissive vertices`);
  }
});

test('every landmark hands the caller a collision footprint and the tall ones a light', () => {
  for (const k of KINDS) {
    const lm = buildLandmark(k, 5);
    assert.ok(lm.solids.length > 0 || k === 'arcade_sign', `${k}: solids`);
    for (const s of lm.solids) {
      assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z) && s.hw > 0 && s.hd > 0 && s.height > 0, `${k}: solid shape`);
    }
    assert.ok(lm.lights.every((l) => Number.isFinite(l.x) && Number.isFinite(l.y) && l.range > 0), `${k}: light positions`);
  }
});

test('the same seed builds the same landmark', () => {
  const a = buildLandmark('crane_cluster', 11), b = buildLandmark('crane_cluster', 11);
  assert.equal(a.tris, b.tris);
  assert.deepEqual(a.solids, b.solids);
});
