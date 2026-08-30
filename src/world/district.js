/**
 * Halstead Bay, loaded.
 *
 * The 2D planner exports centrelines; everything the runtime needs is derived
 * from them here. The one job that matters is answering "where is the road?"
 * fast enough to call a few thousand times a second, because the suspension,
 * the hull collision, the camera and the traffic all ask constantly.
 */

const CELL = 96;                       // spatial hash cell, metres
const key = (ix, iz) => `${ix},${iz}`;

export class District {
  constructor(data) {
    this.data = data;
    this.bounds = data.bounds;
    this.grid = new Map();             // hash cell -> segment list
    this.segments = [];
    this.blocks = data.blocks;
    this.places = data.places;
    this.graph = data.graph;

    // flatten every road into segments once; the hash points at these
    for (const road of data.roads) {
      const half = road.width / 2;
      for (let i = 0; i < road.points.length - 1; i++) {
        const a = road.points[i], b = road.points[i + 1];
        const seg = { ax: a[0], az: a[1], bx: b[0], bz: b[1], half, cls: road.class };
        const id = this.segments.push(seg) - 1;
        this.#bucket(seg, id, half + 6);
      }
    }

    // blocks, hashed by footprint so the streamer can ask what is near
    this.blockGrid = new Map();
    data.blocks.forEach((b, i) => {
      const r = Math.hypot(b.w, b.h) / 2;
      const x0 = Math.floor((b.x - r) / CELL), x1 = Math.floor((b.x + r) / CELL);
      const z0 = Math.floor((b.y - r) / CELL), z1 = Math.floor((b.y + r) / CELL);
      for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
        const k = key(ix, iz);
        (this.blockGrid.get(k) ?? this.blockGrid.set(k, []).get(k)).push(i);
      }
    });

    /* Elevated spans, precomputed. Each is a polyline with a deck height and
       a ramp at either end; the bounding box is only there so elevationAt can
       reject most of them without doing any geometry. */
    this.spans = [];
    for (const br of data.bridges) {
      this.spans.push(makeSpan(br.points, br.width, 7.6, 62));
    }
    for (const e of data.graph.edges) {
      if (e.class !== 'freeway') continue;
      this.spans.push(makeSpan(e.points, e.width, 9.4, 90));
    }
    for (const e of data.graph.edges) {
      // ramps meet the freeway at its deck and the street at the ground
      if (e.class !== 'ramp') continue;
      this.spans.push(makeSpan(e.points, e.width, 9.4, 0, true));
    }

    // buildings indexed by their block, so a chunk load is one lookup
    this.buildingsByBlock = new Map();
    for (const g of data.buildings) {
      const list = this.buildingsByBlock.get(g.blockId);
      if (list) list.push(g); else this.buildingsByBlock.set(g.blockId, [g]);
    }
  }

  #bucket(seg, id, pad) {
    const x0 = Math.floor((Math.min(seg.ax, seg.bx) - pad) / CELL);
    const x1 = Math.floor((Math.max(seg.ax, seg.bx) + pad) / CELL);
    const z0 = Math.floor((Math.min(seg.az, seg.bz) - pad) / CELL);
    const z1 = Math.floor((Math.max(seg.az, seg.bz) + pad) / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = key(ix, iz);
        (this.grid.get(k) ?? this.grid.set(k, []).get(k)).push(id);
      }
    }
  }

  /** Nearest road centreline, as {distance, half, class} — null if nothing near. */
  nearestRoad(x, z) {
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    let best = null;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const ids = this.grid.get(key(ix + dx, iz + dz));
        if (!ids) continue;
        for (const id of ids) {
          const s = this.segments[id];
          const vx = s.bx - s.ax, vz = s.bz - s.az;
          const l = vx * vx + vz * vz;
          let t = l ? ((x - s.ax) * vx + (z - s.az) * vz) / l : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(x - s.ax - vx * t, z - s.az - vz * t);
          if (!best || d < best.distance) best = { distance: d, half: s.half, cls: s.cls };
        }
      }
    }
    return best;
  }

  /**
   * Metres OUTSIDE the kerb line: <= 0 on tarmac. Same contract, same units as
   * the grid version it replaces, so collision, grip, camera and traffic gates
   * all keep working without knowing the world changed underneath them.
   */
  roadDepth(x, z) {
    const near = this.nearestRoad(x, z);
    if (!near) return 60;              // nowhere near a road: firmly off it
    return near.distance - near.half;
  }

  /** Blocks whose footprint touches a radius — the streamer's unit of work. */
  blocksNear(x, z, radius) {
    const out = new Set();
    const r = Math.ceil(radius / CELL);
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const ids = this.blockGrid.get(key(ix + dx, iz + dz));
        if (ids) for (const i of ids) out.add(i);
      }
    }
    return [...out];
  }

  /** Road segments within `radius` of a point -- what the minimap draws. */
  segmentsNear(x, z, radius) {
    const out = new Set();
    const r = Math.ceil(radius / CELL);
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const ids = this.grid.get(key(ix + dx, iz + dz));
        if (ids) for (const i of ids) out.add(i);
      }
    }
    return [...out].map((i) => this.segments[i]);
  }

  /**
   * Is this point over water?
   *
   * Bridges are checked first and win: a car crossing the lift bridge is over
   * the river by every geometric test, and drowning it there would be absurd.
   */
  inWater(x, z) {
    const W = this.data.water;
    for (const br of this.data.bridges) {
      if (nearPolyline(br.points, x, z) < br.width / 2 + 2.5) return false;
    }
    if (x > this.bounds.w + 20) return true;                 // open sea
    if (nearPolyline(W.river.points, x, z) < W.river.width / 2) return true;
    return pointInPoly(W.bay, x, z);
  }

