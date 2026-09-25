import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { District, ARCH_GRADE, LIFT_GRADE, FREEWAY_H } from '../src/world/district.js';
import { COMPACT_POLY } from '../src/world/playArea.js';
import { buildSpan, signatureBridge } from '../src/world/spans.js';
import { buildLiftBridge } from '../src/world/liftBridge.js';
import { useDistrict, groundHeightAt } from '../src/world/metrics.js';
import { createCarState, resetCar, stepVehicle } from '../src/vehicle/dynamics.js';
import { Traffic } from '../src/game/traffic.js';

/* Every span in Halstead Bay, pinned (2026-09-25). The full audit is the
   scratchpad's bridge-audit.mjs; these are its invariants:
   - no ground road crossing a span steps > 0.5 m, and the real car drives
     through every crossing with every parapet / tower box in place;
   - every deck is flat across, no grade over 8%, bridges land at grade;
   - the drawn tarmac follows the physics surface;
   - no pier column stands in a road, >= 4.5 m clearance over any road under;
   - the parapets hold the car on the deck at 30 / 80 / 120 km/h, scraping;
   - traffic on the expressway rides the deck, not the street under it.
   History: "moving under a bridge stops me with an invisible wall" -- river
   bridges were 7.6 m decks to their end junctions, and parapet boxes took the
   lowest end of a ramp as their base (round 1); the lift bridge's road ran
   16 m off its plan line, DOCK ROAD's ramps were 18.4%, the expressway's
   wheels read the street under the kerb (round 2). */

const data = JSON.parse(readFileSync(new URL('../public/halstead-bay.district.json', import.meta.url)));
const full = new District(data);
const compact = new District(data, { play: COMPACT_POLY });

function allBoxes(D) {
  const out = [];
  for (const s of D.segments) {
    if (signatureBridge(s, D)) continue;
    if (D.deckProfile(s).peak <= 0.12) continue;
    for (const b of buildSpan(s, D).solids) out.push(b);
  }
  const sys = D.liftSystem;
  if (sys) {
    const lb = buildLiftBridge(sys.a, sys.b, sys.width, { deckY: sys.deckY, deckAt: sys.deckAt, gaps: sys.gaps });
    out.push(...lb.solids, ...lb.edgeSolids);
  }
  return out;
}
const near = (boxes) => (x, z) => boxes.filter((b) => Math.abs(b.x - x) < 60 && Math.abs(b.z - z) < 60);

function segDist(a, b, x, z) {
  const vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz;
  let t = l2 ? ((x - a[0]) * vx + (z - a[1]) * vz) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t);
}

