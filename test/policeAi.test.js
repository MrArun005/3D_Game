import test from 'node:test';
import assert from 'node:assert/strict';
import {
  weaponForWanted, aimJitter, burstFor, hasLineOfSight, shotLands, targetProfile, nextState, MAX_DEPLOYED,
} from '../src/game/policeAi.js';
import { mulberry32 } from '../src/core/rng.js';

test('one star is pistols; the response escalates to long guns', () => {
  assert.equal(weaponForWanted(1, 0), 'pistol');
  assert.equal(weaponForWanted(1, 7), 'pistol');
  assert.ok(['pistol', 'smg'].includes(weaponForWanted(2, 1)));
  assert.ok(['smg', 'shotgun'].includes(weaponForWanted(3, 2)));
  assert.ok(['rifle', 'shotgun'].includes(weaponForWanted(4, 0)));
  assert.equal(weaponForWanted(5, 1), 'rifle');
});

test('officers shoot better as the wanted level rises, worse at range and at a running target', () => {
  assert.ok(aimJitter(1, 10) > aimJitter(4, 10) * 2.5, 'a 1-star officer misses far more than a 4-star one');
  assert.ok(aimJitter(2, 40) > aimJitter(2, 8), 'longer shots wander more');
  assert.ok(aimJitter(2, 15, 6) > aimJitter(2, 15, 0) * 1.5, 'a sprinting target is hard to hit');
});

test('burst shape follows the weapon', () => {
  assert.equal(burstFor('shotgun').shots, 1);
  assert.equal(burstFor('pistol').shots, 2);
  assert.equal(burstFor('rifle').shots, 3);
  assert.ok(burstFor('smg').gap < burstFor('pistol').gap, 'an SMG cycles faster inside a burst');
});

const wall = { x: 10, z: 0, angle: 0, hw: 1, hd: 4, height: 12 };

test('a building between officer and player breaks line of sight; beside it does not', () => {
  assert.equal(hasLineOfSight(0, 1.2, 0, 20, 1.1, 0, [wall]), false);
  assert.equal(hasLineOfSight(0, 1.2, 8, 20, 1.1, 8, [wall]), true);
});

test('a vehicle blocks the line unless it is the officer\'s own cruiser', () => {
  const car = { x: 10, z: 0, r: 1.3 };
  assert.equal(hasLineOfSight(0, 1.2, 0, 20, 1.1, 0, [], [car]), false);
  assert.equal(hasLineOfSight(0, 1.2, 0, 20, 1.1, 0, [], [car], car), true, 'own cruiser never blocks');
});

test('aimed shots: zero jitter always lands, huge jitter mostly misses, crouching helps', () => {
  const rnd = mulberry32(7);
  assert.equal(shotLands(0, 1.2, 0, 15, 1.1, 0, 0.42, 0, rnd), true);
  let hitsStand = 0, hitsCrouch = 0, hitsWild = 0;
  const r1 = mulberry32(11), r2 = mulberry32(11), r3 = mulberry32(11);
  for (let i = 0; i < 400; i++) {
    if (shotLands(0, 1.2, 0, 15, 1.1, 0, 0.42, 0.03, r1)) hitsStand++;
    if (shotLands(0, 1.2, 0, 15, 0.75, 0, 0.32, 0.03, r2)) hitsCrouch++;
    if (shotLands(0, 1.2, 0, 15, 1.1, 0, 0.42, 0.25, r3)) hitsWild++;
  }
  assert.ok(hitsStand > 200, `steady aim should land most shots at 15 m, got ${hitsStand}/400`);
  assert.ok(hitsCrouch < hitsStand, 'a crouched target takes fewer hits');
  assert.ok(hitsWild < 60, `a wild shooter mostly misses, got ${hitsWild}/400`);
});

test('target profile: a crouched player is lower and smaller, a car is the cabin', () => {
  const stand = targetProfile(true, false), crouch = targetProfile(true, true), car = targetProfile(false, false);
  assert.ok(crouch.y < stand.y && crouch.r < stand.r);
  assert.ok(car.r > stand.r);
});

test('state machine: cover -> peek when seen, back to cover when the burst is spent, advance when quiet', () => {
  const base = { hp: 100, gap: 20, playerSpeed: 5, quietFor: 0, canSee: true, burstLeft: 3, t: 1 };
  assert.equal(nextState({ ...base, state: 'cover' }), 'peek');
  assert.equal(nextState({ ...base, state: 'cover', canSee: false }), 'cover', 'no line, stays behind the door');
  assert.equal(nextState({ ...base, state: 'peek', burstLeft: 0 }), 'cover');
  assert.equal(nextState({ ...base, state: 'cover', quietFor: 5, t: 0.1 }), 'advance');
  assert.equal(nextState({ ...base, state: 'advance', t: 0.4 }), 'advance');
  assert.equal(nextState({ ...base, state: 'advance', t: 1.0 }), 'cover');
});

