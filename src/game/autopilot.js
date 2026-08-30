import { CELL, LANE } from '../world/metrics.js';

/* The lattice this file was written for is retired. buildRoute() still emitted
   waypoints at multiples of CELL, so V (film mode) drove to an empty corner of
   the map. When a district is present the route walks its road graph instead. */
let GRAPH = null;
export function useGraphForRoutes(district) { GRAPH = district?.graph ?? null; }

/** A loop of connected junctions, starting from wherever the car is. */
function graphRoute(fromX, fromZ, legs = 14) {
  const nodes = GRAPH.nodes, edges = GRAPH.edges;
  const adj = new Map();
  edges.forEach((e, i) => {
    for (const id of [e.a, e.b]) {
      const l = adj.get(id); if (l) l.push(i); else adj.set(id, [i]);
    }
  });
  let at = nodes.reduce((b, n) =>
    Math.hypot(n.x - fromX, n.y - fromZ) < Math.hypot(b.x - fromX, b.y - fromZ) ? n : b);
  const out = [[at.x, at.y]];
  let prev = -1;
  for (let i = 0; i < legs; i++) {
    const cand = (adj.get(at.id) ?? []).filter((e) => e !== prev);
    if (!cand.length) break;
    const pick = cand[(i * 7 + 3) % cand.length];
    const e = edges[pick];
    const far = e.a === at.id ? e.b : e.a;
    const n = nodes.find((q) => q.id === far);
    if (!n) break;
    out.push([n.x, n.y]);
    prev = pick; at = n;
  }
  return out;
}
import { V, WHEELBASE } from '../vehicle/config.js';

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

    // mirror the speed-sensitive limit the physics applies, so the normalised
    // target we hand over means the same thing it does from the keyboard
    const limit = V.steerMax * (0.32 + 0.68 / (1 + (speed * speed) / 260));
    car.steerTarget = Math.max(-1, Math.min(1, delta / limit));

    const wanted = Math.max(9, this.cruise * (1 - Math.abs(delta) * 2.4));
    const err = wanted - speed;
    car.throttle += (Math.max(0, Math.min(1, err * 0.45)) - car.throttle) * Math.min(1, dt * 8);
    car.brake += (Math.max(0, Math.min(1, -err * 0.30)) - car.brake) * Math.min(1, dt * 8);
    car.hand = 0;
    car.wantsForward = true;
    car.wantsReverse = false;
  }
}
