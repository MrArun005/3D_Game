import test from 'node:test';
import assert from 'node:assert/strict';
import { streakLamps, CUT } from '../src/world/streaks.js';

const o = { x0: 0, z0: 0, x1: 0, z1: 0, w: 0, h: 0, a: 0 };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('lamps sit at the nose, either side of it, on the mesh lateral (sin yaw, cos yaw)', () => {
  // yaw 0: forward is +X (cos yaw, -sin yaw); camera 40 m ahead
  assert.ok(streakLamps(10, 20, 0, 2.3, 0.55, 50, 20, o));
  assert.ok(near(o.x0, 12.3) && near(o.x1, 12.3), 'both lamps at the nose');
  assert.ok(near(o.z0, 20 - 0.55) && near(o.z1, 20 + 0.55), 'lamps left/right, not fore/aft');
  // yaw 0.7: lamp at mesh-local +Z is x + half*sin(yaw), z + half*cos(yaw) from the nose
  const yaw = 0.7, fx = Math.cos(yaw), fz = -Math.sin(yaw);
  assert.ok(streakLamps(0, 0, yaw, 2.3, 0.55, fx * 40, fz * 40, o));
  const nx = fx * 2.3, nz = fz * 2.3;
  assert.ok(near(o.x1, nx + 0.55 * Math.sin(yaw)) && near(o.z1, nz + 0.55 * Math.cos(yaw)));
  assert.ok(near((o.x1 - o.x0) * fx + (o.z1 - o.z0) * fz, 0), 'lamp pair is perpendicular to forward');
  assert.ok(near(Math.hypot(o.x1 - o.x0, o.z1 - o.z0), 1.1), 'track = 2 x half');
});

test('facing cut-off: straight on streaks long, 60 deg off gets none, behind gets none', () => {
  assert.ok(streakLamps(0, 0, 0, 2.3, 0.55, 40, 0, o));
  assert.ok(o.w >= 7 && o.w <= 8.5 && near(o.a, 1), `head-on at 40 m: w ${o.w} a ${o.a}`);
  const at = (deg, d = 40) => streakLamps(0, 0, 0, 2.3, 0.55, Math.cos(deg * Math.PI / 180) * d, Math.sin(deg * Math.PI / 180) * d, o);
  assert.ok(at(20), 'within 20 deg');
  assert.ok(o.w > 5, 'still long at 20 deg');
  assert.equal(at(60), false, 'a car at 60 deg gets none');
  assert.equal(at(180), false, 'the chase camera behind the hero gets none');
  assert.ok(Math.acos(CUT) * 180 / Math.PI < 60);
  assert.ok(at(Math.acos(CUT) * 180 / Math.PI - 1), 'just inside the cut');
  assert.ok(o.a < 0.15, 'fades in from the cut-off, no pop');
});

test('distance: shrinks when very close, fades out past 100 m, gone under 4 m and over 140 m', () => {
  assert.ok(streakLamps(0, 0, 0, 2.3, 0.55, 30, 0, o)); const w30 = o.w;
  assert.ok(streakLamps(0, 0, 0, 2.3, 0.55, 8, 0, o));
  assert.ok(o.w < w30 * 0.4, `close streak shrinks: ${o.w} vs ${w30}`);
  assert.ok(streakLamps(0, 0, 0, 2.3, 0.55, 120, 0, o));
  assert.ok(o.a > 0.4 && o.a < 0.6, `half faded at 120 m: ${o.a}`);
  assert.equal(streakLamps(0, 0, 0, 2.3, 0.55, 3, 0, o), false);
  assert.equal(streakLamps(0, 0, 0, 2.3, 0.55, 150, 0, o), false);
});
