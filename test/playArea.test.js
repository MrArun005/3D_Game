import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { District } from '../src/world/district.js';
import {
  COMPACT_POLY, RACEWAY_POLY, COMPACT_PLACES, COMPACT_CHOP, COMPACT_TARGETS, JERSEY, HOARDING,
  makePlayArea, holdInside, clipGraph, pickMapMode, keptCellSet, wallProps, remapMission, ringHides,
} from '../src/world/playArea.js';
import { isRacewayArea } from '../src/world/raceTrack.js';
import { farLampHeads } from '../src/world/dressing.js';
import { KERB_H } from '../src/world/metrics.js';
import { STORY_MISSIONS, StoryManager } from '../src/game/storyMissions.js';
import { CHOP_SHOP_COMPACT, CHOP_SHOP } from '../src/game/garage.js';
import { CommandEngine } from '../src/game/commands.js';
import { FeatureTour } from '../src/game/featureTour.js';
import { Jobs } from '../src/game/jobs.js';
import { Mission } from '../src/game/mission.js';
import { mapTransform } from '../src/ui/hud.js';
import { StreetLife } from '../src/world/streetLife.js';
import { buildRiverside } from '../src/world/riverside.js';
import { mulberry32 } from '../src/core/rng.js';

/* The compact city (world/playArea.js). Every number here is measured against
   the shipped district file; a District is built from a FRESH parse each time
   because the constructor writes into its data (the Tokyo blocks and places). */
const read = () => JSON.parse(readFileSync(new URL('../public/halstead-bay.district.json', import.meta.url)));
const full = new District(read());
const city = new District(read(), { play: COMPACT_POLY });
const A = city.play, W = city.wall;
const edgeDist = (x, z) => A.probe(x, z).d;
const cellOf = (x, z) => `${Math.floor(x / 256)},${Math.floor(z / 256)}`;

test('a District with no opts is the whole bay, as before', () => {
  assert.equal(full.graph.nodes.length, 1789);
  assert.equal(full.graph.edges.length, 2937);
  assert.equal(full.places.length, 105);
  assert.equal(full.fullGraph, full.graph, 'one graph');
  assert.equal(full.play, null);
  assert.equal(full.wall, null);
  assert.equal(full.playBounds, null);
});

test('the compact gameplay graph is ONE component, wholly inside, the rendering graph whole', () => {
  const g = city.graph;
  assert.ok(g.nodes.length >= 300 && g.nodes.length <= 360, `${g.nodes.length} nodes`);
  assert.equal(g.nodes.length, 328);
  assert.equal(g.edges.length, 511);
  for (const n of g.nodes) assert.ok(A.contains(n.x, n.y), `node ${n.id} outside`);
  for (const e of g.edges) for (const [x, z] of e.points) assert.ok(A.contains(x, z), `edge ${e.id} leaves`);
  // connected: a BFS from any node reaches every node
  const adj = new Map(g.nodes.map((n) => [n.id, []]));
  for (const e of g.edges) { adj.get(e.a).push(e.b); adj.get(e.b).push(e.a); }
  const seen = new Set([g.nodes[0].id]), q = [g.nodes[0].id];
  while (q.length) for (const nb of adj.get(q.pop())) if (!seen.has(nb)) { seen.add(nb); q.push(nb); }
  assert.equal(seen.size, g.nodes.length, 'one component');
  assert.equal(city.fullGraph.nodes.length, 1789, 'kerbs and signals still see every junction');
  assert.deepEqual(city.bounds, full.bounds, 'bounds stay the whole map (water, surrounds, riverside read them)');
  assert.deepEqual(city.playBounds, { x0: 1509, z0: 878.7, x1: 2955, z1: 2362.5 });
});

