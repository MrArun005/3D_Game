import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLiftBridge, LIFT_BRIDGE, DECK_Y } from '../src/world/liftBridge.js';
import { MAT_KEYS } from '../src/world/artKit.js';

const triCount = (geo) => (geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3);
const build = (lift = 0) => buildLiftBridge(LIFT_BRIDGE.a, LIFT_BRIDGE.b, LIFT_BRIDGE.width, { lift });
const POSES = [0, 0.5, 1];
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tol ${tol})`);
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

test('liftBridge: the artKit contract -- known material keys, full attribute set, four draws', () => {
  const b = build();
  assert.ok(b.parts.length > 100, `parts ${b.parts.length}`);
  const keys = new Set();
  for (const { geo, mat } of b.parts) {
    assert.ok(MAT_KEYS.includes(mat), `material ${mat}`);
    keys.add(mat);
    for (const a of ['position', 'normal', 'uv', 'color', 'emit', 'flick']) assert.ok(geo.attributes[a], `${mat} lacks ${a}`);
    assert.ok(geo.attributes.uv.array.some((v) => v !== 0), `${mat} has an all-zero UV attribute`);
  }
  // steel, concrete, trim, lights -- one merged mesh each, so four draws for the landmark
  assert.deepEqual([...keys].sort(), ['concrete', 'dark', 'emit', 'metal']);
  assert.ok(b.lamps.length >= 6 && b.lamps.every((l) => Number.isFinite(l.x) && Number.isFinite(l.y) && Number.isFinite(l.z) && l.colour !== undefined), 'hero light heads');
  assert.ok(b.lamps.some((l) => l.colour === 0xff2a18), 'red warning light on the tower tops');
  assert.ok(b.lamps.some((l) => l.colour === 0x2bff77), 'green navigation light over the channel');
  assert.equal(b.tris, b.parts.reduce((n, { geo }) => n + triCount(geo), 0), 'reported triangle count');
});

test('liftBridge: the same plan line builds the same bridge, every pose', () => {
  for (const lift of POSES) {
    const a = build(lift), b = build(lift);
    assert.equal(a.parts.length, b.parts.length);
    for (let i = 0; i < a.parts.length; i++) {
      assert.equal(a.parts[i].mat, b.parts[i].mat);
      assert.deepEqual(Array.from(a.parts[i].geo.attributes.position.array), Array.from(b.parts[i].geo.attributes.position.array), `part ${i} at lift ${lift}`);
    }
    assert.deepEqual(a.rig, b.rig);
    assert.deepEqual(a.solids, b.solids);
  }
});

test('liftBridge: 14,000 triangle budget, and it is not a box either', () => {
  for (const lift of POSES) {
    const b = build(lift);
    assert.ok(b.tris <= 14000, `lift ${lift}: ${b.tris} triangles`);
    assert.ok(b.tris > 3000, `lift ${lift}: ${b.tris} triangles is not a lattice`);
  }
  // posing the span must not change what is drawn, only where
  assert.equal(build(0).tris, build(1).tris);
});

test('liftBridge: towers stand 55-65 m, the deck corridor is the plan line', () => {
  const b = build();
  const { a, b: pb, length, angle } = LIFT_BRIDGE;
  near(length, Math.hypot(pb[0] - a[0], pb[1] - a[1]), 1e-9, 'length');
  near(b.length, length, 1e-9, 'reported length');
  near(b.angle, angle, 1e-9, 'reported angle');
  assert.ok(b.height >= 55 && b.height <= 68, `height ${b.height}`);

  let mnY = Infinity, mxY = -Infinity, maxOff = 0, minT = Infinity, maxT = -Infinity;
  const c = Math.cos(angle), s = Math.sin(angle);
  for (const { geo } of b.parts) {
    const p = geo.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      const dx = p[i] - a[0], dz = p[i + 2] - a[1];
      const t = dx * c + dz * s, off = Math.abs(-dx * s + dz * c);
      mnY = Math.min(mnY, p[i + 1]); mxY = Math.max(mxY, p[i + 1]);
      maxOff = Math.max(maxOff, off); minT = Math.min(minT, t); maxT = Math.max(maxT, t);
    }
  }
  // tower legs are 58 m; machinery house and beacon take the silhouette to ~63
  assert.ok(mxY >= 55 && mxY <= 66, `top of the steel ${mxY}`);
  assert.ok(mnY >= -8 && mnY < 0, `caissons reach the riverbed but not the mantle (${mnY})`);
  assert.ok(maxOff <= LIFT_BRIDGE.width / 2 + 10, `nothing wider than the deck band + towers (${maxOff})`);
  assert.ok(minT >= -2 && maxT <= length + 2, `stays between the abutments (${minT} .. ${maxT})`);
});

test('liftBridge: the span is DOWN at lift 0 and rises by the full travel at lift 1', () => {
  const down = build(0);
  assert.equal(down.rig.spanY, DECK_Y, 'lift 0 puts the span on the plan deck height');
  assert.equal(down.lift, 0, 'default pose is down');
  assert.equal(buildLiftBridge(LIFT_BRIDGE.a, LIFT_BRIDGE.b, LIFT_BRIDGE.width).lift, 0, 'opts is optional');
  for (const lift of POSES) {
    const b = build(lift);
    near(b.rig.spanY, DECK_Y + lift * b.rig.travel, 1e-9, `span height at lift ${lift}`);
    // every cable lug rides with the span, every counterweight against it
    for (const l of b.rig.lugs) near(l.y, b.rig.spanY + b.rig.trussH, 1e-9, 'lug on the top chord');
    for (const w of b.rig.counterweights) near(w.y, build(0).rig.counterweights[0].y - lift * b.rig.travel, 1e-9, 'counterweight moves the other way');
  }
  // clamped, not trusted
  assert.equal(buildLiftBridge(LIFT_BRIDGE.a, LIFT_BRIDGE.b, 26, { lift: 4 }).rig.spanY, build(1).rig.spanY);
  assert.equal(buildLiftBridge(LIFT_BRIDGE.a, LIFT_BRIDGE.b, 26, { lift: -3 }).rig.spanY, DECK_Y);
});

test('liftBridge: every cable touches its sheave at one end and its span lug or counterweight at the other, in every pose', () => {
  let total = null;
  for (const lift of POSES) {
    const b = build(lift);
    assert.equal(b.rig.sheaves.length, 4, 'two towers, two side-frames each');
    assert.equal(b.rig.counterweights.length, 4, 'one counterweight per sheave');
    assert.equal(b.rig.cables.length, 8, 'a span run and a counterweight run per sheave');

    for (const cb of b.rig.cables) {
      assert.ok(cb.len > 0.5, `lift ${lift}: cable ${cb.end} has length ${cb.len}`);
      // upper end is on the sheave it runs over -- within the wheel, i.e. it is a tangent, not a guess
      const sh = b.rig.sheaves.find((s) => dist([s.x, s.y, s.z], cb.from) <= s.r + 1e-6);
      assert.ok(sh, `lift ${lift}: ${cb.end} cable does not reach any sheave`);
      near(cb.from[1], sh.y, 1e-9, 'cable leaves the sheave at axle height');
      near(dist(cb.from, cb.to), Math.abs(cb.len), 1e-9, 'length is measured from the endpoints');

      // lower end is bolted to the thing it carries
      if (cb.end === 'span') {
        const lug = b.rig.lugs.find((l) => dist([l.x, l.y, l.z], cb.to) <= 1e-6);
        assert.ok(lug, `lift ${lift}: span cable misses the lift span's lug`);
      } else {
        const w = b.rig.counterweights.find((c) => Math.hypot(c.x - cb.to[0], c.z - cb.to[2]) <= 1e-6);
        assert.ok(w, `lift ${lift}: counterweight cable misses the counterweight`);
        near(cb.to[1], w.y, 1e-9, 'it lands on the counterweight top');
      }
    }
    // the two runs over one sheave sum to a constant: the cable is not stretching
    const sums = b.rig.sheaves.map((s) => b.rig.cables.filter((c) => dist([s.x, s.y, s.z], c.from) <= s.r + 1e-6).reduce((n, c) => n + c.len, 0));
    assert.equal(sums.length, 4);
    for (const v of sums) near(v, sums[0], 1e-9, 'both sheaves on a tower carry the same cable');
    if (total === null) total = sums[0]; else near(sums[0], total, 1e-9, `cable length changed at lift ${lift}`);
  }
  assert.ok(total > 20, `a real cable length (${total})`);
});

