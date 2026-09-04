import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recoilFor, spreadToPixels, rayHitsBox, firstBuildingHit, swayFor, swayPhaseStep, reloadPose, ADS, HIP,
} from '../src/game/shooting.js';
import { WEAPON_KINDS } from '../src/game/weapons.js';

test('every weapon has a recoil pattern and it saturates past the last entry', () => {
  for (const k of WEAPON_KINDS) {
    const a = recoilFor(k, 0), late = recoilFor(k, 11), beyond = recoilFor(k, 40);
    assert.ok(a.pitch > 0, `${k}: first shot must kick up`);
    assert.deepEqual(late, beyond, `${k}: past the pattern it repeats the last entry`);
  }
});

test('rifle drifts right over a burst, shotgun kicks hardest', () => {
  const r0 = recoilFor('rifle', 0), r7 = recoilFor('rifle', 7);
  assert.ok(r7.yaw > r0.yaw, 'rifle yaw should grow to the right through the burst');
  assert.ok(recoilFor('shotgun', 0).pitch > recoilFor('rifle', 0).pitch * 2);
});

test('spread projects to pixels: wider cone, narrower FOV and taller screen all enlarge the gap', () => {
  const base = spreadToPixels(0.02, 60, 900);
  assert.ok(spreadToPixels(0.04, 60, 900) > base, 'wider cone');
  assert.ok(spreadToPixels(0.02, 42, 900) > base, 'ADS FOV magnifies the same cone');
  assert.ok(spreadToPixels(0.02, 60, 1400) > base, 'taller viewport');
  assert.ok(spreadToPixels(0, 60, 900) >= 3, 'never collapses below a visible gap');
});

test('ADS tightens every weapon and slows it down', () => {
  for (const k of WEAPON_KINDS) {
    assert.ok(ADS[k], `${k} needs ADS settings`);
    assert.ok(ADS[k].fov < HIP.fov);
    assert.ok(ADS[k].spread < 1 && ADS[k].speed < 1);
    assert.ok(ADS[k].back < HIP.back, 'camera comes in over the shoulder');
  }
});

const box = { x: 10, z: 0, angle: 0, hw: 2, hd: 2, height: 20 };

test('a ray into a building stops at its face; one that misses passes', () => {
  const t = rayHitsBox(0, 1.4, 0, 1, 0, 0, box);
  assert.ok(Math.abs(t - 8) < 1e-6, `entry face is at x=8, got ${t}`);
  assert.equal(rayHitsBox(0, 1.4, 5, 1, 0, 0, box), Infinity, 'offset ray misses');
  assert.equal(rayHitsBox(0, 25, 0, 1, 0, 0, box), Infinity, 'over the roof');
  assert.equal(rayHitsBox(0, 1.4, 0, -1, 0, 0, box), Infinity, 'pointing away');
});

test('a rotated building is tested in its own frame', () => {
  const rot = { x: 10, z: 0, angle: Math.PI / 4, hw: 2, hd: 0.2, height: 20 };
  // a thin wall turned 45 degrees: a ray along +x hits it, a ray along the wall's length skims past its end
  assert.ok(rayHitsBox(0, 1, 0, 1, 0, 0, rot) < Infinity);
  assert.equal(rayHitsBox(10 - 5, 1, 0 - 5, Math.SQRT1_2, 0, Math.SQRT1_2, { ...rot, hd: 0.01 }) < 8, true);
});

test('a ray starting inside a building is not blocked by that building', () => {
  assert.equal(rayHitsBox(10, 1, 0, 1, 0, 0, box), Infinity);
});

test('firstBuildingHit returns the nearest face within range, else Infinity', () => {
  const near = { x: 5, z: 0, angle: 0, hw: 1, hd: 1, height: 10 };
  const t = firstBuildingHit(0, 1, 0, 1, 0, 0, [box, near], 100);
  assert.ok(Math.abs(t - 4) < 1e-6, `nearest is x=4, got ${t}`);
  assert.equal(firstBuildingHit(0, 1, 0, 1, 0, 0, [box], 3), Infinity, 'out of range');
});

test('sway grows with speed and shrinks to a third in ADS', () => {
  const still = swayFor(0, 1.3, false), walk = swayFor(1.8, 1.3, false), run = swayFor(5.5, 1.3, false);
  assert.ok(Math.abs(walk.dy) > Math.abs(still.dy));
  assert.ok(Math.abs(run.roll) > Math.abs(walk.roll));
  const ads = swayFor(5.5, 1.3, true);
  assert.ok(Math.abs(ads.roll) < Math.abs(run.roll) * 0.4);
  assert.ok(swayPhaseStep(6, 0.016) > swayPhaseStep(0, 0.016), 'strides quicken with speed');
});

test('the reload pose dips in, holds, and comes back up', () => {
  assert.deepEqual(reloadPose(0), { dy: -0, tilt: 0 });
  assert.ok(reloadPose(0.5).dy < -0.1, 'fully down in the middle');
  assert.ok(reloadPose(1).dy > -1e-9 && reloadPose(1).tilt < 1e-9, 'back up at the end');
});

test('moving widens the cone and crouching tightens it', async () => {
  const { movementSpread } = await import('../src/game/shooting.js');
  assert.equal(movementSpread(0, false), 1);
  assert.equal(movementSpread(2, false), 1.25);
  assert.equal(movementSpread(6, false), 1.7);
  assert.ok(movementSpread(0, true) < 1);
});

test('aim assist bends toward a target inside the cone and leaves a wide miss alone', async () => {
  const { aimAssist } = await import('../src/game/shooting.js');
  const near = [{ x: 20, y: 1, z: 0.6 }];       // ~1.7 degrees off the aim
  const d = aimAssist({ x: 1, y: 0, z: 0 }, 0, 1, 0, near, 0.07, 0.55);
  assert.ok(d.z > 0.01 && d.z < 0.03, `eased partway toward the target, got z=${d.z.toFixed(4)}`);
  const far = [{ x: 20, y: 1, z: 6 }];          // ~17 degrees off
  const e = aimAssist({ x: 1, y: 0, z: 0 }, 0, 1, 0, far, 0.07, 0.55);
  assert.equal(e.z, 0, 'outside the cone: untouched');
});
