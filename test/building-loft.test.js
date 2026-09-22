import test from 'node:test';
import assert from 'node:assert/strict';
import { build, STYLE } from '../src/world/buildings/loft.js';
import { MAT_KEYS } from '../src/world/artKit.js';
import { GROUND_H, FLOOR_H } from '../src/world/tokyo.js';
import { mulberry32 } from '../src/core/rng.js';

const tris = (g) => (g.index ? g.index.count / 3 : g.attributes.position.count / 3);
// twenty seeds over row/mixed-use footprints (10-20 m a side) and planner heights of 14-26 m
const cases = [];
for (let s = 1; s <= 20; s++) { const r = mulberry32(s * 97); cases.push([s, 5 + Math.round(r() * 5), 5 + Math.round(r() * 5), 14 + r() * 12]); }

test('loft: every part carries the full attribute set and a known material key', () => {
  assert.equal(STYLE, 'loft');
  for (const [s, hw, hd, h] of cases) {
    const b = build(s, hw, hd, h);
    assert.ok(b.parts.length >= 5 && b.parts.length <= MAT_KEYS.length, `parts ${b.parts.length}`);
    for (const p of b.parts) {
      assert.ok(MAT_KEYS.includes(p.mat), `material ${p.mat}`);
      for (const a of ['position', 'normal', 'uv', 'color', 'emit']) assert.ok(p.geo.attributes[a], `${a} on ${p.mat}`);
    }
  }
});

test('loft: stays inside the footprint + 0.6 m, snaps to 4-7 whole storeys, under 3,000 triangles', () => {
  for (const [s, hw, hd, h] of cases) {
    const b = build(s, hw, hd, h);
    assert.ok(b.floors >= 4 && b.floors <= 7, `floors ${b.floors}`);
    assert.ok(Math.abs(b.height - (GROUND_H + (b.floors - 1) * FLOOR_H)) < 1e-9, 'height is whole storeys');
    let t = 0;
    for (const p of b.parts) {
      t += tris(p.geo);
      const a = p.geo.attributes.position.array;
      for (let i = 0; i < a.length; i += 3) {
        assert.ok(Math.abs(a[i]) <= hw + 0.6 + 1e-6 && Math.abs(a[i + 2]) <= hd + 0.6 + 1e-6, `${p.mat} outside footprint at ${a[i].toFixed(2)},${a[i + 2].toFixed(2)} (hw ${hw} hd ${hd})`);
        assert.ok(a[i + 1] >= -1e-6 && a[i + 1] <= b.height + 3.2, `${p.mat} y ${a[i + 1]}`);
      }
    }
    assert.ok(t > 800 && t <= 3000, `seed ${s} ${2 * hw}x${2 * hd} ${b.floors} floors: ${t} triangles`);
  }
});

test('loft: two shop boards on the street face, warm lamps, lit windows', () => {
  const b = build(7, 8, 7, 20);
  assert.equal(b.boards.length, 2);
  for (const bd of b.boards) { assert.ok(bd.x > 8 + 0.02 && bd.x < 8.6, 'board proud of the pier face on the +X front'); assert.ok(bd.w <= 6 && bd.h === 1.0); assert.equal(bd.yaw, Math.PI / 2); }
  // frontages that round to an EVEN bay count (12, 14, 20 m) must not put a pier through the residents' door at z=0
  for (const hd of [6, 7, 10]) {
    const hw = 7, pl = build(3, hw, hd, 18).parts.find((p) => p.mat === 'plaster').geo.attributes.position.array;
    for (let i = 0; i < pl.length; i += 3) assert.ok(!(Math.abs(pl[i + 2]) <= 0.2 + 1e-6 && pl[i] > hw - 0.31 && pl[i] < hw + 0.03 && pl[i + 1] < 1), `pier on the door line at hd ${hd}`);
  }
  assert.ok(b.lamps.length >= 4 && b.lamps.every((l) => l.colour === 0xffc28a));
  const em = b.parts.find((p) => p.mat === 'emit').geo.attributes.emit.array;
  let lit = 0; for (let i = 0; i < em.length; i += 3) if (em[i] > 0) lit++;
  assert.ok(lit > 0, 'something glows at night');
});

test('loft: the same seed builds the same building; a different seed differs', () => {
  const a = build(11, 7, 9, 19), b = build(11, 7, 9, 19), c = build(12, 7, 9, 19);
  assert.equal(a.parts.length, b.parts.length);
  for (let i = 0; i < a.parts.length; i++) assert.deepEqual(Array.from(a.parts[i].geo.attributes.position.array), Array.from(b.parts[i].geo.attributes.position.array), a.parts[i].mat);
  assert.deepEqual(a.boards, b.boards); assert.deepEqual(a.lamps, b.lamps);
  const pa = a.parts.map((p) => tris(p.geo)).join(','), pc = c.parts.map((p) => tris(p.geo)).join(',');
  assert.notEqual(pa, pc, 'another seed, another building');
});
