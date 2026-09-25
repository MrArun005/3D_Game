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

test('a Tokyo building is one geometry with colour, emit and UVs, under 2400 triangles at this footprint, snapped to storeys', () => {
  const b = buildTokyoBuilding(17, 5, 7, 24);
  for (const a of ['position', 'normal', 'uv', 'color', 'emit']) assert.ok(b.geo.attributes[a], `${a} attribute`);
  /* The ceiling moved 1600 -> 2200 for the full-height signage pass. Measured
     over 200 footprints, the mean building went 2757 -> 2845 triangles (+3.2%)
     and the max 10208 -> 10446: the extra is a dozen sign boxes, not a new
     class of geometry. The board count is instanced atlas quads, so it costs
     instances and no draws -- hence the much looser bound below.
     The facade pass (2026-09-23: recessed windows, bands, cornices, balconies,
     roof kit) is held to its own budget in the test further down; this
     7-storey, 10 x 14 m footprint still comes in under the old line. */
  assert.ok(b.tris > 200 && b.tris < 2400, `triangles ${b.tris}`);
  assert.ok(Math.abs(b.height - (GROUND_H + (b.floors - 1) * FLOOR_H)) < 1e-9, 'height is whole storeys');
  assert.ok(b.boards.length >= 1 && b.boards.length <= 120, `sign boards ${b.boards.length}`);
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

test('most Tokyo buildings carry a tall facade kanban like ラーメン', () => {
  let n = 0;
  for (let s = 1; s <= 30; s++) {
    const b = buildTokyoBuilding(s * 19, 6, 8, 28);
    if (b.boards.some((bd) => bd.vertical && bd.h >= 3.2)) n++;
  }
  assert.ok(n >= 22, `tall kanban ${n}/30`);
});

test('open shops are rooms (back wall + floor), not a glass sticker', () => {
  let rooms = 0;
  for (let s = 1; s <= 24; s++) {
    const b = buildTokyoBuilding(s * 23, 6, 8, 22);
    // a shop at eye level that throws real light -- NOT a brightness constant:
    // pinning 170 here made a later retune of the palette fail the test rather
    // than the look, which is the wrong way round
    if (b.tris > 700 && (b.lamps ?? []).some((lp) => lp.y < 2.0 && lp.intensity > 0 && lp.range >= 20)) rooms++;
  }
  assert.ok(rooms >= 10, `open shop rooms ${rooms}/24`);
});

test('kanban lamps are coloured neon the light pool can prefer', () => {
  let n = 0;
  for (let s = 1; s <= 20; s++) {
    const b = buildTokyoBuilding(s * 13, 6, 8, 30);
    for (const lp of b.lamps ?? []) {
      // the property the pool actually sorts on: neon-flagged, coloured, at
      // street level, with reach. Brightness is a look value and lives in the
      // generator, not in an assertion.
      if (lp.neon && lp.colour && lp.intensity > 0 && lp.range >= 28 && lp.y < 3.5) n++;
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
  assert.ok(p.pos[0] > 2345 && p.pos[0] < 2375 && p.pos[2] > 1395, 'stands in the canyon, hugging the east shops');
  assert.ok(p.pos[1] < 1.8, `eye height ${p.pos[1]} is a drone, not image 11`);
});

test('the shrine is one small geometry with a lit lantern window', async () => {
  const { buildShrine } = await import('../src/world/tokyo.js');
  const s = buildShrine(3);
  assert.ok(s.tris > 80 && s.tris < 600, `triangles ${s.tris}`);
  for (const a of ['position', 'uv', 'color', 'emit']) assert.ok(s.geo.attributes[a], a);
  const em = s.geo.attributes.emit.array; let lit = 0; for (let i = 0; i < em.length; i += 3) if (em[i] > 0) lit++;
  assert.ok(lit > 0);
});

import { tokyoCell } from '../src/world/tokyoSigns.js';

test('every board has a shape the Tokyo atlas draws, and none stretches its tile badly', () => {
  // the atlas tiles: h 4:1, v 1:4 (drawn for the rolled quad), s 2:1. Before 2026-09-23 a fascia ran to 16:1 on a 4:1 tile.
  const bad = [];
  for (let s = 1; s <= 200; s++) {
    for (const bd of buildTokyoBuilding(s * 7 + 1, 3 + (s % 6), 3 + (s % 5) * 1.3, 10 + (s % 9) * 6).boards) {
      const k = bd.kind;
      const a = k === 'v' ? bd.h / bd.w : bd.w / bd.h;
      const ok = k === 'h' ? a >= 2.8 && a <= 6.2 : k === 'v' ? a >= 2.3 && a <= 5.6 : k === 's' ? Math.abs(a - 2) < 0.05 : false;
      if (!ok || (k === 'v') !== !!bd.vertical) bad.push(`${k} ${bd.w.toFixed(2)}x${bd.h.toFixed(2)}`);
    }
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} boards off their tile's shape`);
});

test('the two faces of a projecting kanban look out of their lightbox, not into it', () => {
  let pairs = 0;
  for (let s = 1; s <= 40; s++) {
    const v = buildTokyoBuilding(s * 11, 5, 6, 30).boards.filter((bd) => bd.kind === 'v');
    for (const a of v) for (const b of v) {
      if (a === b || a.x !== b.x || a.y !== b.y || !(b.z - a.z > 0.15 && b.z - a.z < 0.3)) continue;
      pairs++;
      // normal = (sin yaw, 0, cos yaw): the face on the +z side must point +z, the other -z
      assert.ok(Math.cos(b.yaw) > 0.9 && Math.cos(a.yaw) < -0.9, `faces ${a.yaw.toFixed(2)} / ${b.yaw.toFixed(2)} look inward`);
    }
  }
  assert.ok(pairs >= 40, `projecting kanban pairs ${pairs}`);
});

test('tall buildings carry a video screen, and the tenant signs stop under it', () => {
  let screens = 0;
  for (let s = 1; s <= 60; s++) {
    const b = buildTokyoBuilding(s * 31, 6, 7, 50);
    const sc = b.boards.find((bd) => bd.kind === 's');
    if (!sc) continue;
    screens++;
    const tenants = b.boards.filter((bd) => bd.kind === 'h' && bd.h === 0.62);
    assert.ok(tenants.every((t) => t.y + t.h / 2 < sc.y - sc.h / 2), 'a tenant sign runs into the screen');
  }
  assert.ok(screens >= 25, `screens on 12+ storey buildings: ${screens}/60`);
});

test('tokyoCell maps each board shape into its own atlas region, and the shader can decode a screen', () => {
  const [u, v, du, dv] = tokyoCell('h', 0);
  assert.deepEqual([u, v, du, dv], [0, 1 - 128 / 2048, 0.25, 0.0625]);
  for (let i = 0; i < 24; i++) {
    const vc = tokyoCell('v', i / 24);
    assert.ok(vc[1] >= 0.25 - 1e-9 && vc[1] + vc[3] <= 0.625 + 1e-9, `kanban tile ${i} outside rows 6-11`);
  }
  // the material recovers a screen's ad index as k = u0*4 + (1 - v0*8)*4: it must be 0..7, once each
  const ks = new Set();
  for (let i = 0; i < 8; i++) {
    const [su, sv, sdu, sdv] = tokyoCell('s', i / 8);
    assert.equal(sdv, 0.125);
    assert.equal(sdu, 0.25);
    const k = su * 4 + (1 - sv * 8) * 4;
    assert.ok(Number.isInteger(k) && k >= 0 && k < 8, `screen ${i} decodes to ${k}`);
    ks.add(k);
  }
  assert.equal(ks.size, 8, 'every screen ad reachable');
  for (const c of [tokyoCell('s', 1), tokyoCell('nope', 0.5), tokyoCell('h', -3)]) assert.ok(c.every((x) => x >= 0 && x <= 1), 'cells stay inside the atlas');
});

/* ---- The facade pass (2026-09-23): windows with depth, bands, cornices,
   balconies, a different top storey, the roof kit. Geometry is checked the
   way the tank and helicopter are: winding against the normals, finite
   attributes, and -- because a recessed window is a hole in a hollow skin --
   that no two faces lie in one plane facing the same way. */
import { TOKYO_KIT, PAINT_VARIANT, SURF } from '../src/world/tokyo.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// the synthetic spread the budget below was measured on: 3-13 m by 3-11 m half sizes, 10-66 m planner heights
const spread = (s) => [s * 7919 + 13, 3 + (s % 7) * 1.7, 3 + (s % 5) * 2.1, 10 + (s % 9) * 7];

test('triangles per building stay inside the facade budget (200 seeds)', () => {
  /* Measured 2026-09-23 on this spread: mean 2770 -> 3499 (+26%), max
     8972 -> 10352. On the district's own 219 Little Tokyo footprints: mean
     3504 -> 4416, max 18390 -> 18206, all 219 together 0.77M -> 0.97M --
     one mesh per chunk as before, no draw added. The ceilings sit ~10% over
     the measurement, so the next layer has to say what it costs. */
  let sum = 0, max = 0;
  for (let s = 0; s < 200; s++) { const t = buildTokyoBuilding(...spread(s)).tris; sum += t; max = Math.max(max, t); }
  assert.ok(sum / 200 < 3850, `mean ${Math.round(sum / 200)} triangles a building`);
  assert.ok(max < 11500, `max ${max}`);
});

test('every triangle faces outward, every attribute is finite, every surf is a real kind (200 seeds)', () => {
  let wrong = 0, total = 0, bad = 0, badSurf = 0, displays = 0;
  for (let s = 0; s < 200; s++) {
    const g = buildTokyoBuilding(...spread(s)).geo;
    assert.ok(g.index, 'indexed');
    const P = g.attributes.position.array, N = g.attributes.normal.array, I = g.index.array, S = g.attributes.surf.array;
    for (const n of ['position', 'normal', 'uv', 'color', 'emit', 'flick', 'surf']) for (const v of g.attributes[n].array) if (!Number.isFinite(v)) bad++;
    for (const v of S) { const k = Math.floor(v), f = v - k; if (k < SURF.WALL || k > SURF.DISPLAY || f < 0.04 || f > 0.86) badSurf++; if (k === SURF.DISPLAY) displays++; }
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      if (cx * cx + cy * cy + cz * cz < 1e-14) continue;
      total++;
      if (cx * (N[a] + N[b] + N[c]) + cy * (N[a + 1] + N[b + 1] + N[c + 1]) + cz * (N[a + 2] + N[b + 2] + N[c + 2]) <= 0) wrong++;
    }
  }
  assert.equal(bad, 0, 'non-finite attribute values');
  assert.equal(badSurf, 0, 'surf values outside WALL..DISPLAY or the 0.05..0.85 variant band');
  assert.ok(displays > 0, 'no side-street shop bay carries SURF.DISPLAY (the brown boards are back)');
  assert.equal(wrong, 0, `${wrong} of ${total} triangles face against their normals`);
});

test('no two faces share a plane facing the same way (z-fighting), 80 seeds', () => {
  /* Axis-aligned triangles bucketed by plane and facing; two in one bucket
     that overlap with positive area fight in the depth buffer. This found the
     plinth on the stallrisers' plane, the shop door's glass lying ON its frame
     (a bug since the shops went in), the soffit poking 2 cm through the
     facade, the string lights inside the soffit and the billboard legs on the
     coping's inner wall. Undersides resting on the ground are never seen. */
  const sat = (A, B) => {
    for (const T of [A, B]) for (let i = 0; i < 3; i++) {
      const p = T[i], q = T[(i + 1) % 3], nx = q[1] - p[1], ny = p[0] - q[0], L = Math.hypot(nx, ny) || 1;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const v of A) { const d = (v[0] * nx + v[1] * ny) / L; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (const v of B) { const d = (v[0] * nx + v[1] * ny) / L; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      if (a1 <= b0 + 0.002 || b1 <= a0 + 0.002) return false;
    }
    return true;
  };
  const fights = [];
  for (let s = 0; s < 80; s++) {
    const g = buildTokyoBuilding(...spread(s)).geo, P = g.attributes.position.array, I = g.index.array;
    const planes = new Map();
    for (let t = 0; t < I.length; t += 3) {
      const ids = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
      const [a, b, c] = ids;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], L = Math.hypot(...n);
      if (L < 1e-9) continue;
      const ax = n.findIndex((v) => Math.abs(v) / L > 0.999);
      if (ax < 0 || (ax === 1 && n[1] < 0 && Math.abs(P[a + 1]) < 1e-6)) continue;
      const o1 = (ax + 1) % 3, o2 = (ax + 2) % 3, key = `${ax}${Math.sign(n[ax])}${Math.round(P[a + ax] * 1000)}`;
      (planes.get(key) ?? planes.set(key, []).get(key)).push(ids.map((i) => [P[i + o1], P[i + o2]]));
    }
    for (const [key, list] of planes) {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (sat(list[i], list[j])) { fights.push(`seed ${s} plane ${key}`); break; }
    }
  }
  assert.deepEqual(fights.slice(0, 5), [], `${fights.length} coplanar overlaps`);
});

test('windows have depth: glass R behind the street face, side reveals, projecting sills', () => {
  let sillBuildings = 0, checked = 0;
  for (let s = 0; s < 40; s++) {
    const [seed, hw, hd, h] = spread(s);
    const b = buildTokyoBuilding(seed, hw, hd, h), R = b.style.reveal;
    assert.ok(R >= 0.12 && R <= 0.18, `reveal ${R}`);
    const P = b.geo.attributes.position.array, N = b.geo.attributes.normal.array, S = b.geo.attributes.surf.array;
    let panes = 0, recessed = 0, reveals = 0, sills = 0;
    for (let i = 0; i < S.length; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], nx = N[i * 3], nz = N[i * 3 + 2];
      if (y < GROUND_H + 0.5 || y > b.style.mainRoof) continue;
      if (Math.floor(S[i]) === SURF.GLASS && nx > 0.99 && x > hw - 0.5) { panes++; if (Math.abs(hw - R - x) < 1e-4) recessed++; }
      if (Math.abs(nz) > 0.99 && x > hw - R - 1e-4 && x < hw - R + 1e-4) reveals++;   // a side reveal's inner edge, at the glass line
      if (nx > 0.99 && Math.abs(x - (hw + 0.07)) < 1e-4) sills++;
    }
    if (!panes) continue;
    checked++;
    assert.equal(recessed, panes, `seed ${seed}: ${panes - recessed} street-face panes are not ${R.toFixed(3)} m in`);
    // two side reveals an opening; a strip opening carries a pane per bay between its two, so only punched and paired fronts must match one for one
    if (b.style.window !== 'strip' && !b.style.showroom) assert.ok(reveals >= panes, `seed ${seed}: ${reveals} reveal corners for ${panes} pane corners`);
    else assert.ok(reveals >= 8, `seed ${seed}: a strip front with ${reveals} reveal corners`);
    if (b.style.sills) { assert.ok(sills > 0, `seed ${seed}: sills rolled, none built`); sillBuildings++; }
  }
  assert.ok(checked >= 35 && sillBuildings >= 10, `checked ${checked}, with sills ${sillBuildings}`);
});

test('the facade kit varies: window styles, bands, cornices, top storeys and the roof kit all occur', () => {
  const seen = new Map();
  const add = (k) => seen.set(k, (seen.get(k) ?? 0) + 1);
  for (let s = 0; s < 200; s++) {
    const st = buildTokyoBuilding(...spread(s)).style;
    add('win:' + st.window); add('bands:' + st.bands); add('cornice:' + st.cornice); add('top:' + st.top);
    if (st.columns) add('columns');
    if (st.balconies) add('balconies');
    if (st.smallBalconies) add('smallBalconies');
    for (const r of st.roof) add('roof:' + r);
  }
  for (const k of ['win:punched', 'win:paired', 'win:strip', 'bands:every', 'bands:third', 'bands:first', 'cornice:step', 'cornice:slab', 'cornice:coping',
    'top:setback', 'top:penthouse', 'columns', 'balconies', 'smallBalconies',
    'roof:bulkhead', 'roof:tank-drum', 'roof:tank-panel', 'roof:lattice', 'roof:mast', 'roof:hvac', 'roof:garden', 'roof:shed', 'roof:billboard']) {
    assert.ok((seen.get(k) ?? 0) >= 5, `${k}: ${seen.get(k) ?? 0} of 200`);
  }
  assert.ok(seen.get('top:null') > 120, 'most buildings keep a plain top storey');
});

test('residential street balconies: a run 1.05 m out, above the tenant boards, never through the screen', () => {
  let runs = 0;
  for (let s = 0; s < 300; s++) {
    const [seed, hw, hd, h] = spread(s);
    const b = buildTokyoBuilding(seed, hw, hd, h);
    if (!b.style.balconies) continue;
    runs++;
    assert.ok(b.style.residential, 'balconies are for flats');
    const P = b.geo.attributes.position.array, N = b.geo.attributes.normal.array;
    let slabY = Infinity;
    for (let i = 0; i < P.length; i += 3) if (N[i] > 0.99 && Math.abs(P[i] - (hw + 1.05)) < 1e-4) slabY = Math.min(slabY, P[i + 1]);
    assert.ok(Number.isFinite(slabY), `seed ${seed}: no slab front at 1.05 m`);
    const tenants = b.boards.filter((bd) => bd.kind === 'h' && bd.h === 0.62);
    for (const t of tenants) assert.ok(t.y + t.h / 2 < slabY, `seed ${seed}: a tenant board at ${t.y.toFixed(2)} runs into the balconies from ${slabY.toFixed(2)}`);
    const sc = b.boards.find((bd) => bd.kind === 's');
    if (sc) for (let i = 0; i < P.length; i += 3) {
      if (N[i] > 0.99 && Math.abs(P[i] - (hw + 1.05)) < 1e-4) assert.ok(P[i + 1] > sc.y + sc.h / 2 || P[i + 1] < sc.y - sc.h / 2, `seed ${seed}: a balcony crosses the screen`);
    }
  }
  assert.ok(runs >= 40, `balcony runs in 300: ${runs}`);
});

test('an open shop is a room you can see into: no wall stands in front of its back wall', () => {
  /* It was not: the ground-floor mass ran to hw - recess and the room stood
     1.2 m inside it, so every open shop was a flat wall with a lamp. */
  let open = 0;
  for (let s = 0; s < 60; s++) {
    const [seed, hw, hd, h] = spread(s);
    const b = buildTokyoBuilding(seed, hw, hd, h);
    if (b.style.shop !== 'open') continue;
    open++;
    const back = hw - b.style.recess - b.style.roomD;   // the room's back wall face stands 8 cm in front of this
    const P = b.geo.attributes.position.array, N = b.geo.attributes.normal.array, S = b.geo.attributes.surf.array;
    for (let i = 0; i < S.length; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      if (N[i * 3] < 0.99 || Math.floor(S[i]) !== SURF.WALL) continue;
      if (x > back + 0.01 && x < hw - b.style.recess + 0.02 && Math.abs(z) < hd - 0.45 && y > 0.2 && y < GROUND_H - 0.3) assert.fail(`seed ${seed}: a wall at x=${x.toFixed(2)} hides the shop`);
    }
  }
  assert.ok(open >= 30, `open shops ${open}/60`);
});

test('a set-back top storey keeps every street-face sign under the main roof', () => {
  let setbacks = 0;
  for (let s = 0; s < 300 && setbacks < 20; s++) {
    const [seed, hw, hd, h] = spread(s);
    const b = buildTokyoBuilding(seed, hw, hd, h);
    if (!b.style.top) continue;
    setbacks++;
    assert.ok(Math.abs(b.style.mainRoof - (b.height - FLOOR_H)) < 1e-9, 'the top storey is one storey');
    for (const bd of b.boards) if (bd.x > hw - 0.01) assert.ok(bd.y + bd.h / 2 <= b.style.mainRoof + 1e-6, `seed ${seed}: a ${bd.kind} board reaches ${(bd.y + bd.h / 2).toFixed(2)} over the roof at ${b.style.mainRoof.toFixed(2)}`);
  }
  assert.ok(setbacks >= 10, `top storeys ${setbacks}`);
});

test('the kerb-face kanban lie flat on the wall, their lettering on the box', () => {
  /* It was box(0.16, bh, bw) turned by the face's yaw: a fin 1.35-1.8 m deep
     standing out THROUGH its own board. Every side-face kanban board now has
     an emissive face 2 cm behind it, facing the same way, under its centre. */
  let n = 0;
  for (let s = 0; s < 40; s++) {
    const [seed, hw, hd, h] = spread(s);
    const b = buildTokyoBuilding(seed, hw, hd, h);
    const P = b.geo.attributes.position.array, N = b.geo.attributes.normal.array, E = b.geo.attributes.emit.array, I = b.geo.index.array;
    for (const bd of b.boards) {
      if (bd.kind !== 'v' || Math.abs(bd.z) < hd + 0.2 || Math.abs(bd.x) > hw) continue;   // the side faces' kanban
      n++;
      const nz = Math.cos(bd.yaw);
      let under = false;
      for (let t = 0; t < I.length && !under; t += 3) {
        const i = I[t] * 3;
        if (Math.abs(N[i + 2] - nz) > 1e-3 || E[i] + E[i + 1] + E[i + 2] < 1) continue;
        const zs = [I[t], I[t + 1], I[t + 2]].map((k) => P[k * 3 + 2]);
        if (Math.max(...zs) - Math.min(...zs) > 1e-4 || Math.abs(bd.z - zs[0]) > 0.03 || Math.abs(bd.z - zs[0]) < 0.005) continue;
        const xs = [I[t], I[t + 1], I[t + 2]].map((k) => P[k * 3]), ys = [I[t], I[t + 1], I[t + 2]].map((k) => P[k * 3 + 1]);
        under = bd.x >= Math.min(...xs) && bd.x <= Math.max(...xs) && bd.y >= Math.min(...ys) && bd.y <= Math.max(...ys);
      }
      assert.ok(under, `seed ${seed}: a side kanban at (${bd.x.toFixed(2)}, ${bd.y.toFixed(2)}, ${bd.z.toFixed(2)}) has no box behind it`);
    }
  }
  assert.ok(n >= 20, `side kanban checked ${n}`);
});

test('TOKYO_KIT exposes the painting helpers, and their parts merge with a building', () => {
  for (const k of ['SURF', 'paint', 'box', 'metal', 'cyl', 'quad', 'glass', 'at', 'faces', 'onFace', 'wallFinish', 'flickerOf', 'WALLS', 'LIGHT', 'NEON', 'WARM', 'COOL', 'MAGENTA', 'CYAN', 'GROUND_H', 'FLOOR_H']) assert.ok(k in TOKYO_KIT, k);
  assert.equal(TOKYO_KIT.GROUND_H, GROUND_H);
  const b = buildTokyoBuilding(5, 6, 7, 30).geo;
  const k = TOKYO_KIT.at(TOKYO_KIT.box(2, 3, 4, 0x808080), 1, 1.5, 0);
  assert.deepEqual(Object.keys(k.attributes).sort(), Object.keys(b.attributes).sort(), 'one attribute set, or mergeGeometries refuses');
  const m = mergeGeometries([b, k], false);
  assert.ok(m && m.index.count === b.index.count + k.index.count);
  assert.ok(PAINT_VARIANT.PLAIN === 0.05 && PAINT_VARIANT.SLATS <= 0.85, 'paint variants inside the surf band');
});

test('the same seed builds the same bytes (positions and paint)', () => {
  const hash = (g) => { let h = 2166136261; for (const n of ['position', 'color', 'surf']) for (const v of g.attributes[n].array) { h ^= Math.round(v * 1e4); h = Math.imul(h, 16777619) >>> 0; } return h; };
  for (const f of [spread(3), spread(77), spread(150)]) assert.equal(hash(buildTokyoBuilding(...f).geo), hash(buildTokyoBuilding(...f).geo));
  assert.notEqual(hash(buildTokyoBuilding(...spread(3)).geo), hash(buildTokyoBuilding(spread(3)[0] + 1, ...spread(3).slice(1)).geo));
});

test('tokyoFacadeMaterial builds its node graph under three/webgpu (the paint patterns included)', async () => {
  /* node's `three` is the classic build, which has no node materials; the
     game gets three/webgpu through vite's alias. A child node with the same
     alias builds the material, so a TSL slip -- a missing import, a node
     method on a number -- fails here rather than in a browser. The canvas is
     a stub: the detail painter only needs image data. */
  const { spawnSync } = await import('node:child_process');
  const root = new URL('..', import.meta.url);
  const hook = `export async function resolve(s, c, n) { if (s === 'three') return n('three/webgpu', c); return n(s, c); }`;
  const reg = `import { register } from 'node:module'; register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(hook)}), ${JSON.stringify(root.href)});`;
  const code = `
    globalThis.document = { createElement: () => { let img = null; return { width: 0, height: 0, getContext: () => ({ createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData: (d) => { img = d; }, getImageData: (x, y, w, h) => img ?? { data: new Uint8ClampedArray(w * h * 4) } }) }; } };
    const t = await import(${JSON.stringify(new URL('src/world/tokyo.js', root).href)});
    const m = t.tokyoFacadeMaterial();
    console.log(JSON.stringify({ node: !!m.isNodeMaterial, color: !!m.colorNode, rough: !!m.roughnessNode, normal: !!m.normalNode, emissive: !!m.emissiveNode }));`;
  const r = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(reg), '--input-type=module', '-e', code], { cwd: root, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()), { node: true, color: true, rough: true, normal: true, emissive: true });
});