function cross(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/** Every ground road crossing a span's line (plus the old 62 m approach corridor), on land. */
function crossings(D) {
  const out = [];
  for (const s of D.spans) {
    const ext = s.ramp || 62, n = s.pts.length;
    const out1 = (p, q) => { const ux = p[0] - q[0], uz = p[1] - q[1], l = Math.hypot(ux, uz); return [p[0] + ux / l * ext, p[1] + uz / l * ext]; };
    const P = [out1(s.pts[0], s.pts[1]), ...s.pts, out1(s.pts[n - 1], s.pts[n - 2])];
    for (let gi = 0; gi < D.segments.length; gi++) {
      const g = D.segments[gi];
      if (g.cls === 'freeway' || g.cls === 'ramp') continue;
      const gl = Math.hypot(g.bx - g.ax, g.bz - g.az);
      if (gl < 1) continue;
      for (let i = 0; i < P.length - 1; i++) {
        const t = cross([g.ax, g.az], [g.bx, g.bz], P[i], P[i + 1]);
        if (t === null) continue;
        const sx = P[i + 1][0] - P[i][0], sz = P[i + 1][1] - P[i][1];
        if (Math.abs((sx * (g.bx - g.ax) + sz * (g.bz - g.az)) / (Math.hypot(sx, sz) * gl)) > 0.7) continue;
        const cx = g.ax + (g.bx - g.ax) * t, cz = g.az + (g.bz - g.az) * t;
        if (D.play && !D.play.contains(cx, cz)) continue;
        if (D.inOpenWater(cx, cz)) continue;
        const R = s.half + 30;
        out.push({ g, span: s, at: [cx, cz], t0: Math.max(0, t * gl - R), t1: Math.min(gl, t * gl + R) });
      }
    }
  }
  return out;
}

/**
 * Drive the real car along a line at `kmh`, optionally yawed `into` rad off
 * it and with a steering wobble. Returns progress, the worst drop below the
 * surface, whether it ever left the deck's lateral band, and the log.
 */
function drive(D, boxes, line, { kmh = 50, into = 0, wobble = 0, t0 = 0, t1 = null, secs = null, steer = true, hint = 0 } = {}) {
  useDistrict(D);
  const L = Math.hypot(line.bx - line.ax, line.bz - line.az), ux = (line.bx - line.ax) / L, uz = (line.bz - line.az) / L;
  const heading = Math.atan2(-uz, ux);
  const c = createCarState(); resetCar(c);
  c.x = line.ax + ux * t0; c.z = line.az + uz * t0; c.yaw = heading + into;
  c.y = groundHeightAt(c.x, c.z, hint) + 0.62;           // start on the road's own layer
  c.buildings = near(boxes);
  const v = kmh / 3.6;
  c.vx = Math.cos(c.yaw) * v; c.vz = -Math.sin(c.yaw) * v; c.wantsForward = true; c.throttle = 0.6;
  let along = t0, maxLat = 0, drop = 0, time = 0;
  const end = t1 ?? L;
  const T = secs ?? ((end - t0) / Math.max(4, v) + 8);
  for (let i = 0; i < 120 * T && along < end; i++) {
    const lat = -(c.x - line.ax) * uz + (c.z - line.az) * ux;
    const err = Math.atan2(Math.sin(c.yaw - heading), Math.cos(c.yaw - heading));
    c.throttle = c.fwdSpeed < v ? 0.7 : 0;              // hold the test speed
    c.steerTarget = steer ? Math.max(-1, Math.min(1, -err * 2 + lat * 0.08 + wobble * Math.sin(time * 2.1))) : 0;
    stepVehicle(c, 1 / 120); time += 1 / 120;
    along = (c.x - line.ax) * ux + (c.z - line.az) * uz;
    maxLat = Math.max(maxLat, Math.abs(lat));
    drop = Math.max(drop, groundHeightAt(c.x, c.z, 50) - (c.y - 0.62));   // (river decks: nothing above them)
  }
  useDistrict(null);
  return { along, maxLat, drop, car: c };
}

for (const [name, D] of [['compact city', compact], ['full map', full]]) {
  const X = crossings(D);
  const boxes = allBoxes(D);

  test(`${name}: no ground road crossing a span steps more than 0.5 m in 1 m`, () => {
    assert.ok(X.length >= (D.play ? 5 : 50), `${X.length} crossings found`);
    for (const c of X) {
      const { g } = c, L = Math.hypot(g.bx - g.ax, g.bz - g.az);
      let prev = null, worst = 0, at = null;
      for (let t = c.t0; t <= c.t1; t += 1) {
        const x = g.ax + (g.bx - g.ax) * t / L, z = g.az + (g.bz - g.az) * t / L, y = D.elevationAt(x, z);
        if (prev !== null && Math.abs(y - prev) > worst) { worst = Math.abs(y - prev); at = [x | 0, z | 0]; }
        prev = y;
      }
      assert.ok(worst <= 0.5, `${g.cls} at ${c.at.map((v) => v | 0)} steps ${worst.toFixed(2)} m at ${at}`);
    }
  });

  test(`${name}: the car drives through every one of them (real dynamics, every parapet and tower box)`, () => {
    for (const c of X) {
      const r = drive(D, boxes, c.g, { t0: c.t0, t1: c.t1 });
      assert.ok(r.along >= c.t1 - 0.5, `${c.g.cls} at ${c.at.map((v) => v | 0)}: stopped ${(c.t1 - r.along).toFixed(1)} m short`);
    }
  });

  test(`${name}: >= 4.5 m clear over every road that passes under a deck`, () => {
    for (const c of X) {
      const [x, z] = c.at;
      const ground = D.elevationAt(x, z, 0);
      const deck = D.elevationAt(x, z, 50);
      if (deck - ground < 0.5) continue;           // at grade: a junction, nothing overhead
      assert.ok(deck - 0.9 - ground >= 4.5, `${c.g.cls} at ${[x | 0, z | 0]}: ${(deck - 0.9 - ground).toFixed(2)} m under the soffit`);
    }
  });

  test(`${name}: no parapet box stands low over a spot the ground road owns`, () => {
    for (const b of boxes) {
      if (b.baseY === undefined || b.baseY >= 2.4) continue;
      assert.ok(D.elevationAt(b.x, b.z, b.baseY) >= b.baseY - 0.3,
        `box at ${b.x | 0},${b.z | 0} base ${b.baseY.toFixed(2)} over a surface at ${D.elevationAt(b.x, b.z, b.baseY).toFixed(2)}`);
    }
  });
}

/* The two expressway links the plan makes impossible at any sane grade:
   ramp edge 2925 joins the deck (node 1332) to street node 721 in 30 m, and
   2931 joins node 1333 to street node 1075 in 67 m -- 7.0 m of climb is 35%
   and 12.7%. Both need a plan change (a longer link, or the street node
   raised); they are named here so the list cannot grow unseen. */
const PLAN_DEFECT_RAMPS = [2925, 2931];

test('only the two named expressway links are over 8%', () => {
  const steep = full.spans.filter((s) => s.isRamp && s.grade > 0.08).map((s) => s.edge).sort((a, b) => a - b);
  assert.deepEqual(steep, PLAN_DEFECT_RAMPS);
});

test('every span is flat across, never steeper than 8%, and steps nowhere (the layer it is on)', () => {
  for (const s of full.spans) {
    // ramps: their own grade is pinned above (s.grade); walked, they share
    // layers with the ramp across their street node and the deck at the gore
    if (s.isRamp) continue;
    const line = [];
    for (let i = 0; i < s.pts.length - 1; i++) {
      const p = s.pts[i], q = s.pts[i + 1], l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      for (let t = 0; t < l; t += 1) line.push([p[0] + (q[0] - p[0]) * t / l, p[1] + (q[1] - p[1]) * t / l, (q[0] - p[0]) / l, (q[1] - p[1]) / l]);
    }
    let prev = null, hint = s.profAt ? s.profAt(0) : s.arch ? 0 : s.height;
    for (const [x, z, ux, uz] of line) {
      // the layer a car on this deck stands on: walk it the way a car would
      const y = full.elevationAt(x, z, hint);
      hint = y;
      if (prev !== null) assert.ok(Math.abs(y - prev) <= 0.08 + 1e-6, `${s.kind} ${s.pts[0]}: ${(Math.abs(y - prev) * 100).toFixed(1)}% at ${[x | 0, z | 0]}`);
      prev = y;
      if (y < 0.5) continue;
      // kerb to kerb (1 m in: the parapet). A bridge is flat to 0.2 m. The
      // expressway's gores are NOT fixed: a slip road overlaps the outer lane
      // for ~50 m while it climbs, and a level gore would put 2929/2930 over
      // 13% -- measured, reported, capped here at what it is (0.7 m).
      const w = Math.min(s.half, s.band ?? s.half) - 1;
      const tol = s.isFreeway || s.isRamp ? 0.7 : 0.2;
      for (const o of [-w, w]) {
        const e = full.elevationAt(x - uz * o, z + ux * o, y);
        assert.ok(Math.abs(e - y) < tol, `${s.kind} ${s.pts[0]} banked ${(e - y).toFixed(2)} m at ${[x | 0, z | 0]} off ${o.toFixed(1)}`);
      }
    }
  }
});

test('the river bridges land at grade on their end nodes; the lift system on its own', () => {
  const arches = full.spans.filter((s) => s.arch);
  assert.equal(arches.length, 8, 'every bridge but the lift system');
  for (const s of arches) {
    const [a, b] = [s.pts[0], s.pts[s.pts.length - 1]];
    assert.ok(full.elevationAt(a[0], a[1]) < 0.01 && full.elevationAt(b[0], b[1]) < 0.01, 'lands at grade on its nodes');
    assert.ok(1.5 * s.height / s.arch <= ARCH_GRADE + 1e-9);
  }
  const sys = full.liftSystem;
  assert.ok(sys, 'the lift system exists');
  assert.ok(sys.width > 40, `the twin deck spans both roads: ${sys.width.toFixed(1)} m`);
  assert.ok(sys.deckY > 3 && sys.deckY <= 7.6, `lift deck ${sys.deckY.toFixed(2)} m`);
  assert.ok(sys.deckAt(0) === 0 && sys.deckAt(1e4) === 0, 'both ends at grade');
  for (let t = 0; t < 381; t += 1) assert.ok(Math.abs(sys.deckAt(t + 1) - sys.deckAt(t)) <= LIFT_GRADE + 1e-6, `lift grade at ${t}`);
  // the lift span and both towers sit on the flat deck
  const LL = Math.hypot(sys.b[0] - sys.a[0], sys.b[1] - sys.a[1]);
  for (let t = LL / 2 - 44; t <= LL / 2 + 44; t += 2) assert.ok(Math.abs(sys.deckAt(t) - sys.deckY) < 1e-6, `tower zone at ${t}`);
  // no tower leg stands in a carriageway
  const lb = buildLiftBridge(sys.a, sys.b, sys.width, { deckY: sys.deckY, deckAt: sys.deckAt, gaps: sys.gaps });
  for (const leg of lb.rig.legs) assert.ok(full.tarmacDepth(leg.x, leg.z) > 0.3, `a tower leg at ${leg.x | 0},${leg.z | 0} is on a road`);
});

test('the drawn deck follows the physics surface: tarmac knots on it, chords within 15 cm', () => {
  let n = 0;
  // the decks: bridges, the twin, the expressway. (Streets whose end grazes a
  // deck band, and data.roads' 'ramp' polylines that run through the two
  // defect links, can miss a 1 m feature between 4 m samples: see the report.)
  for (const s of full.segments) {
    if (s.cls === 'street' || s.cls === 'ramp') continue;
    const prof = full.deckProfile(s);
    if (prof.knots.length <= 2) continue;
    n++;
    const L = Math.hypot(s.bx - s.ax, s.bz - s.az);
    for (let t = 0; t <= L; t += 1) {
      const d = full.deckAt(s, t);
      const y = full.elevationAt(s.ax + (s.bx - s.ax) * t / L, s.az + (s.bz - s.az) * t / L, d);
      assert.ok(Math.abs(d - y) < 0.15, `tarmac ${d.toFixed(2)} vs surface ${y.toFixed(2)} at ${t | 0} m of ${L | 0}`);
    }
  }
  assert.ok(n >= 15, `${n} sampled segments`);
});

test('no pier column stands in a road passing under the deck', () => {
  let piers = 0;
  for (const s of full.segments) {
    if (signatureBridge(s, full) || full.deckProfile(s).peak <= 0.12) continue;
    for (const p of buildSpan(s, full).piers) {
      piers++;
      for (const [x, z] of p.cols) {
        for (const o of full.segmentsNear(x, z, 40)) {
          if (o === s) continue;
          const vx = o.bx - o.ax, vz = o.bz - o.az, l2 = vx * vx + vz * vz;
          let t = ((x - o.ax) * vx + (z - o.az) * vz) / l2; t = Math.max(0, Math.min(1, t));
          const d = Math.hypot(x - o.ax - vx * t, z - o.az - vz * t);
          if (full.deckAt(o, t * Math.sqrt(l2)) > p.top - 1) continue;   // a deck beside it, not a road under it
          assert.ok(d >= o.half + p.colR, `pier column at ${x | 0},${z | 0} is ${(o.half + p.colR - d).toFixed(1)} m into a ${o.cls}`);
        }
      }
    }
  }
  assert.ok(piers > 100, `${piers} piers`);
});

test('the parapets hold the car on every river deck: 30 / 80 / 120 km/h, wobbling and steered into it', () => {
  const boxes = allBoxes(full);
  const decks = full.spans.filter((s) => s.arch).map((s) => ({ ax: s.pts[0][0], az: s.pts[0][1], bx: s.pts[1][0], bz: s.pts[1][1], half: s.half }));
  const sys = full.liftSystem;
  decks.push({ ax: sys.a[0], az: sys.a[1], bx: sys.b[0], bz: sys.b[1], half: sys.width / 2 });
  // and a slip road: 2929 drops 7.0 m from the expressway to street node 1076 in 124 m
  const r = full.spans.find((q) => q.isRamp && q.edge === 2929);
  decks.push({ ax: r.pts[0][0], az: r.pts[0][1], bx: r.pts[1][0], bz: r.pts[1][1], half: r.half, hint: 7 });
  for (const d of decks) {
    const L = Math.hypot(d.bx - d.ax, d.bz - d.az);
    for (const kmh of [30, 80, 120]) {
      const r = drive(full, boxes, d, { kmh, wobble: 0.25, t0: 2, t1: L - 2, hint: d.hint ?? 50 });
      assert.ok(r.along >= L - 2.5, `${kmh} km/h along ${d.ax},${d.az}: stopped at ${r.along.toFixed(1)} of ${L.toFixed(0)}`);
      if (!d.hint) assert.ok(r.drop < 0.6, `${kmh} km/h: dropped ${r.drop.toFixed(2)} m below the deck`);
    }
    // straight at the parapet at 12 deg, hands off: it must scrape along, not climb it or stop dead
    for (const kmh of [80, 120]) for (const into of [0.21, -0.21]) {
      const t0 = L * 0.4;
      const r = drive(full, boxes, d, { kmh, into, steer: false, t0, secs: 2.5, hint: d.hint ?? 50 });
      assert.ok(r.maxLat < d.half + 0.2, `${kmh} km/h into the ${into > 0 ? 'left' : 'right'} parapet at ${d.ax},${d.az}: ${r.maxLat.toFixed(2)} m off the centre of a ${d.half} m half-deck`);
      assert.ok(!full.inWater(r.car.x, r.car.z), `${kmh} km/h into ${into} at ${d.ax | 0},${d.az | 0}: in the river at ${r.car.x | 0},${r.car.z | 0}, lat ${r.maxLat.toFixed(1)}`);
      assert.ok(r.along - t0 > 25, `${kmh} km/h: scraped only ${(r.along - t0).toFixed(1)} m along -- snagged on a box seam?`);
    }
  }
});

test('traffic on the expressway rides the deck, not the street under it; the crowd walks the arch', () => {
  useDistrict(full);
  const hint = Traffic.prototype.layerHint;
  const ramps = full.spans.filter((q) => q.isRamp);
  const gore = (x, z) => ramps.some((q) => q.pts.some((p, i) => i < q.pts.length - 1 && segDist(p, q.pts[i + 1], x, z) < q.half + 2));
  let checked = 0;
  for (const s of full.segments) {
    if (s.cls !== 'freeway') continue;
    const L = Math.hypot(s.bx - s.ax, s.bz - s.az), ux = (s.bx - s.ax) / L, uz = (s.bz - s.az) / L;
    for (let t = 0; t <= L; t += 4) for (const lane of [-6, -2, 2, 6]) {
      const x = s.ax + ux * t - uz * lane, z = s.az + uz * t + ux * lane;
      if (gore(x, z)) continue;                    // a slip road's gore: see the flat-across test
      const fresh = groundHeightAt(x, z, hint.call({}, { mesh: { position: { y: 0 } }, edge: { class: 'freeway' } }));
      const deck = full.deckAt(s, t);
      if (deck < FREEWAY_H - 0.5) continue;
      assert.ok(Math.abs(fresh - deck) < 0.05, `a cruiser at ${x | 0},${z | 0} sits at ${fresh.toFixed(2)}, deck ${deck.toFixed(2)}`);
      assert.ok(Math.abs(groundHeightAt(x, z, deck) - deck) < 0.05, 'and stays there on its next frame');
      checked++;
    }
  }
  assert.ok(checked > 500, `${checked} lane samples`);
  // pedestrians (crowd.js: elevationAt at their own spot) on an arch pavement stand on the deck
  for (const s of full.spans.filter((q) => q.arch)) {
    const [a, b] = s.pts, L = s.length, ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    const t = L / 2, deck = full.elevationAt(a[0] + ux * t, a[1] + uz * t);
    for (const o of [s.half + 2.5, -(s.half + 2.5)]) {
      assert.ok(Math.abs(full.elevationAt(a[0] + ux * t - uz * o, a[1] + uz * t + ux * o) - deck) < 0.01, 'a pavement on the deck is the deck');
    }
  }
  useDistrict(null);
});

test('off the side of a bridge is the river: the drowning test sees it', () => {
  // main.js starts drowning on district.inWater(car.x, car.z); a deck is land, the water beside it is not
  for (const s of full.spans.filter((q) => q.arch)) {
    const [a, b] = s.pts, L = s.length, ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    const mx = a[0] + ux * L / 2, mz = a[1] + uz * L / 2;
    assert.equal(full.inWater(mx, mz), false, 'on the deck');
    assert.equal(full.inWater(mx - uz * (s.half + 12), mz + ux * (s.half + 12)), true, 'over the side');
  }
});

test('the lift bridge on the lift system: parapets both sides, open only where DOCK ROAD crosses', () => {
  const sys = full.liftSystem;
  const lb = buildLiftBridge(sys.a, sys.b, sys.width, { deckY: sys.deckY, deckAt: sys.deckAt, gaps: sys.gaps });
  const L = Math.hypot(sys.b[0] - sys.a[0], sys.b[1] - sys.a[1]), ux = (sys.b[0] - sys.a[0]) / L, uz = (sys.b[1] - sys.a[1]) / L;
  const tOf = (b) => (b.x - sys.a[0]) * ux + (b.z - sys.a[1]) * uz;
  const sideOf = (b) => Math.sign(-(b.x - sys.a[0]) * uz + (b.z - sys.a[1]) * ux);
  const [g0, g1] = sys.gaps[0];
  for (const side of [-1, 1]) {
    const run = lb.edgeSolids.filter((b) => sideOf(b) === side);
    assert.ok(run.length > 40, `${run.length} parapet boxes on side ${side}`);
    for (const b of run) {
      const t = tOf(b);
      assert.ok(t + b.hw <= g0 + 0.01 || t - b.hw >= g1 - 0.01, `a parapet box across DOCK ROAD at t=${t.toFixed(1)}`);
      // the lowest point of its 8 m (<= 0.3 m under its middle at 7.5%)
      assert.ok(b.baseY <= sys.deckAt(t) + 1e-6 && sys.deckAt(t) - b.baseY < 0.35, `parapet base ${b.baseY.toFixed(2)} vs deck ${sys.deckAt(t).toFixed(2)}`);
    }
  }
  assert.equal(lb.rig.spanY, sys.deckY, 'the span sits on the lift deck');
  assert.ok(lb.tris <= 14000, `${lb.tris} triangles`);
});
