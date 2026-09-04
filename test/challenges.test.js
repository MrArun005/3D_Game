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

  // Step 0: Drive to Harbour Point depot (380, -140)
  story.update({ x: 380, z: -140, fwdSpeed: 2 }, 0.016);
  assert.equal(story.stepIdx, 1, 'Should advance to step 1 upon arriving at depot');
  assert.equal(mockTraffic.wanted, 2, 'Heat should escalate to 2 stars');

  // Step 1: Container breached · Lose 2-star heat (120, 240, needZeroHeat: true)
  // Approach target while STILL HOT (wanted = 2)
  story.update({ x: 120, z: 240, fwdSpeed: 2 }, 0.016);
  assert.equal(story.stepIdx, 1, 'Should NOT advance while wanted heat is active');
  assert.equal(markerColor, 0xff3b30, 'Marker should turn warning RED when heat blocks dropoff');

  // Lose the heat (e.g. via Pay n Spray or evading cops)
  mockTraffic.wanted = 0;
  story.update({ x: 120, z: 240, fwdSpeed: 2 }, 0.016);
  assert.equal(story.stepIdx, 2, 'Should advance to safehouse delivery once heat is zero');

  // Step 2: Deliver Camaro to safehouse (-80, 60)
  story.update({ x: -80, z: 60, fwdSpeed: 1 }, 0.016);
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
    points: [{ x: 100, y: 100 }, { x: 300, y: 300 }],
    route: () => {},
    stop: () => {},
    addListener: (type, fn) => { if (type === 'finish') finishCallback = fn; },
  };

  const mockTraffic = { wanted: 0, reportCrime: () => {} };
  const mockHud = {
    flash: () => {},
    setJob: () => {},
    showVictoryBanner: (title, sub, cash) => {
      victoryBanner = { title, sub, cash };
    },
  };

  const mockDistrict = {
    blocks: [],
    graph: { nodes: [{ kind: 'cross', x: 100, y: 100 }, { kind: 'tee', x: 300, y: 300 }] },
  };

  const mockAudio = {
    cash: () => {},
    victoryFanfare: () => { fanfarePlayed = true; },
  };

  const jobs = new Jobs(mockMission, mockTraffic, mockHud, mockDistrict, mockAudio);
  assert.equal(typeof finishCallback, 'function', 'Jobs should register finish callback without clobbering');

  // Manually start a courier job
  jobs.job = {
    kind: 'courier',
    pay: 500,
    limit: 60,
    tier: 1,
    a: { x: 100, y: 100 },
    b: { x: 300, y: 300 },
    pickedUp: false,
    t: 0,
  };

  // Reaching pickup (mission index moves to 1)
  mockMission.index = 1;
  jobs.update({ x: 100, z: 100, fwdSpeed: 0 }, 0.016);
  assert.equal(jobs.job.pickedUp, true, 'Package should be aboard');

  // Trigger finish
  finishCallback(25.0);
  assert.equal(jobs.job, null, 'Job should complete');
  assert.equal(jobs.cash >= 500, true, 'Cash should be credited');
  assert.notEqual(victoryBanner, null, 'Victory banner should be displayed');
  assert.equal(fanfarePlayed, true, 'Audio victory fanfare should trigger');
});
