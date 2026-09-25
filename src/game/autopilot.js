import { CELL, LANE } from '../world/metrics.js';

/* The lattice this file was written for is retired. buildRoute() still emitted
   waypoints at multiples of CELL, so V (film mode) drove to an empty corner of
   the map. When a district is present the route walks its road graph instead. */
let GRAPH = null;
export function useGraphForRoutes(district) { GRAPH = district?.graph ?? null; }

/**
 * A drive of connected junctions, starting from wherever the car is. It
 * follows each edge's own POLYLINE (it used to jump junction to junction in a
 * straight line, which cut every bent street through its buildings -- the F9
 * benchmark car ran into a wall, 2026-09-25), densified to ~8 m, and at each
 * junction takes the straightest way on, never back the way it came and never
 * into a dead end while there is a choice.
 */
function graphRoute(fromX, fromZ, legs = 60) {
  const nodes = GRAPH.nodes, edges = GRAPH.edges;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map();
  edges.forEach((e, i) => {
    for (const id of [e.a, e.b]) {
      const l = adj.get(id); if (l) l.push(i); else adj.set(id, [i]);
    }
  });
  let at = nodes.reduce((b, n) =>
    Math.hypot(n.x - fromX, n.y - fromZ) < Math.hypot(b.x - fromX, b.y - fromZ) ? n : b);
  const out = [[at.x, at.y]];
  let prev = -1, hx = 0, hz = 0;
  for (let i = 0; i < legs; i++) {
    let cand = (adj.get(at.id) ?? []).filter((e) => e !== prev);
    if (!cand.length) cand = adj.get(at.id) ?? [];   // a dead end: turn round
    if (!cand.length) break;
    const live = cand.filter((ei) => { const e = edges[ei]; return (adj.get(e.a === at.id ? e.b : e.a) ?? []).length > 1; });
    if (live.length) cand = live;
    const pathOf = (e) => {
      const p = e.points?.length >= 2 ? e.points : [[byId.get(e.a).x, byId.get(e.a).y], [byId.get(e.b).x, byId.get(e.b).y]];
      return e.a === at.id ? p : p.slice().reverse();
    };
    // straightest on; ties broken by a seeded-looking index so loops vary
    let pick = cand[0], bestS = -Infinity;
    cand.forEach((ei, k) => {
      const p = pathOf(edges[ei]), q = p[Math.min(1, p.length - 1)];
      const dx = q[0] - p[0][0], dz = q[1] - p[0][1], l = Math.hypot(dx, dz) || 1;
      const s = (i === 0 ? 0 : (dx * hx + dz * hz) / l) + (((i * 7 + k * 3) % 5) * 0.04);
      if (s > bestS) { bestS = s; pick = ei; }
    });
    const e = edges[pick], p = pathOf(e);
    for (let j = 1; j < p.length; j++) pushStraight(out, out[out.length - 1], p[j]);
    const n = byId.get(e.a === at.id ? e.b : e.a);
    if (!n) break;
    const t = p[p.length - 1], u = p[Math.max(0, p.length - 2)], l = Math.hypot(t[0] - u[0], t[1] - u[1]) || 1;
    hx = (t[0] - u[0]) / l; hz = (t[1] - u[1]) / l;
    prev = pick; at = n;
  }
  // keep right (traffic does): half a lane off the centre line, across the local heading
  return out.map((p, i) => {
    const a = out[Math.max(0, i - 1)], b = out[Math.min(out.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return [p[0] - (dz / l) * LANE_OFF, p[1] + (dx / l) * LANE_OFF];
  });
}
import { WHEELBASE } from '../vehicle/config.js';
import { steerLimit } from '../vehicle/dynamics.js';

const LANE_OFF = LANE * 0.5;                 // inner lane, right of the centre line
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** three.js is right-handed: right = forward x up = (-fz, fx). */
const rightOf = (d) => [-d[1], d[0]];

/**
 * Build a driveable route through the grid as a list of world waypoints.
 * Straight runs sit on the lane centre; junctions get a tangent arc, because a
 * hard corner would make the pursuit controller saw at the wheel.
 */
export function buildRoute(steps, fromX = 0, fromZ = 0) {
  // a real district beats the retired lattice every time
  if (GRAPH) return graphRoute(fromX, fromZ);
  const pts = [];
  let i = 0, j = 0, h = 0;
  let cursor = null;

  const lanePoint = (ni, nj, d) => {
    const r = rightOf(d);
    return [ni * CELL + r[0] * LANE_OFF, nj * CELL + r[1] * LANE_OFF];
  };

  for (const step of steps) {
    const d = DIRS[h];
    const ni = i + d[0] * step.go;
    const nj = j + d[1] * step.go;

    if (!cursor) cursor = lanePoint(i, j, d);

    if (!step.turn) {
      const end = lanePoint(ni, nj, d);
      pushStraight(pts, cursor, end);
      cursor = end;
      i = ni; j = nj;
      continue;
    }

    const nh = (h + (step.turn === 'R' ? 1 : 3)) % 4;
    const e = DIRS[nh];
    const radius = step.turn === 'R' ? 8 : 12;      // a left turn crosses more road

    // the corner is where the two lane lines cross
    const pd = lanePoint(ni, nj, d);
    const pe = lanePoint(ni, nj, e);
    const C = d[0] !== 0 ? [pe[0], pd[1]] : [pd[0], pe[1]];

    const start = [C[0] - d[0] * radius, C[1] - d[1] * radius];
    const end = [C[0] + e[0] * radius, C[1] + e[1] * radius];
    const centre = [start[0] + e[0] * radius, start[1] + e[1] * radius];

    pushStraight(pts, cursor, start);

    const a0 = Math.atan2(-e[1], -e[0]);
    let a1 = Math.atan2(d[1], d[0]);
    while (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
    while (a1 - a0 < -Math.PI) a1 += Math.PI * 2;
    for (let k = 1; k <= 10; k++) {
      const a = a0 + (a1 - a0) * (k / 10);
      pts.push([centre[0] + Math.cos(a) * radius, centre[1] + Math.sin(a) * radius]);
    }

    cursor = end;
    i = ni; j = nj; h = nh;
  }
  return pts;
}

function pushStraight(pts, from, to) {
  const dx = to[0] - from[0], dz = to[1] - from[1];
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.round(len / 8));
  for (let k = 1; k <= n; k++) pts.push([from[0] + (dx * k) / n, from[1] + (dz * k) / n]);
}

/**
 * Pure-pursuit driver. Aims at a point a speed-dependent distance down the
 * path and converts the required curvature into a steering angle, then feeds
 * the same normalised control the keyboard does.
 */
export class Autopilot {
  constructor(route, { cruise = 24 } = {}) {
    this.route = route;
    this.index = 0;
    this.cruise = cruise;
    this.done = false;
  }

  /** World position of the car's target, for cameras that want to look ahead. */
  lookaheadPoint(distance = 40) {
    const i = Math.min(this.route.length - 1, this.index + Math.round(distance / 8));
    return this.route[i];
  }

  update(car, dt) {
    const route = this.route;
    // advance the anchor to the nearest point ahead of us
    let best = this.index;
    let bestD = Infinity;
    for (let k = this.index; k < Math.min(route.length, this.index + 24); k++) {
      const d = (route[k][0] - car.x) ** 2 + (route[k][1] - car.z) ** 2;
      if (d < bestD) { bestD = d; best = k; }
    }
    this.index = best;
    if (best >= route.length - 3) { this.done = true; }

    const speed = Math.max(0, car.fwdSpeed);
    const L = 7 + speed * 0.55;
    let k = best, travelled = 0;
    while (k < route.length - 1 && travelled < L) {
      travelled += Math.hypot(route[k + 1][0] - route[k][0], route[k + 1][1] - route[k][1]);
      k++;
    }
    const target = route[k];

    const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    const dx = target[0] - car.x, dz = target[1] - car.z;
    const ahead = dx * cy + dz * -sy;          // forward = (cos, -sin)
    const lateral = dx * sy + dz * cy;         // right   = (sin,  cos)

    // pure pursuit curvature, with lateral measured positive to the right
    const Ld = Math.max(4, Math.hypot(ahead, lateral));
    const delta = Math.atan((2 * WHEELBASE * -lateral) / (Ld * Ld));

    /* Normalise by the SAME speed-sensitive limit the physics applies, so the
       target we hand over means what it does from the keyboard. This kept
       its own copy, V.steerMax * (0.32 + 0.68 / (1 + v^2/260)), which had
       drifted from the physics (0.389 vs 0.426 rad at 60 km/h) and would
       have been 2.7x out under the gta profile's grip-limited lock (0.144 rad
       at 60): every command applied at a third and the film car running wide
       on every bend (2026-09-23). */
    const limit = steerLimit(car);
    car.steerTarget = Math.max(-1, Math.min(1, delta / limit));

    /* Slow for the bend AHEAD, not just the one under the wheels: the
       sharpest heading change over the next ~stopping distance caps the
       speed (about 0.5 g round it). */
    let turn = 0;
    for (let j = best + 1, far = Math.min(route.length - 2, best + 2 + Math.round((10 + speed * 1.6) / 8)); j <= far; j++) {
      const a0 = Math.atan2(route[j][1] - route[j - 1][1], route[j][0] - route[j - 1][0]);
      const a1 = Math.atan2(route[j + 1][1] - route[j][1], route[j + 1][0] - route[j][0]);
      let d = Math.abs(a1 - a0); if (d > Math.PI) d = 2 * Math.PI - d;
      turn = Math.max(turn, d);
    }
    const bendCap = turn > 0.05 ? Math.sqrt(5 * 8 / turn) : Infinity;
    const wanted = Math.max(7, Math.min(bendCap, this.cruise * (1 - Math.abs(delta) * 2.4)));
    const err = wanted - speed;
    car.throttle += (Math.max(0, Math.min(1, err * 0.45)) - car.throttle) * Math.min(1, dt * 8);
    car.brake += (Math.max(0, Math.min(1, -err * 0.30)) - car.brake) * Math.min(1, dt * 8);
    /* Stuck on something (a parked car, a wall after a bad line): after 2 s
       under 1.5 m/s, put the car back on the route a few points on, facing
       along it. A benchmark that ends against a wall measures nothing. */
    this.stuck = speed < 1.5 ? (this.stuck || 0) + dt : 0;
    if (this.stuck > 2 && this.index < route.length - 4) {
      const j = Math.min(route.length - 2, this.index + 3), p = route[j], q = route[j + 1];
      car.x = p[0]; car.z = p[1];
      car.yaw = Math.atan2(-(q[1] - p[1]), q[0] - p[0]);
      car.vx = 0; car.vz = 0; car.yawRate = 0;
      car.prevX = car.x; car.prevZ = car.z; car.prevYaw = car.yaw;   // no interpolated smear across the jump
      this.index = j; this.stuck = 0; this.recovered = (this.recovered || 0) + 1;
    }
    car.hand = 0;
    car.wantsForward = true;
    car.wantsReverse = false;
  }
}
