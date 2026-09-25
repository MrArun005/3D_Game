/**
 * Halstead Bay, loaded.
 *
 * The 2D planner exports centrelines; everything the runtime needs is derived
 * from them here. The one job that matters is answering "where is the road?"
 * fast enough to call a few thousand times a second, because the suspension,
 * the hull collision, the camera and the traffic all ask constantly.
 */

import { fetchCached } from '../core/assetCache.js';
import { makePlayArea, clipGraph, COMPACT_PLACES, RACEWAY_POLY } from './playArea.js';

const CELL = 96;                       // spatial hash cell, metres
/* A NUMBER, not the old `${ix},${iz}` string: nearestRoad runs for every
   walking pedestrian, the car and the traffic every frame, and each call built
   and hashed nine strings (54% of the crowd's steady cost, 2026-09-23). The
   map is ~44 x 32 cells of 96 m, so the offset leaves room either side. */
const key = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);
export const gridKey = key;

/** Regent Street's carriageway, m (District #regentStreet). */
export const REGENT_STREET_W = 18;
/** Its side streets' first block, m (District #regentSideStreets). */
export const SIDE_W = 11;

export class District {
  /**
   * `opts.play`: a polygon ([x, z] vertices) the game is played inside -- the
   * compact city (world/playArea.js COMPACT_POLY), or null for the whole bay.
   */
  constructor(data, opts = {}) {
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
    this.regentStreet = this.#regentStreet(data);   // before the graph is clipped: it narrows, splits and cuts roads and edges
    this.graph = data.graph;
    /* The compact city (2026-09-23, world/playArea.js). GAMEPLAY reads
       `graph` -- traffic, the crowd, jobs, the checkpoint run, navigation,
       autopilot, versus, respawns -- so clipping it here is the one choke
       point that keeps all of them inside: 1,789 nodes / 2,937 edges -> 328 /
       511, one connected component. RENDERING (kerbs, markings, signals,
       gantries, junction decals, prop guards) reads `fullGraph`, or the inside
       half of every exit edge would lose its kerb. `bounds` stays the whole
       map (water, surrounds, riverside and versus read it); `playBounds` is
       the city's box for the map. `play` is the city alone (landmarks and the
       places filter ask it); `wall` is where a body may stand -- the city plus
       the raceway island, which /tp track and Shift+T still reach. With no
       opts none of this exists and the District answers exactly as before. */
    this.fullGraph = data.graph;
    this.play = null;
    this.wall = null;
    this.playBounds = null;
    if (opts.play) {
      this.play = makePlayArea(opts.play);
      this.wall = makePlayArea([opts.play, RACEWAY_POLY]);
      this.graph = clipGraph(data.graph, this.play);
      this.places = this.places.filter((p) => this.play.contains(p.x, p.y)).concat(COMPACT_PLACES);
      this.playBounds = this.play.bbox;
    }

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
      /* A river bridge LANDS AT GRADE on its own bank nodes (2026-09-25).
         Every bridge but the lift bridge was a 7.6 m flat deck from end node
         to end node plus a 62 m smoothstep ramp carried on INTO the city past
         them. Measured over the plan (scratchpad/bridge-audit.mjs): every one
         of the nine has a junction 0-39 m past each end, the quay streets
         (segment 539 on the east bank) run straight through the bridgeheads,
         and the water starts only 9-15 m in from the end nodes. So: (1) the
         quay street at BROADWAY rose 0 -> 6.4 m in 3 m at (1768,1600) and fell
         7.6 -> 0 at (1774,1641) -- the "invisible wall under the bridge"; (2)
         the approach ramp peaked at 18.4% (1.5 x 7.6 / 62), a ski jump; (3)
         the ramps stood across the next junction inland.
         The plan put junctions AT the bridge ends, so the deck has to meet the
         street there: an arch INSIDE the polyline, 0 at each end node, rising
         over the water with a smoothstep of half-length R <= ARCH_R and a crown
         H = ARCH_GRADE * R / 1.5, so the steepest point is ARCH_GRADE (7.5%).
         BROADWAY (148 m): R 74, crown 3.70 m, soffit 5.4 m over the water
         mid-river. The lift bridge keeps its 7.6 m deck and ramps --
         world/liftBridge.js and its tests are built on them. */
      /* DOCK ROAD keeps the old deck too: it crosses the lift bridge mid-river
         AT deck level (t 90-126 m of its 147), so an arch under it would be a
         7.6 m wall in the river, and its east end is 21 m from that crossing. */
      if (br.signature || crossesSignature(br, data.bridges)) {
        this.spans.push(makeSpan(br.points, br.width, 7.6, 62, false, 'bridge')); continue;
      }
      const sp = makeSpan(br.points, br.width, 0, 0, false, 'bridge');
      sp.arch = Math.min(ARCH_R, sp.length / 2);
      sp.height = Math.min(7.6, ARCH_GRADE * sp.arch / 1.5);
      this.spans.push(sp);
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
    this.shibuya = this.#carveShibuya(data);
  }

