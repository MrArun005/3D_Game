import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrade, GRADE_PRESETS } from '../src/core/grade.js';
import { interpolateGradeProfile, GameClock } from '../src/game/clock.js';
import { CommandEngine } from '../src/game/commands.js';

test('GRADE_PRESETS contains standard cinematic profiles', () => {
  assert.ok(GRADE_PRESETS.DEFAULT, 'DEFAULT preset exists');
  assert.ok(GRADE_PRESETS.NEON_NOIR, 'NEON_NOIR preset exists');
  assert.ok(GRADE_PRESETS.VINTAGE_70S, 'VINTAGE_70S preset exists');
  assert.ok(GRADE_PRESETS.BLACK_WHITE_NOIR, 'BLACK_WHITE_NOIR preset exists');
  assert.ok(GRADE_PRESETS.BLEACH_BYPASS, 'BLEACH_BYPASS preset exists');
  assert.ok(GRADE_PRESETS.GOLDEN_HOUR, 'GOLDEN_HOUR preset exists');
  assert.equal(GRADE_PRESETS.BLACK_WHITE_NOIR.sat, 0.0, 'B&W preset has zero saturation');
});

test('createGrade no-post fallback provides complete preset and profile API', () => {
  const grade = createGrade(null, null, null, { post: false });

  assert.equal(typeof grade.setGradeProfile, 'function');
  assert.equal(typeof grade.setPreset, 'function');
  assert.equal(typeof grade.cyclePreset, 'function');
  assert.equal(typeof grade.setNight, 'function');
  assert.equal(typeof grade.setHurt, 'function');
  assert.equal(typeof grade.setSpeed, 'function');

  assert.doesNotThrow(() => {
    grade.setGradeProfile({ sat: 1.2, contrast: 0.3 });
    grade.setPreset('NEON_NOIR');
    grade.cyclePreset(1);
    grade.setNight(true);
  });
});

test('interpolateGradeProfile computes smooth diurnal profiles', () => {
  const noon = interpolateGradeProfile(12.0, 'CLEAR');
  const night = interpolateGradeProfile(0.0, 'CLEAR');
  const dusk = interpolateGradeProfile(18.5, 'CLEAR');
  const dawn = interpolateGradeProfile(6.0, 'CLEAR');

  assert.ok(noon.sat > 0.9 && noon.sat < 1.15, 'Noon saturation is natural');
  assert.ok(night.sat > noon.sat, 'Night saturation is elevated for neon vibrancy');
  assert.ok(night.bloomStrength > noon.bloomStrength, 'Night bloom is stronger than noon');

  // Weather modifier checks
  const overcast = interpolateGradeProfile(12.0, 'OVERCAST');
  assert.ok(overcast.sat < noon.sat, 'Overcast desaturates the scene');
  assert.ok(overcast.contrast < noon.contrast, 'Overcast softens shadow contrast');

  const storm = interpolateGradeProfile(0.0, 'STORM');
  assert.ok(storm.vignette > night.vignette, 'Storm deepens peripheral vignette');
  assert.ok(storm.contrast > night.contrast, 'Storm boosts wet road specular contrast');
});

test('GameClock update continuously feeds dynamic profile to grade', () => {
  let lastProfile = null;
  const mockGrade = {
    setGradeProfile(p) { lastProfile = p; },
    setNight() {},
  };

  const clock = new GameClock({ startHour: 15.0 });
  clock.update(0.1, { grade: mockGrade });

  assert.ok(lastProfile !== null, 'Clock pushed profile to grade');
  assert.equal(typeof lastProfile.sat, 'number');
  assert.equal(typeof lastProfile.contrast, 'number');
  assert.ok(Array.isArray(lastProfile.shadowTint), 'shadowTint is an array');
});

test('CommandEngine executes /grade commands successfully', () => {
  const posts = [];
  const mockChat = {
    post(channel, msg) { posts.push({ channel, msg }); }
  };

  let activePreset = 'DEFAULT';
  const mockGrade = {
    get currentPreset() { return activePreset; },
    get presetDetails() { return GRADE_PRESETS[activePreset]; },
    get presets() { return GRADE_PRESETS; },
    setPreset(p) { activePreset = p; return p; },
    cyclePreset() { activePreset = 'NEON_NOIR'; return activePreset; },
  };

  const engine = new CommandEngine({
    chat: mockChat,
    grade: mockGrade,
  });

  // /grade list
  engine.execute('/grade list');
  assert.ok(posts.some(p => p.msg.includes('Available:')));

  // /grade NEON_NOIR
  engine.execute('/grade NEON_NOIR');
  assert.equal(activePreset, 'NEON_NOIR');

  // /grade cycle
  engine.execute('/grade cycle');
  assert.ok(posts.some(p => p.msg.includes('Color grade swapped to:')));

  // /grade default
  engine.execute('/grade default');
  assert.equal(activePreset, 'DEFAULT');
});
