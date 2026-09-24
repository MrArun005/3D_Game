/* London's red buses and black cabs (world/londonVehicles.js) and their place
   in the civilian fleet (vendorCars.js install, traffic.js). The geometry
   half holds the rules every authored asset keeps: finite attributes, real
   UVs, every triangle wound with its normals, shells facing out, a triangle
   budget, determinism. The fleet half drives the real Traffic class on the
   compact city's graph: the quota, the spec and lamps the kit brings, the LOD
   swap, the bus's length in the leader gap, the stop line and the spawn. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import {
  londonKit, londonKitFor, londonTriangles, LONDON_SPECS, LONDON_PAINTS, fleetStyle, londonEnabled,
  setLondonNight, londonNight, _internals,
} from '../src/world/londonVehicles.js';
import { ZEBRA_DEPTH } from '../src/game/traffic.js';

// every vendor file fails at once (as in vendorCars-boot.test.js): only the code-built London kits install
for (const L of [GLTFLoader, OBJLoader, MTLLoader]) L.prototype.load = function (url, _a, _b, onError) { onError?.(new Error('offline (test)')); };
const quietly = async (fn) => {
  const warn = console.warn, info = console.info;
  console.warn = () => {}; console.info = () => {};
  try { return await fn(); } finally { console.warn = warn; console.info = info; }
};

const STYLES = ['bus', 'cab'];
const geos = (k) => ({ paint: k.paint, detail: k.detail, lod: k.lodBody, head: k.lamps.head, tail: k.lamps.tail });

/* ----------------------------------------------------------- geometry */

test('both kits: indexed, finite, real UVs, the London attributes on detail and LOD', () => {
  for (const style of STYLES) {
    const k = londonKit(style);
    for (const [name, g] of Object.entries(geos(k))) {
      assert.ok(g.index, `${style} ${name} is indexed`);
      for (const [an, a] of Object.entries(g.attributes)) for (let i = 0; i < a.array.length; i++) assert.ok(Number.isFinite(a.array[i]), `${style} ${name}.${an}[${i}] finite`);
      const uv = g.attributes.uv;
      assert.ok(uv, `${style} ${name} carries UVs (CLAUDE.md rule 4)`);
      let u0 = Infinity, u1 = -Infinity, nonzero = 0;
      for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); u0 = Math.min(u0, u); u1 = Math.max(u1, u); if (u !== 0 || v !== 0) nonzero++; }
      assert.ok(u1 - u0 > 0.05 && nonzero > uv.count * 0.5, `${style} ${name}: UVs vary (not the all-zero fill)`);
      const max = g.index.array.reduce((m, v) => Math.max(m, v), 0);
      assert.ok(max < g.attributes.position.count, `${style} ${name}: indices in range`);
    }
    for (const g of [k.detail, k.lodBody]) {
      for (const a of ['color', 'aSurf', 'aEmit', 'aPart']) assert.ok(g.attributes[a], `${style} detail/LOD carries ${a}`);
      // WebGPU's default maxVertexBuffers is 8: what the London shader reads (uv is carried for rule 4, not read)
      assert.ok(['position', 'normal', 'color', 'aSurf', 'aEmit', 'aPart'].every((a) => g.attributes[a]) && Object.keys(g.attributes).length <= 7, `${style}: ${Object.keys(g.attributes).join(', ')}`);
    }
  }
});

