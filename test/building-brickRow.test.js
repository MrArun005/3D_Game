import test from 'node:test';
import assert from 'node:assert/strict';
import { build, STYLE } from '../src/world/buildings/brickRow.js';
import { MAT_KEYS } from '../src/world/artKit.js';
import { GROUND_H, FLOOR_H } from '../src/world/tokyo.js';
import { mulberry32 } from '../src/core/rng.js';

const tris = (g) => (g.index ? g.index.count / 3 : g.attributes.position.count / 3);
const verts = (b, mat) => { const p = b.parts.find((q) => q.mat === mat); return p ? p.geo.attributes.position.array : new Float32Array(0); };
/** Does `mat` have a vertex satisfying f(x, y, z)? */
const has = (b, mat, f) => { const a = verts(b, mat); for (let i = 0; i < a.length; i += 3) if (f(a[i], a[i + 1], a[i + 2])) return true; return false; };

// twenty seeds over LONG terraces: 10-18 m deep, 24-44 m of frontage, planner heights 11-19 m.
// These are NOT hero-block sizes -- see `real` below -- they are the long-run case.
const cases = [];
for (let s = 1; s <= 20; s++) { const r = mulberry32(s * 97); cases.push([s, 5 + Math.round(r() * 4), 12 + Math.round(r() * 10), 11 + r() * 8]); }
// the worst case the budget is written against: a terrace across the whole 56 m plot at five storeys
const plot = [];
for (let s = 1; s <= 20; s++) plot.push([s, 7, 28, 17]);
/* The footprints the hero block ACTUALLY has. Measured over
   public/halstead-bay.district.json (2026-09-12): the 589 built OLD QUARTER
   row/mid footprints run 6.9-18.8 m on the long side and 6.9-13.9 m on the
   short one, median ~9.5 x 9.2, and ART_CAP never clips them -- so every one
   of them is a one-to-three house run, not a 44 m terrace. Both street
   orientations, because frontRotation picks whichever face meets the road.
   This is the set that caught fixed 1.5 m window columns hanging a metre of
   stone band off the end of the plot. */
const real = [];
{
  const sides = [6.9, 8.0, 9.2, 10.1, 11.5, 13.9, 18.8];
  let s = 100;
  for (const a of sides) for (const b of sides) if (b <= a) { real.push([s++, a / 2, b / 2, 13], [s++, b / 2, a / 2, 18]); }
}

test('brickRow: every part carries the full attribute set and a known material key', () => {
  assert.equal(STYLE, 'brickRow');
  for (const [s, hw, hd, h] of [...cases, ...real]) {
    const b = build(s, hw, hd, h);
    assert.ok(b.parts.length >= 5 && b.parts.length <= MAT_KEYS.length, `parts ${b.parts.length}`);
    for (const p of b.parts) {
      assert.ok(MAT_KEYS.includes(p.mat), `material ${p.mat}`);
      for (const a of ['position', 'normal', 'uv', 'color', 'emit', 'flick']) assert.ok(p.geo.attributes[a], `${a} on ${p.mat}`);
    }
    assert.deepEqual(b.boards, []);   // a residential terrace carries no shop fascia
  }
});

