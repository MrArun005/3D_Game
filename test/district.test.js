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
  /* Reachability, not an exact count: District#infill adds procedural
     footprints on built blocks, so the total is data.buildings.length plus
     whatever fitted. The invariants that matter are that every AUTHORED
     footprint is still reachable from its block, and that everything added
     stays inside its block and clear of the authored ones. */
  const authored = new Set(data.buildings);
  let seen = 0, infill = 0;
  for (const b of data.blocks) {
    const list = city.buildingsOf(b.id);
    for (const g of list) {
      if (authored.has(g)) { seen++; continue; }
      infill++;
      assert.ok(g.infill, 'unknown footprint that is neither authored nor infill');
      assert.ok(Math.abs(g.x) + g.w / 2 <= b.w / 2 && Math.abs(g.y) + g.d / 2 <= b.h / 2,
        `infill footprint leaves block ${b.id}`);
      for (const a of list) {
        if (a === g || !authored.has(a)) continue;
        const clear = Math.abs(a.x - g.x) >= (a.w + g.w) / 2 || Math.abs(a.y - g.y) >= (a.d + g.d) / 2;
        assert.ok(clear, `infill overlaps an authored footprint on block ${b.id}`);
      }
    }
  }
  assert.equal(seen, data.buildings.length, 'every authored building reachable from its block');
  assert.ok(infill > 500, `infill added ${infill} footprints`);
});

test('the streamer can ask what is nearby', () => {
  const near = city.blocksNear(2100, 1400, 300);
  assert.ok(near.length > 0 && near.length < data.blocks.length, `nearby ${near.length}`);
});
