import test from 'node:test';
import assert from 'node:assert/strict';
import { StoryManager, STORY_MISSIONS } from '../src/game/storyMissions.js';
import { Jobs } from '../src/game/jobs.js';

test('StoryManager enforces zero-heat dropoff and awards victory banner upon safe completion', () => {
  let flashed = [];
  let victoryBanner = null;
  let cashSoundPlayed = false;
  let fanfarePlayed = false;
  let markerColor = null;

  const mockMission = {
    active: true,
    route: (pts, label) => {},
    stop: (reason) => {},
    setMarkerColor: (hex) => { markerColor = hex; },
    addListener: (type, fn) => {},
  };

  const mockTraffic = { wanted: 0 };

  const mockHud = {
    flash: (msg) => flashed.push(msg),
    showVictoryBanner: (title, sub, cash) => {
      victoryBanner = { title, sub, cash };
    },
  };

  let garageCash = 0;
  const mockGarage = {
    addCash: (amount) => { garageCash += amount; },
  };

  const mockAudio = {
    cash: () => { cashSoundPlayed = true; },
    victoryFanfare: () => { fanfarePlayed = true; },
  };

  const story = new StoryManager(mockMission, mockTraffic, mockHud, mockGarage, mockAudio);
  assert.equal(story.startMission('heist_1', { x: 0, z: 0 }), true);
  assert.equal(story.stepIdx, 0);

  // Step 0: Drive to Harbour Point depot (2156, 2436)
  story.update({ x: 2156, z: 2436, fwdSpeed: 2 }, 0.016);
  assert.equal(story.stepIdx, 1, 'Should advance to step 1 upon arriving at depot');
  assert.equal(mockTraffic.wanted, 2, 'Heat should escalate to 2 stars');

  // Step 1: Container breached · Lose 2-star heat (1163, 1864, needZeroHeat: true)
  // Approach target while STILL HOT (wanted = 2)
  story.update({ x: 1163, z: 1864, fwdSpeed: 2 }, 0.016);
  assert.equal(story.stepIdx, 1, 'Should NOT advance while wanted heat is active');
  assert.equal(markerColor, 0xff3b30, 'Marker should turn warning RED when heat blocks dropoff');

  // Lose the heat (e.g. via Pay n Spray or evading cops)
  mockTraffic.wanted = 0;
  story.update({ x: 1163, z: 1864, fwdSpeed: 2 }, 0.016);
  assert.equal(story.stepIdx, 2, 'Should advance to safehouse delivery once heat is zero');

  // Step 2: Deliver Camaro to safehouse (1387, 1092)
  story.update({ x: 1387, z: 1092, fwdSpeed: 1 }, 0.016);
  assert.equal(story.active, null, 'Mission should complete after final safehouse delivery');
  assert.equal(garageCash, 7500, 'Heist 1 payout should be deposited into garage');
  assert.notEqual(victoryBanner, null, 'Victory banner should be displayed on HUD');
  assert.equal(victoryBanner.cash, 7500);
  assert.equal(fanfarePlayed, true, 'Audio victory fanfare should trigger');
});

test('Jobs dispatches contracts, handles pickup boarding, and rewards completion with victory fanfare', () => {
  let victoryBanner = null;
  let fanfarePlayed = false;

  let finishCallback = null;
  const mockMission = {
    index: 0,
    active: false,
    route: () => {},
    stop: () => {},
    addListener: (type, fn) => { finishCallback = fn; },
  };

  const mockTraffic = { wanted: 0, reportCrime: () => {} };
  const mockHud = { flash: () => {}, showVictoryBanner: (t, s, c) => { victoryBanner = { t, s, c }; }, setJob: () => {} };
  const mockDistrict = {
    blocks: [{ x: 300, y: 300, district: 'KINGSWAY' }],
    graph: { nodes: [{ kind: 'cross', x: 200, y: 150 }, { kind: 'tee', x: 450, y: 350 }] },
  };
  const mockAudio = {
    cash: () => {},
    victoryFanfare: () => { fanfarePlayed = true; },
  };

  const jobs = new Jobs(mockMission, mockTraffic, mockHud, mockDistrict, mockAudio);
  jobs.toggle({ x: 0, z: 0 });
  assert.notEqual(jobs.job, null);

  // Pick up fare at point A
  mockMission.index = 1;
  jobs.update({ x: 200, z: 150, fwdSpeed: 0.5 }, 0.016);
  assert.equal(jobs.job.pickedUp, true);

  // Complete contract at dropoff
  if (finishCallback) finishCallback(12.5);
  assert.equal(jobs.job, null);
  assert.notEqual(victoryBanner, null);
  assert.equal(fanfarePlayed, true);
});