test('every hospital and police station is inside, and the three new places stand on a pavement', () => {
  const hp = city.places.filter((p) => p.type === 'hosp' || p.type === 'police');
  assert.ok(hp.some((p) => p.type === 'hosp') && hp.some((p) => p.type === 'police'));
  for (const p of city.places) assert.ok(A.contains(p.x, p.y), `${p.name} outside`);
  assert.equal(full.places.filter((p) => (p.type === 'hosp' || p.type === 'police') && A.contains(p.x, p.y)).length, 0,
    'the file has none inside -- which is why these exist');
  for (const p of COMPACT_PLACES) {
    const td = city.tarmacDepth(p.x, p.y);
    assert.ok(td >= 5 && td <= 8, `${p.name} tarmacDepth ${td.toFixed(1)}`);
    assert.equal(city.inOpenWater(p.x, p.y), false);
    assert.ok(city.elevationAt(p.x, p.y) < 0.05, `${p.name} on a deck`);
  }
});

test('WASTED and BUSTED wake you inside (main.js onDeath / onBust nearest-place rule)', () => {
  const rnd = mulberry32(7);
  const { x0, z0, x1, z1 } = A.bbox;
  let n = 0;
  while (n < 1000) {
    const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
    if (!A.contains(x, z)) continue;
    n++;
    for (const type of ['hosp', 'police']) {
      const at = city.places.filter((p) => p.type === type).reduce((best, p) => {
        const d = Math.hypot(p.x - x, p.y - z);
        return d < best.d ? { d, p } : best;
      }, { d: Infinity, p: null }).p;
      assert.ok(at && A.contains(at.x, at.y), `${type} from (${x.toFixed(0)},${z.toFixed(0)})`);
    }
  }
});

test('jobs and the checkpoint run never leave the compact city', () => {
  const hud = { flash() {}, setJob() {} }, traffic = { wanted: 0, reportCrime() {} };
  const fakeMission = { pts: null, addListener() {}, route(p) { this.pts = p; }, stop() {}, setMarkerColor() {} };
  const jobs = new Jobs(fakeMission, traffic, hud, city);
  const real = Math.random, rnd = mulberry32(11);
  Math.random = rnd;
  try {
    let taken = 0;
    for (let t = 0; t < 400; t++) {
      const n = city.graph.nodes[(rnd() * city.graph.nodes.length) | 0];
      jobs.job = null; fakeMission.pts = null;
      jobs.toggle({ x: n.x, z: n.y });
      if (!fakeMission.pts) continue;
      taken++;
      for (const p of fakeMission.pts) assert.ok(A.contains(p.x, p.y ?? p.z), `job point (${p.x},${p.y}) outside`);
    }
    assert.ok(taken > 300, `${taken} of 400 jobs taken`);
  } finally { Math.random = real; }
  const mission = new Mission(new THREE.Scene(), city);
  for (let seed = 1; seed <= 200; seed++) {
    mission.active = false;
    mission.start({ x: 2354, z: 1408 }, seed * 2654435761 >>> 0);
    assert.ok(mission.active, `seed ${seed} laid a course`);
    for (const p of mission.points) assert.ok(A.contains(p.x, p.y), `seed ${seed}: checkpoint outside`);
  }
});

test('pickMapMode: ?fullmap > ?compact > hb.map > compact', () => {
  assert.equal(pickMapMode('', null), 'compact');
  assert.equal(pickMapMode('?fullmap', null), 'full');
  assert.equal(pickMapMode('?fullmap', 'compact'), 'full');
  assert.equal(pickMapMode('?compact', 'full'), 'compact');
  assert.equal(pickMapMode('?fullmap&compact', null), 'full');
  assert.equal(pickMapMode('', 'full'), 'full');
  assert.equal(pickMapMode('', 'compact'), 'compact');
  assert.equal(pickMapMode('', 'nonsense'), 'compact');
  assert.equal(pickMapMode('?room=abc&fullmap=', null), 'full', 'a room invite carries it as fullmap=');
});