test('every triangle is wound with its normals (the tank track was inside out once)', () => {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), f = new THREE.Vector3(), n = new THREE.Vector3(), v = new THREE.Vector3();
  for (const style of STYLES) for (const [name, g] of Object.entries(geos(londonKit(style)))) {
    const p = g.attributes.position, nn = g.attributes.normal, ix = g.index.array;
    let wrong = 0, total = 0;
    for (let i = 0; i < ix.length; i += 3) {
      a.fromBufferAttribute(p, ix[i]); b.fromBufferAttribute(p, ix[i + 1]); c.fromBufferAttribute(p, ix[i + 2]);
      f.subVectors(b, a).cross(v.subVectors(c, a));
      if (f.lengthSq() < 1e-12) continue;   // the collapsed ridge / corner points: zero area, nothing to draw
      n.fromBufferAttribute(nn, ix[i]).add(v.fromBufferAttribute(nn, ix[i + 1])).add(v.fromBufferAttribute(nn, ix[i + 2]));
      total++;
      if (f.dot(n) <= 0) wrong++;
    }
    assert.ok(total > 0);
    assert.equal(wrong, 0, `${style} ${name}: ${wrong} of ${total} triangles face against their normals`);
  }
});

test('the painted shells face OUT: away from the body\'s long axis', () => {
  // winding agreeing with normals is not enough -- both could point in. Measure against the body itself.
  const axis = { bus: (x) => [Math.max(-3.9, Math.min(3.7, x)), 1.9], cab: (x) => [Math.max(-1.8, Math.min(1.8, x)), 0.85] };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), f = new THREE.Vector3(), v = new THREE.Vector3();
  for (const style of STYLES) for (const [name, g] of [['paint', londonKit(style).paint], ['lod', londonKit(style).lodBody]]) {
    const p = g.attributes.position, ix = g.index.array;
    let out = 0, total = 0;
    for (let i = 0; i < ix.length; i += 3) {
      a.fromBufferAttribute(p, ix[i]); b.fromBufferAttribute(p, ix[i + 1]); c.fromBufferAttribute(p, ix[i + 2]);
      f.subVectors(b, a).cross(v.subVectors(c, a));
      if (f.lengthSq() < 1e-12) continue;
      const m = a.clone().add(b).add(c).multiplyScalar(1 / 3), [ax, ay] = axis[style](m.x);
      total++;
      if (f.dot(v.set(m.x - ax, m.y - ay, m.z)) > 0) out++;
    }
    assert.ok(out / total > (name === 'paint' ? 0.98 : 0.9), `${style} ${name}: ${out} of ${total} face out`);
  }
});

test('size: a 10.5 x 2.55 x 4.4 m bus and a 4.58 x 1.74 m cab, on the ground, facing +X', () => {
  const bb = (g) => { g.computeBoundingBox(); return g.boundingBox; };
  const bus = bb(londonKit('bus').paint), cab = bb(londonKit('cab').paint);
  assert.ok(Math.abs(bus.max.x - bus.min.x - 10.5) < 0.02 && Math.abs(bus.max.z - bus.min.z - 2.55) < 0.02, 'bus footprint');
  assert.ok(bus.max.y > 4.3 && bus.max.y < 4.5, `bus height ${bus.max.y.toFixed(2)}`);
  assert.ok(Math.abs(cab.max.x - cab.min.x - 4.58) < 0.02 && Math.abs(cab.max.z - cab.min.z - 1.74) < 0.04, 'cab footprint');
  const sign = bb(londonKit('cab').detail);
  assert.ok(sign.max.y > 1.84 && sign.max.y < 1.92, `the TAXI sign tops the cab at ${sign.max.y.toFixed(2)} m`);
  // wheels touch the road: the lowest detail vertex is the tyre at y = 0
  for (const style of STYLES) assert.ok(Math.abs(bb(londonKit(style).detail).min.y) < 0.01, `${style} tyres on the ground`);
  // the nose is +X: the headlamp geometry is ahead of the centre, the brake lamps behind it
  for (const style of STYLES) {
    const k = londonKit(style);
    assert.ok(bb(k.lamps.head).min.x > k.spec.L / 2 - 0.1, `${style} head lamps at the nose`);
    assert.ok(bb(k.lamps.tail).max.x < -k.spec.L / 2 + 0.1, `${style} brake lamps at the tail`);
  }
});