test('liftBridge: solids cover every tower leg, in districtWorld box shape', () => {
  const b = build();
  assert.equal(b.solids.length, 4, 'one solid per side-frame');
  assert.equal(b.rig.legs.length, 16, 'four legs per side-frame');
  for (const s of b.solids) {
    for (const k of ['x', 'z', 'hw', 'hd', 'angle', 'height']) assert.ok(Number.isFinite(s[k]), `solid lacks ${k}`);
    assert.ok(s.height > 50, `a solid tall enough to stop anything (${s.height})`);
    assert.equal(s.local, undefined, 'the local-frame marker is stripped on the way out');
  }
  for (const leg of b.rig.legs) {
    const hit = b.solids.some((s) => {
      // vehicle/collision.js:resolveBoxes -- a box's angle turns its +X to (cos a, sin a)
      const c = Math.cos(s.angle), sn = Math.sin(s.angle), dx = leg.x - s.x, dz = leg.z - s.z;
      return Math.abs(dx * c + dz * sn) <= s.hw + 1e-6 && Math.abs(-dx * sn + dz * c) <= s.hd + 1e-6;
    });
    assert.ok(hit, `leg at ${leg.x.toFixed(1)}, ${leg.z.toFixed(1)} is undefended`);
  }
});

test('liftBridge: keep-out covers the towers and nothing else', () => {
  const b = build();
  assert.equal(b.keepOut.length, 2, 'one rect per tower, not the whole 381 m of harbour');
  // landmarks.js:keepOutAt, verbatim
  const inside = (x, z, pad = 1.5) => b.keepOut.some((k) => {
    const dx = x - k.x, dz = z - k.z;
    return Math.abs(dx * k.cy - dz * k.sy) <= k.hw + pad && Math.abs(dx * k.sy + dz * k.cy) <= k.hd + pad;
  });
  for (const leg of b.rig.legs) assert.ok(inside(leg.x, leg.z), 'a tower leg is inside the keep-out');
  for (const k of b.keepOut) near(k.cy * k.cy + k.sy * k.sy, 1, 1e-9, 'cy/sy are a unit rotation');
  // the abutments are ordinary quayside and must still get dressed
  const { a, b: pb } = LIFT_BRIDGE, c = Math.cos(LIFT_BRIDGE.angle), s = Math.sin(LIFT_BRIDGE.angle);
  for (const t of [0, 30, LIFT_BRIDGE.length - 30, LIFT_BRIDGE.length]) assert.ok(!inside(a[0] + t * c, a[1] + t * s), `keep-out reaches t=${t}`);
  assert.ok(!inside(pb[0], pb[1]), 'the far abutment is free');
});

