import test from 'node:test';
import assert from 'node:assert/strict';
import { windowState } from '../src/world/signs.js';
import { bloomKnee, bloomThresholdFor, NIGHT_EXPOSURE } from '../src/core/grade.js';
import { LightPool, headScore } from '../src/game/lighting.js';

/* The window-state roll (signs.js:buildWindowMaterial) is the same hash in the
   shader: fract(sin(r*97.31 + b*41.7 + 0.37) * 43758.5453) of the per-instance
   aTint dressing.js already seeded from the module position. Run it in float32,
   the precision the GPU has, over dressing's own roll. */
const f = Math.fround;
function roll(rnd) {
  const hh = rnd();
  if (hh < 0.42) return 'dark';                       // dressing.js:703 leaves these tintless
  const tint = hh < 0.75 ? [1.0, 0.82, 0.55] : [0.72, 0.86, 1.0];
  const lv = 0.45 + rnd() * 0.55;
  const h = f(f(Math.sin(f(f(tint[0] * lv) * 97.31 + f(tint[2] * lv) * 41.7 + 0.37)) * 43758.5453) % 1);
  return windowState(h < 0 ? h + 1 : h);
}

test('window states: most dark, a few bright, every state present', () => {
  let s = 1;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const n = { dark: 0, dim: 0, bright: 0, curtain: 0, blinds: 0, tv: 0 };
  const N = 50000;
  for (let i = 0; i < N; i++) n[roll(rnd)]++;
  const pc = (k) => 100 * n[k] / N;
  assert.ok(pc('dark') > 48 && pc('dark') < 56, `dark ${pc('dark').toFixed(1)}% -- most windows are dark`);
  assert.ok(pc('bright') < pc('dim'), 'bright warm is rarer than dim warm');
  for (const k of Object.keys(n)) assert.ok(pc(k) > 3, `${k} ${pc(k).toFixed(1)}% -- every state shows up`);
  assert.ok(pc('dim') + pc('bright') + pc('curtain') + pc('blinds') + pc('tv') > 40, 'the lit half is really lit');
});

test('bloom knee: a lit window is excluded, a sign core is not', () => {
  const T = bloomThresholdFor(0.85, NIGHT_EXPOSURE);   // night, as clock.js authors it
  const alpha = (lum) => {                             // BloomNode luminosityHighPass
    const t = Math.min(1, Math.max(0, (lum - T) / bloomKnee(T)));
    return t * t * (3 - 2 * t);
  };
  assert.ok(alpha(0.74) === 0, 'a Tokyo lit window stays out of the bloom');
  assert.ok(alpha(1.0) < 0.25, 'a whole facade window barely contributes');
  assert.ok(alpha(1.89) > 0.95, 'Tokyo neon blooms');
  assert.ok(alpha(2.0) === 1, 'the sign core blooms at full weight');
  assert.ok(alpha(4.8) === 1, 'a headlamp lens blooms');
});

/* Hero lights (game/lighting.js): the world hands positions over in
   heroLightsByChunk, the pool lends its 3 boot-time lights to the nearest. */
const fakeScene = { add() {} };
const step = (pool, x, z, n = 40) => { for (let i = 0; i < n; i++) pool.update(0.05, x, z); };

test('hero lights: nearest first, no thrash when two sources swap order', () => {
  const world = { headsByChunk: new Map(), heroLightsByChunk: new Map() };
  world.heroLightsByChunk.set('0,0', [
    { x: 0, z: 0, y: 3, intensity: 26, range: 12 },
    { x: 10, z: 0, y: 3 },
    { x: 20, z: 0, y: 3 },
    { x: 400, z: 0, y: 3 },      // out of range
  ]);
  const pool = new LightPool(fakeScene, world, { count: 1, hero: 3 });
  step(pool, 0, 0);
  const lit = pool.heroes.filter((h) => h.light.intensity > 0);
  assert.equal(lit.length, 3, 'three sources in range, three lights');
  assert.ok(!pool.heroes.some((h) => h.src?.x === 400), 'the far one is never picked');
  assert.equal(pool.heroes[0].light.distance, 12, 'a source carries its own range');
  const owners = pool.heroes.map((h) => h.src);
  step(pool, 11, 0);              // past the middle source: the ranking reorders
  assert.deepEqual(pool.heroes.map((h) => h.src), owners, 'same three sources, no hand-over');
});

/* The bug this guards (2026-09-14): main.js built the pool only for a ?night
   boot, so a session that started in the afternoon and drove into midnight had
   no pool at all -- measured on the Tokyo street, 2 of 6 lights alive and both
   still at the world origin, against 2,077 registered heads. The pool is built
   at boot now and faded by clock.js's nightFactor, so both ends need holding:
   lit after dark, and genuinely off at noon rather than lighting the city. */
test('the pool lights after dark and goes fully out by day', () => {
  const head = { x: 4, z: 0, y: 6, intensity: 60, range: 26 };
  const world = { headsByChunk: new Map([['0,0', [head]]]), heroLightsByChunk: new Map() };
  world.heroLightsByChunk.set('0,0', [{ x: 0, z: 0, y: 3, intensity: 26, range: 12 }]);
  const pool = new LightPool(fakeScene, world, { count: 1, hero: 1 });

  pool.setNight(1);
  step(pool, 0, 0);
  assert.ok(pool.lights[0].light.intensity > 0, 'a lamp head is lit at night');
  assert.ok(pool.heroes[0].light.intensity > 0, 'a doorway is lit at night');

  pool.setNight(0);
  step(pool, 0, 0);
  assert.equal(pool.lights[0].light.intensity, 0, 'no lamp burns at noon');
  assert.equal(pool.heroes[0].light.intensity, 0, 'no doorway burns at noon');

  pool.setNight(0.5);
  step(pool, 0, 0);
  assert.ok(pool.lights[0].light.intensity > 0, 'dusk is partial, not a switch');
});

test('neon kanban beat a closer sodium lamp so Tokyo gets coloured light', () => {
  const sodium = { x: 8, z: 0, y: 8 };
  const kanban = { x: 22, z: 0, y: 6, neon: true, colour: 0xff40c0, intensity: 100, range: 32 };
  assert.ok(headScore(kanban, 0, 0) < headScore(sodium, 0, 0), 'bias puts the neon ahead of a nearer street lamp');
  const world = { headsByChunk: new Map([['0,0', [sodium, kanban]]]), heroLightsByChunk: new Map() };
  const pool = new LightPool(fakeScene, world, { count: 1, hero: 0 });
  step(pool, 0, 0);
  assert.equal(pool.lights[0].head, kanban);
  assert.ok(pool.lights[0].light.intensity > 80, `neon intensity ${pool.lights[0].light.intensity}`);
});

test('hero lights: no source, no light, and no crash without the world hook', () => {
  const pool = new LightPool(fakeScene, { headsByChunk: new Map() }, { count: 1, hero: 2 });
  step(pool, 0, 0, 5);
  assert.ok(pool.heroes.every((h) => h.light.intensity === 0));
});