test('the lamp pair sits where streaks.js and lighting.js look for it (L/2, bonnetY * 0.78, +-wMax * 0.62)', () => {
  for (const style of STYLES) {
    const k = londonKit(style), s = k.spec, g = k.lamps.head;
    g.computeBoundingBox();
    const c = g.boundingBox.getCenter(new THREE.Vector3());
    // on the lens, a few cm proud of the nose: the streak sprite is pulled 1 m toward the camera anyway
    assert.ok(Math.abs(g.boundingBox.max.x - (s.L / 2 - 0.04)) < 0.10, `${style} lamp x ${g.boundingBox.max.x.toFixed(2)}`);
    assert.ok(Math.abs(c.y - s.bonnetY * 0.78) < 0.03, `${style} lamp height ${c.y.toFixed(3)} vs ${(s.bonnetY * 0.78).toFixed(3)}`);
    // one lamp either side, each within 10 cm of the streak's lateral offset
    const p = g.attributes.position;
    let zr = 0, nr = 0;
    for (let i = 0; i < p.count; i++) if (p.getZ(i) > 0) { zr += p.getZ(i); nr++; }
    assert.ok(Math.abs(zr / nr - s.wMax * 0.62) < 0.10, `${style} lamp lateral ${(zr / nr).toFixed(2)} vs ${(s.wMax * 0.62).toFixed(2)}`);
  }
});

test('triangle budgets: comparable to the fleet (2.0-3.3k), under the 4k traffic line; the LOD a fifth or less', (tc) => {
  for (const style of STYLES) {
    const t = londonTriangles(style);
    tc.diagnostic(`${style}: paint ${t.paint} + detail ${t.detail} = ${t.total}, LOD ${t.lod}`);
    assert.ok(t.total <= 4000, `${style} ${t.total} triangles (docs/BUDGETS.md: vehicle traffic 4000)`);
    assert.ok(t.total >= 1500, `${style} is detailed (${t.total})`);
    assert.ok(t.lod <= t.total * 0.25, `${style} LOD ${t.lod} of ${t.total}`);
  }
});

test('deterministic: two builds are identical', () => {
  for (const style of STYLES) {
    const a = _internals.buildKit(style), b = _internals.buildKit(style);
    for (const part of ['paint', 'detail', 'lodBody']) for (const name of Object.keys(a[part].attributes)) {
      assert.deepEqual(a[part].attributes[name].array, b[part].attributes[name].array, `${style} ${part}.${name}`);
    }
  }
});

test('the wheels turn about their own hubs: aPart is (hub x, hub y, -radius) on wheel vertices, z >= 0 elsewhere', () => {
  for (const style of STYLES) {
    const k = londonKit(style), w = k.detail.attributes.aPart, p = k.detail.attributes.position;
    const hubs = new Set();
    let onWheel = 0;
    for (let i = 0; i < w.count; i++) {
      if (w.getZ(i) >= 0) continue;
      onWheel++;
      assert.ok(Math.abs(-w.getZ(i) - k.spec.wheelR) < 1e-6, `${style} wheel radius`);
      const r = Math.hypot(p.getX(i) - w.getX(i), p.getY(i) - w.getY(i));
      assert.ok(r <= k.spec.wheelR + 1e-4, `${style} a wheel vertex sits inside its own wheel (${r.toFixed(3)})`);
      hubs.add(`${w.getX(i).toFixed(2)},${w.getY(i).toFixed(2)}`);
    }
    assert.equal(hubs.size, 2, `${style}: two axles (front, rear) share the hub x/y`);
    assert.ok(onWheel > 0 && onWheel < w.count, 'only the wheels turn');
  }
});

