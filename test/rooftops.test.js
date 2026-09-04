import test from 'node:test';
import assert from 'node:assert/strict';
import { pickRooftops } from '../src/game/policeAi.js';

const roofs = [
  { x: 20, z: 0, h: 60 },    // too close
  { x: 80, z: 0, h: 70 },    // good, tallest
  { x: 90, z: 10, h: 65 },   // good but within 40 m of the tallest: skipped
  { x: 0, z: 100, h: 40 },   // good, second
  { x: 60, z: 60, h: 12 },   // too low
  { x: 300, z: 0, h: 90 },   // too far
];

test('marksmen take the two tallest roofs in range, spread apart', () => {
  const p = pickRooftops(roofs, 0, 0);
  assert.equal(p.length, 2);
  assert.equal(p[0].h, 70);
  assert.equal(p[1].h, 40, 'the 65 m roof is too close to the 70 m one');
});

test('no roofs in range means no marksmen, not a crash', () => {
  assert.deepEqual(pickRooftops([{ x: 5, z: 5, h: 80 }], 0, 0), []);
  assert.deepEqual(pickRooftops([], 0, 0), []);
});

test('roadblock riflemen stand behind the cruisers, spread across the road, facing the car', async () => {
  const { roadblockPosts } = await import('../src/game/policeAi.js');
  // road runs +x, car approaches from -x; cruisers at x=100
  const posts = roadblockPosts(100, 0, 1, 0, 8);
  assert.equal(posts.length, 2);
  for (const p of posts) { assert.ok(p.x > 100, 'behind the cruisers, further along the road'); assert.ok(Math.abs(p.z) > 1, 'off the centreline'); }
  assert.ok(posts[0].z * posts[1].z < 0, 'one each side');
  const facing = [Math.cos(posts[0].yaw), -Math.sin(posts[0].yaw)];
  assert.ok(facing[0] < -0.9, 'facing back down the road toward the car');
});
