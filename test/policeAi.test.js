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

test('one-star officers hold fire unless you have been shooting; two stars fire on sight', async () => {
  const { shouldFire } = await import('../src/game/policeAi.js');
  assert.equal(shouldFire(1, 30), false);
  assert.equal(shouldFire(1, 2), true, 'you fired eight seconds ago or less: they answer');
  assert.equal(shouldFire(2, 30), true);
});

/* --- bounding overwatch: one man moves, the rest shoot (policeAi movement block) --- */

const AI = await import('../src/game/policeAi.js');
const { ARSENAL } = await import('../src/game/weapons.js');

/** Cover points in a ring-ish scatter around the player at (0,0), the way traffic.js collects cruisers and parked cars. */
function coverField() {
  const out = [];
  for (let r = 9; r <= 34; r += 5) for (let a = 0; a < 12; a++) out.push({ x: Math.cos(a / 12 * Math.PI * 2) * r, z: Math.sin(a / 12 * Math.PI * 2) * r });
  return out;
}

/** A squad of four, run for `secs` at 10 Hz exactly the way the traffic.js hook drives them. */
function simulate(secs, wanted = 3) {
  const covers = coverField(), px = 0, pz = 0, dt = 0.1;
  const squad = [0, 1, 2, 3].map((slot) => {
    const a = slot / 4 * Math.PI * 2;
    return { slot, hp: 100, state: 'cover', role: 'suppress', stateT: 0, rushCool: 0, reloadLeft: 0, flanks: 0, dest: null, arrived: false, x: Math.cos(a) * 28, z: Math.sin(a) * 28 };
  });
  const log = { maxMovers: 0, moverTicks: 0, rushers: new Set(), rushes: [], speeds: [] };
  for (let i = 0; i < secs / dt; i++) {
    for (const o of squad) o.gap = Math.hypot(px - o.x, pz - o.z);
    const roles = AI.assignRoles(squad, { wanted });
    squad.forEach((o, k) => { o.role = roles[k]; });
    for (const o of squad) {
      if ((o.role === 'rush' || o.role === 'flank') && o.state !== 'rush' && !o.dest) {
        const plan = AI.rushPlan(o, { px, pz, covers });
        if (plan) { o.dest = plan; o.rushTime = plan.time; }
      }
      const next = AI.nextState({ state: o.state, hp: o.hp, gap: o.gap, playerSpeed: 0, quietFor: 0, canSee: true, burstLeft: 0, t: o.stateT, role: o.role, dest: o.dest, reloadLeft: o.reloadLeft, arrived: o.arrived, rushTime: o.rushTime });
      if (next !== o.state) {
        if (next === 'rush') { o.arrived = false; log.rushers.add(o.slot); log.rushes.push({ slot: o.slot, flank: !!o.dest.flank, speed: o.dest.speed, time: o.dest.time, from: { x: o.x, z: o.z }, to: { x: o.dest.x, z: o.dest.z } }); }
        if (o.state === 'rush') { o.rushCool = AI.RUSH_COOL_S; if (o.dest?.flank) o.flanks++; o.dest = null; }
        o.state = next; o.stateT = 0;
      }
      o.stateT += dt; o.rushCool = Math.max(0, o.rushCool - dt);
      const m = AI.moveTarget(o, { px, pz });
      const st = AI.stepToward(o.x, o.z, m.x, m.z, m.speed, dt);
      o.x = st.x; o.z = st.z; o.arrived = st.arrived;
      log.speeds.push(st.moved / dt);
    }
    const moving = squad.filter((o) => o.state === 'rush').length;
    log.maxMovers = Math.max(log.maxMovers, moving);
    if (moving) log.moverTicks++;
  }
  return { squad, log, covers };
}

test('a squad bounds: somebody is always rushing, and never everybody at once', () => {
  const { log } = simulate(30, 3);
  assert.ok(log.rushes.length >= 3, `30 s should see several rushes, got ${log.rushes.length}`);
  assert.ok(log.moverTicks > 40, `somebody should be moving for a good part of the fight, got ${log.moverTicks} ticks of 300`);
  assert.equal(log.maxMovers, 1, 'three stars: one man out of cover at a time, the rest are shooting');
  assert.ok(log.rushers.size >= 2, 'the rushes are shared out, not one officer doing all the work');
});

test('four stars bounds two at a time, and still never the whole squad', () => {
  const { log } = simulate(30, 4);
  assert.ok(log.maxMovers <= 2 && log.maxMovers >= 1);
  assert.ok(log.maxMovers < 4, 'a gun always stays on the player');
});