test('the soft wall: 2000 bodies at 5-80 m/s for 20 s, none escapes, no damage written', () => {
  const rnd = mulberry32(11), STEP = 1 / 120, nodes = city.graph.nodes;
  let escaped = 0, worst = -Infinity, contacts = 0;
  for (let k = 0; k < 2000; k++) {
    const nd = nodes[(rnd() * nodes.length) | 0], a = rnd() * Math.PI * 2, v = 5 + rnd() * 75;
    const b = { x: nd.x, z: nd.y, vx: Math.cos(a) * v, vz: Math.sin(a) * v };
    for (let i = 0; i < 2400; i++) {
      b.x += b.vx * STEP; b.z += b.vz * STEP;
      if (holdInside(b, W, 2.6)) contacts++;
      const d = W.probe(b.x, b.z).d;
      if (d > worst) worst = d;
    }
    if (!W.contains(b.x, b.z)) escaped++;
    assert.equal(b.impact, undefined); assert.equal(b.hitAt, undefined);
  }
  assert.equal(escaped, 0);
  assert.ok(worst <= -2.3, `worst post-step distance ${worst.toFixed(2)} m`);
  assert.ok(contacts > 1000, `${contacts} contacts: the sweep really reached the wall`);
});

test('the soft wall leaves the inside alone and only takes the outward speed', () => {
  const b = { x: 2354, z: 1408, vx: 30, vz: -5 };
  assert.equal(holdInside(b, W, 2.6), false);
  assert.deepEqual(b, { x: 2354, z: 1408, vx: 30, vz: -5 });
  // at the east edge (x = 2955) heading out and along it
  const c = { x: 2954, z: 1500, vx: 20, vz: 10 };
  assert.equal(holdInside(c, W, 2.6), true);
  assert.ok(Math.abs(c.x - (2955 - 2.6)) < 1e-9, `pushed to the inset: x ${c.x}`);
  assert.ok(c.vx <= 1e-9, 'no outward speed left');
  assert.ok(c.vz >= 10 * 0.98, `tangential kept: ${c.vz}`);
  // the helicopter's negative inset lets it hover 150 m out, no further
  const h = { x: 1500, z: 1300, vx: -10, vz: 0 };   // the west wall (the river's centreline) is at x ~1606 here
  assert.equal(holdInside(h, W, -150), false, '~106 m past the wall is allowed');
  h.x = 1300; holdInside(h, W, -150);
  assert.ok(Math.abs(W.probe(h.x, h.z).d - 150) < 1e-6, 'held at 150 m out');
});

test('the raceway island is inside the wall, and RACEWAY_POLY is isRacewayArea exactly', () => {
  assert.ok(W.contains(3560, 2457), 'the circuit grid');
  assert.ok(!A.contains(3560, 2457), 'but not part of the city');
  const R = makePlayArea(RACEWAY_POLY);
  let checked = 0;
  for (let x = 3380; x <= 4240; x += 7.3) for (let z = 2380; z <= 3060; z += 7.3) {
    assert.equal(R.contains(x, z), isRacewayArea(x, z), `(${x.toFixed(1)}, ${z.toFixed(1)})`);
    checked++;
  }
  assert.ok(checked > 10000);
});

test('streaming: 50 cells within 128 m of the city, the spawn ring whole, no playable ground dropped', () => {
  const kc = keptCellSet((x, z) => A.probe(x, z).d < 128, full.bounds);
  assert.equal(kc.size, 50);
  for (let cx = 8; cx <= 10; cx++) for (let cz = 4; cz <= 6; cz++) assert.ok(kc.has(`${cx},${cz}`), `spawn ring ${cx},${cz}`);
  // every cell with any inside point in it is built
  for (let x = A.bbox.x0; x <= A.bbox.x1; x += 16) for (let z = A.bbox.z0; z <= A.bbox.z1; z += 16) {
    if (A.contains(x, z)) assert.ok(kc.has(cellOf(x, z)), `inside point (${x},${z}) in an unbuilt cell`);
  }
  const kw = keptCellSet((x, z) => W.probe(x, z).d < 128, full.bounds);
  assert.ok(kw.size > kc.size && kw.has(cellOf(3560, 2457)), 'the raceway island streams when you are there');
});

