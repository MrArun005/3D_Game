import test from 'node:test';
import assert from 'node:assert/strict';
import { newState, step, STRIKE_MIN, STRIKE_MAX } from '../src/world/lightning.js';
import { mulberry32 } from '../src/core/rng.js';

test('a storm strikes every 18-50 s, flashes stutter between 0 and 1, and thunder is scheduled once per strike', () => {
  const rnd = mulberry32(3), s = newState(rnd);
  let strikes = 0, lit = 0, frames = 0, maxFlash = 0, lastStrikeAt = -Infinity, t = 0;
  for (; t < 400; t += 1 / 60) {
    const f = step(s, 1 / 60, rnd); frames++;
    assert.ok(f >= 0 && f <= 1);
    if (f > 0) lit++;
    maxFlash = Math.max(maxFlash, f);
    if (s.strike) {
      strikes++;
      assert.ok(t - lastStrikeAt >= STRIKE_MIN - 0.1 && (lastStrikeAt === -Infinity || t - lastStrikeAt <= STRIKE_MAX + 0.1), `gap ${t - lastStrikeAt}`);
      assert.ok(s.strike.delay >= 0.4 && s.strike.delay <= 3.0);
      lastStrikeAt = t;
    }
  }
  assert.ok(strikes >= 8 && strikes <= 22, `strikes in 400 s: ${strikes}`);
  assert.ok(lit / frames < 0.03, 'the sky is dark almost all the time');
  assert.ok(maxFlash > 0.6);
});
