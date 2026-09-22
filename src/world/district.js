/**
 * Halstead Bay, loaded.
 *
 * The 2D planner exports centrelines; everything the runtime needs is derived
 * from them here. The one job that matters is answering "where is the road?"
 * fast enough to call a few thousand times a second, because the suspension,
 * the hull collision, the camera and the traffic all ask constantly.
 */

import { fetchCached } from '../core/assetCache.js';

const CELL = 96;                       // spatial hash cell, metres
const key = (ix, iz) => `${ix},${iz}`;

export class District {
  constructor(data) {
    this.data = data;
    this.bounds = data.bounds;
    this.grid = new Map();             // hash cell -> segment list
    this.segments = [];
    // Designate Little Tokyo / Neo-Tokyo district in the central street corridor around spawn
    /* The corridor, not a pocket. Arun: "we should have a long stretch". The
       original eleven ran z 1400-1624 -- about 225 m, three grid rows, and the
       canyon ended almost as soon as it started. These are every block in the
       same grid columns from z~1080 to z~1624: rows 291-298 (north), 302-303
       (the row that was missing between them), 308-309 and 314 (the flanks).
       ~545 m of continuous frontage, better than double. */
    const TOKYO_BLOCKS = new Set([
      291, 292, 293, 294, 295, 296, 297, 298,
      299, 300, 301, 302, 303,
      304, 305, 306, 307, 308,
      309, 310, 311, 312, 313, 314,
    ]);
    for (const b of data.blocks) {
      if (TOKYO_BLOCKS.has(b.id)) {
        b.district = 'LITTLE TOKYO';
      }
    }
    this.blocks = data.blocks;
    this.places = data.places;
    if (!this.places.some((p) => p.district === 'LITTLE TOKYO')) {
      this.places.push(
        { type: 'diner', name: 'Ramen Yokocho · ラーメン横丁', district: 'LITTLE TOKYO', x: 2320, y: 1410 },
        { type: 'club', name: 'Kabukicho Neon Lounge · 歌舞伎町', district: 'LITTLE TOKYO', x: 2450, y: 1405 },
        { type: 'store', name: '24H Lawson Convenience · コンビニ', district: 'LITTLE TOKYO', x: 2280, y: 1395 },
        { type: 'arcade', name: 'Akiba Cyber Arcade · 秋葉原', district: 'LITTLE TOKYO', x: 2415, y: 1515 },
        { type: 'hotel', name: 'Shinjuku Capsule Hotel · カプセル', district: 'LITTLE TOKYO', x: 2285, y: 1510 },
        { type: 'pub', name: 'Shibuya Izakaya Alley · 居酒屋', district: 'LITTLE TOKYO', x: 2560, y: 1410 }
      );
    }
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
      this.spans.push(makeSpan(br.points, br.width, 7.6, 62, false, 'bridge'));
    }
    for (const e of data.graph.edges) {
      if (e.class !== 'freeway') continue;
      this.spans.push(makeSpan(e.points, e.width, 9.4, 90, false, 'freeway'));
    }
    for (const e of data.graph.edges) {
      // ramps meet the freeway at its deck and the street at the ground
      if (e.class !== 'ramp') continue;
      this.spans.push(makeSpan(e.points, e.width, 9.4, 0, true, 'ramp'));
    }