/**
   * How high the road is here.
   *
   * The map has always carried ten bridges and an elevated expressway, and
   * the 3D world has always drawn them flat on the water -- the single
   * biggest lie in the city. A bridge is its centreline plus a ramped
   * approach at each end, so the height is a function of how far along that
   * span you are and how far off its centre.
   */
  elevationAt(x, z) {
    let best = 0;
    for (let i = 0; i < this.spans.length; i++) {
      const s = this.spans[i];
      if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
      const h = spanHeight(s, x, z);
      if (h > best) best = h;
    }
    return best;
  }

  buildingsOf(blockId) { return this.buildingsByBlock.get(blockId) ?? []; }
}

/**
 * Precompute a span: cumulative lengths, a bounding box padded by the ramps,
 * and the end tangents used to extrapolate the approaches.
 */
function makeSpan(points, width, height, ramp, taper = false) {
  const pts = points.map((p) => [p[0], p[1]]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const pad = width / 2 + ramp + 8;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [px, pz] of pts) {
    minX = Math.min(minX, px); maxX = Math.max(maxX, px);
    minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz);
  }
  return {
    pts, cum, half: width / 2, height, ramp, taper,
    length: cum[cum.length - 1],
    minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad,
  };
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Height of one span at a point: 0 if the point is not over or approaching it. */
function spanHeight(s, x, z) {
  // nearest point on the polyline, as (distance along, distance across)
  let bestD = Infinity, along = 0;
  for (let i = 0; i < s.pts.length - 1; i++) {
    const ax = s.pts[i][0], az = s.pts[i][1];
    const vx = s.pts[i + 1][0] - ax, vz = s.pts[i + 1][1] - az;
    const l2 = vx * vx + vz * vz;
    let t = l2 ? ((x - ax) * vx + (z - az) * vz) / l2 : 0;
    const tc = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - ax - vx * tc, z - az - vz * tc);
    if (d < bestD) { bestD = d; along = s.cum[i] + tc * Math.sqrt(l2); }
  }
  if (bestD <= s.half + 1.5) {
    if (s.taper) {
      // a ramp climbs across its whole length rather than having approaches
      return s.height * smooth(Math.max(0, Math.min(1, along / Math.max(1, s.length))));
    }
    return s.height;
  }
  if (s.taper || !s.ramp) return 0;

  /* The approaches.
     Projecting onto a polyline CLAMPS to its ends, so `along` can never leave
     [0, length] and the ramps were unreachable -- the deck jumped straight
     out of the water. They have to be measured along the end tangents,
     extrapolated past the span. */
  for (const end of [0, 1]) {
    const p0 = end ? s.pts[s.pts.length - 1] : s.pts[0];
    const p1 = end ? s.pts[s.pts.length - 2] : s.pts[1];
    let ux = p0[0] - p1[0], uz = p0[1] - p1[1];
    const l = Math.hypot(ux, uz) || 1;
    ux /= l; uz /= l;                       // points OUT of the span
    const rx = x - p0[0], rz = z - p0[1];
    const out = rx * ux + rz * uz;          // metres past the abutment
    if (out <= 0 || out > s.ramp) continue;
    const perp = Math.hypot(rx - ux * out, rz - uz * out);
    if (perp > s.half + 1.5) continue;
    return s.height * smooth(1 - out / s.ramp);
  }
  return 0;
}

/** Distance from a point to a polyline. */
function nearPolyline(pts, x, z) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1];
    const vx = pts[i + 1][0] - ax, vz = pts[i + 1][1] - az;
    const l = vx * vx + vz * vz;
    let t = l ? ((x - ax) * vx + (z - az) * vz) / l : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
  }
  return best;
}

function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export async function loadDistrict(url = '/halstead-bay.district.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`district ${res.status}`);
  return new District(await res.json());
}