test('far stand-ins: the ring hides only what a built chunk replaces, from 200 places inside', () => {
  const kept = keptCellSet((x, z) => W.probe(x, z).d < 128, full.bounds);
  // stand-in centres, as districtWorld #buildFarCity lays them
  const at = [];
  for (const bl of city.blocks) {
    const ca = Math.cos(bl.angle), sa = Math.sin(bl.angle);
    for (const g of city.buildingsOf(bl.id)) {
      const lx = g.x + g.w / 2, lz = g.y + g.d / 2;
      at.push([bl.x + lx * ca - lz * sa, bl.y + lx * sa + lz * ca]);
    }
  }
  const rnd = mulberry32(5), R = (2 + 0.5) * 256;   // the FULL ring (radius 2)
  let hidden = 0, keptUp = 0;
  for (let k = 0; k < 200; k++) {
    const n = city.graph.nodes[(rnd() * city.graph.nodes.length) | 0];
    for (const [px, pz] of at) {
      const isKept = kept.has(cellOf(px, pz));
      const h = ringHides(px, pz, n.x, n.y, R, isKept, false);
      if (h) { hidden++; assert.ok(isKept, 'a stand-in hidden over a cell that never builds: a hole'); }
      else if (Math.abs(px - n.x) < R && Math.abs(pz - n.y) < R) keptUp++;
      // photo mode lifts the clip: everything in the ring may build, so everything in it hides
      if (Math.abs(px - n.x) < R && Math.abs(pz - n.y) < R) assert.ok(ringHides(px, pz, n.x, n.y, R, isKept, true));
    }
  }
  assert.ok(hidden > 0 && keptUp > 0, `${hidden} hidden, ${keptUp} kept up at the ring's unbuilt edge`);
  assert.equal(ringHides(10, 10, 0, 0, 100), true, 'without a clip the rule is the old one');
});

test('far glare: heads in a cell that is never built keep their glare, every inside head hands over', () => {
  const kept = keptCellSet((x, z) => W.probe(x, z).d < 128, full.bounds);
  const heads = farLampHeads(city, (x, z) => kept.has(cellOf(x, z)));
  assert.equal(heads.length, farLampHeads(full).length, 'the same heads, tagged');
  const inside = heads.filter((h) => A.contains(h.x, h.z));
  assert.ok(inside.length > 600, `${inside.length} inside`);
  for (const h of inside) assert.equal(h.kept, 1, 'inside heads collapse to the chunk glare');
  const nKept = heads.filter((h) => h.kept).length;
  assert.ok(nKept >= inside.length && nKept < heads.length * 0.35, `${nKept} of ${heads.length} kept`);
  assert.equal(farLampHeads(full)[0].kept, undefined, 'no tag without a predicate: the whole-bay shader is untouched');
});

test('the wall is dressed: jersey barriers on roads and decks, hoarding on open ground, 1 m outside', () => {
  const props = wallProps(city, A);
  const jersey = props.filter((p) => p.name === JERSEY), hoarding = props.filter((p) => p.name === HOARDING);
  assert.ok(jersey.length >= 600 && jersey.length <= 700, `${jersey.length} jersey`);
  assert.ok(hoarding.length >= 480 && hoarding.length <= 600, `${hoarding.length} hoarding`);
  for (const p of props) {
    const d = A.probe(p.x, p.z).d;
    assert.ok(d > 0.99 && d < 1.01, `prop ${d.toFixed(2)} m from the line`);
  }
  for (const p of hoarding) {
    assert.equal(city.inOpenWater(p.x, p.z), false, 'hoarding in the river');
    assert.ok(city.tarmacDepth(p.x, p.z) >= 5.5, 'hoarding on a road');
  }
  /* Height: the DRAWN road under the barrier -- the segment it is deepest
     into, at districtWorld's end-centre deck interpolation, +KERB_H on the
     pavement -- never elevationAt at its own spot (CLAUDE.md, the banked
     bridge). Checked independently of wallProps' own surface() walk. */
  for (const p of jersey) {
    let best = Infinity, deck = 0;
    for (const sg of city.segments) {
      const vx = sg.bx - sg.ax, vz = sg.bz - sg.az, l2 = vx * vx + vz * vz;
      let t = l2 ? ((p.x - sg.ax) * vx + (p.z - sg.az) * vz) / l2 : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(p.x - sg.ax - vx * t, p.z - sg.az - vz * t) - sg.half;
      if (d < best) { best = d; const ea = city.elevationAt(sg.ax, sg.az); deck = ea + (city.elevationAt(sg.bx, sg.bz) - ea) * t; }
    }
    assert.ok(Math.abs(p.y - (deck + (best > 0 ? KERB_H : 0))) < 1e-6, `barrier at y ${p.y}, road drawn at ${deck}`);
  }
  // the three river decks the outline crosses mid-span (Marrow Road, Steel Mile, Broadway): barriers at 7.6 m
  const decks = jersey.filter((p) => p.y > 5);
  assert.ok(decks.length >= 40, `${decks.length} barriers on decks`);
  for (const p of decks) assert.ok(Math.abs(p.y - 7.6) < 0.05 || Math.abs(p.y - (7.6 + KERB_H)) < 0.05, `deck barrier at y ${p.y}`);
  for (const p of jersey) if (city.inOpenWater(p.x, p.z)) assert.ok(city.elevationAt(p.x, p.z) > 0.5, 'a barrier in the water off any deck');
  // local +Z (the hoarding's printed face) looks into the city
  for (const p of props.slice(0, 200)) {
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    assert.ok(A.probe(p.x + fx * 3, p.z + fz * 3).d < A.probe(p.x, p.z).d, 'faces inward');
  }
  const chunks = new Set(props.map((p) => cellOf(p.x, p.z)));
  assert.equal(chunks.size, 21);
});

