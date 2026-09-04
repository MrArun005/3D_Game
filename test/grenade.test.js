import test from 'node:test';
import assert from 'node:assert/strict';
import { launchVelocity, stepBody, blastFalloff, FUSE_S } from '../src/game/grenade.js';

test('a level throw is lofted a little and goes forward at throw speed', () => {
  const v = launchVelocity(1, 0, 0);
  assert.ok(Math.abs(v.vx - 14) < 1e-9 && Math.abs(v.vz) < 1e-9);
  assert.ok(v.vy > 2.5 && v.vy < 3.5, 'about 12 degrees of loft');
});

test('the body flies, bounces once keeping a third, rolls to a stop, and the fuse ends it at 2.2 s', () => {
  const b = { x: 0, y: 1.5, z: 0, ...launchVelocity(1, 0, 0), t: 0 };
  let bounced = false, done = false, minVyAfterGround = 0;
  for (let i = 0; i < 400 && !done; i++) {
    const vyBefore = b.vy;
    done = stepBody(b, 1 / 120, 0);
    if (b.y <= 0.081 && vyBefore < -0.8 && b.vy > 0) { bounced = true; minVyAfterGround = b.vy; }
  }
  assert.ok(bounced, 'it hit the ground and came back up');
  assert.ok(minVyAfterGround < 3, 'the bounce keeps only a fraction');
  assert.ok(done, 'the fuse went off');
  assert.ok(Math.abs(b.t - FUSE_S) < 0.02);
  assert.ok(b.x > 8 && b.x < 30, `it travelled a throw's distance, got ${b.x.toFixed(1)} m`);
});

test('blast falloff is 1 at the centre, 0 at the edge, and quadratic between', () => {
  assert.equal(blastFalloff(0, 6), 1);
  assert.equal(blastFalloff(6, 6), 0);
  assert.equal(blastFalloff(9, 6), 0);
  assert.ok(Math.abs(blastFalloff(3, 6) - 0.25) < 1e-9);
});
