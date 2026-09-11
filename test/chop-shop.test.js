import test from 'node:test';
import assert from 'node:assert/strict';
import { chopValue, CHOP_SHOP } from '../src/game/garage.js';
import { crimeWitnessed } from '../src/game/policeAi.js';

/* The chop shop pays 35% of the showroom price, a fifth more for an outlaw,
   never under $200; it sits on the heist_2 warehouse. The Underworld Network
   perk halves how close a witness must be. */
test('chop value is 35% of the showroom price, +20% for an outlaw, floored at $200', () => {
  assert.equal(chopValue('q-suv'), Math.round(1800 * 0.35));
  assert.equal(chopValue('q-suv', true), Math.round(Math.round(1800 * 0.35) * 1.2));
  assert.equal(chopValue('q-sports'), 200, 'the free coupe still fetches the floor');
  assert.equal(chopValue('not-a-car'), Math.round(600 * 0.35), 'an unknown body is priced as a cheap one');
  assert.deepEqual([CHOP_SHOP.x, CHOP_SHOP.z], [3662, 1221], 'same address as the heist_2 stash');
});

test('Underworld Network halves the witness reach', () => {
  const cruiserAt60 = [{ live: true, x: 60, z: 0 }];
  assert.equal(crimeWitnessed('traffic', 0, 0, [], cruiserAt60), true, 'a cruiser at 60 m sees a crash');
  assert.equal(crimeWitnessed('traffic', 0, 0, [], cruiserAt60, 0, 0.5), false, 'at half reach it needs to be inside 45 m');
  const pedAt30 = [{ live: true, down: 0, x: 30, z: 0 }];
  assert.equal(crimeWitnessed('traffic', 0, 0, pedAt30, []), true);
  assert.equal(crimeWitnessed('traffic', 0, 0, pedAt30, [], 0, 0.5), false, 'a pedestrian at 30 m is outside 22.5 m');
  assert.equal(crimeWitnessed('police', 0, 0, [], [], 0, 0.5), true, 'hitting the police is always seen');
});