test('story missions: every step inside, 60 m from the wall, the originals untouched', () => {
  const before = JSON.stringify(STORY_MISSIONS);
  for (const m of STORY_MISSIONS) {
    const r = remapMission(m, A, city.graph.nodes);
    assert.equal(r.id, m.id);
    r.steps.forEach((st, i) => {
      assert.ok(A.contains(st.target.x, st.target.z), `${m.id}:${i} outside`);
      assert.ok(edgeDist(st.target.x, st.target.z) <= -60, `${m.id}:${i} ${edgeDist(st.target.x, st.target.z).toFixed(0)} m from the wall`);
      if (A.contains(m.steps[i].target.x, m.steps[i].target.z)) assert.equal(st, m.steps[i], 'an inside step is the same object');
      if (i && (st !== m.steps[i] || r.steps[i - 1] !== m.steps[i - 1])) {   // a MOVED step keeps its distance (tokyo_1's own 130 m legs are as written)
        const a = m.steps[i - 1].target, b = m.steps[i].target;
        const sameAddress = a.x === b.x && a.z === b.z;   // standoff_1 holds the yard it drove to
        const gap = Math.hypot(st.target.x - r.steps[i - 1].target.x, st.target.z - r.steps[i - 1].target.z);
        assert.ok(sameAddress ? gap === 0 : gap >= 150, `${m.id}:${i} ${gap.toFixed(0)} m after the last step`);
      }
    });
  }
  assert.equal(JSON.stringify(STORY_MISSIONS), before, '?fullmap plays the table as written');
  const h2 = remapMission(STORY_MISSIONS.find((m) => m.id === 'heist_2'), A, city.graph.nodes);
  assert.deepEqual(h2.steps[2].target, { x: COMPACT_CHOP.x, z: COMPACT_CHOP.z }, 'the stash is still the chop shop');
  assert.deepEqual(h2.steps[0].target, COMPACT_TARGETS['heist_2:0']);
  assert.ok(city.graph.nodes.some((n) => n.x === COMPACT_TARGETS['heist_2:0'].x && n.y === COMPACT_TARGETS['heist_2:0'].z), 'the gun-shop meet is a junction');
});

test('StoryManager routes a remapped mission only when given the area', () => {
  const routed = [];
  const mission = { route(p) { routed.push(p[0]); }, setRadius() {}, stop() {}, setMarkerColor() {} };
  const s = new StoryManager(mission, { wanted: 0 }, { flash() {} }, { addCash() {} });
  s.startMission('standoff_1', { x: 0, z: 0 });
  assert.deepEqual(routed.pop(), { x: 2156, z: 2436 }, 'whole bay: the original depot');
  s.useArea(A, city.graph.nodes);
  s.startMission('standoff_1', { x: 0, z: 0 });
  const t = routed.pop();
  assert.ok(A.contains(t.x, t.z), 'compact: a depot inside');
});