test('brickRow: stays inside the footprint + 1.2 m, 3-5 storeys on a jittered grid, under 6,000 triangles', () => {
  let min = Infinity, max = 0, sum = 0;
  for (const [s, hw, hd, h] of [...cases, ...plot, ...real]) {
    const b = build(s, hw, hd, h);
    assert.ok(b.floors >= 3 && b.floors <= 5, `floors ${b.floors}`);
    assert.ok(b.units.length >= 1, `units ${b.units.length}`);
    for (const u of b.units) {
      // a run of narrow houses, not one block. 4.6 m is the floor (a real Victorian
      // terrace width); a plot too short to halve stays one wide house, up to 9.2 m.
      assert.ok(u.w >= 4.55 && u.w <= 9.25, `unit frontage ${u.w}`);
      assert.ok(Math.abs(u.floorH - FLOOR_H) <= 0.25 + 1e-9, `storey height ${u.floorH}`);
      assert.ok(Math.abs(u.height - (GROUND_H + (b.floors - 1) * u.floorH)) < 1e-9, 'whole storeys');
    }
    assert.equal(b.height, Math.max(...b.units.map((u) => u.height)));
    let t = 0;
    for (const p of b.parts) {
      t += tris(p.geo);
      const a = p.geo.attributes.position.array;
      for (let i = 0; i < a.length; i += 3) {
        assert.ok(Math.abs(a[i]) <= hw + 1.2 + 1e-6, `${p.mat} x ${a[i].toFixed(2)} (hw ${hw})`);     // stoops, bays and fire escapes lean over the pavement; nothing else may
        assert.ok(Math.abs(a[i + 2]) <= hd + 0.02 + 1e-6, `${p.mat} z ${a[i + 2].toFixed(2)} (hd ${hd})`);
        assert.ok(a[i + 1] >= -1e-6 && a[i + 1] <= b.height + 3.2, `${p.mat} y ${a[i + 1]}`);
      }
    }
    assert.ok(t > 550 && t <= 6000, `seed ${s} ${2 * hd} m frontage, ${b.floors} floors: ${t} triangles`);
    min = Math.min(min, t); max = Math.max(max, t); sum += t;
  }
  assert.ok(max <= 6000, `max ${max}`);
  assert.ok(min > 550 && sum / (cases.length + plot.length + real.length) < 4000);
});

test('brickRow: the eaves line steps, party walls cap the run, one unit in six is rendered', () => {
  const b = build(3, 6, 22, 17);
  assert.ok(new Set(b.units.map((u) => u.height.toFixed(3))).size >= 3, 'every house its own storey height');
  // a party wall stands 0.35 m past the eaves of its neighbours, with a stone cap on top
  const lowest = Math.min(...b.units.map((u) => u.height));
  assert.ok(has(b, 'brick', (x, y) => x > 6 - 0.4 && y > lowest + 0.3), 'party pilaster runs past the eaves');
  assert.ok(has(b, 'concrete', (x, y) => x > 6 - 0.4 && y > lowest + 0.3), 'stone cap on the party wall');
  let rendered = 0, units = 0;
  for (const [s, hw, hd, h] of cases) { const q = build(s, hw, hd, h); units += q.units.length; rendered += q.units.filter((u) => u.rendered).length; }
  assert.ok(rendered / units > 0.06 && rendered / units < 0.3, `rendered share ${(rendered / units).toFixed(2)}`);
  assert.ok(build(3, 6, 22, 17).parts.some((p) => p.mat === 'plaster') || rendered > 0);
});

