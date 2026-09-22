import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { District } from '../src/world/district.js';
import { useDistrict, surfaceAt } from '../src/world/metrics.js';

const d = new District(JSON.parse(fs.readFileSync('public/halstead-bay.district.json', 'utf8')));

test('blockTypeAt finds the block a point is in', () => {
  const park = d.blocks.find((b) => b.type === 'park');
  assert.equal(d.blockTypeAt(park.x, park.y), 'park');
  assert.equal(d.blockTypeAt(-5000, -5000), null);
});

test('off-road grip follows the ground: grass in a park, gravel in a yard, road unchanged', () => {
  useDistrict(d);
  const park = d.blocks.find((b) => b.type === 'park' && d.roadDepth(b.x, b.y) > 6);
  const yard = d.blocks.find((b) => b.type === 'yard' && d.roadDepth(b.x, b.y) > 6);
  assert.ok(park && yard, 'fixture blocks exist');
  assert.equal(surfaceAt(park.x, park.y).grip, 0.52);
  assert.equal(surfaceAt(yard.x, yard.y).grip, 0.60);
  const n = d.graph.nodes[0];
  assert.equal(surfaceAt(n.x, n.y).grip, 1.0, 'a junction is tarmac');
  useDistrict(null);
});
