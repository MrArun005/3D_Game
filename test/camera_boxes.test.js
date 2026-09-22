import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insideBoxes } from '../src/game/camera.js';

test('a point inside a footprint (plus pad) is blocked, outside is clear', () => {
  const boxes = [{ x: 10, z: 0, hw: 5, hd: 3, angle: 0 }];
  assert.equal(insideBoxes(10, 0, boxes), true);
  assert.equal(insideBoxes(15.4, 0, boxes), true, 'within the 0.6 m pad');
  assert.equal(insideBoxes(16, 0, boxes), false);
  assert.equal(insideBoxes(10, 3.8, boxes), false);
  assert.equal(insideBoxes(0, 0, null), false);
});

test('rotated boxes use their own axes', () => {
  const boxes = [{ x: 0, z: 0, hw: 5, hd: 0.5, angle: Math.PI / 2 }];   // long axis now along z
  assert.equal(insideBoxes(0, 4.5, boxes), true);
  assert.equal(insideBoxes(4.5, 0, boxes), false);
});
