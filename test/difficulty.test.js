import test from 'node:test';
import assert from 'node:assert/strict';
import { pickDifficulty, addHeat, DIFFICULTY, withCity, CITY_LIFE } from '../src/game/difficulty.js';

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

/* --- JUST DRIVE (2026-09-23): easy also turns off the police theatre --- */

test('easy is just drive: no patrol calls, far sirens, far gunfire, street voices or ped crash reports; officers fire from 3', () => {
  const e = DIFFICULTY.easy;
  assert.deepEqual([e.patrolCalls, e.farSirens, e.farGunfire, e.pedVoices, e.pedsReportCrashes, e.fireFrom, e.quietHud], [false, false, false, false, false, 3, true]);
});

test('hard keeps all of it: the old fire-on-sight at two stars', () => {
  const h = DIFFICULTY.hard;
  assert.deepEqual([h.patrolCalls, h.farSirens, h.farGunfire, h.pedVoices, h.pedsReportCrashes, h.fireFrom, h.quietHud], [true, true, true, true, true, 2, false]);
});

test('withCity turns the four ambient knobs on and nothing else', () => {
  const e = DIFFICULTY.easy, c = withCity(e);
  assert.equal(c.name, 'easy+city');
  for (const k of CITY_LIFE) assert.equal(c[k], true, k);
  assert.deepEqual(CITY_LIFE.slice().sort(), ['farGunfire', 'farSirens', 'patrolCalls', 'pedVoices']);
  // stars, damage, crash witnesses and the fire-on-sight level stay easy
  for (const k of ['crimeScale', 'maxWanted', 'decayScale', 'hurtScale', 'crashScale', 'vigilante', 'pedsReportCrashes', 'fireFrom', 'quietHud']) assert.equal(c[k], e[k], k);
  assert.equal(e.patrolCalls, false, 'the table row itself is not mutated');
});

test('withCity is idempotent: hard and an upgraded easy come back unchanged', () => {
  assert.equal(withCity(DIFFICULTY.hard), DIFFICULTY.hard);
  const c = withCity(DIFFICULTY.easy);
  assert.equal(withCity(c), c);
  assert.equal(withCity(c).name, 'easy+city', 'no easy+city+city');
});

test('?city is easy plus the city life; with ?hard or a stored hard it is just hard', () => {
  const c = pickDifficulty('?city');
  assert.equal(c.name, 'easy+city');
  assert.equal(c.patrolCalls, true);
  assert.equal(c.maxWanted, 2, 'still easy stars');
  assert.equal(pickDifficulty('?city&hard').name, 'hard');
  assert.equal(pickDifficulty('?city', 'hard').name, 'hard');
  assert.equal(pickDifficulty('', 'easy').patrolCalls, false);
});