test('the chop shop moves inside with the city, on a pavement', () => {
  assert.deepEqual([CHOP_SHOP.x, CHOP_SHOP.z], [3662, 1221], 'the whole-bay address is unchanged');
  assert.ok(A.contains(CHOP_SHOP_COMPACT.x, CHOP_SHOP_COMPACT.z));
  const td = city.tarmacDepth(CHOP_SHOP_COMPACT.x, CHOP_SHOP_COMPACT.z);
  assert.ok(td >= 5 && td <= 8, `tarmacDepth ${td}`);
  assert.equal(CHOP_SHOP_COMPACT.r, CHOP_SHOP.r);
});

test('/tp refuses the destinations past the wall and still goes downtown, to Tokyo and the track', () => {
  const run = (dist, line) => {
    const hops = [];
    const eng = new CommandEngine({ chat: { post() {} }, hud: { flash() {} }, world: { district: dist }, teleport: (x, z) => hops.push([x, z]) });
    eng.execute(line);
    return hops.length;
  };
  for (const out of ['harbour', 'bridge', 'airport', 'north', 'marrow', 'steelgate']) {
    assert.equal(run(city, `/tp ${out}`), 0, `${out} refused`);
    assert.equal(run(full, `/tp ${out}`), 1, `${out} with the whole bay`);
  }
  for (const ok of ['downtown', 'tokyo', 'track']) assert.equal(run(city, `/tp ${ok}`), 1, `${ok} allowed`);
});

test('the feature tour skips the lift bridge in the compact city and keeps its eight scenes otherwise', () => {
  const ctx = (compact) => ({
    compact, warps: [], warp(x, z) { this.warps.push([x, z]); },
    car: { throttle: 0, brake: 0, headlights: false, headlightMode: 'low' },
    chase: { recentre() {}, looking: false, lookYaw: 0, lookPitch: 0 }, hud: { flash() {} },
    stepOutOfVehicle() {}, equipWeapon() {}, fireWeapon() {}, throwGrenade() {},
    spawnAndEnterTank: () => ({ steer: 0, throttle: 0, fireCannon() {} }),
  });
  const c = ctx(true), t = new FeatureTour(c);
  t.start();
  assert.equal(t.stages.length, 7);
  assert.ok(!t.stages.some((s) => s.id === 'bridge_physics'));
  for (let i = 0; i < 40 && t.active; i++) t.update(3);
  for (const [x, z] of c.warps) assert.ok(A.contains(x, z), `tour warped to (${x},${z})`);
  const f = new FeatureTour(ctx(false));
  f.start();
  assert.equal(f.stages.length, 8);
  f.stop({ download: false });
});

test('the big map transform: the whole bay unchanged, the city zoomed, clicks round-trip', () => {
  const W0 = 1680, H0 = 1200;
  const old = (b) => {   // the transform as it was, for the whole bay
    const sc = Math.min((W0 - 52) / b.w, (H0 - 80) / b.h);
    return { sc, ox: (W0 - b.w * sc) / 2, oz: 54 + (H0 - 80 - b.h * sc) / 2 };
  };
  const tf = mapTransform(W0, H0, { x0: 0, z0: 0, x1: full.bounds.w, z1: full.bounds.h });
  const o = old(full.bounds);
  for (const k of ['sc', 'ox', 'oz']) assert.ok(Math.abs(tf[k] - o[k]) < 1e-9, k);
  const pb = city.playBounds;
  const tc = mapTransform(W0, H0, { x0: pb.x0 - 60, z0: pb.z0 - 60, x1: pb.x1 + 60, z1: pb.z1 + 60 });
  assert.ok(tc.sc / tf.sc > 1.8, `zoom ${(tc.sc / tf.sc).toFixed(2)}x`);
  for (const t of [tf, tc]) for (const [x, z] of [[2354, 1408], [1509, 930], [2955, 2362.5]]) {
    const px = t.ox + x * t.sc, pz = t.oz + z * t.sc;
    assert.ok(Math.abs((px - t.ox) / t.sc - x) < 0.01 && Math.abs((pz - t.oz) / t.sc - z) < 0.01);
    if (t === tc) assert.ok(px >= 0 && px <= W0 && pz >= 54 && pz <= H0, 'the city fits under the title bar');
  }
});