    // buildings indexed by their block, so a chunk load is one lookup
    this.buildingsByBlock = new Map();
    for (const g of data.buildings) {
      const list = this.buildingsByBlock.get(g.blockId);
      if (list) list.push(g); else this.buildingsByBlock.set(g.blockId, [g]);
    }
    this.#infill(data);
  }

  /** Add a road segment dynamically (e.g. race track) and bucket it in the spatial grid. */
  addSegment(seg, pad = seg.half + 6) {
    const id = this.segments.push(seg) - 1;
    this.#bucket(seg, id, pad);
    return id;
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

  /**
   * Placement-time tarmac test: metres outside the kerb line of the nearest
   * OVERLAPPING road — the minimum (distance - half) over every segment near
   * the point. roadDepth() answers with the nearest CENTRELINE only, which is
   * the right (and fast) contract for physics but blind to a wide road whose
   * centreline is further away than a narrow one's — exactly the case
   * placement cares about, because segments run straight through junctions.
   * Cold path: chunk build only. `exclude` skips one segment by identity —
   * parked cars are legitimately on their own street's tarmac.
   */
  tarmacDepth(x, z, exclude = null) {
    let best = 60;
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const ids = this.grid.get(key(ix + dx, iz + dz));
        if (!ids) continue;
        for (const id of ids) {
          const s = this.segments[id];
          if (s === exclude) continue;
          const vx = s.bx - s.ax, vz = s.bz - s.az;
          const l = vx * vx + vz * vz;
          let t = l ? ((x - s.ax) * vx + (z - s.az) * vz) / l : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(x - s.ax - vx * t, z - s.az - vz * t) - s.half;
          if (d < best) best = d;
        }
      }
    }
    return best;
  }

  /** Blocks whose footprint touches a radius — the streamer's unit of work. */
  /** The district a point stands in: the nearest block's, within 60 m; null on the water or far outside the plan. */
  districtAt(x, z) {
    if (this.isRacewayLand && this.isRacewayLand(x, z)) return 'HALSTEAD RACEWAY';
    let best = null, bd = 60;
    for (const i of this.blocksNear(x, z, 60)) {   // blocksNear returns indices into this.blocks
      const b = this.blocks[i]; if (!b) continue;
      const d = Math.hypot(b.x - x, b.y - z) - Math.max(b.w, b.h) * 0.5;   // distance to the block's edge, roughly
      if (d < bd && b.district) { bd = d; best = b.district; }
    }
    return best;
  }

  /** The type of the block under (x, z) ('park', 'yard', 'lot', ...), or null.
   *  One grid cell (each block is registered in every cell its bounding circle
   *  touches) and a rotated-rectangle test; the physics asks per off-road wheel. */
  blockTypeAt(x, z) {
    const ids = this.blockGrid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!ids) return null;
    for (const i of ids) {
      const b = this.blocks[i]; if (!b) continue;
      const dx = x - b.x, dz = z - b.y, ca = Math.cos(b.angle || 0), sa = Math.sin(b.angle || 0);
      if (Math.abs(dx * ca + dz * sa) <= b.w / 2 && Math.abs(-dx * sa + dz * ca) <= b.h / 2) return b.type ?? null;
    }
    return null;
  }

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
    if (this._nearCache && radius === this._nearR && Math.hypot(x - this._nearX, z - this._nearZ) < 3.0) {
      return this._nearCache;
    }
    if (!this._nearSeen) this._nearSeen = new Uint8Array(this.segments.length);
    else this._nearSeen.fill(0);
    const list = [];
    const r = Math.ceil(radius / CELL);
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const ids = this.grid.get(key(ix + dx, iz + dz));
        if (ids) {
          for (let k = 0; k < ids.length; k++) {
            const id = ids[k];
            if (!this._nearSeen[id]) {
              this._nearSeen[id] = 1;
              list.push(this.segments[id]);
            }
          }
        }
      }
    }
    this._nearCache = list;
    this._nearX = x;
    this._nearZ = z;
    this._nearR = radius;
    return list;
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
    return this.inOpenWater(x, z);
  }

  /**
   * Bay, river or sea, ignoring bridges. `inWater` treats a deck as land so
   * you do not drown on it; the skirt used that and poured a 7.6 m dam into
   * the river (the deck is "land"). A span over water wants a soffit, not a
   * wall to y=0.
   */
  inOpenWater(x, z) {
    if (this.isRacewayLand && this.isRacewayLand(x, z)) return false;
    const W = this.data.water;
    if (x > this.bounds.w + 20) return true;
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
    if (this.racewayElevationAt) {
      const rh = this.racewayElevationAt(x, z);
      if (rh !== null && rh !== undefined) return rh;
    }
    let best = 0, bs = null, deckBest = 0, rampBest = 0, fwyBest = 0;
    for (let i = 0; i < this.spans.length; i++) {
      const s = this.spans[i];
      if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
      const h = spanHeight(s, x, z);
      if (h > best) { best = h; bs = s; }
      /* Three separate "best"s, because the guard below has three answers and
         one number could not carry them (2026-09-14). deckBest used to mean
         "not a freeway", which INCLUDED ramp spans -- isFreeway is
         `kind === 'freeway'` and a ramp's kind is 'ramp' -- so a street passing
         under the expressway anywhere near a ramp was "dropped" to the ramp's
         own 9.4 m and climbed 9.4 m in 3 m instead. That is the invisible wall.
         deckBest is now BRIDGES ONLY: the thing you can still be standing on
         when you are underneath the whole expressway structure. */
      if (h > deckBest && !s.isFreeway && !s.isRamp) { deckBest = h; }
      if (s.isRamp && h > rampBest) { rampBest = h; }
      if (s.isFreeway && h > fwyBest) { fwyBest = h; }
    }
    /* Under a freeway flyover, not on it. The span band is the deck's footprint, and
       a surface street crossing beneath the expressway lies inside it -- the
       car (and traffic) used to climb 9.4 m onto the deck the moment it drove
       under. If the point sits on the tarmac of a ground-level segment that
       is not parallel to the span, it is underneath: no lift.
       Only applies to freeway spans; bridges cross open water and must keep their continuous deck. */
    /* ...and a ramp or bridge deck at the same point SURVIVES that. elevationAt
       takes the MAX over every span, so where the Steelgate ramp passes under
       the expressway the max came from the expressway, the guard correctly said
       "you are underneath" -- and returned 0, throwing the RAMP's own height
       away with it. Measured along that ramp, the deck ran 9.4, 9.4, 9.4 ...
       then 0.0, 0.0 for ~18 m, then climbed back: you drove up a flyover and
       fell through it. Falling back to the best non-freeway deck keeps the ramp
       (and any bridge) continuous while the surface street underneath still
       drops to the ground, which is the whole point of the guard. */
    /* A bridge's APPROACH RAMP lifts anything near its axis (2026-09-14).
       spanHeight extends a 62 m corridor straight out of each abutment and
       raises every point inside it, which is right for the road that climbs
       onto the bridge and wrong for a street that merely passes near the
       abutment. Measured beside the heist-2 crossing: a street at (1431,943)
       is carried to 5.7 m, reaches 6.6 m at (1437,942), and is back to 0.0 at
       (1443,941) -- 6.6 m of climb and a 6.6 m drop in 7 m. That is the
       invisible wall you hit and stop dead against.

       An approach runs WITH the span; a street that crosses near it does not.
       Only applied where the lift came from the ramp corridor (outside the
       deck band) -- on the deck itself there is nothing to cross, it is over
       water. */
    if (best > 0 && bs && bs.isBridge) {
      let onPolyline = Infinity;
      for (let i = 0; i < bs.pts.length - 1; i++) {
        const ax = bs.pts[i][0], az = bs.pts[i][1];
        const vx = bs.pts[i + 1][0] - ax, vz = bs.pts[i + 1][1] - az;
        const l2 = vx * vx + vz * vz;
        let t = l2 ? ((x - ax) * vx + (z - az) * vz) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        onPolyline = Math.min(onPolyline, Math.hypot(x - ax - vx * t, z - az - vz * t));
      }
      if (onPolyline > bs.half + 5.5) {                 // we are on the ramp, not the deck
        /* Which road are you MORE CENTRED in -- one that climbs with the span,
           or one that crosses it? "Any crossing street wins" zeroed the
           approach at every junction on it, which put a hole in the ramp
           30 m short of the deck. */
        const d = spanDir(bs, x, z);
        let alongD = Infinity, crossD = Infinity;
        for (const seg of this.segmentsNear(x, z, 24)) {
          const vx = seg.bx - seg.ax, vz = seg.bz - seg.az, l = Math.hypot(vx, vz) || 1;
          let t = ((x - seg.ax) * vx + (z - seg.az) * vz) / (l * l); t = Math.max(0, Math.min(1, t));
          const dist = Math.hypot(x - seg.ax - vx * t, z - seg.az - vz * t);
          if (dist > seg.half) continue;
          if (Math.abs((vx * d[0] + vz * d[1]) / l) > 0.6) alongD = Math.min(alongD, dist);
          else crossD = Math.min(crossD, dist);
        }
        /* A bare comparison, no margin. Where two roads meet their centrelines
           pass within centimetres and the winner flutters sample to sample --
           at (2027,2421) the cross street is 0.3 m from its centre against the
           arterial's 0.4 m, and the approach drops for one 3 m step: a pothole.
           A margin is the obvious fix and it is the WRONG one: it makes the
           zero harder to reach, so more streets stay lifted onto decks. Swept:
             margin 0.0 -> 53 walls   0.5 -> 55   1.0 -> 63   1.5 -> 65   2.0 -> 65
           Every metre of margin trades one 3 m jolt for a dozen real walls. */
        if (crossD < alongD) return 0;      // squarely on the cross street: underneath
      }
    }
    if (best > 0 && bs && (bs.isFreeway || bs.height > 8.0)) {
      /* Deck or underneath? In plan they overlap, so no geometry alone can say
         -- a surface street crossing beneath the expressway sits inside the
         freeway's 22 m half-width, and the freeway's own centreline sits inside
         the crossing street's. The honest tie-break is which carriageway you
         are more CENTRED in: you are driving the road you are in the middle of.

         Measured at (3152,1253): 0.0 m from the arterial's centre, 20.3 m from
         the freeway's -- you are on the arterial, underneath. At the freeway's
         own centreline the comparison inverts and you stay on the deck.

         This replaces a parallelism test ("a street running WITH the span IS
         the approach, lift it"), which lifted every service street running
         alongside the expressway underneath it: 9.4 m in 3 m, the invisible
         wall you stop dead against. The expressway's real approaches are their
         own `ramp` class and are handled as elevated below. */
      /* NORMALISED centredness, d / half -- not raw metres (2026-09-14).
         A freeway on-ramp is half 8 where the arterial it merges with is
         half 15, and near the merge their carriageways OVERLAP in plan. On raw
         distance the winner flips every few metres, and each flip is a 9.4 m
         step: measured on the race route at (3100,2538) the ramp centre is
         3.2 m away and the arterial's 4.6 m, so the ramp won and lifted a car
         that was squarely on the arterial. As a FRACTION of each road's own
         width the arterial is 0.31 against the ramp's 0.40 -- you are further
         into the arterial, which is the true answer. A wide road owns you at a
         greater distance than a narrow one. */
      let groundD = Infinity, elevD = Infinity, elevSeg = null;
      for (const seg of this.segmentsNear(x, z, 30)) {
        const vx = seg.bx - seg.ax, vz = seg.bz - seg.az, l2 = vx * vx + vz * vz || 1;
        let t = ((x - seg.ax) * vx + (z - seg.az) * vz) / l2; t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(x - seg.ax - vx * t, z - seg.az - vz * t);
        if (d > seg.half) continue;
        const f = d / Math.max(1, seg.half);
        if (seg.cls === 'freeway' || seg.cls === 'ramp') {
          if (f < elevD) { elevD = f; elevSeg = seg; }
        } else if (f < groundD) groundD = f;
      }
      /* The tie goes to the GROUND against a ramp, and to the DECK against the
         expressway (2026-09-14). These roads genuinely overlap in plan, so no
         2D test can say which you are driving -- but the two structures fail
         differently and deserve different answers.

         A RAMP is half 8 and merges with an arterial of half 15, so they run
         together for a stretch and the nearer centreline flips every few
         metres. Measured on the race route: at (3102,2537) the ramp centre is
         1.3 m off against the arterial's 5.1 m, so the ramp won and lifted a
         car that was squarely on the arterial -- a 9.4 m invisible wall, which
         is the blockage on the scenic route. You can only reach a ramp from
         its own ends, so where one overlaps a road at grade, the road wins.

         The EXPRESSWAY is the opposite: it is a through road you drive along
         for kilometres, and every surface street crossing UNDER it also
         contains the deck's centreline. Handing those ties to the ground put
         46 holes in the motorway -- measured, by trying it. So the deck keeps
         its ties.

           elevated wins ties   53 walls total, 9.4 m walls on the race line
           ground wins ties     91 walls total, race line clean, 46 freeway holes
           split (this)         see below */
      if (elevSeg && elevSeg.cls === 'ramp' && groundD < Infinity) return deckBest;
      if (elevSeg && elevD <= groundD) {
        if (elevSeg.cls === 'ramp' && rampBest > 0) return rampBest;
        if (elevSeg.cls === 'freeway' && fwyBest > 0) return fwyBest;
        return best;
      }
      if (groundD < Infinity) return deckBest;
    }
    return best;
  }

  buildingsOf(blockId) { return this.buildingsByBlock.get(blockId) ?? []; }

  /**
   * Fill the blocks in.
   *
   * The file ships 2,598 footprints over 506 blocks: about five a block,
   * covering roughly 15% of a typical 56x44m downtown block. Measured from a
   * rooftop that reads as a plain of roads with the odd tower on it, because it
   * is one. A built city block is 60-90% footprint. This walks each built
   * block's frontage in block-local coordinates and drops additional
   * footprints wherever they fit without touching an authored one, leaving a
   * courtyard in the middle. Deterministic (hashed on block id and cell), and
   * everything downstream -- massing, collision, far stand-ins, the facade kit
   * -- reads buildingsOf(), so it all densifies together with no new draws.
   *
   * Procedural for layout, authored for detail: the authored footprints keep
   * their exact positions; this only adds where they left the slab bare.
   */
  #infill(data) {
    const BUILT = new Set(['row', 'mid', 'tower']);
    const MARGIN = 2.6;            // inset from the block edge: the pavement
    const GAP = 2.2;               // clear space to an authored footprint
    const hash = (a, b) => { const n = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return n - Math.floor(n); };
    let added = 0;
    for (const bl of data.blocks) {
      if (!BUILT.has(bl.type)) continue;
      const list = this.buildingsByBlock.get(bl.id) ?? [];
      const hw = bl.w / 2, hh = bl.h / 2;
      // frontage depth and plot width by block kind
      const depth = bl.type === 'tower' ? 18 : bl.type === 'mid' ? 15 : 11;
      const plot = bl.type === 'tower' ? 16 : bl.type === 'mid' ? 13 : 9;
      const overlaps = (x, y, w, d) => list.some((g) =>
        Math.abs(g.x - x) < (g.w + w) / 2 + GAP && Math.abs(g.y - y) < (g.d + d) / 2 + GAP);
      const tryPlace = (x, y, w, d, seedA, seedB) => {
        // shrink a little so a run of plots reads as separate buildings
        const k = 0.86 + hash(seedA, seedB) * 0.12;
        const ww = w * k, dd = d * k;
        if (Math.abs(x) + ww / 2 > hw - MARGIN || Math.abs(y) + dd / 2 > hh - MARGIN) return;
        if (overlaps(x, y, ww, dd)) return;
        list.push({ blockId: bl.id, block: [bl.x, bl.y], angle: bl.angle, x, y, w: ww, d: dd,
                    type: bl.type, infill: true });
        added++;
      };
      // long sides: plots along x, set back `depth` from the top and bottom edges
      const innerW = bl.w - 2 * MARGIN, innerH = bl.h - 2 * MARGIN;
      if (innerH > depth * 1.2) {
        const n = Math.max(1, Math.floor(innerW / plot));
        const step = innerW / n;
        for (let i = 0; i < n; i++) {
          const x = -innerW / 2 + step * (i + 0.5);
          tryPlace(x, -hh + MARGIN + depth / 2, step, depth, bl.id + i, 1);
          tryPlace(x,  hh - MARGIN - depth / 2, step, depth, bl.id + i, 2);
        }
      }
      // short sides, between the corner plots
      if (innerW > depth * 1.2) {
        const span = innerH - 2 * depth;
        const n = Math.max(0, Math.floor(span / plot));
        const step = n ? span / n : 0;
        for (let i = 0; i < n; i++) {
          const y = -span / 2 + step * (i + 0.5);
          tryPlace(-hw + MARGIN + depth / 2, y, depth, step, bl.id + 100 + i, 3);
          tryPlace( hw - MARGIN - depth / 2, y, depth, step, bl.id + 100 + i, 4);
        }
      }
      if (!this.buildingsByBlock.has(bl.id) && list.length) this.buildingsByBlock.set(bl.id, list);
    }
    this.infilled = added;
  }
}

