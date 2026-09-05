import test from 'node:test';
import assert from 'node:assert/strict';
import { FeatureTour } from '../src/game/featureTour.js';

test('FeatureTour initializes with all 8 core feature demo stages', () => {
  const tour = new FeatureTour();
  assert.equal(tour.stages.length, 8, 'Must have 8 feature showcase stages');

  const expectedStages = [
    'tokyo_spawn',
    'headlights',
    'tokyo_drive',
    'bridge_physics',
    'on_foot',
    'arsenal',
    'tank',
    'phone_finish',
  ];

  for (let i = 0; i < expectedStages.length; i++) {
    assert.equal(tour.stages[i].id, expectedStages[i]);
    assert.ok(tour.stages[i].duration > 0, `Stage ${expectedStages[i]} duration must be positive`);
    assert.ok(tour.stages[i].title, `Stage ${expectedStages[i]} must have a title`);
    assert.ok(tour.stages[i].badge, `Stage ${expectedStages[i]} must have a badge`);
  }

  const totalDuration = tour.stages.reduce((acc, s) => acc + s.duration, 0);
  assert.ok(totalDuration >= 50 && totalDuration <= 70, `Total duration should be ~1 minute, got ${totalDuration}`);
});

test('FeatureTour executes stages and steps correctly', () => {
  const events = [];
  const mockCtx = {
    warp: (x, z, yaw) => events.push(`warp:${x},${z}`),
    car: { throttle: 0, brake: 0, headlights: false, headlightMode: 'low' },
    chase: { recentre: () => events.push('recentre'), looking: false, lookYaw: 0, lookPitch: 0 },
    hud: { flash: (msg) => events.push(`hud:${msg}`) },
    stepOutOfVehicle: () => events.push('stepOut'),
    equipWeapon: (kind) => events.push(`equip:${kind}`),
    fireWeapon: () => events.push('fire'),
    throwGrenade: () => events.push('grenade'),
    spawnAndEnterTank: () => { events.push('tank'); return { steer: 0, throttle: 0, fireCannon: () => events.push('cannon') }; },
  };

  const tour = new FeatureTour(mockCtx);
  assert.equal(tour.active, false);

  tour.start();
  assert.equal(tour.active, true);
  assert.equal(tour.stageIdx, 0);
  assert.ok(events.includes('warp:2351.5,1356'), 'Should warp to Little Tokyo on start');

  // Step stage 0 until next stage
  tour.update(tour.stages[0].duration + 0.1);
  assert.equal(tour.stageIdx, 1, 'Should transition to headlights stage');

  tour.stop({ download: false });
  assert.equal(tour.active, false);
});

test('FeatureTour applyInput accurately feeds inputs across stages without allocations', () => {
  const mockCtx = {
    warp: () => {},
    car: { throttle: 0, brake: 0, headlights: false, headlightMode: 'low' },
    chase: { recentre: () => {}, looking: false, lookYaw: 0, lookPitch: 0 },
    hud: { flash: () => {} },
    stepOutOfVehicle: () => {},
    equipWeapon: () => {},
    fireWeapon: () => {},
    throwGrenade: () => {},
    spawnAndEnterTank: () => ({ steer: 0, throttle: 0, fireCannon: () => {} }),
  };

  const tour = new FeatureTour(mockCtx);
  const inputState = { throttle: 0, brake: 0, steer: 0, handbrake: 0, hold: false };

  // When not active, should do nothing
  tour.applyInput(inputState, 0.016);
  assert.equal(inputState.throttle, 0);

  tour.start();
  // Stage 0: tokyo_spawn (parked brake)
  tour.applyInput(inputState, 0.016);
  assert.equal(inputState.brake, 1);
  assert.equal(inputState.throttle, 0);

  // Advance to Stage 2: tokyo_drive
  tour.stageIdx = 2;
  tour.applyInput(inputState, 0.016);
  assert.equal(inputState.throttle, 0.85);
  assert.equal(inputState.brake, 0);

  // Advance to Stage 4: on_foot
  tour.stageIdx = 4;
  tour.stageTime = 2.5; // sprint range
  tour.applyInput(inputState, 0.016);
  assert.equal(inputState.throttle, 1);
  assert.equal(inputState.hold, true);

  // Advance to Stage 6: tank
  tour.stageIdx = 6;
  tour.stageTime = 1.0;
  tour.applyInput(inputState, 0.016);
  assert.equal(inputState.steer, 0.8);
  assert.equal(inputState.throttle, 0.3);

  tour.stop({ download: false });
});