test('StoryManager and Jobs automatically auto-map GPS waypoint to challenge target upon selection', () => {
  let waypoint = null;
  const mockNav = {
    setWaypoint: (x, z) => { waypoint = { x, z }; },
    clearWaypoint: () => { waypoint = null; },
    lastTarget: 'old',
  };

  const mockMission = {
    route: () => {},
    stop: () => {},
    setMarkerColor: () => {},
    addListener: () => {},
  };

  const mockTraffic = { wanted: 0, reportCrime: () => {} };
  const mockHud = { flash: () => {}, showVictoryBanner: () => {}, setJob: () => {} };
  const mockGarage = { addCash: () => {} };

  const story = new StoryManager(mockMission, mockTraffic, mockHud, mockGarage, null, mockNav);
  story.startMission('heist_1', { x: 0, z: 0 });

  // Step 0 target is Harbour Point depot (2156, 2436)
  assert.deepEqual(waypoint, { x: 2156, z: 2436 }, 'Selecting challenge must auto-map navigation to target');
  assert.equal(mockNav.lastTarget, null, 'Should reset lastTarget to force instant route calculation');

  // Advance to step 1 (1163, 1864)
  story.update({ x: 2156, z: 2436, fwdSpeed: 1 }, 0.016);
  assert.deepEqual(waypoint, { x: 1163, z: 1864 }, 'Advancing challenge step must auto-map to next objective');

  // Abandon mission clears waypoint
  story.abandon();
  assert.equal(waypoint, null, 'Abandoning challenge must clear auto-mapped waypoint');

  // Jobs auto-mapping
  const mockDistrict = {
    blocks: [],
    graph: { nodes: [{ kind: 'cross', x: 200, y: 150 }, { kind: 'tee', x: 450, y: 350 }] },
  };
  const jobs = new Jobs(mockMission, mockTraffic, mockHud, mockDistrict, null, mockNav);
  jobs.toggle({ x: 0, z: 0 });
  assert.notEqual(waypoint, null, 'Taking a job contract must auto-map navigation waypoint');

  jobs.toggle({ x: 0, z: 0 }); // abandon
  assert.equal(waypoint, null, 'Abandoning job must clear GPS waypoint');
});

test('Heist II finishes at Steelgate Warehouse inside Steelgate, not outside city gate', () => {
  const heist2 = STORY_MISSIONS.find((m) => m.id === 'heist_2');
  assert.ok(heist2, 'Heist 2 must exist');
  const finishStep = heist2.steps[heist2.steps.length - 1];
  assert.equal(finishStep.text, 'STASH WEAPONS AT STEELGATE WAREHOUSE');
  // Steelgate X is 3323..4019, Z is 1020..1661
  assert.ok(finishStep.target.x >= 3300 && finishStep.target.x <= 4100, 'Finishing target must be inside Steelgate');
  assert.ok(finishStep.target.z >= 1000 && finishStep.target.z <= 1700, 'Finishing target must be inside Steelgate');
  assert.notEqual(finishStep.target.x, -350, 'Must NOT be at dummy origin -350');
  assert.notEqual(finishStep.target.z, -180, 'Must NOT be at dummy origin -180');
});