/**
 * Precompute a span: cumulative lengths, a bounding box padded by the ramps,
 * and the end tangents used to extrapolate the approaches.
 */
function makeSpan(points, width, height, ramp, taper = false, kind = 'bridge') {
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
    pts, cum, half: width / 2, height, ramp, taper, kind,
    isFreeway: kind === 'freeway', isBridge: kind === 'bridge', isRamp: kind === 'ramp',
    length: cum[cum.length - 1],
    minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad,
  };
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Unit direction of the span's nearest piece to (x, z). */
function spanDir(s, x, z) {
  let bestD = Infinity, dir = [1, 0];
  for (let i = 0; i < s.pts.length - 1; i++) {
    const ax = s.pts[i][0], az = s.pts[i][1];
    const vx = s.pts[i + 1][0] - ax, vz = s.pts[i + 1][1] - az, l2 = vx * vx + vz * vz;
    let t = l2 ? ((x - ax) * vx + (z - az) * vz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
    if (d < bestD) { bestD = d; const l = Math.sqrt(l2) || 1; dir = [vx / l, vz / l]; }
  }
  return dir;
}

/** Height of one span at a point: 0 if the point is not over or approaching it. */
/** Deck beam thickness. Skirt over water/flyover stops this far under the
 *  tarmac instead of running to the riverbed. water.js piers meet this. */
export const DECK_T = 0.9;

/**
 * Bottom of the concrete under a raised road.
 * Over water or a flyover: a 0.9 m soffit (a beam). On a land ramp: a wall
 * down to grade (an abutment). The old path used `inWater` (bridges win) and
 * every river span became a dam.
 */
export function skirtFoot(deckY, overWater, cls) {
  if (!(deckY > 0.12)) return 0;
  if (overWater) return deckY - DECK_T;
  if (cls === 'freeway' || cls === 'ramp') return Math.max(0, deckY - DECK_T);
  return 0;
}

function spanHeight(s, x, z) {
  // 1. Check approach ramps first if not a continuous taper and ramp length > 0
  if (!s.taper && s.ramp) {
    for (const end of [0, 1]) {
      const p0 = end ? s.pts[s.pts.length - 1] : s.pts[0];
      const p1 = end ? s.pts[s.pts.length - 2] : s.pts[1];
      let ux = p0[0] - p1[0], uz = p0[1] - p1[1];
      const l = Math.hypot(ux, uz) || 1;
      ux /= l; uz /= l;                       // points OUT of the span
      const rx = x - p0[0], rz = z - p0[1];
      const out = rx * ux + rz * uz;          // metres past the abutment
      if (out > 0 && out <= s.ramp) {
        const perp = Math.hypot(rx - ux * out, rz - uz * out);
        if (perp <= s.half + 5.5) {           // same band as the span (covers pavement)
          return s.height * smooth(1 - out / s.ramp);
        }
      }
    }
  }

  // 2. Nearest point on the polyline, as (distance along, distance across)
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

  /* The lifted band covers the PAVEMENT, not just the carriageway.
     half + 5.5 clears the 4.8m pavement's outer edge with room for a railing. */
  if (bestD <= s.half + 5.5) {
    if (s.taper) {
      // a ramp climbs across its whole length rather than having approaches
      return s.height * smooth(Math.max(0, Math.min(1, along / Math.max(1, s.length))));
    }
    return s.height;
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
  const data = await fetchCached(url, 'json');
  return new District(data);
}
