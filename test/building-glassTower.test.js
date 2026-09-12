import test from 'node:test';
import assert from 'node:assert/strict';
import { build, STYLE, GROUND_H, FLOOR_H, MIN_FLOORS, MAX_FLOORS } from '../src/world/buildings/glassTower.js';
import { MAT_KEYS } from '../src/world/artKit.js';

const triCount = (geo) => (geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3);
const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
const footprint = (seed) => ({ hw: 7 + (seed % 5) * 2.5, hd: 8 + (seed % 3) * 3, h: 40 + seed * 2.5 });

test('glassTower: every part carries the artKit attribute set and a known material key', () => {
  assert.equal(STYLE, 'glassTower');
  for (const seed of seeds) {
    const { hw, hd, h } = footprint(seed), b = build(seed, hw, hd, h);
    /* Parts are merged per material key before return, so the count is 5-8 by
       design -- it is no longer a proxy for detail. Assert the TRIANGLES instead,
       which is what the old count stood in for. */
    assert.ok(b.parts.reduce((n, { geo }) => n + triCount(geo), 0) > 800, `seed ${seed}: parts ${b.parts.length}`);
    for (const { geo, mat } of b.parts) {
      assert.ok(MAT_KEYS.includes(mat), `seed ${seed}: material ${mat}`);
      for (const a of ['position', 'normal', 'uv', 'color', 'emit']) assert.ok(geo.attributes[a], `seed ${seed}: ${mat} lacks ${a}`);
    }
  }
});

test('glassTower: stays inside the footprint (0.6 m overhang), snaps to storeys, under 6,000 triangles', () => {
  for (const seed of seeds) {
    const { hw, hd, h } = footprint(seed), b = build(seed, hw, hd, h);
    let tris = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity;
    for (const { geo } of b.parts) {
      tris += triCount(geo);
      const p = geo.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) {
        minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
        minZ = Math.min(minZ, p[i + 2]); maxZ = Math.max(maxZ, p[i + 2]);
        minY = Math.min(minY, p[i + 1]);
      }
    }
    assert.ok(tris < 6000 && tris > 800, `seed ${seed}: ${tris} triangles`);
    assert.equal(tris, b.tris, 'reported tri count');
    assert.ok(maxX <= hw + 0.6 && minX >= -hw - 0.6, `seed ${seed}: x ${minX} .. ${maxX} for hw ${hw}`);
    assert.ok(maxZ <= hd + 0.6 && minZ >= -hd - 0.6, `seed ${seed}: z ${minZ} .. ${maxZ} for hd ${hd}`);
    assert.ok(minY >= -1e-6, `seed ${seed}: nothing below ground (${minY})`);
    assert.ok(b.floors >= MIN_FLOORS && b.floors <= MAX_FLOORS, `seed ${seed}: floors ${b.floors}`);
    assert.ok(Math.abs(b.height - (GROUND_H + (b.floors - 1) * FLOOR_H)) < 1e-9, `seed ${seed}: height ${b.height} off the storey grid`);
    assert.ok(b.boards.length >= 1 && b.boards.every((s) => s.w > 0 && s.h > 0), 'a fascia board over the entrance');
    assert.ok(b.lamps.length >= 3 && b.lamps.some((l) => l.colour === 0xfff1d6), 'canopy downlights');
    const lit = b.parts.filter((p) => p.mat === 'emit').reduce((n, { geo }) => n + triCount(geo), 0);
    assert.ok(lit > 40, `seed ${seed}: something glows at night (${lit} emissive triangles)`);
  }
});

test('glassTower: the same seed builds the same tower; another seed a different one', () => {
  const a = build(7, 10, 9, 60), b = build(7, 10, 9, 60), c = build(8, 10, 9, 60);
  assert.equal(a.parts.length, b.parts.length);
  for (let i = 0; i < a.parts.length; i++) {
    assert.equal(a.parts[i].mat, b.parts[i].mat);
    assert.deepEqual(Array.from(a.parts[i].geo.attributes.position.array), Array.from(b.parts[i].geo.attributes.position.array));
  }
  assert.deepEqual(a.boards, b.boards); assert.deepEqual(a.lamps, b.lamps);
  assert.ok(a.tris !== c.tris || a.parts.length !== c.parts.length, 'different seed, different tower');
});