test('brickRow: stoop steps, a recessed reveal, bays, chimney stacks, fire escapes', () => {
  const b = build(3, 6, 22, 17), hw = 6;
  // stoop: stone slabs below the threshold, each lower one reaching further over the pavement -- at least three step tops
  const st = new Set();
  const c = verts(b, 'concrete');
  for (let i = 0; i < c.length; i += 3) if (c[i] > hw && c[i + 1] > 0.01 && c[i + 1] < 0.7) st.add(c[i + 1].toFixed(3));
  assert.ok(st.size >= 3, `stoop step tops ${[...st].join(',')}`);
  assert.ok(has(b, 'concrete', (x, y) => x > hw + 0.9 && y < 0.3), 'the bottom step reaches the pavement');

  // recessed reveal: brick stands at the elevation face, sashes sit >= 0.15 m behind it (this is the plane change the brief asks for)
  assert.ok(has(b, 'brick', (x) => x > hw - 0.01), 'brick at the elevation face');
  assert.ok(has(b, 'timber', (x, y, z) => x > 0 && x < hw - 0.15 && y > 5), 'sash frame recessed inside the opening');
  assert.ok(has(b, 'concrete', (x, y) => x > hw + 0.05 && y > 5), 'stone lintels and sills stand proud');

  // bays: at least one unit, its glazing 0.7 m in front of the face, its own lead roof
  assert.ok(b.units.filter((u) => u.bay).length >= 1, 'a bay on the row');
  assert.ok(has(b, 'brick', (x, y) => x > hw + 0.6 && y < 8), 'bay body projects 0.7 m');
  assert.ok(has(b, 'metal', (x, y) => x > hw + 0.5 && y > 4), 'lead roof over the bay');

  // chimney stacks with pots, above the roof, set back from the street
  assert.ok(b.stacks.length >= 2, `stacks ${b.stacks.length}`);
  for (const s of b.stacks) assert.ok(has(b, 'brick', (x, y, z) => Math.abs(z - s.z) < 0.5 && x > -2.2 && x < -1.0 && y > s.y - 0.75), 'a real stack under every pot cluster');
  assert.ok(has(b, 'concrete', (x, y) => x > -2.2 && x < -1.0 && y > Math.min(...b.stacks.map((s) => s.y)) - 0.4), 'clay pots on the stack');

  // fire escape: black iron platforms out over the street on ~35% of units, capped per run
  const withEsc = cases.filter(([s, a, d, hh]) => build(s, a, d, hh).units.some((u) => u.escape));
  assert.ok(withEsc.length >= 5, `terraces with a fire escape ${withEsc.length}`);
  const [es, ehw, ehd, eh] = withEsc[0];
  assert.ok(has(build(es, ehw, ehd, eh), 'dark', (x, y) => x > ehw + 0.5 && y > 4), 'iron platform out over the street');
  for (const q of [...cases, ...plot].map(([s, a, d, h]) => build(s, a, d, h))) assert.ok(q.units.filter((u) => u.escape).length <= Math.max(1, Math.round(q.units.length / 3)), 'fire escapes capped per run');
});

test('brickRow: window states are varied, not one lit fraction', () => {
  const st = { dark: 0, dim: 0, bright: 0, tv: 0, curtain: 0 };
  for (const [s, hw, hd, h] of cases) { const b = build(s, hw, hd, h); for (const k in st) st[k] += b.states[k]; }
  const n = Object.values(st).reduce((a, c) => a + c, 0);
  assert.ok(n > 1200, `windows ${n}`);
  const want = { dark: 0.42, dim: 0.18, bright: 0.14, tv: 0.08, curtain: 0.18 };
  for (const k in want) assert.ok(Math.abs(st[k] / n - want[k]) < 0.05, `${k} ${(st[k] / n).toFixed(3)} vs ${want[k]}`);
  // the dark ones are glass (no emit part at all); the lit ones glow, and a TV flickers
  const b = build(3, 6, 22, 17);
  const em = verts(b, 'emit').length && b.parts.find((p) => p.mat === 'emit').geo;
  let lit = 0, cool = 0, flick = 0;
  const e = em.attributes.emit.array, f = em.attributes.flick.array;
  for (let i = 0; i < e.length; i += 3) { if (e[i] + e[i + 1] + e[i + 2] > 0) lit++; if (e[i + 2] > e[i] * 1.5) cool++; }
  for (let i = 0; i < f.length; i++) if (f[i] > 0) flick++;
  assert.ok(lit > 40 && cool > 0 && flick > 0, `lit ${lit} tv-blue ${cool} flickering ${flick}`);
  assert.ok(b.parts.some((p) => p.mat === 'glass'), 'dark windows carry no emit part');
  assert.ok(b.lamps.length >= 1 && b.lamps.every((l) => l.colour === 0xffc28a), 'warm doorway lamps');
});

test('brickRow: the same seed builds the same terrace; a different seed differs', () => {
  const a = build(11, 6, 18, 15), b = build(11, 6, 18, 15), c = build(12, 6, 18, 15);
  assert.equal(a.parts.length, b.parts.length);
  for (let i = 0; i < a.parts.length; i++) assert.deepEqual(Array.from(a.parts[i].geo.attributes.position.array), Array.from(b.parts[i].geo.attributes.position.array), a.parts[i].mat);
  assert.deepEqual(a.units, b.units); assert.deepEqual(a.lamps, b.lamps); assert.deepEqual(a.states, b.states);
  assert.notEqual(a.parts.map((p) => tris(p.geo)).join(','), c.parts.map((p) => tris(p.geo)).join(','), 'another seed, another terrace');
});