test('every rush is short and ends on a real cover point, never in the open', () => {
  const { log, covers } = simulate(30, 3);
  for (const r of log.rushes) {
    assert.ok(covers.some((c) => Math.abs(c.x - r.to.x) < 1e-9 && Math.abs(c.z - r.to.z) < 1e-9), 'the destination is one of the cover points, not open ground');
    const d = Math.hypot(r.to.x - r.from.x, r.to.z - r.from.z);
    assert.ok(r.time >= AI.RUSH_MIN_S && r.time <= AI.RUSH_MAX_S, `a rush is ${AI.RUSH_MIN_S}-${AI.RUSH_MAX_S} s, this one was budgeted ${r.time.toFixed(1)} s`);
    assert.ok(d / r.speed <= r.time, `he has to REACH the cover inside the rush: ${(d / r.speed).toFixed(1)} s of running in a ${r.time.toFixed(1)} s window`);
  }
  assert.ok(log.speeds.some((v) => v > AI.WALK_SPEED * 2), 'the model gets a running speed to animate');
});

test('a rush with nowhere to run to does not happen', () => {
  assert.equal(AI.rushPlan({ slot: 0, role: 'rush', x: 30, z: 0 }, { px: 0, pz: 0, covers: [] }), null);
  // cover that does not buy ground, or that is in the player's lap, is not cover worth crossing for
  assert.equal(AI.rushPlan({ slot: 0, role: 'rush', x: 30, z: 0 }, { px: 0, pz: 0, covers: [{ x: 36, z: 0 }] }), null, 'backwards is not a rush');
  assert.equal(AI.rushPlan({ slot: 0, role: 'rush', x: 30, z: 0 }, { px: 0, pz: 0, covers: [{ x: 3, z: 0 }] }), null, 'nor is running into his arms');
  assert.ok(AI.rushPlan({ slot: 0, role: 'rush', x: 30, z: 0 }, { px: 0, pz: 0, covers: [{ x: 18, z: 2 }] }));
});

test('the flanker goes wide: he ends up well off the line he started on', () => {
  const covers = coverField();
  const o = { slot: 1, role: 'flank', x: 28, z: 0 };
  const plan = AI.rushPlan(o, { px: 0, pz: 0, covers });
  assert.ok(plan && plan.flank);
  const a0 = Math.atan2(o.z, o.x), a1 = Math.atan2(plan.z, plan.x);
  const swing = Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)));
  assert.ok(swing > 0.5, `a flank swings round you, got ${(swing * 57.3).toFixed(0)} degrees`);
  assert.ok(plan.speed > AI.RUSH_SPEED, 'he has the furthest to go, so he sprints');
  const other = AI.rushPlan({ slot: 0, role: 'flank', x: 28, z: 0 }, { px: 0, pz: 0, covers });
  assert.ok(Math.sign(other.z) !== Math.sign(plan.z), 'odd and even slots flank opposite sides');
});

test('one squad, one flanker: the rest come straight at you', () => {
  const squad = [0, 1, 2, 3].map((slot) => ({ slot, hp: 100, state: 'cover', gap: 30, rushCool: 0, flanks: 0 }));
  const roles = AI.assignRoles(squad, { wanted: 3 });
  assert.equal(roles.filter((r) => r === 'flank').length, 1);
  assert.equal(roles.filter((r) => r === 'suppress').length, 3);
  assert.ok(AI.assignRoles(squad.map((o) => ({ ...o, flanks: 1 })), { wanted: 3 }).every((r) => r !== 'flank'), 'once each man has gone wide once, they stop');
  assert.ok(AI.assignRoles([{ slot: 0, hp: 100, state: 'cover', gap: 30 }], { wanted: 4 }).every((r) => r === 'suppress'), 'a lone officer holds his cover');
});

/* --- weapon handling --- */

const gun = (over = {}) => ({ gunKind: 'pistol', state: 'peek', ammo: 12, burstLeft: 0, fireT: -1, reloadLeft: 0, settleLeft: 0, ...over });
const see = (over = {}) => ({ dt: 0.1, canSee: true, blocked: false, stars: 3, quietFor: 0, ...over });

test('no line of sight, no shot -- and re-acquiring you costs him a beat', () => {
  assert.equal(AI.fireControl(gun(), see({ canSee: false })).fire, false);
  assert.equal(AI.fireControl(gun(), see({ canSee: false })).hold, 'nolos');
  // that tick armed the settle; the very next frame, with a line, he still cannot snap-fire
  let o = AI.fireControl(gun(), see({ canSee: false }));
  let shots = 0, first = -1;
  for (let i = 0; i < 20; i++) {
    const r = AI.fireControl(gun({ ...o, state: 'peek' }), see());
    o = r; if (r.fire && first < 0) first = i * 0.1;
    if (r.fire) shots++;
  }
  assert.ok(first >= AI.SETTLE_S - 0.11, `the first round waits for the sight picture, came at ${first}s`);
  assert.ok(shots > 0, 'and then he does fire');
});

test('a civilian in the line stops the burst', () => {
  assert.equal(AI.fireControl(gun({ settleLeft: 0 }), see({ blocked: true })).fire, false);
  const peds = [{ x: 8, z: 0, live: true }];
  assert.ok(AI.bystanderInLine(0, 1.2, 0, 20, 1.1, 0, peds), 'someone is standing in it');
  assert.equal(AI.bystanderInLine(0, 1.2, 0, 20, 1.1, 0, [{ x: 8, z: 4, live: true }]), null, 'four metres to the side is clear');
  assert.equal(AI.bystanderInLine(0, 1.2, 0, 20, 1.1, 0, [{ x: 8, z: 0, live: true, down: true }]), null, 'a body on the ground is not a reason to hold fire');
});