  /**
   * The Shibuya corner (2026-09-23, docs/REF-SHIBUYA.md): the Little Tokyo
   * crossroads nearest the spawn (2354, 1408 in main.js) gets its set pieces
   * on its four corners -- QFRONT on the biggest, the Shibuhachi screens
   * diagonally across, the slim sign corner and the ad drum on the other two --
   * and the vista drum down the street between the screens and the sign
   * corner. Decided HERE, once, in the footprint data, so everything that
   * reads buildingsOf() -- the chunk builder, collision, roofsNear, the far
   * stand-ins -- sees the same plots and the same heights (g.hero, g.heroH).
   *
   * Two of the four corners are 99 x 64 m tower plots whose corner is ~30 m
   * from the crossing: a set piece there takes a corner SQUARE carved out of
   * the plot (the tower keeps the rest; a filler plot takes the strip beside
   * the square), so QFRONT stands on the corner and not 40 m back in the
   * middle of a podium. Pure data; deterministic. `?noshibuya` skips it.
   */
  /**
   * REGENT STREET (2026-09-24, Arun: "make it exactly how long Regent Street
   * London is ... width, length, height"). The compact city's longest straight
   * London road is the Kingsway boundary road, 973 m from (1907, 1769) to
   * (2880, 1763) -- Oxford Circus to Piccadilly Circus on the real street is
   * about 830 m of it, so the length is right to within a block. It shipped
   * 26 m of carriageway; Regent Street's is two lanes each way plus a bus
   * lane, ~18 m, which with our 4.75 m building line each side puts the
   * facades 27.5 m apart (measured on the real street: ~27-30 m). So the road
   * is narrowed here, in the data every consumer derives from (segments,
   * graph edges, markings, traffic lanes), and named. world/regent.js lines
   * BOTH sides with one cornice line. Returns { road, a, b, width } or null
   * when the file does not carry that road.
   */
  #regentStreet(data) {
    const near = (p, x, z) => Math.abs(p[0] - x) < 3 && Math.abs(p[1] - z) < 3;
    const i = (data.roads ?? []).findIndex((r) => r.points?.length === 2 && near(r.points[0], 1906.7, 1768.7) && near(r.points[1], 2879.9, 1763.4));
    if (i < 0) return null;
    const r = data.roads[i], [A, B] = r.points, L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const off = (p) => Math.abs(((p[0] - A[0]) * (B[1] - A[1]) - (p[1] - A[1]) * (B[0] - A[0])) / L);
    /* ...and any stub drawn along it (the file lays a 26 m street over its
       first 100 m): a road whose every point sits within 6 m of the line. */
    const along = new Set([i]);
    data.roads.forEach((q, k) => { if (k !== i && q.points?.length >= 2 && q.points.every((p) => off(p) < 6)) along.add(k); });
    for (const k of along) { data.roads[k].width = REGENT_STREET_W; data.roads[k].name = 'REGENT STREET'; }
    for (const e of data.graph?.edges ?? []) if (along.has(e.road)) e.width = REGENT_STREET_W;
    if (data.graph) this.#regentSideStreets(data, along, A, B, L, off);
    const quadrant = data.graph ? this.#quadrant(data, along, off) : null;
    // `strip`: the line as the file drew it, which the planner's far-side strip is measured along
    return { road: i, a: r.points[0], b: r.points[r.points.length - 1], strip: [A, B], width: REGENT_STREET_W, quadrant };
  }

  /**
   * The streets that meet Regent Street (2026-09-24, Arun's go-ahead on
   * "cut the diagonals back" and "narrow the side streets"):
   *   1. A road meeting it at under 40 degrees (three Harbour Point streets
   *      at ~24 deg) peeled a 60-100 m wedge of tarmac off its south side,
   *      where no frontage could stand. Every edge of such a road with both
   *      ends within 70 m of the line is dropped, and the road now begins at
   *      its first junction beyond (a road left with no edges is dropped whole).
   *   2. Every other non-arterial road meeting it is narrowed to SIDE_W over
   *      its first block (the edge touching Regent Street): the real street's
   *      side streets -- Conduit, Maddox, New Burlington -- are ~10-12 m
   *      across, the file's were 26-30 m. The arterial crossing (Halstead
   *      Avenue, as Oxford Street at Oxford Circus) keeps its width.
   * Roads are split so the segments (tarmac), the graph edges and every
   * consumer agree. Node kinds are re-derived from the new degrees (the
   * signals and crossings read 'cross' / 'tee').
   */
  #regentSideStreets(data, along, A, B, L, off) {
    const G = data.graph, N = new Map(G.nodes.map((n) => [n.id, n]));
    const ux = (B[0] - A[0]) / L, uz = (B[1] - A[1]) / L;
    const onLine = (n) => off([n.x, n.y]) < 3 && (n.x - A[0]) * ux + (n.y - A[1]) * uz > -3 && (n.x - A[0]) * ux + (n.y - A[1]) * uz < L + 3;
    const regentNodes = new Set(G.nodes.filter(onLine).map((n) => n.id));
    const touched = new Set();
    // 1. the shallow roads
    const shallow = new Set();
    for (const e of G.edges) {
      if (along.has(e.road) || !(regentNodes.has(e.a) || regentNodes.has(e.b))) continue;
      const na = N.get(e.a), nb = N.get(e.b), dx = nb.x - na.x, dz = nb.y - na.y, l = Math.hypot(dx, dz) || 1;
      if (Math.abs(dx * ux + dz * uz) / l > Math.cos(40 * Math.PI / 180)) shallow.add(e.road);
    }
    const drop = new Set();
    for (const e of G.edges) if (shallow.has(e.road) && off([N.get(e.a).x, N.get(e.a).y]) < 70 && off([N.get(e.b).x, N.get(e.b).y]) < 70) drop.add(e);
    G.edges = G.edges.filter((e) => { if (!drop.has(e)) return true; touched.add(e.a); touched.add(e.b); return false; });
    for (const k of shallow) {
      const left = G.edges.filter((e) => e.road === k);
      const road = data.roads[k];
      if (!left.length) { road.points = []; continue; }
      // the road now runs over its kept edges only: their node chain, in the road's own direction
      const ends = new Map();
      for (const e of left) for (const id of [e.a, e.b]) ends.set(id, (ends.get(id) ?? 0) + 1);
      const tips = [...ends].filter(([, c]) => c === 1).map(([id]) => N.get(id));
      if (tips.length === 2) {
        const p0 = road.points[0], d = (n) => Math.hypot(n.x - p0[0], n.y - p0[1]);
        const [t0, t1] = d(tips[0]) < d(tips[1]) ? tips : [tips[1], tips[0]];
        road.points = [[t0.x, t0.y], [t1.x, t1.y]];
      }
    }
    // 2. the side streets' first block
    for (const e of G.edges) {
      if (along.has(e.road) || !(regentNodes.has(e.a) || regentNodes.has(e.b))) continue;
      const road = data.roads[e.road];
      if (!road || road.class === 'arterial' || road.class === 'freeway' || e.width <= SIDE_W) continue;
      const na = N.get(e.a), nb = N.get(e.b);
      if (Math.abs((nb.x - na.x) * ux + (nb.y - na.y) * uz) / (Math.hypot(nb.x - na.x, nb.y - na.y) || 1) > Math.cos(40 * Math.PI / 180)) continue;   // running along it: not a side street
      this.#splitRoadAt(data, e, SIDE_W);
    }
    // node kinds from the new degrees
    const deg = new Map();
    for (const e of G.edges) for (const id of [e.a, e.b]) deg.set(id, (deg.get(id) ?? 0) + 1);
    for (const id of touched) {
      const n = N.get(id), k = deg.get(id) ?? 0;
      if (n.kind === 'cross' || n.kind === 'tee' || n.kind === 'end') n.kind = k >= 4 ? 'cross' : k === 3 ? 'tee' : k === 2 ? 'bend' : 'end';
    }
    // an end node nothing reaches any more goes too
    G.nodes = G.nodes.filter((n) => deg.has(n.id) || !touched.has(n.id));
  }

  /**
   * THE QUADRANT (2026-09-24, Arun's three photos: the curve of Regent Street
   * into Piccadilly Circus -- one sweep, stone both sides, one cornice). The
   * compact grid has no curve, so one is laid: a circular arc TANGENT to
   * Regent Street at its junction (2056, 1768), across the empty block north
   * of it, to the junction at (1934, 1659) -- radius ~123 m, ~190 m of arc
   * (the real Quadrant runs ~200-250 m). Regent Street's width, its own road
   * and graph edge; world/regent.js lines both sides and the wedge it cuts
   * off the corner becomes the building between the two curving roads.
   * Returns { road, edge } or null when the file lacks either junction.
   */
  #quadrant(data, along, off) {
    const G = data.graph, find = (x, z) => G.nodes.find((n) => Math.hypot(n.x - x, n.y - z) < 4);
    const a = find(2056, 1768), b = find(1934, 1659);
    if (!a || !b) return null;
    // tangent to Regent Street (heading -X) at a: the centre is straight off it, R from |b - c| = R
    const dx = b.x - a.x, dz = b.y - a.y, R = (dx * dx + dz * dz) / (2 * -dz);   // c = (a.x, a.y - R)
    const cx = a.x, cz = a.y - R, t0 = Math.atan2(a.y - cz, a.x - cx), t1 = Math.atan2(b.y - cz, b.x - cx);
    let dt = t1 - t0; while (dt > Math.PI) dt -= 2 * Math.PI; while (dt < -Math.PI) dt += 2 * Math.PI;
    const n = Math.max(8, Math.round((Math.abs(dt) * R) / 8)), pts = [];
    for (let i = 0; i <= n; i++) { const t = t0 + (dt * i) / n; pts.push([cx + Math.cos(t) * R, cz + Math.sin(t) * R]); }
    pts[0] = [a.x, a.y]; pts[n] = [b.x, b.y];
    const road = data.roads.push({ class: 'street', name: 'REGENT STREET', width: REGENT_STREET_W, points: pts }) - 1;
    const id = G.edges.reduce((m, e) => Math.max(m, e.id), -1) + 1;
    const edge = { road, a: a.id, b: b.id, points: pts.map((p) => [p[0], p[1]]), class: 'street', width: REGENT_STREET_W, lanes: 2, oneway: false, length: Math.abs(dt) * R, id };
    G.edges.push(edge);
    /* The curve REPLACES the corner, as the real street does: Regent
       Street's straight run west of a, the corner node's other arms (the
       cross street's block from b down to it and the stub south of it) and
       the stubs laid along the line out there all go, so the land inside the
       sweep is building land. The western boundary roads still meet at the
       far end, so nothing is cut off; the compact graph stays one component. */
    const corner = G.nodes.find((nd) => Math.hypot(nd.x - b.x, nd.y - a.y) < 6);
    const dropped = new Set(G.edges.filter((e) => {
      if (e === edge) return false;
      if (corner && (e.a === corner.id || e.b === corner.id)) return true;
      if (!along.has(e.road)) return false;
      const na = G.nodes.find((nd) => nd.id === e.a), nb = G.nodes.find((nd) => nd.id === e.b);
      return na.x < a.x + 1 && nb.x < a.x + 1 && off([na.x, na.y]) < 8 && off([nb.x, nb.y]) < 8;   // west of a, a itself included
    }));
    const roads = new Set([...dropped].map((e) => e.road)), ends = new Set([...dropped].flatMap((e) => [e.a, e.b]));
    G.edges = G.edges.filter((e) => !dropped.has(e));
    for (const k of roads) this.#rebuildRoad(data, k);
    const deg = new Map();
    for (const e of G.edges) for (const nid of [e.a, e.b]) deg.set(nid, (deg.get(nid) ?? 0) + 1);
    for (const nd of G.nodes) if (ends.has(nd.id) || nd === a || nd === b) { const k = deg.get(nd.id) ?? 0; nd.kind = k >= 4 ? 'cross' : k === 3 ? 'tee' : k === 2 ? 'bend' : 'end'; }
    G.nodes = G.nodes.filter((nd) => deg.has(nd.id));
    return { road, edge: id, R, length: edge.length, start: [a.x, a.y], dropped: dropped.size };
  }

  /** A road's polyline from the graph edges it still has: the chain of their points, in order (empty when none are left). */
  #rebuildRoad(data, k) {
    const es = data.graph.edges.filter((e) => e.road === k), road = data.roads[k];
    if (!es.length) { road.points = []; return; }
    const at = new Map();
    for (const e of es) for (const nid of [e.a, e.b]) (at.get(nid) ?? at.set(nid, []).get(nid)).push(e);
    // start at an end of the chain nearest the road's old first point
    const tips = [...at].filter(([, l]) => l.length === 1).map(([nid]) => nid);
    const p0 = road.points[0] ?? [0, 0], first = (e, nid) => (e.a === nid ? e.points : e.points.slice().reverse());
    const nodeXY = (nid) => { const e = at.get(nid)[0], pts = e.a === nid ? e.points : e.points.slice().reverse(); return pts[0]; };
    let cur = tips.length ? tips.reduce((m, t) => (Math.hypot(nodeXY(t)[0] - p0[0], nodeXY(t)[1] - p0[1]) < Math.hypot(nodeXY(m)[0] - p0[0], nodeXY(m)[1] - p0[1]) ? t : m)) : es[0].a;
    const used = new Set(), out = [];
    for (;;) {
      const e = (at.get(cur) ?? []).find((q) => !used.has(q));
      if (!e) break;
      used.add(e);
      const pts = first(e, cur);
      for (let i = out.length ? 1 : 0; i < pts.length; i++) out.push([pts[i][0], pts[i][1]]);
      cur = e.a === cur ? e.b : e.a;
    }
    // an edge's points may stop short of its junctions: run the road into the nodes at both ends
    const xy = (nid) => { const nd = data.graph.nodes.find((q) => q.id === nid); return nd ? [nd.x, nd.y] : null; };
    if (out.length >= 2) {
      const startId = [...at.keys()].find((nid) => at.get(nid).length === 1 && Math.hypot(nodeXY(nid)[0] - out[0][0], nodeXY(nid)[1] - out[0][1]) < 0.5);
      const n0 = startId !== undefined ? xy(startId) : null, n1 = xy(cur);
      if (n0 && Math.hypot(n0[0] - out[0][0], n0[1] - out[0][1]) > 0.5) out.unshift(n0);
      if (n1 && Math.hypot(n1[0] - out[out.length - 1][0], n1[1] - out[out.length - 1][1]) > 0.5) out.push(n1);
    }
    road.points = out.length >= 2 ? out : [];
  }

  /** Give edge `e` its own road of width `w` (its points), cutting that stretch out of the road it belonged to. */
  #splitRoadAt(data, e, w) {
    const src = data.roads[e.road], P = src.points;
    const cum = [0];
    for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const proj = (q) => {
      let best = [Infinity, 0];
      for (let i = 0; i < P.length - 1; i++) {
        const vx = P[i + 1][0] - P[i][0], vz = P[i + 1][1] - P[i][1], l2 = vx * vx + vz * vz || 1;
        let t = ((q[0] - P[i][0]) * vx + (q[1] - P[i][1]) * vz) / l2; t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(q[0] - P[i][0] - vx * t, q[1] - P[i][1] - vz * t);
        if (d < best[0]) best = [d, cum[i] + t * (cum[i + 1] - cum[i])];
      }
      return best[1];
    };
    const at = (s) => {
      for (let i = 0; i < P.length - 1; i++) if (s <= cum[i + 1] + 1e-9) { const t = (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1); return [P[i][0] + (P[i + 1][0] - P[i][0]) * t, P[i][1] + (P[i + 1][1] - P[i][1]) * t]; }
      return P[P.length - 1];
    };
    const piece = (s0, s1) => { const pts = [at(s0)]; for (let i = 1; i < P.length - 1; i++) if (cum[i] > s0 && cum[i] < s1) pts.push(P[i]); pts.push(at(s1)); return pts; };
    const sa = proj(e.points[0]), sb = proj(e.points[e.points.length - 1]), lo = Math.min(sa, sb), hi = Math.max(sa, sb), total = cum[cum.length - 1];
    const oldIdx = e.road, rest = data.graph.edges.filter((q) => q !== e && q.road === oldIdx);
    const before = lo > 1 ? piece(0, lo) : null, after = hi < total - 1 ? piece(hi, total) : null;
    src.points = before ?? after ?? [];
    let afterIdx = oldIdx;
    if (before && after) { afterIdx = data.roads.push({ ...src, points: after }) - 1; }
    for (const q of rest) { const m = (proj(q.points[0]) + proj(q.points[q.points.length - 1])) / 2; if (m > hi && afterIdx !== oldIdx) q.road = afterIdx; }
    e.road = data.roads.push({ ...src, width: w, points: e.points.map((p) => [p[0], p[1]]) }) - 1;
    e.width = w;
  }

  #carveShibuya(data) {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('noshibuya')) return null;
    const BUILT = new Set(['row', 'mid', 'tower']);
    const HEIGHT_OF = { qfront: 46, screens: 44, signstack: 41, addrum: 44, drum: 47 };
    const nodes = (data.graph?.nodes ?? []).filter((n) => n.kind === 'cross');
    let node = null, bestD = 150;
    for (const n of nodes) { const d = Math.hypot(n.x - 2354, n.y - 1408); if (d < bestD) { bestD = d; node = n; } }
    if (!node) return null;
    const tokyo = data.blocks.filter((b) => b.district === 'LITTLE TOKYO' && BUILT.has(b.type));
    const local = (bl, x, z) => { const ca = Math.cos(bl.angle), sa = Math.sin(bl.angle), rx = x - bl.x, rz = z - bl.y; return [rx * ca + rz * sa, -rx * sa + rz * ca]; };
    const world = (bl, lx, lz) => { const ca = Math.cos(bl.angle), sa = Math.sin(bl.angle); return [bl.x + lx * ca - lz * sa, bl.y + lx * sa + lz * ca]; };
    // the footprint on each corner: nearest by distance to its RECTANGLE, its centre in that quadrant
    const corner = [null, null, null, null];
    for (const bl of tokyo) {
      const [nx, nz] = local(bl, node.x, node.y);
      for (const g of this.buildingsOf(bl.id)) {
        const [wx, wz] = world(bl, g.x + g.w / 2, g.y + g.d / 2), q = (wx < node.x ? 1 : 0) + (wz < node.y ? 2 : 0);
        const d = Math.hypot(nx - Math.max(g.x, Math.min(nx, g.x + g.w)), nz - Math.max(g.y, Math.min(nz, g.y + g.d)));
        if (d < 45 && Math.min(g.w, g.d) >= 7 && (!corner[q] || d < corner[q].d)) corner[q] = { bl, g, d, q, nx, nz };
      }
    }
    const live = corner.filter(Boolean);
    if (!live.length) return null;
    const big = live.slice().sort((a, b) => b.g.w * b.g.d - a.g.w * a.g.d)[0];
    for (const c of live) {
      if (c === big) c.type = 'qfront';
      else if (c.q === (big.q ^ 3)) c.type = 'screens';
    }
    const rest = live.filter((c) => !c.type).sort((a, b) => Math.max(b.g.w, b.g.d) / Math.min(b.g.w, b.g.d) - Math.max(a.g.w, a.g.d) / Math.min(a.g.w, a.g.d));
    if (rest[0]) rest[0].type = 'signstack';   // the slimmest: the sign corner is a narrow slab
    if (rest[1]) rest[1].type = 'addrum';
    const out = { node, plots: [] };
    /* The streets off the crossing are 8-12 storeys in every photo: cap every
       Little Tokyo footprint within 160 m of the node at 40 m (g.capH), read by
       the chunk builder, the far stand-ins and roofsNear alike. */
    for (const bl of tokyo) {
      const ca = Math.cos(bl.angle), sa = Math.sin(bl.angle);
      for (const g of this.buildingsOf(bl.id)) {
        const lx = g.x + g.w / 2, lz = g.y + g.d / 2;
        if (Math.hypot(bl.x + lx * ca - lz * sa - node.x, bl.y + lx * sa + lz * ca - node.y) < 160) g.capH = 40;
      }
    }
    const GAP = 1.0;
    /* A corner square of side S out of footprint g at the corner nearest the
       node (nx, nz, block-local). The tower keeps the full depth beyond the
       square along its longer side; the strip beside the square becomes a
       filler plot. Returns the square (a new footprint in the same list). */
    const carve = (bl, g, S, nx, nz) => {
      const list = this.buildingsOf(bl.id);
      const ex = nx < g.x + g.w / 2 ? -1 : 1, ez = nz < g.y + g.d / 2 ? -1 : 1;   // which end of each axis faces the node
      const hx0 = ex < 0 ? g.x : g.x + g.w - S, hz0 = ez < 0 ? g.y : g.y + g.d - S;
      const hero = { blockId: bl.id, block: [bl.x, bl.y], angle: bl.angle, x: hx0, y: hz0, w: S, d: S, type: bl.type, infill: true, carved: true };
      const alongX = g.w - S >= g.d - S;
      if (alongX) {
        // the tower gives up the square's width along x: filler takes the rest of that column
        const fz0 = ez < 0 ? hz0 + S + GAP : g.y, fd = g.d - S - GAP;
        if (fd >= 7) list.push({ blockId: bl.id, block: [bl.x, bl.y], angle: bl.angle, x: hx0, y: fz0, w: S, d: fd, type: bl.type, infill: true, carved: true });
        if (ex < 0) { g.x += S + GAP; } g.w -= S + GAP;
      } else {
        const fx0 = ex < 0 ? hx0 + S + GAP : g.x, fw = g.w - S - GAP;
        if (fw >= 7) list.push({ blockId: bl.id, block: [bl.x, bl.y], angle: bl.angle, x: fx0, y: hz0, w: fw, d: S, type: bl.type, infill: true, carved: true });
        if (ez < 0) { g.y += S + GAP; } g.d -= S + GAP;
      }
      list.push(hero);
      return hero;
    };
    for (const c of live) {
      const S = c.type === 'qfront' ? 26 : c.type === 'screens' ? 25 : 20;
      const g = Math.max(c.g.w, c.g.d) > S + 14 ? carve(c.bl, c.g, Math.min(S, c.g.w, c.g.d), c.nx, c.nz) : c.g;
      g.hero = c.type; g.heroH = HEIGHT_OF[c.type];
      const [wx, wz] = world(c.bl, g.x + g.w / 2, g.y + g.d / 2);
      out.plots.push({ type: c.type, x: wx, z: wz, g });
    }
    /* The vista drum: down the approach that runs between the screens corner
       and the sign corner, 90-190 m out, the plot nearest that street's centre
       line (a corner square out of a big one). */
    const scr = out.plots.find((p) => p.type === 'screens'), sig = out.plots.find((p) => p.type === 'signstack');
    if (scr && sig) {
      let bx = (scr.x + sig.x) / 2 - node.x, bz = (scr.z + sig.z) / 2 - node.y;
      const bl0 = Math.hypot(bx, bz) || 1; bx /= bl0; bz /= bl0;
      // snap to the approach edge nearest that bisector
      let vx = bx, vz = bz, bestDot = -2;
      for (const e of data.graph.edges ?? []) {
        const other = e.a === node.id ? e.b : e.b === node.id ? e.a : null;
        if (other == null) continue;
        const o = data.graph.nodes.find((n) => n.id === other); if (!o) continue;
        const ux = o.x - node.x, uz = o.y - node.y, ul = Math.hypot(ux, uz) || 1;
        const dot = (ux * bx + uz * bz) / ul;
        if (dot > bestDot) { bestDot = dot; vx = ux / ul; vz = uz / ul; }
      }
      let pick = null;
      for (const bl of tokyo) for (const g of this.buildingsOf(bl.id)) {
        if (g.hero || Math.min(g.w, g.d) < 9) continue;   // a drum 8.4 m across at the least
        const [wx, wz] = world(bl, g.x + g.w / 2, g.y + g.d / 2), rx = wx - node.x, rz = wz - node.y;
        const t = rx * vx + rz * vz, lat = Math.abs(-rx * vz + rz * vx);
        if (t < 90 || t > 190 || lat > 45) continue;
        if (!pick || lat < pick.lat) pick = { bl, g, lat, t };
      }
      if (pick) {
        const [cx, cz] = world(pick.bl, 0, 0), ax = node.x + vx * pick.t, az = node.y + vz * pick.t;
        const [nx, nz] = local(pick.bl, ax, az);
        const g = Math.max(pick.g.w, pick.g.d) > 26 ? carve(pick.bl, pick.g, 12, nx, nz) : pick.g;
        g.hero = 'drum'; g.heroH = HEIGHT_OF.drum;
        const [wx, wz] = world(pick.bl, g.x + g.w / 2, g.y + g.d / 2);
        out.plots.push({ type: 'drum', x: wx, z: wz, g, along: pick.t, lateral: pick.lat });
        void cx; void cz;
      }
    }
    return out;
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

  /* The nearest centreline segment to (x, z): leaves its squared distance in
     _nd2 and the segment in _ns (null if nothing is near). Squared distances,
     one sqrt at the end, no object per improvement -- same answer as before
     (the first strictly nearer segment wins). */
  #nearest(x, z) {
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    let bestD2 = Infinity, bestS = null;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const ids = this.grid.get(key(ix + dx, iz + dz));
        if (!ids) continue;
        for (let n = 0; n < ids.length; n++) {
          const s = this.segments[ids[n]];
          const vx = s.bx - s.ax, vz = s.bz - s.az;
          const l = vx * vx + vz * vz;
          let t = l ? ((x - s.ax) * vx + (z - s.az) * vz) / l : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = x - s.ax - vx * t, ez = z - s.az - vz * t, d2 = ex * ex + ez * ez;
          if (d2 < bestD2) { bestD2 = d2; bestS = s; }
        }
      }
    }
    this._nd2 = bestD2; this._ns = bestS;
    return bestS !== null;
  }

  /** Nearest road centreline, as {distance, half, class} — null if nothing near. */
  nearestRoad(x, z) {
    if (!this.#nearest(x, z)) return null;
    return { distance: Math.sqrt(this._nd2), half: this._ns.half, cls: this._ns.cls };
  }

  /**
   * Metres OUTSIDE the kerb line: <= 0 on tarmac. Same contract, same units as
   * the grid version it replaces, so collision, grip, camera and traffic gates
   * all keep working without knowing the world changed underneath them.
   */
  roadDepth(x, z) {
    if (!this.#nearest(x, z)) return 60;   // nowhere near a road: firmly off it
    return Math.sqrt(this._nd2) - this._ns.half;
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
      if (withinPolyline(br.points, x, z, br.width / 2 + 2.5)) return false;
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
    if (withinPolyline(W.river.points, x, z, W.river.width / 2)) return true;
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

  /**
   * The deck height along a road segment, as knots {knots: t[], ys: y[], peak}
   * (2026-09-25). Two knots -- the end centres, exactly the old lerp -- unless
   * an end or the middle of the segment is on a river-bridge ARCH
   * (district.archAt), where elevationAt is a smoothstep and not a lerp: then
   * a knot every <= DECK_STEP m on the centreline, straight runs merged (16 m keeps
   * the worst arch segment at 2,191 triangles per 100 m; 10 m cost 3,035). This is
   * the ONE place the tarmac (districtWorld) and the structure (buildSpan) get
   * their heights from, so they cannot disagree.
   */
  deckProfile(seg) {
    const dx = seg.bx - seg.ax, dz = seg.bz - seg.az, L = Math.hypot(dx, dz) || 1;
    const e = (t) => this.elevationAt(seg.ax + dx * t / L, seg.az + dz * t / L);
    const yA = e(0), yB = e(L);
    /* A long street that merely STARTS at a bridgehead node is not on the
       arch: sampling its 500 m would draw every other span's lift it passes
       (measured: nine such streets, 0.1-0.7 m bumps). The middle, or a short
       segment with an end on it, is. */
    const onArch = this.archAt(seg.ax + dx / 2, seg.az + dz / 2)
      || (L < 2 * ARCH_R && (this.archAt(seg.ax, seg.az) || this.archAt(seg.bx, seg.bz)));
    if (!onArch) return { knots: [0, L], ys: [yA, yB], peak: Math.max(yA, yB) };
    const n = Math.ceil(L / DECK_STEP);
    const T = [], Y = [];
    for (let i = 0; i <= n; i++) { T.push(L * i / n); Y.push(i === 0 ? yA : i === n ? yB : e(L * i / n)); }
    const knots = [T[0]], ys = [Y[0]];
    for (let i = 1; i < n; i++) {                   // drop a knot the line through its neighbours already passes
      const t0 = knots[knots.length - 1], y0 = ys[ys.length - 1];
      const lin = y0 + (Y[i + 1] - y0) * (T[i] - t0) / (T[i + 1] - t0);
      if (Math.abs(Y[i] - lin) > 0.02) { knots.push(T[i]); ys.push(Y[i]); }
    }
    knots.push(T[n]); ys.push(Y[n]);
    return { knots, ys, peak: Math.max(...ys) };
  }

  /** The drawn deck height t metres along a road segment (deckProfile). */
  deckAt(seg, t) { return profileAt(this.deckProfile(seg), t); }

  /** Is (x, z) on a river-bridge arch's band (2026-09-25)? deckProfile asks,
      to know which road segments must be sampled along and not lerped. */
  archAt(x, z) {
    for (const s of this.spans) {
      if (!s.arch || x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
      for (let i = 0; i < s.pts.length - 1; i++) {
        const ax = s.pts[i][0], az = s.pts[i][1], vx = s.pts[i + 1][0] - ax, vz = s.pts[i + 1][1] - az;
        const l2 = vx * vx + vz * vz;
        let t = l2 ? ((x - ax) * vx + (z - az) * vz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
        if (Math.hypot(x - ax - vx * t, z - az - vz * t) <= s.half + 5.5) return true;
      }
    }
    return false;
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
      /* A footprint's x/y is its MIN corner in block-local coordinates (the
         planner's convention; districtWorld places a building at x + w/2).
         This test and the push below used to read and write CENTRES, so every
         infill plot landed half its size off the spot it was checked at: 1,123
         of 1,207 poked out of their block, 110 pairs overlapped, 3 sat wholly
         inside an authored tower (measured 2026-09-23, scratchpad overlap.mjs)
         -- the Shibuya corner plot among them. x, y below are centres. */
      const overlaps = (x, y, w, d) => list.some((g) =>
        Math.abs(g.x + g.w / 2 - x) < (g.w + w) / 2 + GAP && Math.abs(g.y + g.d / 2 - y) < (g.d + d) / 2 + GAP);
      const place = (x, y, w, d, seedA, seedB) => {
        // shrink a little so a run of plots reads as separate buildings
        const k = 0.86 + hash(seedA, seedB) * 0.12;
        const ww = w * k, dd = d * k;
        if (Math.abs(x) + ww / 2 > hw - MARGIN || Math.abs(y) + dd / 2 > hh - MARGIN) return false;
        if (overlaps(x, y, ww, dd)) return false;
        list.push({ blockId: bl.id, block: [bl.x, bl.y], angle: bl.angle, x: x - ww / 2, y: y - dd / 2, w: ww, d: dd,
                    type: bl.type, infill: true });
        added++;
        return true;
      };
      /* A slot an authored footprint half blocks still takes a narrower plot
         beside it: halves, then thirds, along the frontage (never narrower
         than MIN_W). With the overlap test in the right convention the whole
         slots alone fill 357 of the old 1,207, so without this the downtown
         blocks thin out (coverage 0.447 -> 0.398). */
      const MIN_W = bl.type === 'tower' ? 9 : bl.type === 'mid' ? 7 : 5;
      const tryPlace = (x, y, w, d, seedA, seedB) => {
        if (place(x, y, w, d, seedA, seedB)) return;
        const alongX = w >= d, L = alongX ? w : d;
        for (const n of [2, 3]) {
          if (L / n < MIN_W) break;
          let any = false;
          for (let i = 0; i < n; i++) {
            const o = -L / 2 + (L / n) * (i + 0.5);
            if (place(alongX ? x + o : x, alongX ? y : y + o, alongX ? L / n : w, alongX ? d : L / n, seedA * 7 + n * 13 + i, seedB)) any = true;
          }
          if (any) return;
        }
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
/** Height of a deckProfile at t metres along its segment. */
export function profileAt(prof, t) {
  const K = prof.knots, Y = prof.ys;
  if (t <= K[0]) return Y[0];
  for (let i = 1; i < K.length; i++) {
    if (t <= K[i]) return Y[i - 1] + (Y[i] - Y[i - 1]) * (t - K[i - 1]) / (K[i] - K[i - 1] || 1);
  }
  return Y[Y.length - 1];
}


/** Arch profile knot spacing, m: a 16 m chord sags <= 13 cm at BROADWAY's
    crown (6H/R^2 = 0.004 /m). */
export const DECK_STEP = 16;

/** Does a bridge's polyline pass within the signature bridge's deck band? */
function crossesSignature(br, bridges) {
  for (const sg of bridges) {
    if (!sg.signature || sg === br) continue;
    const r = sg.width / 2 + 5.5;
    for (let i = 0; i < br.points.length - 1; i++) {
      const [ax, az] = br.points[i], [bx, bz] = br.points[i + 1], L = Math.hypot(bx - ax, bz - az);
      for (let t = 0; t <= L; t += 2) {
        if (withinPolyline(sg.points, ax + (bx - ax) * t / L, az + (bz - az) * t / L, r)) return true;
      }
    }
  }
  return false;
}

/** River-bridge arch: longest half-rise, and the steepest grade it may reach. */
export const ARCH_R = 90, ARCH_GRADE = 0.075;

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
    if (s.arch) {
      // the river bridge's arch: 0 at both end nodes, never past them
      const k = Math.min(along, s.length - along) / s.arch;
      return k <= 0 ? 0 : s.height * smooth(Math.min(1, k));
    }
    if (s.taper) {
      // a ramp climbs across its whole length rather than having approaches
      return s.height * smooth(Math.max(0, Math.min(1, along / Math.max(1, s.length))));
    }
    return s.height;
  }
  return 0;
}

/* Is the point within `r` of the polyline? The same answer as the old
   nearPolyline(...) < r (the least distance over every piece), but each piece
   is rejected on its bounding box before any square root and the walk stops
   at the first hit. The river is 99 points, and the drowning test, the
   placement guards and the compact city's wall dressing (playArea.js) all
   ask: inOpenWater measured 5.7 -> 2.1 us a call (node, 5,182 samples). */
function withinPolyline(pts, x, z, r) {
  const r2 = r * r;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
    if (x < (ax < bx ? ax : bx) - r || x > (ax > bx ? ax : bx) + r
     || z < (az < bz ? az : bz) - r || z > (az > bz ? az : bz) + r) continue;
    const vx = bx - ax, vz = bz - az;
    const l = vx * vx + vz * vz;
    let t = l ? ((x - ax) * vx + (z - az) * vz) / l : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x - ax - vx * t, ez = z - az - vz * t;
    if (ex * ex + ez * ez < r2) return true;
  }
  return false;
}

function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export async function loadDistrict(url = '/halstead-bay.district.json', opts = {}) {
  const data = await fetchCached(url, 'json');
  return new District(data, opts);
}
