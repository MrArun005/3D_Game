import test from 'node:test';
import assert from 'node:assert/strict';
import { pickDifficulty, addHeat, DIFFICULTY } from '../src/game/difficulty.js';

test('easy is the default; ?hard, ?easy and the stored choice pick the other', () => {
  assert.equal(pickDifficulty('').name, 'easy');
  assert.equal(pickDifficulty('?debug&quality=high').name, 'easy');
  assert.equal(pickDifficulty('?hard').name, 'hard');
  assert.equal(pickDifficulty('', 'hard').name, 'hard');
  assert.equal(pickDifficulty('?easy', 'hard').name, 'easy', 'the address beats the stored choice');
  assert.equal(pickDifficulty('', 'nonsense').name, 'easy');
});

test('easy: crimes bring 40% of the heat and never pass two stars', () => {
  const e = DIFFICULTY.easy;
  assert.ok(Math.abs(addHeat(0, 1, e) - 0.4) < 1e-9);
  let w = 0;
  for (let i = 0; i < 50; i++) w = addHeat(w, 1.5, e);   // fifty pedestrians later
  assert.equal(w, 2);
});

test('heat something else set is never lowered by the cap', () => {
  // a hold-out or a mission put you at 3.5 stars: a crime on easy cannot drop you to 2
  assert.equal(addHeat(3.5, 1, DIFFICULTY.easy), 3.5);
});

test('hard is the full game: full heat, five-star ceiling', () => {
  const h = DIFFICULTY.hard;
  assert.equal(addHeat(0, 1.2, h), 1.2);
  assert.equal(addHeat(4.8, 1, h), 5);
  assert.deepEqual([h.decayScale, h.hurtScale, h.crashScale, h.vigilante], [1, 1, 1, true]);
});
