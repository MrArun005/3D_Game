import test from 'node:test';
import assert from 'node:assert/strict';
import { build, STYLE, GROUND_H, FLOOR_H, MIN_FLOORS, MAX_FLOORS } from '../src/world/buildings/officeMidrise.js';
import { MAT_KEYS } from '../src/world/artKit.js';

const tris = (g) => (g.index ? g.index.count / 3 : g.attributes.position.count / 3);
// twenty seeds over a spread of footprints and planner heights
const CASES = Array.from({ length: 20 }, (_, i) => ({ seed: i * 7 + 1, hw: 8 + (i % 6) * 2, hd: 9 + (i % 5) * 2.5, h: 14 + i * 1.6 }));

test(`${STYLE}: every part carries the attribute set, a known material key, and stays inside the footprint`, () => {
  for (const { seed, hw, hd, h } of CASES) {
    const b = build(seed, hw, hd, h);
    /* Parts are merged per material key before return, so the count is 5-8 by
       design -- it is no longer a proxy for detail. Assert the TRIANGLES instead,
       which is what the old count stood in for. */
    assert.ok(b.parts.reduce((n, { geo }) => n + (geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3), 0) > 800, 'triangles');
    let total = 0;
    for (const { geo, mat } of b.parts) {
      assert.ok(MAT_KEYS.includes(mat), `material key ${mat}`);
      for (const a of ['position', 'normal', 'uv', 'color', 'emit']) assert.ok(geo.attributes[a], `${a} attribute`);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        assert.ok(Math.abs(p.getX(i)) <= hw + 0.6 + 1e-6, `x ${p.getX(i)} outside hw ${hw} (${mat})`);
        assert.ok(Math.abs(p.getZ(i)) <= hd + 0.6 + 1e-6, `z ${p.getZ(i)} outside hd ${hd} (${mat})`);
        assert.ok(p.getY(i) >= -1e-6, 'below ground');
      }
      total += tris(geo);
    }
    assert.ok(total <= 3000, `seed ${seed}: ${total} triangles`);
    assert.ok(b.floors >= MIN_FLOORS && b.floors <= MAX_FLOORS, `floors ${b.floors}`);
    assert.ok(Math.abs(b.height - (GROUND_H + (b.floors - 1) * FLOOR_H)) < 1e-9, 'height is whole storeys');
    assert.ok(b.boards.length === 1 && b.boards[0].w >= 1.5, 'the entrance sign board');
    assert.ok(b.lamps.length === 3, 'two canopy downlights and the sign light');
    assert.ok(b.parts.some((p) => p.mat === 'emit'), 'something glows at night');
  }
});

test(`${STYLE}: the same seed builds the same building`, () => {
  const a = build(11, 12, 15, 26), b = build(11, 12, 15, 26);
  assert.equal(a.parts.length, b.parts.length);
  for (let i = 0; i < a.parts.length; i++) {
    assert.equal(a.parts[i].mat, b.parts[i].mat);
    assert.deepEqual(Array.from(a.parts[i].geo.attributes.position.array), Array.from(b.parts[i].geo.attributes.position.array));
  }
  assert.deepEqual(a.boards, b.boards); assert.deepEqual(a.lamps, b.lamps);
  const c = build(12, 12, 15, 26);
  assert.ok(c.parts.length !== a.parts.length || c.boards[0].z !== a.boards[0].z, 'another seed, another building');
});
