/**
 * Dijkstra GPS route pathfinding on district road graph.
 * Provides live polyline node sequence, waypoint tracking,
 * and next-turn arrow directions within 60m.
 */
class MinHeap {
  constructor() { this.data = []; }
  push(item) {
    this.data.push(item);
    let i = this.data.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p].d <= this.data[i].d) break;
      const tmp = this.data[p]; this.data[p] = this.data[i]; this.data[i] = tmp;
      i = p;
    }
  }
  pop() {
    if (this.data.length === 0) return null;
    const top = this.data[0];
    const bottom = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = bottom;
      let i = 0;
      const len = this.data.length;
      while (true) {
        let left = (i << 1) + 1, right = left + 1, best = i;
        if (left < len && this.data[left].d < this.data[best].d) best = left;
        if (right < len && this.data[right].d < this.data[best].d) best = right;
        if (best === i) break;
        const tmp = this.data[i]; this.data[i] = this.data[best]; this.data[best] = tmp;
        i = best;
      }
    }
    return top;
  }
  get size() { return this.data.length; }
}

export class Navigation {
  constructor(district) {
    this.district = district;
    this.nodes = new Map();
    this.adj = new Map();
    this.routePoints = [];
    this.routeNodes = [];
    this.waypoint = null;
    this.lastCalcTime = 0;
    this.lastTarget = null;
    this.turnInfo = null;

    this.#buildGraph();
  }

  #buildGraph() {
    if (!this.district?.graph) return;
    const { nodes, edges } = this.district.graph;
    for (const n of nodes) {
      this.nodes.set(n.id, n);
      this.adj.set(n.id, []);
    }
    for (const e of edges) {
      if (!this.adj.has(e.a) || !this.adj.has(e.b)) continue;
      const len = e.length || Math.hypot(
        this.nodes.get(e.a).x - this.nodes.get(e.b).x,
        this.nodes.get(e.a).y - this.nodes.get(e.b).y
      );
      const pts = e.points && e.points.length >= 2 ? e.points : [
        [this.nodes.get(e.a).x, this.nodes.get(e.a).y],
        [this.nodes.get(e.b).x, this.nodes.get(e.b).y],
      ];
      this.adj.get(e.a).push({ to: e.b, len, points: pts });
      this.adj.get(e.b).push({ to: e.a, len, points: pts.slice().reverse() });
    }
  }

  findNearestNode(wx, wz) {
    let bestId = null, bestDist = Infinity;
    for (const [id, n] of this.nodes) {
      const d = Math.hypot(n.x - wx, n.y - wz);
      if (d < bestDist) {
        bestDist = d;
        bestId = id;
      }
    }
    return bestId;
  }

  findRoute(fromId, toId) {
    if (fromId === null || toId === null || !this.nodes.has(fromId) || !this.nodes.has(toId)) return [];
    if (fromId === toId) {
      const n = this.nodes.get(fromId);
      return n ? [[n.x, n.y]] : [];
    }
    const dist = new Map();
    const prev = new Map();
    const visited = new Set();
    const heap = new MinHeap();
    dist.set(fromId, 0);
    heap.push({ id: fromId, d: 0 });

    while (heap.size > 0) {
      const { id: u, d: du } = heap.pop();
      if (visited.has(u)) continue;
      visited.add(u);
      if (u === toId) break;

      const neighbors = this.adj.get(u) || [];
      for (const edge of neighbors) {
        if (visited.has(edge.to)) continue;
        const alt = du + edge.len;
        if (!dist.has(edge.to) || alt < dist.get(edge.to)) {
          dist.set(edge.to, alt);
          prev.set(edge.to, { from: u, edge });
          heap.push({ id: edge.to, d: alt });
        }
      }
    }

    if (!prev.has(toId)) return [];

    // Backtrack path
    const nodePath = [toId];
    let curr = toId;
    const detailedPoints = [];

    while (prev.has(curr)) {
      const { from, edge } = prev.get(curr);
      nodePath.unshift(from);
      for (let i = edge.points.length - 1; i >= 0; i--) {
        detailedPoints.unshift(edge.points[i]);
      }
      curr = from;
    }

    this.routeNodes = nodePath;
    return detailedPoints;
  }

  setWaypoint(wx, wz) {
    this.waypoint = { x: wx, z: wz };
    this.lastTarget = null; // force recalculation
  }

  clearWaypoint() {
    this.waypoint = null;
    this.routePoints = [];
    this.turnInfo = null;
  }

  update(car, missionTarget = null) {
    const now = performance.now();
    const target = missionTarget || this.waypoint;

    // Check waypoint arrival for manual waypoints
    if (this.waypoint && !missionTarget) {
      const distToWp = Math.hypot(car.x - this.waypoint.x, car.z - this.waypoint.z);
      if (distToWp < 15) {
        this.clearWaypoint();
        return;
      }
    }

    if (!target) {
      this.routePoints = [];
      this.turnInfo = null;
      return;
    }

    const tz = target.z !== undefined ? target.z : target.y;
    const targetKey = `${Math.round(target.x)}_${Math.round(tz)}`;
    const shouldRecalc = targetKey !== this.lastTarget || (now - this.lastCalcTime > 1500);

    if (shouldRecalc) {
      const startNode = this.findNearestNode(car.x, car.z);
      const endNode = this.findNearestNode(target.x, tz);
      this.lastTarget = targetKey;
      this.lastCalcTime = now;

      if (startNode !== null && endNode !== null) {
        const pts = this.findRoute(startNode, endNode);
        this.routePoints = pts;
        if (pts.length === 0) {
          // Unreachable waypoint back-off: don't thrash recalculation
          this.lastCalcTime = now + 2500;
        }
      } else {
        this.routePoints = [];
        this.lastCalcTime = now + 2500;
      }
    }

    // Trim points behind car
    if (this.routePoints.length > 1) {
      const [p0, p1] = [this.routePoints[0], this.routePoints[1]];
      const d0 = Math.hypot(car.x - p0[0], car.z - p0[1]);
      const d1 = Math.hypot(car.x - p1[0], car.z - p1[1]);
      if (d1 < d0 && d0 < 25) {
        this.routePoints.shift();
      }
    }

    // Next turn calculation within 60m
    this.turnInfo = null;
    if (this.routePoints.length >= 2) {
      const pNext = this.routePoints[0];
      const distNext = Math.hypot(car.x - pNext[0], car.z - pNext[1]);
      if (distNext < 60 && this.routePoints.length >= 3) {
        const pAfter = this.routePoints[1];
        // Relative turn angle via 2D cross product and dot product
        const dx1 = pNext[0] - car.x, dz1 = pNext[1] - car.z;
        const dx2 = pAfter[0] - pNext[0], dz2 = pAfter[1] - pNext[1];
        const cross = dx1 * dz2 - dz1 * dx2;
        const dot = dx1 * dx2 + dz1 * dz2;
        const turnAngle = Math.atan2(cross, dot);

        let dir = 'STRAIGHT';
        let arrow = '↑';
        if (turnAngle > 0.45) { dir = 'RIGHT'; arrow = '↱'; }
        else if (turnAngle < -0.45) { dir = 'LEFT'; arrow = '↰'; }

        this.turnInfo = { dir, arrow, dist: Math.round(distNext) };
      }
    }
  }
}
