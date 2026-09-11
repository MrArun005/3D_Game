import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { District } from '../src/world/district.js';
import { FarTraffic } from '../src/world/farTraffic.js';

const district = new District(JSON.parse(readFileSync(new URL('../public/halstead-bay.district.json', import.meta.url))));
const RING = 640;   // (radius 2 + 0.5) * 256
const PX = 2300, PZ = 1400;   // the Little Tokyo spawn

/** Lane-side check: the point must be on tarmac, to the RIGHT of its own segment's centreline, outside the ring, inside FAR. */
function check(ft, i, x, z) {
  const sg = district.segments[ft.seg[i]];
  const px = ft.pos[i * 4 * 3], pz = ft.pos[i * 4 * 3 + 2];      // head L
  const dx = px - x, dz = pz - z;
  // the module gates the car CENTRE; the lamp sits 2.2 m ahead of it, hence the slack
  assert.ok(!(Math.abs(dx) < RING - 3 && Math.abs(dz) < RING - 3), `car ${i} inside the ring`);
  assert.ok(Math.hypot(dx, dz) <= 1503, `car ${i} beyond 1500 m`);
  // signed lateral offset in the travel frame: right of centreline is positive
  const vx = sg.bx - sg.ax, vz = sg.bz - sg.az, l = Math.hypot(vx, vz);
  const ux = ft.dir[i] * vx / l, uz = ft.dir[i] * vz / l;
  const lat = -(px - sg.ax) * uz + (pz - sg.az) * ux;
  assert.ok(lat > 0 && lat < sg.half, `car ${i} lateral ${lat.toFixed(2)} not in the right-hand carriageway (half ${sg.half})`);
  assert.ok(district.tarmacDepth(px, pz) < 0, `car ${i} headlamp off the tarmac`);
}

test('every phantom seeds onto the right-hand lane of a far segment', () => {
  const ft = new FarTraffic(null, district, { count: 220 });
  ft.update(1 / 60, PX, PZ, RING, 1);
  let alive = 0;
  for (let i = 0; i < ft.n; i++) {
    if (ft.seg[i] < 0) continue;
    alive++;
    check(ft, i, PX, PZ);
    assert.ok(ft.speed[i] >= 9 && ft.speed[i] <= 14);
    assert.ok(Math.abs(ft.scl[i * 8] - 1.6) < 1e-6, 'headlamp scale');
    assert.ok(Math.abs(ft.scl[i * 8 + 4] - 0.9) < 1e-6, 'tail scale');
    // headlamps warm, tails red (a car seeded this frame is still black: age 0 fades in)
    assert.ok(ft.col[i * 12] >= ft.col[i * 12 + 2] && ft.col[i * 12 + 6] >= ft.col[i * 12 + 7]);
  }
  assert.ok(alive > 200, `only ${alive} phantoms found a far segment`);
});

test('a phantom moves along its segment at its own speed, in its travel direction', () => {
  const ft = new FarTraffic(null, district, { count: 40 });
  ft.update(0, PX, PZ, RING, 1);
  const i = ft.seg.findIndex((s) => s >= 0);
  const seg = ft.seg[i], s0 = ft.s[i], x0 = ft.pos[i * 12], z0 = ft.pos[i * 12 + 2];
  ft.update(1, PX, PZ, RING, 1);
  if (ft.seg[i] === seg && ft.s[i] > s0) {
    assert.ok(Math.abs(ft.s[i] - s0 - ft.speed[i]) < 1e-3, 'advanced one speed-second');
    const moved = Math.hypot(ft.pos[i * 12] - x0, ft.pos[i * 12 + 2] - z0);
    assert.ok(Math.abs(moved - ft.speed[i]) < 1e-2, `moved ${moved} m for speed ${ft.speed[i]}`);
    const sg = district.segments[seg];
    const along = ((ft.pos[i * 12] - x0) * (sg.bx - sg.ax) + (ft.pos[i * 12 + 2] - z0) * (sg.bz - sg.az)) * ft.dir[i];
    assert.ok(along > 0, 'moved in its own travel direction');
  }
  // headlamps sit ahead of the tails along the travel direction
  const hx = ft.pos[i * 12] - ft.pos[i * 12 + 6], hz = ft.pos[i * 12 + 2] - ft.pos[i * 12 + 8];
  assert.ok(Math.abs(Math.hypot(hx, hz) - 4.2) < 0.2, 'nose to boot is 4.2 m');
});

test('phantoms that reach the end of their segment or fall inside the ring are re-seeded far away', () => {
  const ft = new FarTraffic(null, district, { count: 120 });
  ft.update(0, PX, PZ, RING, 1);
  const before = Int32Array.from(ft.seg);
  // teleport the player onto the phantoms: everything within the ring must move
  const i = ft.seg.findIndex((s) => s >= 0);
  const cx = ft.pos[i * 12], cz = ft.pos[i * 12 + 2];
  ft.update(1 / 60, cx, cz, RING, 1);
  assert.notEqual(ft.seg[i], before[i], 'the car under the player was re-seeded');
  for (let k = 0; k < ft.n; k++) if (ft.seg[k] >= 0) check(ft, k, cx, cz);
  // run the segment out: a big step ends every segment, all re-seed, none is stale
  ft.update(400, cx, cz, RING, 1);
  for (let k = 0; k < ft.n; k++) if (ft.seg[k] >= 0) { check(ft, k, cx, cz); assert.ok(ft.s[k] <= ft.segLen[ft.seg[k]]); }
});

test('by day nothing is simulated and every scale is zero-cost', () => {
  const ft = new FarTraffic(null, district, { count: 10 });
  ft.update(1, PX, PZ, RING, 0);
  assert.ok(ft.seg.every((s) => s < 0), 'no seeding at nightK 0');
  ft.update(1, PX, PZ, RING, 1);
  assert.ok(ft.seg.some((s) => s >= 0));
});
