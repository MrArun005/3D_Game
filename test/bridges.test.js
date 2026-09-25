import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { District, ARCH_GRADE } from '../src/world/district.js';
import { COMPACT_POLY } from '../src/world/playArea.js';
import { buildSpan, signatureBridge } from '../src/world/spans.js';
import { useDistrict, groundHeightAt } from '../src/world/metrics.js';
import { createCarState, resetCar, stepVehicle } from '../src/vehicle/dynamics.js';

/* "Moving under a bridge stops me with an invisible wall" (2026-09-25).
   Two causes, both pinned here (the full audit is the scratchpad's
   bridge-audit.mjs; these are its invariants):
   1. elevationAt: every river bridge was a 7.6 m deck to its end node, and
      the plan puts a junction there -- the quay street through the BROADWAY
      bridgehead climbed 6.4 m in 3 m. The river bridges are arches now,
      0 at both end nodes (district.js).
   2. spans.js: ONE parapet collision box per clipped run with the LOWEST end
      as its baseY, from the corner lerp -- a wall at ground level under any
      ramp or any expressway segment with a street under a corner.
   The car physics is driven through every crossing with the real boxes. */

const data = JSON.parse(readFileSync(new URL('../public/halstead-bay.district.json', import.meta.url)));
const full = new District(data);
const compact = new District(data, { play: COMPACT_POLY });

function spanBoxes(D) {
  const out = [];
  for (const s of D.segments) {
    if (signatureBridge(s, D)) continue;
    if (D.deckProfile(s).peak <= 0.12) continue;
    for (const b of buildSpan(s, D).solids) out.push(b);
  }
  return out;
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

/** Drive the real car along a segment from t0 to t1 at ~50 km/h; how far did it get? */
function drive(D, boxes, g, t0, t1) {
  useDistrict(D);
  const L = Math.hypot(g.bx - g.ax, g.bz - g.az), ux = (g.bx - g.ax) / L, uz = (g.bz - g.az) / L;
  const heading = Math.atan2(-uz, ux);
  const c = createCarState(); resetCar(c);
  c.x = g.ax + ux * t0; c.z = g.az + uz * t0; c.yaw = heading;
  c.y = groundHeightAt(c.x, c.z) + 0.62;
  c.buildings = (x, z) => boxes.filter((b) => Math.abs(b.x - x) < 60 && Math.abs(b.z - z) < 60);
  c.vx = ux * 14; c.vz = uz * 14; c.wantsForward = true; c.throttle = 0.5;
  let along = t0;
  for (let i = 0; i < 120 * 12 && along < t1; i++) {
    const lat = -(c.x - g.ax) * uz + (c.z - g.az) * ux;
    const err = Math.atan2(Math.sin(c.yaw - heading), Math.cos(c.yaw - heading));
    c.steerTarget = Math.max(-1, Math.min(1, -err * 2 + lat * 0.08));
    stepVehicle(c, 1 / 120);
    along = (c.x - g.ax) * ux + (c.z - g.az) * uz;
  }
  useDistrict(null);
  return along;
}

for (const [name, D] of [['compact city', compact], ['full map', full]]) {
  const X = crossings(D);
  const boxes = spanBoxes(D);

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

  test(`${name}: the car drives through every one of them (real dynamics, real parapet boxes)`, () => {
    for (const c of X) {
      const got = drive(D, boxes, c.g, c.t0, c.t1);
      assert.ok(got >= c.t1 - 0.5, `${c.g.cls} at ${c.at.map((v) => v | 0)}: stopped ${(c.t1 - got).toFixed(1)} m short`);
    }
  });

  test(`${name}: no parapet box stands low over a spot the ground road owns`, () => {
    // below 2.32 m (ride 0.62 + 1.7) a box blocks a car at grade; it may only
    // stand where the surface there IS the deck it sits on
    for (const b of boxes) {
      if (b.baseY >= 2.4) continue;
      assert.ok(D.elevationAt(b.x, b.z) >= b.baseY - 0.3,
        `box at ${b.x | 0},${b.z | 0} base ${b.baseY.toFixed(2)} over a surface at ${D.elevationAt(b.x, b.z).toFixed(2)}`);
    }
  });
}

test('the river bridges are arches: at grade on both end nodes, flat across, never steeper than 8%', () => {
  const arches = full.spans.filter((s) => s.arch);
  assert.equal(arches.length, 8, 'every bridge but the lift bridge and DOCK ROAD (which meets it at deck level)');
  for (const s of arches) {
    const [a, b] = [s.pts[0], s.pts[s.pts.length - 1]];
    assert.ok(full.elevationAt(a[0], a[1]) < 0.01 && full.elevationAt(b[0], b[1]) < 0.01, 'lands at grade on its nodes');
    assert.ok(s.height > 3 && s.height <= 7.6, `crown ${s.height.toFixed(2)}`);
    const ux = (b[0] - a[0]) / s.length, uz = (b[1] - a[1]) / s.length;
    let prev = null;
    for (let t = 0; t <= s.length; t += 1) {
      const x = a[0] + ux * t, z = a[1] + uz * t, y = full.elevationAt(x, z);
      if (prev !== null) assert.ok(Math.abs(y - prev) <= 0.08, `grade ${(Math.abs(y - prev) * 100).toFixed(1)}% at ${t} m`);
      prev = y;
      if (!full.inOpenWater(x, z)) continue;
      for (const o of [-s.half, -s.half / 2, s.half / 2, s.half]) {
        assert.ok(Math.abs(full.elevationAt(x - uz * o, z + ux * o) - y) < 0.01, `banked ${o} m off the centre at ${t} m`);
      }
    }
    // the steepest point is where the design says it is
    assert.ok(1.5 * s.height / s.arch <= ARCH_GRADE + 1e-9);
  }
});

test('the drawn deck follows the arch: tarmac knots on the physics surface, chords within 15 cm', () => {
  let arched = 0;
  for (const s of full.segments) {
    const prof = full.deckProfile(s);
    if (prof.knots.length <= 2) continue;
    arched++;
    const L = Math.hypot(s.bx - s.ax, s.bz - s.az);
    for (let t = 0; t <= L; t += 1) {
      const y = full.elevationAt(s.ax + (s.bx - s.ax) * t / L, s.az + (s.bz - s.az) * t / L);
      assert.ok(Math.abs(full.deckAt(s, t) - y) < 0.15, `tarmac ${full.deckAt(s, t).toFixed(2)} vs surface ${y.toFixed(2)}`);
    }
  }
  assert.ok(arched >= 15, `${arched} arch segments`);
});
