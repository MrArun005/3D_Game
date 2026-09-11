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

/* --- per-channel night tone map + exposure-derived bloom threshold ------- */
import { hableCurve, hableToneMap, HABLE, bloomThresholdFor, NIGHT_EXPOSURE } from '../src/core/grade.js';

const sat = (c) => { const M = Math.max(...c), m = Math.min(...c); return M > 0 ? (M - m) / M : 0; };
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

test('hableCurve is Hable\'s Uncharted 2 polynomial, monotone, white point at W', () => {
  near(hableCurve(0), 0, 1e-12, 'black stays black');
  near(hableCurve(HABLE.W), 0.7251, 1e-3, 'curve(W) is the white-point normaliser');
  assert.equal(hableToneMap([HABLE.W / HABLE.BIAS], 1)[0], 1, 'W maps to exactly white');
  let prev = -1;
  for (let x = 0; x <= 20; x += 0.05) { const y = hableCurve(x); assert.ok(y > prev, `monotone at ${x}`); prev = y; }
});

test('hableToneMap keeps saturated HDR neon saturated where AgX does not (measured numbers)', () => {
  /* AgX at exposure 1.15 (three r185 agxToneMapping ported verbatim, scratch script 2026-09-12):
       (2, 0, 0)       -> (0.966, 0.244, 0.169)  sat 100% -> 83%
       (2.4, 0.3, 0.9) -> (0.887, 0.468, 0.607)  sat  88% -> 47% */
  const red = hableToneMap([2, 0, 0], NIGHT_EXPOSURE);
  near(red[0], 0.925, 0.005, 'red channel');
  assert.equal(red[1], 0); assert.equal(red[2], 0);   // per channel: a zero channel STAYS zero
  assert.equal(sat(red), 1, 'pure red keeps 100% saturation');

  const magenta = hableToneMap([2.4, 0.3, 0.9], NIGHT_EXPOSURE);
  near(magenta[0], 0.970, 0.005, 'r'); near(magenta[1], 0.355, 0.005, 'g'); near(magenta[2], 0.688, 0.005, 'b');
  assert.ok(sat(magenta) > 0.60, `magenta keeps >60% (${sat(magenta).toFixed(3)}); AgX keeps 47%`);

  /* BIAS is solved so the blend does not shift exposure: AgX puts 0.18 grey at 0.239. */
  near(hableToneMap([0.18], NIGHT_EXPOSURE)[0], 0.239, 0.003, 'mid grey matches AgX');
  assert.equal(hableToneMap([50], 1)[0], 1, 'clamps at white');
});

test('bloomThresholdFor keeps the night calibration and scales with exposure', () => {
  assert.equal(bloomThresholdFor(0.85, 1.15), 0.85, 'night 0.85 @ 1.15 is the calibrated point, unchanged');
  near(bloomThresholdFor(0.25, 1.05), 0.2738, 1e-3, 'day 0.25 @ 1.05');
  /* the invariant: HDR threshold * exposure (what the eye sees) is constant */
  for (const e of [0.7, 1.0, 1.05, 1.15, 2.3]) near(bloomThresholdFor(0.85, e) * e, 0.85 * 1.15, 1e-9, `display threshold at ${e}`);
  assert.equal(bloomThresholdFor(0.5, 1.0, 1.0), 0.5, 'explicit reference exposure');
});
