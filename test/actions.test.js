import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PAD_CAR, PAD_FOOT } from '../src/game/input.js';

/* Every action input.js can send must have a handler in main.js. On
   2026-09-06 the 'camera' handler was deleted in an unrelated edit while
   the key kept firing it: C silently did nothing. This is the tripwire. */
test('every input action has a handler in main.js', () => {
  const input = fs.readFileSync('src/game/input.js', 'utf8');
  const main = fs.readFileSync('src/main.js', 'utf8');
  const actions = [...new Set([...input.matchAll(/onAction\('([a-z0-9]+)'\)/g)].map((m) => m[1]),
    ...Object.values(PAD_CAR), ...Object.values(PAD_FOOT))];   // the pad raises its actions from tables
  assert.ok(actions.length > 15, `found ${actions.length} actions`);
  const missing = actions.filter((a) => !(main.includes(`action === '${a}'`) || (a.startsWith('weapon') && main.includes("action.startsWith('weapon')"))));
  assert.deepEqual(missing, [], `actions with no handler: ${missing.join(', ')}`);
});