test('the hero-sized cab (a carjack): scaled to the hull, no wheels of its own, built once', () => {
  const spec = { L: 4.64, wMax: 0.90 };
  const a = londonKitFor('cab', spec, { wheels: false }), b = londonKitFor('cab', spec, { wheels: false });
  assert.equal(a, b, 'cached per size');
  a.paint.computeBoundingBox();
  assert.ok(Math.abs(a.paint.boundingBox.max.x - a.paint.boundingBox.min.x - 4.64) < 0.02, 'as long as the hull');
  const w = a.detail.attributes.aPart;
  for (let i = 0; i < w.count; i++) assert.ok(w.getZ(i) >= 0, 'the hero keeps its own wheels');
  assert.equal(londonKitFor('cab', LONDON_SPECS.cab), londonKit('cab'), 'the fleet size is the shared kit');
});

test('fleet quota: a bus in slot 4 of every 11, ?london=all fills the pool, ?nolondon none', () => {
  const buses = (n, q = '') => [...Array(n).keys()].filter((i) => fleetStyle(i, q) === 'bus').length;
  assert.equal(buses(14), 1);
  assert.equal(buses(18), 2);
  assert.equal(buses(26), 2);
  assert.equal(buses(36), 3);
  assert.equal(buses(40), 4);
  assert.equal(fleetStyle(4, ''), 'bus');
  assert.equal(fleetStyle(0, ''), undefined, 'every other slot rolls the weighted dice');
  assert.equal(buses(18, '?nolondon'), 0);
  assert.equal(fleetStyle(0, '?london=all'), 'bus');
  assert.equal(fleetStyle(1, '?london=all'), 'cab');
  assert.equal(londonEnabled('?nolondon'), false);
  assert.equal(londonEnabled('?foo'), true);
  setLondonNight(3); assert.equal(londonNight(), 1);
  setLondonNight(-1); assert.equal(londonNight(), 0);
});

/* -------------------------------------------------------------- fleet */

const stubAssets = () => {
  const box = () => new THREE.BoxGeometry(4.4, 1.4, 1.8);
  const stunt = {};
  for (const k of ['sedan', 'hatch', 'wagon', 'suv', 'van', 'pickup']) stunt[k] = { body: box(), glass: box(), occupant: box(), lodBody: box() };
  return { geo: { stunt }, mat: { parked: new THREE.MeshStandardMaterial(), tailDim: new THREE.MeshStandardMaterial({ emissive: 0xa8181c }), carGlass: new THREE.MeshStandardMaterial() } };
};

test('the boot installs both with the London contract; cabs are weighted, the bus is quota-only; ?nolondon removes them', async () => {
  const { loadVendorCars, bootStyles, FLEET_ONLY, KENNEY_CARS } = await import('../src/world/vendorCars.js');
  const assets = stubAssets();
  const installed = await quietly(() => loadVendorCars(assets));
  assert.ok(installed.includes('bus') && installed.includes('cab'), `installed ${installed.join(', ')}`);
  for (const style of STYLES) {
    const k = assets.geo.stunt[style];
    assert.ok(k.body && k.glass && k.detailMat && k.lodBody && k.lamps?.head && k.lamps?.tail, `${style}: body, detail, LOD, lamps`);
    assert.equal(k.occupant, null, `${style}: no occupant draw behind opaque glass`);
    assert.equal(k.spec, LONDON_SPECS[style]);
    assert.deepEqual(k.paints, LONDON_PAINTS[style]);
  }
  const keys = assets.geo.stuntKeys;
  assert.equal(keys.filter((k) => k === 'cab').length, 4, 'cab weight 4');
  assert.equal(keys.filter((k) => k === 'bus').length, 0, 'the bus never comes from the random pick (rivals, race grids)');
  assert.equal(KENNEY_CARS.cab, 'l-cab', 'carjack a cab, drive a cab');
  assert.equal(KENNEY_CARS.bus, undefined, 'a bus is no hero body');
  assert.equal(FLEET_ONLY.bus, 'l-bus');
  globalThis.location = { search: '?nolondon' };
  try {
    assert.ok(!bootStyles().some(([k]) => k === 'bus' || k === 'cab'), '?nolondon: neither installs');
    const a2 = stubAssets();
    await quietly(() => loadVendorCars(a2));
    assert.equal(a2.geo.stunt.bus, undefined);
    assert.ok(!a2.geo.stuntKeys.includes('cab'));
  } finally { delete globalThis.location; }
});

