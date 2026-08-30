import test from 'node:test';
import assert from 'node:assert/strict';
import { signalState, CYCLE, GREEN, AMBER } from '../src/world/signals.js';

test('the two axes are never green at the same time', () => {
  for (const [i, j] of [[0, 0], [3, -2], [17, 41], [-8, 5]]) {
    for (let t = 0; t < CYCLE * 2; t += 0.05) {
      const a = signalState(i, j, 0, t);
      const b = signalState(i, j, 1, t);
      assert.ok(!(a === 'green' && b === 'green'),
        `both green at t=${t.toFixed(2)} for ${i},${j}`);
      assert.ok(!(a === 'green' && b === 'amber'), 'green against amber');
      assert.ok(!(b === 'green' && a === 'amber'), 'green against amber');
    }
  }
});

test('an approach only ever goes green -> amber -> red', () => {
  // scanning from t=0 can start mid-phase because junctions are offset, so
  // check the TRANSITIONS rather than assuming which state we begin in
  const seen = [];
  let prev = null;
  for (let t = 0; t < CYCLE * 2; t += 0.01) {
    const s = signalState(2, 7, 0, t);
    if (s !== prev) { seen.push([prev, s]); prev = s; }
  }
  const legal = { green: 'amber', amber: 'red', red: 'green' };
  let greens = 0;
  for (const [from, to] of seen) {
    if (from === null) continue;              // the very first sample
    assert.equal(legal[from], to, `illegal transition ${from} -> ${to}`);
    if (to === 'green') greens++;
  }
  assert.ok(greens >= 2, `should go green once per cycle, saw ${greens} in two`);
});

test('the phase is stable across a stream-out and stream-in', () => {
  // same inputs must give the same answer: there is no hidden state to lose
  const a = signalState(5, -3, 1, 41.7);
  const b = signalState(5, -3, 1, 41.7);
  assert.equal(a, b);
  assert.equal(signalState(5, -3, 1, 41.7 + CYCLE), a);
});

test('neighbouring junctions are not all in lockstep', () => {
  const t = 3.3;
  const states = [[0,0],[1,0],[0,1],[1,1],[2,3]].map(([i,j]) => signalState(i, j, 0, t));
  assert.ok(new Set(states).size > 1, 'junctions should be desynchronised');
});
