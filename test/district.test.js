import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { District } from '../src/world/district.js';

const data = JSON.parse(readFileSync(new URL('../public/halstead-bay.district.json', import.meta.url)));
const city = new District(data);

test('the index answers from real geometry, not arithmetic', () => {
  // road segments, not graph edges: 264 centrelines flatten to ~750 segments,
  // while the nav graph splits the same lines into ~2900 node-to-node edges
  assert.ok(city.segments.length > 700, `segments ${city.segments.length}`);
  assert.equal(city.graph.edges.length > city.segments.length, true);
  assert.ok(city.grid.size > 100, 'spatial hash populated');
});

test('a point on a road centreline is ON the road', () => {
  // walk every arterial and sample its own centreline
  let checked = 0, onRoad = 0;
  for (const r of data.roads) {
    if (r.class !== 'arterial') continue;
    for (let i = 1; i < r.points.length; i += 7) {
      const [x, z] = r.points[i];
      checked++;
      if (city.roadDepth(x, z) <= 0) onRoad++;
    }
  }
  assert.ok(checked > 50, `sampled ${checked}`);
  assert.equal(onRoad, checked, `${checked - onRoad} centreline points read as off-road`);
});

test('the middle of a city block is OFF the road', () => {
  let checked = 0, offRoad = 0;
  for (const b of data.blocks) {
    if (b.w < 60 || b.h < 50) continue;      // only blocks big enough to have a middle
    checked++;
    if (city.roadDepth(b.x, b.y) > 0) offRoad++;
  }
  assert.ok(checked > 100, `sampled ${checked}`);
  assert.ok(offRoad / checked > 0.95, `only ${offRoad}/${checked} block centres read as off-road`);
});

test('far outside the city is firmly off-road', () => {
  assert.ok(city.roadDepth(-5000, -5000) > 20);
});

test('blocks and their buildings join by id', () => {
  const withBuildings = data.blocks.filter((b) => city.buildingsOf(b.id).length > 0);
  assert.ok(withBuildings.length > 200, `${withBuildings.length} blocks have buildings`);
  const total = data.blocks.reduce((n, b) => n + city.buildingsOf(b.id).length, 0);
  assert.equal(total, data.buildings.length, 'every building reachable from its block');
});

test('the streamer can ask what is nearby', () => {
  const near = city.blocksNear(2100, 1400, 300);
  assert.ok(near.length > 0 && near.length < data.blocks.length, `nearby ${near.length}`);
});