/** A Traffic on the compact city's graph with the London kits installed. */
async function fleet(count, search = '') {
  const { loadVendorCars } = await import('../src/world/vendorCars.js');
  const { Traffic } = await import('../src/game/traffic.js');
  const { District } = await import('../src/world/district.js');
  const { COMPACT_POLY } = await import('../src/world/playArea.js');
  const assets = stubAssets();
  await quietly(() => loadVendorCars(assets));
  const data = JSON.parse(readFileSync(new URL('../public/halstead-bay.district.json', import.meta.url)));
  const district = new District(data, { play: COMPACT_POLY });
  if (search) globalThis.location = { search };
  let t;
  try { t = new Traffic(new THREE.Scene(), assets, count, 0); } finally { if (search) delete globalThis.location; }
  t.patrol = false;          // no cruisers: the officer rig loader is not what this tests
  t.useGraph(district);
  return { t, district };
}

test('Traffic: the quota lands two buses in an 18-car pool, with the London spec, paint, lamps and draws', async () => {
  const { t } = await fleet(18);
  const buses = t.cars.filter((c) => c.style === 'bus');
  assert.deepEqual(t.cars.map((c, i) => (c.style === 'bus' ? i : -1)).filter((i) => i >= 0), [4, 15]);
  for (const c of buses) {
    assert.equal(c.spec, LONDON_SPECS.bus);
    assert.ok(LONDON_PAINTS.bus.includes(c.mesh.material.color.getHex()), 'London red');
    assert.ok(c.fixedPaint);
    assert.deepEqual(c.offsets, LONDON_SPECS.bus.offsets);
    assert.ok(Math.max(...c.offsets.map(Math.abs)) + c.radius >= c.spec.L / 2, 'the collision circles cover the whole bus');
    assert.ok(c.reach >= c.spec.L / 2, 'collision.js rough reach');
    // paint + detail + LOD + brake + lamp pair; no occupant. By day 3 draw (the LOD and the lamps are hidden).
    assert.equal(c.mesh.children.length, 4);
    assert.ok(c.london && c.london.lod.visible === false && c.london.detail.visible);
    assert.equal(c.london.lod.userData, c.london.detail.userData, 'LOD and detail read the same route');
  }
  const cab = t.cars.find((c) => c.style === 'cab');
  assert.ok(cab, 'a black cab in the pool');
  assert.ok(LONDON_PAINTS.cab.includes(cab.mesh.material.color.getHex()));
  assert.ok(cab.mesh.material.metalness > 0.3, 'glossy black');
  t.setNight(1);
  assert.equal(londonNight(), 1, 'Traffic.setNight lights the London material');
  assert.ok(t.lamps.every((l) => l.visible));
  t.setNight(0);
  assert.equal(londonNight(), 0);
});