test('a reload is a real pause: the gun is down for the weapon\'s own reload time', () => {
  let o = gun({ ammo: 0 });
  const start = AI.fireControl(o, see());
  assert.ok(start.reloadStart && !start.fire && start.hold === 'reload');
  o = { ...o, ...start };
  let t = 0;
  while (o.reloadLeft > 0 && t < 10) { const r = AI.fireControl(o, see()); assert.equal(r.fire, false, 'he cannot shoot mid-reload'); o = { ...o, ...r }; t += 0.1; }
  assert.ok(Math.abs(t - ARSENAL.pistol.reload) < 0.25, `the pause is the weapon's reload, got ${t.toFixed(1)}s of ${ARSENAL.pistol.reload}s`);
  assert.equal(o.ammo, ARSENAL.pistol.mag, 'and then he has a full magazine');
});

test('a magazine runs out: the officer cannot fire for ever', () => {
  let o = gun({ gunKind: 'rifle', ammo: ARSENAL.rifle.mag, fireT: -1 });
  let fired = 0;
  for (let i = 0; i < 600 && !o.reloadStart; i++) { const r = AI.fireControl(o, see()); if (r.fire) fired++; o = { ...o, ...r }; }
  assert.equal(fired, ARSENAL.rifle.mag, 'exactly one magazine, then the reload');
});

test('one star still holds fire, and nobody fires from behind the door', () => {
  assert.equal(AI.fireControl(gun(), see({ stars: 1, quietFor: 30 })).hold, 'holdfire');
  assert.equal(AI.fireControl(gun({ state: 'cover' }), see()).fire, false, 'only the peek fires');
  assert.equal(AI.fireControl(gun({ state: 'rush' }), see()).fire, false, 'and never while running');
});

test('a suppressing officer fires longer bursts with shorter pauses', () => {
  const plain = burstFor('rifle'), sup = burstFor('rifle', true);
  assert.ok(sup.shots > plain.shots && sup.pause < plain.pause);
  assert.equal(burstFor('shotgun', true).shots, 1, 'a pump gun is still a pump gun');
});

test('the new states do not break the old ones', () => {
  const base = { hp: 100, gap: 20, playerSpeed: 5, quietFor: 0, canSee: true, burstLeft: 3, t: 1 };
  assert.equal(AI.nextState({ ...base, state: 'cover', role: 'rush', dest: { x: 1, z: 1 } }), 'rush');
  assert.equal(AI.nextState({ ...base, state: 'cover', role: 'rush', dest: null }), 'peek', 'no cover to rush to: he shoots instead');
  assert.equal(AI.nextState({ ...base, state: 'rush', t: 0.5, rushTime: 3 }), 'rush');
  assert.equal(AI.nextState({ ...base, state: 'rush', t: 0.5, rushTime: 3, arrived: true }), 'cover', 'arrived early: back into cover');
  assert.equal(AI.nextState({ ...base, state: 'peek', reloadLeft: 1.2 }), 'reload');
  assert.equal(AI.nextState({ ...base, state: 'reload', reloadLeft: 0 }), 'cover');
  assert.equal(AI.nextState({ ...base, state: 'rush', reloadLeft: 1.2, t: 0.2, rushTime: 3 }), 'rush', 'he reloads on the move');
  assert.equal(AI.nextState({ ...base, gap: 4, playerSpeed: 0, state: 'rush', reloadLeft: 2, t: 0.2 }), 'arrest', 'arrest still beats everything');
  assert.equal(AI.nextState({ ...base, hp: 0, state: 'rush', t: 0.2 }), 'down');
});

test('the officer\'s own position is coverX/coverZ, and the settle beat is longer than the cover dwell', () => {
  /* traffic.js keeps a deployed officer's XZ in coverX/coverZ -- c.x/c.z is his
     CRUISER. The movement calls read coverX first so the hook can pass the
     officer straight in; when that regresses, officers walk relative to a
     parked car and the rush picks cover on the wrong side of the street. */
  const o = { slot: 0, role: 'rush', state: 'cover', x: 999, z: 999, coverX: 30, coverZ: 0 };
  const plan = AI.rushPlan(o, { px: 0, pz: 0, covers: coverField() });
  assert.ok(plan && Math.hypot(plan.x - 30, plan.z) < AI.RUSH_SPEED * AI.RUSH_MAX_S, 'the rush starts from coverX, not from the cruiser');
  const m = AI.moveTarget({ ...o, state: 'advance' }, { px: 0, pz: 0 });
  assert.ok(Math.hypot(m.x - 7, m.z) < 0.001, 'the advance walks in from coverX and stops 7 m out');
  // nextState makes him sit in cover for 0.6 s before he peeks; a shorter settle never binds
  assert.ok(AI.SETTLE_S > 0.6, `the sight-picture beat has to outlast the cover dwell, got ${AI.SETTLE_S}`);
});
