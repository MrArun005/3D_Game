import test from 'node:test';
import assert from 'node:assert/strict';
import { rainSpell } from '../src/world/weather.js';

test('rain comes in spells: roughly 40% of the time, in runs of minutes, never flickering', () => {
  let wet = 0, flips = 0, prev = rainSpell(0);
  for (let t = 0; t < 4 * 3600; t += 1) { const r = rainSpell(t); if (r) wet++; if (r !== prev) flips++; prev = r; }
  const frac = wet / (4 * 3600);
  assert.ok(frac > 0.3 && frac < 0.5, `wet fraction ${frac.toFixed(2)}`);
  assert.ok(flips >= 6 && flips <= 12, `spell changes in four hours: ${flips}`);
});