test('liftBridge: LIFT_BRIDGE metadata matches the plan entry without re-deriving it', () => {
  assert.equal(LIFT_BRIDGE.name, 'HALSTEAD LIFT BRIDGE');
  assert.deepEqual(LIFT_BRIDGE.a, [1939, 2317]);
  assert.deepEqual(LIFT_BRIDGE.b, [1962, 2698]);
  assert.equal(LIFT_BRIDGE.width, 26);
  assert.equal(LIFT_BRIDGE.deckY, DECK_Y);
  near(LIFT_BRIDGE.x, (1939 + 1962) / 2, 1e-9, 'midpoint x');
  near(LIFT_BRIDGE.z, (2317 + 2698) / 2, 1e-9, 'midpoint z');
  near(LIFT_BRIDGE.length, 381.69, 0.01, 'plan length');
  near(LIFT_BRIDGE.height, build().height, 1e-9, 'published height is the built height');
  // the metadata angle really does point from a to b
  const c = Math.cos(LIFT_BRIDGE.angle), s = Math.sin(LIFT_BRIDGE.angle);
  near(1939 + LIFT_BRIDGE.length * c, 1962, 1e-6, 'angle x');
  near(2317 + LIFT_BRIDGE.length * s, 2698, 1e-6, 'angle z');
});