test('Traffic: buses spawn with room on a whole edge, keep their length in the queue, stop their NOSE at the line, and swap to the LOD', async (tc) => {
  /* 24 cars (was 18, 2026-09-24): with the Quadrant's road changes 18 cars never queued behind a bus in 90 s, so the gap below went unchecked -- and at 24-30 it FAILED (0.75 m, then -1.65 m into a bus: a leader round a bend was unseen, traffic.js #leaderLimit). 24 makes the meetings happen. */
  const { t, district } = await fleet(24, '?london=all');   // a bus in three, the rest cabs: every interaction happens
  const player = { x: 2354, z: 1408, speed: 0, yaw: 0, fwdSpeed: 0 };
  const wasLive = new Map();
  let spawns = 0, followers = 0, minFollow = Infinity, atLine = 0, minNose = Infinity, lodSwaps = 0;
  const edgeWidthNear = (node, x, z) => {
    let best = Infinity, w = 10;
    for (const id of t.adj.get(node) ?? []) {
      const e = t.E[id];
      for (let i = 1; i < e.points.length; i++) {
        const [ax, az] = e.points[i - 1], [bx, bz] = e.points[i], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(ax + dx * u - x, az + dz * u - z);
        if (d < best) { best = d; w = e.width; }
      }
    }
    return w;
  };
  const dt = 1 / 60;
  for (let f = 0; f < 60 * 90; f++) {
    // the player drifts along with the fleet's first bus now and then, so the LOD has to come back near
    if (f % 1200 === 600) { const b = t.cars.find((c) => c.live && c.style === 'bus'); if (b) { player.x = b.x + 30; player.z = b.z; } }
    const farBefore = t.cars.map((c) => c.london?.far);
    t.update(player, dt, f * dt);
    t.cars.forEach((c, i) => { if (c.london && c.london.far !== farBefore[i] && c.live) lodSwaps++; });
    const live = t.cars.filter((c) => c.live);
    for (const c of t.cars) {
      const was = wasLive.get(c) ?? false;
      if (c.live && !was && c.spec.long) {
        spawns++;
        for (const o of live) {
          if (o === c) continue;
          const need = c.spec.L / 2 + o.spec.L / 2 + 3;
          assert.ok(Math.hypot(o.x - c.x, o.z - c.z) >= need - 1.5, `bus spawned ${Math.hypot(o.x - c.x, o.z - c.z).toFixed(1)} m from a ${o.style}`);
        }
      }
      wasLive.set(c, c.live);
    }
    for (const b of live) {
      if (!b.spec.long) continue;
      // anyone stopped right behind this bus, same lane, same way
      for (const o of live) {
        if (o === b || o.speed > 0.05) continue;
        const fx = Math.cos(o.yaw), fz = -Math.sin(o.yaw), dx = b.x - o.x, dz = b.z - o.z;
        const along = dx * fx + dz * fz, side = Math.abs(-dx * fz + dz * fx);
        const dyaw = Math.abs(((o.yaw - b.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (along > 0 && along < 25 && side < 1.0 && dyaw < 0.15 && b.speed < 0.05) {
          followers++;
          minFollow = Math.min(minFollow, along - b.spec.L / 2 - o.spec.L / 2);
        }
      }
      // a bus stopped at (or just short of) a stop line: its nose short of the crossing
      const g = b.gates[0];
      if (g && b.speed === 0 && g.s - b.s > -0.05 && g.s - b.s < b.spec.stopBack + 0.05) {
        const node = t.N.get(g.node[0]);
        const nx = b.x + Math.cos(b.yaw) * b.spec.L / 2, nz = b.z - Math.sin(b.yaw) * b.spec.L / 2;
        const clear = Math.hypot(nx - node.x, nz - node.y) - edgeWidthNear(g.node[0], b.x, b.z) / 2;
        atLine++;
        minNose = Math.min(minNose, clear);
      }
    }
  }
  tc.diagnostic(`bus spawns ${spawns}, follower frames ${followers} (min bumper gap ${minFollow.toFixed(2)} m), at-line frames ${atLine} (min nose clearance ${minNose.toFixed(2)} m), LOD swaps ${lodSwaps}`);
  assert.ok(spawns >= 6, `buses spawned (${spawns})`);
  assert.ok(followers > 20, `queues formed behind buses (${followers} frames)`);
  /* A follower keeps the same bumper gap behind a bus as behind a car: 8 m
     of gap from the bus's REAR, not its centre. Measured in this run: 4.01 m
     behind a bus, 4.00 m car behind car (approach lag eats ~1.7 m of the
     ideal 5.7); with the leader gap taken to the bus's centre, 1.08 m. */
  assert.ok(minFollow > 3.5, `bumper gap behind a stopped bus: ${minFollow.toFixed(2)} m`);
  assert.ok(atLine > 20, `buses waited at red lights (${atLine} frames)`);
  /* The nose stops where a sedan's does, 1.2 + zebra + 1.0 - 2.31 = ~4.1 m
     back from the carriageway edge (plus the lane offset: this is straight-
     line distance to the node). Measured: 5.28 m; with the centre stopping at
     the sedan's line, 2.23 m -- the front half across the crossing. */
  assert.ok(minNose > 1.2 + ZEBRA_DEPTH * 0.5, `bus nose ${minNose.toFixed(2)} m clear of the junction`);
  assert.ok(lodSwaps >= 2, `the LOD swaps both ways (${lodSwaps})`);
  void district;
});

test('the night path: with no setNight caller, traffic follows the HUD clock (main.js\'s curve); a setNight call takes over', async () => {
  const { nightOf } = await import('../src/game/traffic.js');
  assert.equal(nightOf(12), 0);
  assert.equal(nightOf(22), 1);
  assert.equal(nightOf(3), 1);
  assert.ok(Math.abs(nightOf(19.25) - 0.5) < 1e-9, 'half lit at 19:15');
  assert.ok(Math.abs(nightOf(6.2) - 0.5) < 1e-9, 'half lit at 06:12');
  const { t } = await fleet(18);
  const player = { x: 2354, z: 1408, speed: 0, yaw: 0, fwdSpeed: 0 };
  t.hud = { clock: { hour: 16.85 } };                     // main's day boot
  t.update(player, 1 / 60, 0);
  assert.equal(londonNight(), 0);
  assert.ok(t.lamps.every((l) => !l.visible), 'by day the lamp pairs cost no draw');
  t.hud.clock.hour = 21.5;                                 // the clock runs into the night
  t.update(player, 1 / 60, 1 / 60);
  assert.equal(londonNight(), 1, 'blinds, saloon lights and TAXI signs light up');
  assert.ok(t.lamps.every((l) => l.visible), 'and every headlamp pair, London or not');
  assert.ok(t.lampMat.emissiveIntensity > 2.5);
  t.setNight(0.25);                                        // main feeds it again: the clock read stops
  t.update(player, 1 / 60, 2 / 60);
  assert.equal(londonNight(), 0.25);
  assert.equal(t.night, 0.25);
});

test('Traffic: a far London vehicle is ONE draw (LOD), a near one turns its wheels', async () => {
  const { t } = await fleet(18);
  const bus = t.cars[4];
  const player = { x: 2354, z: 1408, speed: 0, yaw: 0, fwdSpeed: 0 };
  const dt = 1 / 60;
  // run until the bus is live, then stand the player next to it and away from it
  for (let f = 0; f < 600 && !bus.live; f++) t.update(player, dt, f * dt);
  assert.ok(bus.live, 'the bus spawned');
  const near = { ...player, x: bus.x + 20, z: bus.z };
  for (let f = 0; f < 30; f++) { near.x = bus.x + 20; near.z = bus.z; t.update(near, dt, 10 + f * dt); }
  assert.equal(bus.london.far, false);
  assert.ok(bus.mesh.material.visible && bus.london.detail.visible && !bus.london.lod.visible, 'near: paint + detail');
  const roll = bus.london.detail.userData.roll;
  assert.ok(roll >= 0 && roll < 2 * Math.PI * LONDON_SPECS.bus.wheelR, `roll wrapped to one turn (${roll})`);
  const far = { ...player, x: bus.x + 200, z: bus.z };
  for (let f = 0; f < 30; f++) { far.x = bus.x + 200; far.z = bus.z; t.update(far, dt, 11 + f * dt); }
  assert.equal(bus.london.far, true);
  assert.ok(!bus.mesh.material.visible && !bus.london.detail.visible && bus.london.lod.visible, 'far: the LOD alone');
});