test('Races complete checkpoints at full speed without requiring stopping', () => {
  const mockMission = {
    route: () => {},
    stop: () => {},
    setMarkerColor: () => {},
    setRadius: () => {},
  };
  const mockHud = { flash: () => {}, showVictoryBanner: () => {} };
  const mockGarage = { addCash: () => {} };

  const story = new StoryManager(mockMission, { wanted: 0 }, mockHud, mockGarage, null, null);
  story.startMission('race_1', { x: 2350, z: 1350 });

  assert.equal(story.stepIdx, 0);
  const step0 = story.active.steps[0];

  // Blasting through checkpoint at 50 m/s (180 km/h)
  story.update({ x: step0.target.x, z: step0.target.z, fwdSpeed: 50 }, 0.016);
  assert.equal(story.stepIdx, 1, 'Race checkpoint must trigger and complete even at high cruising speed');
});

test('Jobs grants one-time $50,000 test funds to player and persists flag', () => {
  const store = {};
  const mockStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
  };

  const origStorage = globalThis.localStorage;
  globalThis.localStorage = mockStorage;

  try {
    const mockMission = { addListener: () => {} };
    const mockTraffic = {};
    const mockHud = { setJob: () => {}, flash: () => {} };
    const mockDistrict = { blocks: [], graph: { nodes: [] } };

    // First initialization: grants $50,000
    const jobs1 = new Jobs(mockMission, mockTraffic, mockHud, mockDistrict);
    assert.equal(jobs1.cash, 50000, 'First startup should grant $50,000 test funds');
    assert.equal(store['hb.grant_50k'], '1', 'Should set one-time grant flag');
    assert.equal(store['hb.cash'], '50000', 'Should persist $50,000 cash balance');

    // Second initialization: does not double grant
    const jobs2 = new Jobs(mockMission, mockTraffic, mockHud, mockDistrict);
    assert.equal(jobs2.cash, 50000, 'Second startup should retain $50,000 without double-granting');
  } finally {
    if (origStorage) globalThis.localStorage = origStorage;
    else delete globalThis.localStorage;
  }
});

test('Tank driver and multi-vehicle states complete story mission checkpoints', () => {
  const mockMission = {
    route: () => {},
    stop: () => {},
    setMarkerColor: () => {},
    setRadius: () => {},
  };
  const mockHud = { flash: () => {}, showVictoryBanner: () => {} };
  const mockGarage = { addCash: () => {} };

  const story = new StoryManager(mockMission, { wanted: 0 }, mockHud, mockGarage, null, null);
  story.startMission('heist_2', { x: 0, z: 0 });

  assert.equal(story.stepIdx, 0);
  const step0 = story.active.steps[0];

  // Tank vehicle state: speed = 4, vx = 2, vz = 2 (no fwdSpeed)
  const tankVehicleState = {
    x: step0.target.x,
    z: step0.target.z,
    speed: 4,
    vx: 2,
    vz: 2,
  };

  story.update(tankVehicleState, 0.016);
  assert.equal(story.stepIdx, 1, 'Tank vehicle should successfully secure the checkpoint');
});

test('Mission route with isStory=true does not auto-advance index or stop the marker prematurely', async () => {
  const { Mission } = await import('../src/game/mission.js');
  const scene = { add: () => {} };
  const mockDistrict = { graph: { nodes: [] }, blocks: [] };
  const mission = new Mission(scene, mockDistrict);

  mission.route([{ x: 100, z: 100 }], 'STORY CHECKPOINT', true);
  assert.equal(mission.isStory, true);
  assert.equal(mission.active, true);
  assert.equal(mission.marker.visible, true);

  // Car drives directly inside the ring (dist = 0)
  mission.update({ x: 100, z: 100 }, 0.016);

  // Because isStory is true, Mission should NOT advance index or hide marker
  assert.equal(mission.index, 0, 'Index should not advance inside mission.update');
  assert.equal(mission.active, true, 'Mission must remain active');
  assert.equal(mission.marker.visible, true, 'Marker must remain visible');
});