test('state machine: arrest beats everything but death, and death beats all', () => {
  const base = { hp: 100, gap: 4, playerSpeed: 0, quietFor: 0, canSee: true, burstLeft: 3, t: 1 };
  assert.equal(nextState({ ...base, state: 'peek' }), 'arrest');
  assert.equal(nextState({ ...base, state: 'peek', hp: 0 }), 'down');
  assert.equal(nextState({ ...base, state: 'arrest', canSee: false }), 'cover', 'cannot cuff what you cannot see');
});

test('the deployed cap is a small number', () => {
  assert.ok(MAX_DEPLOYED >= 4 && MAX_DEPLOYED <= 8);
});

test('officers take cover on the far side of the cruiser from the player', async () => {
  const { coverSide } = await import('../src/game/policeAi.js');
  const a = coverSide(10, 0, 0, 10, 20);   // player on +z: door should be on -z side
  assert.ok(a.z < 0);
  const b = coverSide(10, 0, 0, 10, -20);
  assert.ok(b.z > 0);
});

test('body armour soaks 60% of a hit until it runs out', async () => {
  const { absorb } = await import('../src/game/policeAi.js');
  assert.deepEqual(absorb(0, 0.2), { toHealth: 0.2, toArmour: 0 });
  const r = absorb(1, 0.2); assert.ok(Math.abs(r.toHealth - 0.08) < 1e-9 && Math.abs(r.toArmour - 0.12) < 1e-9);
  const last = absorb(0.05, 0.2); assert.ok(Math.abs(last.toArmour - 0.05) < 1e-9 && Math.abs(last.toHealth - 0.15) < 1e-9, 'the last of the armour goes first, the rest is yours');
});

test('a player on foot who opens the gap gets chased once the officer has a line', async () => {
  const { nextState } = await import('../src/game/policeAi.js');
  const base = { state: 'cover', hp: 100, gap: 30, playerSpeed: 5, quietFor: 0, canSee: true, burstLeft: 0, t: 1.5 };
  assert.equal(nextState({ ...base, playerOnFoot: true }), 'advance');
  assert.equal(nextState({ ...base, playerOnFoot: false }), 'peek', 'in a car they hold cover and shoot');
  assert.equal(nextState({ ...base, playerOnFoot: true, canSee: false }), 'cover', 'no line, no chase');
});

test('losing them: unseen for ten seconds with cruisers searching nearby drains the stars; seen, heli, or nobody there does not', async () => {
  const { evasionDecay, searchRadius, HIDDEN_AFTER_S } = await import('../src/game/policeAi.js');
  const base = { hot: false, eyesOn: false, coldFor: HIDDEN_AFTER_S + 1, nearest: 80, wanted: 2 };
  assert.ok(evasionDecay(base) > 0, 'hidden and searched for: draining');
  assert.equal(evasionDecay({ ...base, hot: true }), 0, 'a line on you stops it');
  assert.equal(evasionDecay({ ...base, eyesOn: true }), 0, 'the helicopter does not lose you');
  assert.equal(evasionDecay({ ...base, coldFor: 4 }), 0, 'not yet');
  assert.equal(evasionDecay({ ...base, nearest: Infinity }), 0, 'no cruiser has arrived: nothing to evade');
  assert.equal(evasionDecay({ ...base, wanted: 4 }), 0, 'four stars: ten seconds is not enough');
  assert.ok(evasionDecay({ ...base, wanted: 4, coldFor: 21 }) > 0, 'twenty is, once the helicopter has lost you too');
  assert.equal(evasionDecay({ ...base, nearest: 400, coldFor: 0, cool: 10 }), 0.55, 'the old 240 m rule still applies');
  assert.ok(searchRadius(3) < searchRadius(20) && searchRadius(200) === 90, 'the ring grows and caps');
});

test('a crime needs a witness until you are wanted; hitting the police is always seen', async () => {
  const { crimeWitnessed } = await import('../src/game/policeAi.js');
  const far = [{ live: true, x: 500, z: 0 }], near = [{ live: true, x: 10, z: 0 }], two = [near[0], { live: true, x: -10, z: 5 }];
  assert.equal(crimeWitnessed('traffic', 0, 0, far, []), false, 'an empty street');
  assert.equal(crimeWitnessed('traffic', 0, 0, near, []), true, 'one bystander is enough for a shot or a crash');
  assert.equal(crimeWitnessed('person', 0, 0, near, []), false, 'the victim alone does not call it in');
  assert.equal(crimeWitnessed('person', 0, 0, two, []), true);
  assert.equal(crimeWitnessed('traffic', 0, 0, [], [{ live: true, x: 60, z: 0 }]), true, 'a cruiser saw it');
  assert.equal(crimeWitnessed('police', 0, 0, [], []), true);
  assert.equal(crimeWitnessed('traffic', 0, 0, [], [], 2), true, 'already wanted: everything counts');
});
