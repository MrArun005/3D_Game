import test from 'node:test';
import assert from 'node:assert/strict';
import { build, STYLE, GROUND_H, FLOOR_H, MIN_FLOORS, MAX_FLOORS } from '../src/world/buildings/warehouse.js';
import { MAT_KEYS } from '../src/world/artKit.js';

const tris = (g) => (g.index ? g.index.count / 3 : g.attributes.position.count / 3);
// twenty seeds over a spread of footprints and planner heights (the tall ones must clamp to MAX_FLOORS)
const CASES = Array.from({ length: 20 }, (_, i) => ({ seed: i + 1, hw: 6 + (i % 5) * 2, hd: 7 + (i % 4) * 2.5, h: 10 + i * 1.2 }));

test('warehouse: every part carries the attribute set and a known material key', () => {
  assert.equal(STYLE, 'warehouse');
  for (const c of CASES) {
    const b = build(c.seed, c.hw, c.hd, c.h);
    /* Parts are merged per material key before return, so the count is 5-8 by
       design -- it is no longer a proxy for detail. Assert the TRIANGLES instead,
       which is what the old count stood in for. */
    assert.ok(b.parts.reduce((n, { geo }) => n + (geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3), 0) > 800, `seed ${c.seed}: ${b.parts.length} parts`);
    for (const { geo, mat } of b.parts) {
      assert.ok(MAT_KEYS.includes(mat), `material key ${mat}`);
      for (const a of ['position', 'normal', 'uv', 'color', 'emit']) assert.ok(geo.attributes[a], `seed ${c.seed}: ${mat} part lacks ${a}`);
    }
  }
});

test('warehouse: stays inside the footprint plus the 0.6 m overhang, and on the ground', () => {
  for (const c of CASES) {
    const b = build(c.seed, c.hw, c.hd, c.h);
    for (const { geo, mat } of b.parts) {
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        assert.ok(Math.abs(p.getX(i)) <= c.hw + 0.6 + 1e-6 && Math.abs(p.getZ(i)) <= c.hd + 0.6 + 1e-6, `seed ${c.seed}: ${mat} at (${p.getX(i).toFixed(2)}, ${p.getZ(i).toFixed(2)}) outside hw ${c.hw} hd ${c.hd}`);
        assert.ok(p.getY(i) >= -1e-6, `seed ${c.seed}: ${mat} below ground`);
      }
    }
    for (const o of [...b.boards, ...b.lamps]) assert.ok(Math.abs(o.x) <= c.hw + 0.6 && Math.abs(o.z) <= c.hd + 0.6 && o.y > 0, 'boards and lamps sit on the building');
    // every lit part (windows, transom, soffit, lanterns) stays under the sooted course + corbels: the top-row arches once ran 0.5 m up into them
    for (const { geo, mat } of b.parts) if (mat === 'emit') { geo.computeBoundingBox(); assert.ok(geo.boundingBox.max.y <= b.height - 0.6 + 1e-6, `seed ${c.seed}: lit part reaches ${geo.boundingBox.max.y.toFixed(2)} into the top band (${b.height})`); }
  }
});

test('warehouse: height snaps to the storey grid within 3-6 storeys', () => {
  for (const c of CASES) {
    const b = build(c.seed, c.hw, c.hd, c.h);
    assert.ok(b.floors >= MIN_FLOORS && b.floors <= MAX_FLOORS, `floors ${b.floors}`);
    assert.ok(Math.abs(b.height - (GROUND_H + (b.floors - 1) * FLOOR_H)) < 1e-9, `height ${b.height} off the grid`);
  }
  assert.equal(build(1, 8, 8, 5).floors, MIN_FLOORS, 'a planner height below the minimum clamps up');
  assert.equal(build(1, 8, 8, 60).floors, MAX_FLOORS, 'a tall planner height clamps down');
});

test('warehouse: under 3,000 triangles, and it has a marquee board, lanterns and something lit', () => {
  for (const c of CASES) {
    const b = build(c.seed, c.hw, c.hd, c.h);
    const t = b.parts.reduce((n, p) => n + tris(p.geo), 0);
    assert.ok(t <= 3000, `seed ${c.seed} (hw ${c.hw}, hd ${c.hd}, ${b.floors} floors): ${t} triangles`);
    assert.ok(b.boards.length >= 1 && b.boards.length <= 3, `boards ${b.boards.length}`);
    assert.ok(b.boards[0].w >= 5 && b.boards[0].w <= 6.2 && b.boards[0].h === 1.1 && b.boards[0].yaw === Math.PI / 2, 'marquee board ~6 x 1.1 facing the street');
    assert.equal(b.lamps.length, 2, 'two wall lanterns');
    for (const l of b.lamps) assert.equal(l.colour, 0xffb060);
    let lit = 0;
    for (const { geo, mat } of b.parts) if (mat === 'emit') { const e = geo.attributes.emit.array; for (let i = 0; i < e.length; i += 3) if (e[i] > 0) lit++; }
    assert.ok(lit > 0, 'windows glow at night');
  }
});

test('warehouse: deterministic -- the same seed twice is byte-identical, another seed differs', () => {
  const a = build(7, 10, 12, 20), b = build(7, 10, 12, 20), c = build(8, 10, 12, 20);
  assert.equal(a.parts.length, b.parts.length);
  for (let i = 0; i < a.parts.length; i++) {
    assert.equal(a.parts[i].mat, b.parts[i].mat);
    assert.deepEqual(Array.from(a.parts[i].geo.attributes.position.array), Array.from(b.parts[i].geo.attributes.position.array));
    assert.deepEqual(Array.from(a.parts[i].geo.attributes.emit.array), Array.from(b.parts[i].geo.attributes.emit.array));
  }
  assert.deepEqual(a.boards, b.boards); assert.deepEqual(a.lamps, b.lamps);
  const emitSum = (r) => r.parts.reduce((n, p) => n + (p.mat === 'emit' ? p.geo.attributes.emit.array.reduce((x, y) => x + y, 0) : 0), 0);
  assert.notEqual(emitSum(a), emitSum(c), 'a different seed lights different windows');
});
