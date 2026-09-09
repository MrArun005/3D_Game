import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldFire } from '../src/game/policeAi.js';
import { StoryManager } from '../src/game/storyMissions.js';
import { Garage, REPAIR } from '../src/game/garage.js';

/* Regression tests for the gameplay fixes of 2026-09-09 (docs/REVIEW-2026-09-09-GTA.md,
   section 3 and the quick wins). Each one pins the behaviour the fix bought. */

test('a freshly deployed one-star officer (quietFor 999) holds fire; a shot at him answers', () => {
  assert.equal(shouldFire(1, 999), false, 'traffic.js deploys with quietFor = 999');
  assert.equal(shouldFire(1, 0), true, 'officerHit resets quietFor to 0: he fires back');
  assert.equal(shouldFire(2, 999), true);
});

test('Mission.route requireStop: a job checkpoint takes only below 1.5 m/s', async () => {
  const { Mission } = await import('../src/game/mission.js');
  const mission = new Mission({ add: () => {} }, { graph: { nodes: [] }, blocks: [] });
  mission.route([{ x: 100, z: 100 }, { x: 400, z: 100 }], 'FARE', false, { requireStop: true });
  mission.update({ x: 100, z: 100, fwdSpeed: 6 }, 0.016);
  assert.equal(mission.index, 0, 'rolling through the ring does not board the fare');
  mission.update({ x: 100, z: 100, fwdSpeed: 0.5 }, 0.016);
  assert.equal(mission.index, 1, 'stopped inside the ring: boarded');
  // a plain route (a getaway) is still a fly-through
  mission.route([{ x: 100, z: 100 }, { x: 400, z: 100 }], 'GETAWAY');
  mission.update({ x: 100, z: 100, fwdSpeed: 20 }, 0.016);
  assert.equal(mission.index, 1);
});

test('StoryManager.onOfficerDown counts only officers dropped near the zone', () => {
  const flashed = [];
  const story = new StoryManager({ route() {}, stop() {}, setMarkerColor() {} }, { wanted: 0 }, { flash: (m) => flashed.push(m) }, { addCash() {} });
  story.startMission('bounty_1', { x: 0, z: 0 });
  story.stepIdx = story.active.steps.findIndex((s) => s.needDowned);   // the firefight step
  const step = story.active.steps[story.stepIdx];
  assert.ok(step?.needDowned, 'bounty_1 carries a needDowned step');
  story.downed = 0;
  story.onOfficerDown(step.target.x + 10, step.target.z);
  assert.equal(story.downed, 1, 'in the zone: counts');
  story.onOfficerDown(step.target.x + 500, step.target.z);
  assert.equal(story.downed, 1, 'three blocks away: does not count');
  story.onOfficerDown();
  assert.equal(story.downed, 2, 'no position given: counted (older callers)');
  story.abandon();
  assert.equal(story.active, null);
});

test('Garage: corrupt hb.garage falls back to the default car; payAndSpray shares the repair price and the 3-star gate', () => {
  const store = { 'hb.garage': '{not json' };
  const origStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
  try {
    const jobs = { cash: 1000, persist() {} };
    const flashed = [];
    const hull = { material: { color: { setHex() {} } } };
    let repaired = 0;
    const garage = new Garage(jobs, {}, { userData: { hull } }, { value: 0.5, repair() { repaired++; } }, { flash: (m) => flashed.push(m) });
    assert.deepEqual(garage.ownedCars, ['q-sports'], 'unparseable save: the default car, no throw');

    let heat = 4; let cleared = 0;
    garage.heat = () => heat;
    garage.onRepair = () => { if (heat > 0 && heat < 3) { cleared++; heat = 0; return true; } return false; };
    assert.equal(garage.payAndSpray(), false, 'four stars: they know the driver');
    assert.equal(jobs.cash, 1000, 'and nothing is charged');
    assert.equal(cleared, 0);

    heat = 2;
    assert.equal(garage.payAndSpray(), true);
    assert.equal(jobs.cash, 1000 - REPAIR, 'one price: the garage repair price');
    assert.equal(cleared, 1, 'routed through the same onRepair gate main wires');
    assert.equal(repaired, 1);
    assert.equal(heat, 0);
  } finally {
    if (origStorage) globalThis.localStorage = origStorage; else delete globalThis.localStorage;
  }
});
