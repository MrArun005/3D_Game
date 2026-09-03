/**
 * Dijkstra GPS route pathfinding on district road graph.
 * Provides live polyline node sequence, waypoint tracking,
 * and next-turn arrow directions within 60m.
 */
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
    if (fromId === toId || !this.nodes.has(fromId) || !this.nodes.has(toId)) return [];
    const dist = new Map();
    const prev = new Map();
    const visited = new Set();
    const queue = [{ id: fromId, d: 0 }];
    dist.set(fromId, 0);

    while (queue.length > 0) {
      queue.sort((a, b) => a.d - b.d);
      const { id: u, d: du } = queue.shift();
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
          queue.push({ id: edge.to, d: alt });
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

    // Check waypoint arrival
    if (this.waypoint) {
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

    const targetKey = `${Math.round(target.x)}_${Math.round(target.z || target.y)}`;
    const shouldRecalc = targetKey !== this.lastTarget || (now - this.lastCalcTime > 1500);

    if (shouldRecalc) {
      const startNode = this.findNearestNode(car.x, car.z);
      const endNode = this.findNearestNode(target.x, target.z || target.y);
      if (startNode && endNode) {
        const pts = this.findRoute(startNode, endNode);
        if (pts.length > 0) {
          this.routePoints = pts;
          this.lastTarget = targetKey;
          this.lastCalcTime = now;
        }
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
        // Relative heading angle
        const dx1 = pNext[0] - car.x, dz1 = pNext[1] - car.z;
        const dx2 = pAfter[0] - pNext[0], dz2 = pAfter[1] - pNext[1];
        const a1 = Math.atan2(dx1, dz1);
        const a2 = Math.atan2(dx2, dz2);
        let diff = (a2 - a1);
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        let dir = 'STRAIGHT';
        let arrow = '↑';
        if (diff > 0.45) { dir = 'RIGHT'; arrow = '↱'; }
        else if (diff < -0.45) { dir = 'LEFT'; arrow = '↰'; }

        this.turnInfo = { dir, arrow, dist: Math.round(distNext) };
      }
    }
  }
}