test('the faster water test answers exactly as the old least-distance walk', () => {
  const data = read();
  const near = (pts, x, z) => {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0], az = pts[i][1], vx = pts[i + 1][0] - ax, vz = pts[i + 1][1] - az, l = vx * vx + vz * vz;
      let t = l ? ((x - ax) * vx + (z - az) * vz) / l : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
    }
    return best;
  };
  const inPoly = (poly, x, z) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const rnd = mulberry32(3);
  let wet = 0, river = 0, decks = 0;
  const check = (x, z) => {
    const inRiver = near(data.water.river.points, x, z) < data.water.river.width / 2;
    const open = x > full.bounds.w + 20 || inRiver || inPoly(data.water.bay, x, z);
    const onDeck = data.bridges.some((br) => near(br.points, x, z) < br.width / 2 + 2.5);
    assert.equal(full.inOpenWater(x, z), open, `open water at (${x.toFixed(1)},${z.toFixed(1)})`);
    assert.equal(full.inWater(x, z), onDeck ? false : open, `water at (${x.toFixed(1)},${z.toFixed(1)})`);
    wet += open; river += inRiver; decks += onDeck;
  };
  for (let i = 0; i < 20000; i++) check(rnd() * 4400 - 100, rnd() * 3200 - 100);
  // and densely along the river, where the early exit and the box reject both bite
  for (const [px, pz] of data.water.river.points) for (let k = 0; k < 20; k++) check(px + (rnd() - 0.5) * 160, pz + (rnd() - 0.5) * 160);
  assert.ok(wet > 1000 && river > 500 && decks > 20, `${wet} wet, ${river} river, ${decks} on decks`);
});

test('street life picks its manholes and hydrants inside the city', () => {
  // the steam puff paints a 64 px canvas; nothing else here touches the DOM
  const had = globalThis.document;
  const ctx2d = new Proxy({}, { get: (o, k) => (k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}) });
  globalThis.document = { createElement: () => ({ getContext: () => ctx2d }) };
  try {
    const inCity = new StreetLife(new THREE.Scene(), city), whole = new StreetLife(new THREE.Scene(), full);
    assert.equal(inCity.manholes.length, 12);
    assert.equal(inCity.hydrants.length, 24);
    for (const p of [...inCity.manholes, ...inCity.hydrants]) assert.ok(A.contains(p.x, p.z), `(${p.x.toFixed(0)},${p.z.toFixed(0)}) outside`);
    assert.ok(whole.manholes.some((p) => !A.contains(p.x, p.z)), 'the whole bay still picks by file order');
  } finally { if (had === undefined) delete globalThis.document; else globalThis.document = had; }
});

test('the riverside banks stop 300 m past the compact city, whole with the whole bay', () => {
  const extent = (d) => {
    const g = buildRiverside(new THREE.Scene(), d, true, null).group;
    let worst = -Infinity, verts = 0;
    g.traverse((o) => {
      if (!o.isMesh) return;
      const p = o.geometry.attributes.position;
      verts += p.count;
      for (let i = 0; i < p.count; i += 5) worst = Math.max(worst, A.probe(p.getX(i), p.getZ(i)).d);
      o.geometry.dispose();
    });
    return { worst, verts };
  };
  const c = extent(city), f = extent(full);
  assert.ok(c.worst < 300 + 12, `a bank panel ${c.worst.toFixed(0)} m out`);   // a panel's midpoint is tested; its ends reach half a panel further
  assert.ok(f.worst > 900, 'the whole bay keeps the whole river');
  assert.ok(c.verts < f.verts * 0.6, `${c.verts} vs ${f.verts} vertices`);
});
