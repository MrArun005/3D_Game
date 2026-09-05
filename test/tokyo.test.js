import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTokyoBuilding, frontRotation, GROUND_H, FLOOR_H } from '../src/world/tokyo.js';

test('a Tokyo building is one geometry with colour, emit and UVs, under 1600 triangles, snapped to storeys', () => {
  const b = buildTokyoBuilding(17, 5, 7, 24);
  for (const a of ['position', 'normal', 'uv', 'color', 'emit']) assert.ok(b.geo.attributes[a], `${a} attribute`);
  assert.ok(b.tris > 200 && b.tris < 1600, `triangles ${b.tris}`);
  assert.ok(Math.abs(b.height - (GROUND_H + (b.floors - 1) * FLOOR_H)) < 1e-9, 'height is whole storeys');
  assert.ok(b.boards.length >= 1 && b.boards.length <= 5, `sign boards ${b.boards.length}`);
  const em = b.geo.attributes.emit.array; let lit = 0; for (let i = 0; i < em.length; i += 3) if (em[i] + em[i + 1] + em[i + 2] > 0) lit++;
  assert.ok(lit > 0, 'something glows at night');
});

test('the same seed builds the same building; another seed a different one', () => {
  const a = buildTokyoBuilding(3, 6, 6, 18), b = buildTokyoBuilding(3, 6, 6, 18), c = buildTokyoBuilding(4, 6, 6, 18);
  assert.equal(a.tris, b.tris); assert.deepEqual(a.boards, b.boards);
  assert.ok(a.tris !== c.tris || a.boards.length !== c.boards.length || a.geo.attributes.color.array[0] !== c.geo.attributes.color.array[0]);
});

test('the front is the side deepest into tarmac', () => {
  const probe = (x, z) => (z > 6 ? 3 : 0);                      // the road is at +Z in world (the sample sits 8 m out)
  const toWorld = (lx, lz) => [lx, lz];                          // no block rotation
  assert.equal(frontRotation(probe, toWorld, 5, 5), -Math.PI / 2, '+Z side -> rotate +X front by -90 degrees');
  const probe2 = (x, z) => (x < -6 ? 2 : 0);
  assert.equal(frontRotation(probe2, toWorld, 5, 5), Math.PI, '-X side');
});