test('liftBridge: the navigation channel is clear and the steel stands on real deck', () => {
  const b = build();
  const { a, angle, length: L, width } = LIFT_BRIDGE;
  const c = Math.cos(angle), s = Math.sin(angle), half = width / 2;
  const tA = L / 2 - 42, tB = L / 2 + 42;          // the two towers, TOWER_GAP apart
  /* Local frame: t along the plan line from a, off across it. districtWorld
     DRAWS the carriageway at +-s.half (13 m here) and nothing beyond it --
     elevationAt lifts the band to 18.5 but no geometry is emitted there, so
     anything above deck level further out than the kerb has to be carried by
     a caisson or by the lift span itself, or it hangs in open air. */
  const boxes = b.parts.map(({ geo, mat }) => {
    geo.computeBoundingBox();
    const bb = geo.boundingBox, lo = [], hi = [];
    for (const [px, pz] of [[bb.min.x, bb.min.z], [bb.max.x, bb.max.z]]) {
      const dx = px - a[0], dz = pz - a[1];
      lo.push(dx * c + dz * s); hi.push(-dx * s + dz * c);
    }
    return { mat, t0: Math.min(...lo), t1: Math.max(...lo), o0: Math.min(...hi), o1: Math.max(...hi), off: Math.max(Math.abs(hi[0]), Math.abs(hi[1])), y0: bb.min.y, y1: bb.max.y };
  });

  // 1. nothing concrete in the water between the towers: that is the channel
  //    the lift span exists to open. A pier stood at t=184 until 2026-09-12.
  //    The four tower caissons sit ON tA/tB, which is the channel EDGE.
  for (const x of boxes) {
    if (x.mat !== 'concrete' || x.y0 > -5) continue;
    const t = (x.t0 + x.t1) / 2;
    assert.ok(t < tA + 8 || t > tB - 8, `concrete to the riverbed at t=${t.toFixed(1)}, inside the channel ${tA.toFixed(0)}..${tB.toFixed(0)}`);
  }

  // 2. every above-deck part outboard of the kerb is on a caisson or the span
  for (const x of boxes) {
    if (x.y0 < 7.0 || x.off <= half + 0.05) continue;
    const t = (x.t0 + x.t1) / 2;
    const onCaisson = Math.abs(t - tA) < 6 || Math.abs(t - tB) < 6;
    const onSpan = x.t0 >= tA + 4.5 && x.t1 <= tB - 4.5;
    assert.ok(onCaisson || onSpan, `${x.mat} at t=${t.toFixed(1)} hangs ${x.off.toFixed(1)} m out over the water`);
  }

  // 3. headroom: the lowest member that reaches out over the carriageway
  //    (the portal knee braces at +-8.8 m, not the railing on the parapet)
  const over = boxes.filter((x) => x.y0 >= 8 && x.o0 < half - 2 && x.o1 > -(half - 2));
  assert.ok(over.length > 0, 'nothing overhead at all -- there is no cage');
  const clear = Math.min(...over.map((x) => x.y0)) - DECK_Y;
  assert.ok(clear >= 5.0, `only ${clear.toFixed(2)} m of clearance over the carriageway`);
});
