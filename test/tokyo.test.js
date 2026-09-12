import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTokyoBuilding, frontRotation, GROUND_H, FLOOR_H } from '../src/world/tokyo.js';
import { PRESETS } from '../src/game/photo.js';

function emitBands(geo) {
  const em = geo.attributes.emit.array;
  let windowish = 0, neonish = 0;
  for (let i = 0; i < em.length; i += 3) {
    const m = em[i] + em[i + 1] + em[i + 2];
    if (m > 1.6) neonish += m;
    else if (m > 0.04) windowish += m;
  }
  return { windowish, neonish };
}

test('a Tokyo building is one geometry with colour, emit and UVs, under 1600 triangles, snapped to storeys', () => {
  const b = buildTokyoBuilding(17, 5, 7, 24);
  for (const a of ['position', 'normal', 'uv', 'color', 'emit']) assert.ok(b.geo.attributes[a], `${a} attribute`);
  assert.ok(b.tris > 200 && b.tris < 1600, `triangles ${b.tris}`);
  assert.ok(Math.abs(b.height - (GROUND_H + (b.floors - 1) * FLOOR_H)) < 1e-9, 'height is whole storeys');
  assert.ok(b.boards.length >= 1 && b.boards.length <= 30, `sign boards ${b.boards.length}`);
  const em = b.geo.attributes.emit.array; let lit = 0; for (let i = 0; i < em.length; i += 3) if (em[i] + em[i + 1] + em[i + 2] > 0) lit++;
  assert.ok(lit > 0, 'something glows at night');
});

test('neon and shopfronts out-glow the office windows (cover art: neon owns the night)', () => {
  let neon = 0, windows = 0;
  for (let s = 1; s <= 40; s++) {
    const { windowish, neonish } = emitBands(buildTokyoBuilding(s * 97, 6, 8, 28).geo);
    neon += neonish; windows += windowish;
  }
  assert.ok(neon > windows * 1.15, `neon ${neon.toFixed(0)} vs windows ${windows.toFixed(0)} — windows still own the night`);
});

test('a window is a dim hole, a neon part is HDR', () => {
  const em = buildTokyoBuilding(17, 6, 8, 28).geo.attributes.emit.array;
  let maxDim = 0, maxHot = 0;
  for (let i = 0; i < em.length; i += 3) {
    const m = Math.max(em[i], em[i + 1], em[i + 2]);
    if (m > 1.0) maxHot = Math.max(maxHot, m);
    else if (m > 0.02 && m < 0.35) maxDim = Math.max(maxDim, m);
  }
  assert.ok(maxDim < 0.30, `window-class emit ${maxDim.toFixed(2)} still as bright as a tube`);
  assert.ok(maxHot > 1.5, `neon-class emit ${maxHot.toFixed(2)} too timid to bloom`);
});

test('kanban lamps are coloured neon the light pool can prefer', () => {
  let n = 0;
  for (let s = 1; s <= 20; s++) {
    const b = buildTokyoBuilding(s * 13, 6, 8, 30);
    for (const lp of b.lamps ?? []) {
      if (lp.neon && lp.colour && lp.intensity > 60 && lp.range > 26) n++;
    }
  }
  assert.ok(n >= 8, `neon heads across 20 buildings: ${n}`);
});

test('the same seed builds the same building; another seed a different one', () => {
  const a = buildTokyoBuilding(3, 6, 6, 18), b = buildTokyoBuilding(3, 6, 6, 18), c = buildTokyoBuilding(4, 6, 6, 18);
  assert.equal(a.tris, b.tris); assert.deepEqual(a.boards, b.boards);
  assert.ok(a.tris !== c.tris || a.boards.length !== c.boards.length || a.geo.attributes.color.array[0] !== c.geo.attributes.color.array[0]);
});

test('the front is the side nearest the street: tarmacDepth is a signed distance, negative on the road', () => {
  const probe = (x, z) => (z > 6 ? -2 : 25);                    // the road is at +Z in world; everywhere else is far from any kerb
  const toWorld = (lx, lz) => [lx, lz];                          // no block rotation
  assert.equal(frontRotation(probe, toWorld, 5, 5), -Math.PI / 2, '+Z side -> rotate +X front by -90 degrees');
  const probe2 = (x, z) => (x < -6 ? -1 : 30);
  assert.equal(frontRotation(probe2, toWorld, 5, 5), Math.PI, '-X side');
  const probe3 = (x, z) => (x > 6 ? 4 : 30);                    // no tarmac anywhere: the nearest pavement edge still wins
  assert.equal(frontRotation(probe3, toWorld, 5, 5), 0, '+X side');
});

test('the street builds poles and sagging wires only by Tokyo buildings, and is deterministic', async () => {
  const { buildTokyoStreet, POLE_H } = await import('../src/world/tokyo.js');
  const seg = { ax: 0, az: 0, bx: 120, bz: 0, half: 6 };
  const a = buildTokyoStreet([seg], () => true, 5), b = buildTokyoStreet([seg], () => true, 5), none = buildTokyoStreet([seg], () => false, 5);
  assert.ok(a.parts.length >= 8, `poles + arms: ${a.parts.length}`);
  assert.ok(a.lines.length > 0 && a.lines.length % 6 === 0, 'segment pairs');
  assert.equal(a.lines.length, b.lines.length, 'same seed, same street');
  assert.equal(none.parts.length, 0, 'no Tokyo buildings, no poles');
  let minY = Infinity; for (let i = 1; i < a.lines.length; i += 3) minY = Math.min(minY, a.lines[i]);
  assert.ok(minY > 6 && minY < POLE_H, `wires sag but stay above head height: ${minY.toFixed(2)}`);
});

test('little-tokyo camera looks north up the walk-up street at night', () => {
  const p = PRESETS['little-tokyo'];
  assert.ok(p.hour >= 21, `hour ${p.hour} — this is a night shot`);
  assert.ok(p.look[2] > p.pos[2] + 80, 'looks north along the N-S street, not east along the arterial');
  assert.ok(p.pos[0] > 2320 && p.pos[0] < 2390 && p.pos[2] > 1370, 'stands on the Tokyo street, not the spawn arterial');
});

test('the shrine is one small geometry with a lit lantern window', async () => {
  const { buildShrine } = await import('../src/world/tokyo.js');
  const s = buildShrine(3);
  assert.ok(s.tris > 80 && s.tris < 600, `triangles ${s.tris}`);
  for (const a of ['position', 'uv', 'color', 'emit']) assert.ok(s.geo.attributes[a], a);
  const em = s.geo.attributes.emit.array; let lit = 0; for (let i = 0; i < em.length; i += 3) if (em[i] > 0) lit++;
  assert.ok(lit > 0);
});
