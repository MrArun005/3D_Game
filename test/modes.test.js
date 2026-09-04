import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rangeScore, accuracy, holdoutWanted, holdoutScore, rank, RANGE_ROWS, HOLDOUT_MAX_STARS, HOLDOUT_START_STARS,
} from '../src/game/modes.js';

test('range scoring: farther boards pay more and a high hit doubles', () => {
  assert.equal(rangeScore(15, false), 5);
  assert.equal(rangeScore(30, false), 15);
  assert.equal(rangeScore(60, false), 30);
  assert.equal(rangeScore(60, true), 60);
  assert.deepEqual(RANGE_ROWS, [15, 30, 60]);
});

test('accuracy is a whole percentage and never NaN', () => {
  assert.equal(accuracy(0, 0), 0);
  assert.equal(accuracy(3, 4), 75);
  assert.equal(accuracy(1, 3), 33);
});

test('hold-out wanted ramps half a star every 40 s from two, capped', () => {
  assert.equal(holdoutWanted(0), HOLDOUT_START_STARS);
  assert.equal(holdoutWanted(39), HOLDOUT_START_STARS);
  assert.equal(holdoutWanted(40), HOLDOUT_START_STARS + 0.5);
  assert.equal(holdoutWanted(125), HOLDOUT_START_STARS + 1.5);
  assert.equal(holdoutWanted(100000), HOLDOUT_MAX_STARS);
});

test('hold-out score counts seconds and weighs downed officers heavily', () => {
  assert.equal(holdoutScore(60, 0), 120);
  assert.equal(holdoutScore(60, 3), 270);
  assert.ok(holdoutScore(10, 1) > holdoutScore(30, 0), 'one officer down beats twenty extra seconds');
});

test('ranks are monotonic and mode-specific', () => {
  const order = ['D', 'C', 'B', 'A', 'S'];
  let last = -1;
  for (const s of [0, 60, 140, 240, 360, 999]) { const i = order.indexOf(rank(s, 'range')); assert.ok(i >= last); last = i; }
  assert.equal(rank(360, 'range'), 'S');
  assert.notEqual(rank(360, 'holdout'), 'S', 'a hold-out needs a bigger number for the same letter');
});
