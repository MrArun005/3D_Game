import * as THREE from 'three';
import { CELL, LANE, ROAD_HALF } from '../world/metrics.js';
import { signalState, STOP_LINE } from '../world/signals.js';
import { mulberry32 } from '../core/rng.js';
import { personGeometry } from '../world/beach.js';
import { PAINT_COLOURS, BODY_KEYS, BODY_TYPES } from '../vehicle/config.js';
import { groundHeightAt } from '../world/metrics.js';
import { buildOfficer, poseOfficer, PoseBlender, lookAt } from '../world/officer.js';
import { buildWeaponMesh, ARSENAL } from './weapons.js';
import { weaponForWanted, aimJitter, burstFor, hasLineOfSight, shotLands, targetProfile, nextState, MAX_DEPLOYED, pickRooftops, coverSide } from './policeAi.js';
import { roofsNear } from '../world/districtWorld.js';

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** Free-flow speed by road class, m/s. A street is not a bypass. */
const CLASS_SPEED = { freeway: 27, ramp: 14, arterial: 17, boundary: 13, street: 10.5 };
const LOOKAHEAD = 150;               // metres of path kept in front of a car
export const ZEBRA_DEPTH = 4.2;      // shared with the crossing paint in the world
/* Shirts. A street where every driver wears the same colour reads as clones,
   and you see straight into these cabins now. */
const OCCUPANT = [0x2c3a4e, 0x6d4630, 0x3f5b45, 0x7a3540, 0x4a4a55, 0x8a7a58, 0x2f4f6b];
const rightOf = (d) => [-d[1], d[0]];
const axisOf = (d) => (d[0] !== 0 ? 0 : 1);

/** A point on the lane line for direction `d` through junction (i,j). */
function lanePoint(i, j, d, lane) {
  const r = rightOf(d);
  return [i * CELL + r[0] * lane * LANE, j * CELL + r[1] * lane * LANE];
}

/**
 * Traffic that lives on the grid.
 *
 * Each car follows a polyline that is extended one junction at a time. As a
 * segment is appended it records a "gate": the distance along the path at
 * which the car meets a stop line, and which junction and axis govern it. The
 * car then only ever has to look at the next gate to know whether to stop —
 * no per-frame search of the world, and it keeps working when the cell it is
 * driving through streams out behind it.
 */
export class Traffic {
  constructor(scene, assets, count = 18, night = false) {
    this.night = night;
    this.scene = scene;
    this.assets = assets;
    this.rand = mulberry32(4242);
    this.cars = [];
    this.time = 0;

    /* Wanted level.
       Kept here rather than in its own system because the pursuit fleet is
       just traffic with a different opinion about where to go and whether red
       means stop -- all the path, gate and leader machinery is already here. */
    this.wanted = 0;
    this.cool = 0;                    // seconds of clean driving
    this.bustT = 0;                   // how long they have had you surrounded
    this.police = [];
    for (let i = 0; i < count; i++) this.cars.push(this.#makeCar());
  }

  /** Report a collision. `tag` says what was hit; `force` is closing speed. */
  reportCrime(tag, force) {
    const worth = tag === 'police' ? 1.3
                : tag === 'person' ? 1.5
                : tag === 'traffic' ? 0.55
                : 0;                                  // walls and parked cars: nobody cares
    if (!worth) return;
    // one pedestrian is about two stars, not five: `force` is m/s, so the
    // multiplier has to be gentle or a single hit at speed maxes the meter
    const gain = worth * Math.min(1.4, 0.5 + force * 0.05);
    this.wanted = Math.min(5, this.wanted + gain);
    this.cool = 0;
  }

  /** How many cars should be hunting at this wanted level. */
  #wantedCars() {
    return Math.min(6, Math.floor(this.wanted));
  }

  #makePolice() {
    const c = this.#makeCar(this.assets.geo.stunt.police ? 'police' : 'sedan');
    c.mesh.material.color.setHex(0x0d1526);
    c.mesh.material.metalness = 0.35;
    c.hunt = true;
    c.mode = 'road';
    c.lost = 0;
    c.best = Infinity;
    c.stale = 0;
    c.cruise = 26 + this.rand() * 5;

    // the doors and the bar are what make it read as police in one glance
    const decal = liveryTexture();
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(c.spec.L * 0.42, c.spec.bonnetY * 0.5),
        new THREE.MeshStandardMaterial({
          map: decal, transparent: true, roughness: 0.45,
          polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
        }),
      );
      // one plane per flank, facing outward, riding just proud of the paint
      // wMax is a HALF width, so *0.5 put both decals inside the car
      panel.position.set(c.spec.L * 0.03, c.spec.bonnetY * 0.66, side * (c.spec.wMax + 0.015));
      panel.rotation.y = side > 0 ? 0 : Math.PI;
      c.mesh.add(panel);
    }
    // roof band, so it reads as police from directly behind too
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(c.spec.L * 0.22, 0.05, c.spec.wMax * 1.5),
      new THREE.MeshStandardMaterial({ color: 0xeef1f6, roughness: 0.45 }));
    roof.position.set(0, c.spec.roofY ?? c.spec.bonnetY * 1.34, 0);
    c.mesh.add(roof);
    const bar = [];
    for (const [i, hex] of [[-1, 0xff2a1c], [1, 0x2f6dff]]) {
      const lens = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.16, 0.42),
        new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.4 }),
      );
      lens.position.set(0, (c.spec.roofY ?? c.spec.bonnetY * 1.34) + 0.11, i * 0.26);
      c.mesh.add(lens);
      bar.push(lens.material);
    }
    c.bar = bar;

    /* The officer rides in the car and gets out when the chase stops being a
       chase. Kept in the scene rather than parented to the cruiser, because
       the whole point is that they leave it. */
    /* A real officer: seven vertex-coloured meshes with a face, a cap, a stab
       vest and a duty belt (world/officer.js). Geometry and material are shared
       by every officer in the city, so this costs meshes, not memory. */
    const built = buildOfficer(this.police.length + 1);   // seeded by unit number: the same faces every load
    const officer = built.group;
    c.joints = built.joints;
    c.blender = new PoseBlender();
    c.pose = 'idle';
    c.poseT = Math.random() * 6;
    /* The sidearm hangs off the right arm rather than the group, so it follows
       every pose for free -- no second animation to keep in sync. -Y is down
       the arm, so the weapon's +X muzzle turns onto it. */
    const gun = buildWeaponMesh('pistol');
    gun.position.set(0, -0.58, 0);
    gun.rotation.z = -Math.PI / 2;
    c.joints.armR.add(gun);
    c.gun = gun;
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xfff0c0, toneMapped: false }));
    flash.position.set(ARSENAL.pistol.muzzle, 0, 0);   // at the muzzle, in gun space
    flash.visible = false;
    gun.add(flash);
    officer.visible = false;
    this.scene.add(officer);
    c.officer = officer;
    c.flash = flash;
    c.deployT = 0;
    c.holdT = 0;
    c.fireT = 0;
    // firefight state (policeAi.js): hp, cover state, weapon, burst bookkeeping
    c.hp = 100; c.down = 0; c.state = 'cover'; c.stateT = 0; c.gunKind = 'pistol'; c.burstLeft = 0; c.quietFor = 0; c.coverX = 0; c.coverZ = 0; c.slot = this.police.length;
    c.deployed = false;
    return c;
  }

  /** Send everyone home: used when the player is arrested. */
  standDown() {
    this.wanted = 0;
    this.cool = 0;
    this.bustT = 0;
    for (const c of this.police) {
      c.live = false;
      c.mesh.visible = false;
      c.mode = 'road';
      c.deployed = false;
      c.deployT = 0; c.holdT = 0;
      if (c.officer) c.officer.visible = false;
    }
  }

  #makeCar(force) {
    const rand = this.rand;
    const keys = this.assets.geo.stuntKeys ?? BODY_KEYS;    // vendor kits add taxi
    const style = force || keys[Math.floor(rand() * keys.length)];
    const spec = BODY_TYPES[style] ?? BODY_TYPES.sedan;      // taxi/police borrow the sedan's
    const mat = this.assets.mat.parked.clone();
    mat.color.setHex(PAINT_COLOURS[Math.floor(rand() * PAINT_COLOURS.length)]);
    const kit = this.assets.geo.stunt[style];
    let mesh;
    if (kit.group) {
      // a whole textured body (the owner's Sketchfab cars): one clone, its own materials, no paint tint
      /* Inside a unit-scale group. The kit's wrap carries the scale that
         brings a 5 cm Sketchfab export up to car length (~98x); the brake box
         and headlamps below are sized in metres and hung on `mesh`, so on the
         wrap itself they became 100 m red slabs and 30 m white blocks at 75 m
         up -- the "glow blocks in the sky" (measured 2026-09-03). */
      mesh = new THREE.Group();
      const body = kit.group.clone(true);
      body.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      mesh.add(body);
      mesh.material = mat;                          // keeps the .material.color callers happy
    } else {
      mesh = new THREE.Mesh(kit.body, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // a vendor kit's `glass` is its whole detail part (glass, tyres, trim) in the kit palette
      mesh.add(new THREE.Mesh(kit.glass, kit.detailMat ?? this.assets.mat.carGlass));
      const who = new THREE.Mesh(kit.occupant, this.assets.mat.parked.clone());
      who.material.color.setHex(OCCUPANT[Math.floor(rand() * OCCUPANT.length)]);
      who.material.metalness = 0.0;
      who.material.roughness = 0.85;
      mesh.add(who);
    }

    mesh.visible = false;

    const brakeMat = this.assets.mat.tailDim.clone();
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, spec.wMax * 1.3), brakeMat);
    /* The REAR is -X: the fleet drives along +X (a Kenney SUV comes at the
       camera nose-first, headlights and all). This box sat at +L/2 -- on the
       bonnet -- from the day the loft was turned round, and nobody could
       tell on a hull with no lamps of its own. */
    tail.position.set(-(spec.L * 0.5 - 0.06), spec.bonnetY * 0.86, 0);
    mesh.add(tail);
    // headlamps: every car reads as lit at night (Phase 5), the nearest four also get a real spot
    if (this.night) {
      const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xfff2d0, emissiveIntensity: 2.6 });
      for (const s of [-1, 1]) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.3), lampMat);
        lamp.position.set(spec.L * 0.5 - 0.04, spec.bonnetY * 0.78, s * spec.wMax * 0.62);
        mesh.add(lamp);
      }
    }
    this.scene.add(mesh);

    return {
      mesh, brakeMat, spec, style, live: false,   // style: what body this is, so a carjack can dress the hero in it
      path: [], gates: [], s: 0, pathLen: 0,
      speed: 0, cruise: 11 + rand() * 7,
      node: [0, 0], dir: DIRS[0], lane: 0.5,
      offsets: [-spec.L * 0.31, 0, spec.L * 0.31],
      radius: Math.max(0.92, spec.wMax * 1.02),
      reach: spec.L * 0.5 + 0.6,
      x: 0, z: 0, yaw: 0, stopped: false,
    };
  }

  /**
   * Move the whole fleet off the procedural grid and onto Halstead Bay's road
   * graph. Only route-finding changes: the path/gate/leader machinery below is
   * already geometry-agnostic, so signals, queueing and collision come along
   * untouched.
   */
  useGraph(district) {
    this.E = district.graph.edges;
    this.N = new Map(district.graph.nodes.map((n) => [n.id, n]));
    this.adj = new Map();
    this.E.forEach((e, i) => {
      for (const id of [e.a, e.b]) {
        const list = this.adj.get(id);
        if (list) list.push(i); else this.adj.set(id, [i]);
      }
    });
    for (const car of this.cars) { car.live = false; car.mesh.visible = false; }
  }

  /** The edge's polyline, guaranteed to start at `fromId`. Export order is not
      reliably a->b: 55 of the first 400 edges store their points backwards. */
  #oriented(e, fromId) {
    const n = this.N.get(fromId);
    const p = e.points;
    const head = Math.hypot(p[0][0] - n.x, p[0][1] - n.y);
    const tail = Math.hypot(p[p.length - 1][0] - n.x, p[p.length - 1][1] - n.y);
    return head <= tail ? p : p.slice().reverse();
  }

  /** Centre of lane `i` measured right of the centreline. */
  #laneOffset(e, i) {
    const lanes = Math.max(1, e.lanes || 1);
    const k = Math.min(i, lanes - 1);
    return (e.width / 2) * ((2 * k + 1) / (2 * lanes));
  }

  /** Shift a centreline right by `off`, one normal per segment. */
  #shift(pts, off) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.min(i, pts.length - 2)], b = pts[Math.min(i, pts.length - 2) + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      out.push([pts[i][0] - (dz / l) * off, pts[i][1] + (dx / l) * off]);
    }
    return out;
  }

  /** Drive the current edge, stop-line to stop-line, then turn at its far end. */
  #extendGraph(car) {
    const e = this.E[car.edge];
    const line = this.#shift(this.#oriented(e, car.node), this.#laneOffset(e, car.lane));
    const far = e.a === car.node ? e.b : e.a;
    const node = this.N.get(far);
    const L = this.#edgeLen(line);
    /* Stop clear of the junction AND clear of the crossing in front of it.
       Clamping this to a fraction of the edge length instead -- which is what
       it used to do -- parked cars in the middle of short links, nowhere near
       a junction, waiting at a stop line that was 65% of the way down a 20m
       stub of road. */
    const back = e.width / 2 + 1.2 + ZEBRA_DEPTH + 1.0;
    const cut = L - back;
    const gated = cut > 3;                      // no room on this stub: no gate

    // run the edge, stopping `back` short of the junction it feeds
    let run = 0;
    for (let i = 1; i < line.length; i++) {
      const seg = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
      const total = run + seg;
      if (gated && total > cut) {
        const t = Math.max(0, (cut - run) / (seg || 1));
        this.#push(car, [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t,
                         line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t]);
        break;
      }
      run = total;
      this.#push(car, line[i]);
    }

    const stopAt = car.path[car.path.length - 1];
    // signalled junctions only: a quay or a dead end has nothing to obey
    if (gated && node && (node.kind === 'cross' || node.kind === 'tee')) {
      const dx = stopAt[0] - line[0][0], dz = stopAt[1] - line[0][1];
      car.gates.push({ s: car.pathLen, node: [far, 0], axis: Math.abs(dx) > Math.abs(dz) ? 0 : 1 });
    }

    // choose a way out: never double back unless the junction is a dead end
    const cand = (this.adj.get(far) ?? []).filter((id) => id !== car.edge);
    const heading = Math.atan2(stopAt[1] - line[0][1], stopAt[0] - line[0][0]);
    const next = cand.length ? this.#pickExit(cand, far, heading, car.hunt ? this.player : null) : car.edge;

    const ne = this.E[next];
    car.lane = Math.min(car.lane, Math.max(1, ne.lanes || 1) - 1);
    const nline = this.#shift(this.#oriented(ne, far), this.#laneOffset(ne, car.lane));
    const entry = this.#advance(nline, Math.min(ne.width / 2 + 1.2, (ne.length || 20) * 0.35));

    // one quadratic through the junction centre: sharp enough to read as a
    // corner, smooth enough that the leader check does not see a wall
    for (let k = 1; k <= 6; k++) {
      const t = k / 6, u = 1 - t;
      this.#push(car, [
        u * u * stopAt[0] + 2 * u * t * node.x + t * t * entry[0],
        u * u * stopAt[1] + 2 * u * t * node.y + t * t * entry[1],
      ]);
    }

    car.node = far;
    car.edge = next;
  }

  #edgeLen(line) {
    let L = 0;
    for (let i = 1; i < line.length; i++) L += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    return L;
  }

  /** Point `d` metres in from the start of a polyline. */
  #advance(line, d) {
    let run = 0;
    for (let i = 1; i < line.length; i++) {
      const seg = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
      if (run + seg >= d) {
        const t = (d - run) / (seg || 1);
        return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t,
                line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t];
      }
      run += seg;
    }
    return line[line.length - 1];
  }

  /** Mostly straight on, the way real traffic distributes -- unless hunting,
      in which case take whichever exit closes on the target. */
  #pickExit(cand, from, heading, target) {
    const n = this.N.get(from);
    let best = cand[0], bestW = -Infinity;
    for (const id of cand) {
      const e = this.E[id];
      const p = this.#oriented(e, from);
      const far = this.N.get(e.a === from ? e.b : e.a);
      const out = Math.atan2(p[1][1] - n.y, p[1][0] - n.x);
      const turn = Math.abs(((out - heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      let w;
      if (target && far) {
        // greedy descent on the graph: the exit that ends up nearest the player
        w = -Math.hypot(far.x - target.x, far.y - target.z) - turn * 6;
      } else {
        // weight straight-ahead heavily, then jitter so the fleet does not convoy
        w = (Math.PI - turn) * 2 + this.rand() * 1.4;
      }
      if (w > bestW) { bestW = w; best = id; }
    }
    return best;
  }

  /** Drop a car onto a random edge in a ring around the player. */
  #spawnGraph(car, player) {
    let pick = -1;
    for (let tries = 0; tries < 60 && pick < 0; tries++) {
      const id = Math.floor(this.rand() * this.E.length);
      const p = this.E[id].points[0];
      const d = Math.hypot(p[0] - player.x, p[1] - player.z);
      if (d > 55 && d < 260) pick = id;
    }
    if (pick < 0) return;                       // nothing in range this frame

    const e = this.E[pick];
    car.edge = pick;
    car.node = e.a;
    car.lane = this.rand() < 0.65 ? 0 : 1;
    car.cruise = (CLASS_SPEED[e.class] ?? 11) * (0.85 + this.rand() * 0.3);
    car.path = []; car.gates = []; car.pathLen = 0; car.s = 0;
    const line = this.#shift(this.#oriented(e, e.a), this.#laneOffset(e, car.lane));
    this.#push(car, line[0]);
    let guard = 0;
    while (car.pathLen < LOOKAHEAD && guard++ < 40) this.#extendGraph(car);
    car.speed = car.cruise * 0.7;
    car.live = true;
    car.mesh.visible = true;
    this.#place(car);
  }

  /** Append the next block plus the manoeuvre through the junction at its end. */
  #extend(car) {
    const rand = this.rand;
    const { node, dir, lane } = car;
    const next = [node[0] + dir[0], node[1] + dir[1]];

    // run up to the stop line of the next junction
    const entry = lanePoint(next[0], next[1], dir, lane);
    const stop = [entry[0] - dir[0] * STOP_LINE, entry[1] - dir[1] * STOP_LINE];
    this.#push(car, stop);
    car.gates.push({ s: car.pathLen, node: next.slice(), axis: axisOf(dir) });

    // pick a way through: mostly straight, and never a U-turn
    const roll = rand();
    const turn = roll < 0.62 ? 0 : roll < 0.81 ? 1 : 3;      // straight / right / left
    const nd = DIRS[(DIRS.indexOf(dir) + turn) % 4];

    if (turn === 0) {
      this.#push(car, lanePoint(next[0], next[1], dir, lane));
      this.#push(car, [
        lanePoint(next[0], next[1], dir, lane)[0] + dir[0] * (ROAD_HALF + 2),
        lanePoint(next[0], next[1], dir, lane)[1] + dir[1] * (ROAD_HALF + 2),
      ]);
    } else {
      // both radii must stay inside the stop line, or the path doubles back:
      // the arc would start further out than the point the car stops at
      const radius = turn === 1 ? 6.5 : 9.2;                // right is tighter
      const pd = lanePoint(next[0], next[1], dir, lane);
      const pe = lanePoint(next[0], next[1], nd, lane);
      const C = dir[0] !== 0 ? [pe[0], pd[1]] : [pd[0], pe[1]];
      const start = [C[0] - dir[0] * radius, C[1] - dir[1] * radius];
      const centre = [start[0] + nd[0] * radius, start[1] + nd[1] * radius];
      this.#push(car, start);
      let a0 = Math.atan2(-nd[1], -nd[0]);
      let a1 = Math.atan2(dir[1], dir[0]);
      while (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
      while (a1 - a0 < -Math.PI) a1 += Math.PI * 2;
      for (let k = 1; k <= 8; k++) {
        const a = a0 + (a1 - a0) * (k / 8);
        this.#push(car, [centre[0] + Math.cos(a) * radius, centre[1] + Math.sin(a) * radius]);
      }
      this.#push(car, [
        C[0] + nd[0] * (radius + ROAD_HALF), C[1] + nd[1] * (radius + ROAD_HALF),
      ]);
    }
    car.node = next;
    car.dir = nd;
  }

  #push(car, p) {
    const last = car.path[car.path.length - 1];
    if (last) car.pathLen += Math.hypot(p[0] - last[0], p[1] - last[1]);
    car.path.push([p[0], p[1], car.pathLen]);
  }

  spawn(car, player, first) {
    if (this.E) return this.#spawnGraph(car, player);
    const rand = this.rand;
    const pi = Math.round(player.x / CELL), pj = Math.round(player.z / CELL);
    const ring = first ? 1 : 2;
    const i = pi + Math.round((rand() * 2 - 1) * ring);
    const j = pj + Math.round((rand() * 2 - 1) * ring);
    car.dir = DIRS[Math.floor(rand() * 4)];
    car.lane = rand() < 0.5 ? 0.5 : 1.5;
    car.node = [i, j];
    car.path = []; car.gates = []; car.pathLen = 0; car.s = 0;
    const p0 = lanePoint(i, j, car.dir, car.lane);
    // start mid-block, never inside a junction box
    const back = CELL * 0.42;
    this.#push(car, [p0[0] - car.dir[0] * back, p0[1] - car.dir[1] * back]);
    this.#extend(car);
    this.#extend(car);
    car.speed = car.cruise * 0.7;
    car.live = true;
    car.mesh.visible = true;
    this.#place(car);
  }

  /** Position and heading at the current distance along the path. */
  #place(car) {
    const path = car.path;
    let k = 1;
    while (k < path.length - 1 && path[k][2] < car.s) k++;
    const a = path[k - 1], b = path[k];
    const seg = Math.max(1e-4, b[2] - a[2]);
    const t = Math.max(0, Math.min(1, (car.s - a[2]) / seg));
    car.x = a[0] + (b[0] - a[0]) * t;
    car.z = a[1] + (b[1] - a[1]) * t;
    car.yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    // bridges: the deck is 7.6m up, and a car at y=0 drives through it
    car.mesh.position.set(car.x, groundHeightAt(car.x, car.z), car.z);
    car.mesh.rotation.y = car.yaw;
  }

  bodies(target = null) {
    const out = target || [];
    if (!target) out.length = 0;
    for (let i = 0; i < this.police.length; i++) {
      const c = this.police[i];
      if (!c.live) continue;
      if (!c.body) {
        c.body = { x: c.x, z: c.z, yaw: c.yaw, offsets: c.offsets, radius: c.radius, reach: c.reach, tag: 'police', car: c };
      } else {
        c.body.x = c.x; c.body.z = c.z; c.body.yaw = c.yaw;
      }
      out.push(c.body);
    }
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      if (!c.live) continue;
      if (!c.body) {
        c.body = { x: c.x, z: c.z, yaw: c.yaw, offsets: c.offsets, radius: c.radius, reach: c.reach, tag: 'traffic', car: c };
      } else {
        c.body.x = c.x; c.body.z = c.z; c.body.yaw = c.yaw;
      }
      out.push(c.body);
    }
    return out;
  }

  /* Dropped weapons: a downed officer's gun stays on the road for 40 s and the
     player can walk over it to take it (GTA's oldest loop). One list, no
     allocation beyond the drop record; the gun mesh is re-parented, not cloned. */
  #dropWeapon(c) {
    this.drops ??= [];
    const g = c.gun; if (!g) return;
    c.joints.armR.remove(g);
    g.position.set(c.officer.position.x + 0.4, groundHeightAt(c.officer.position.x, c.officer.position.z) + 0.03, c.officer.position.z + 0.3);
    g.rotation.set(Math.PI / 2, 0, this.rand() * Math.PI * 2);
    g.visible = true;
    this.scene.add(g);
    this.drops.push({ kind: c.gunKind, mesh: g, t: 40, x: g.position.x, z: g.position.z });
    c.gun = null;
  }

  /** Called by main each frame: hands back a dropped weapon kind if the player stands on one. */
  pickupAt(x, z) {
    if (!this.drops) return null;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      if (Math.hypot(d.x - x, d.z - z) < 1.2) { this.scene.remove(d.mesh); this.drops.splice(i, 1); return d.kind; }
    }
    return null;
  }

  #tickDrops(dt) {
    if (!this.drops) return;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]; d.t -= dt;
      if (d.t <= 0) { this.scene.remove(d.mesh); this.drops.splice(i, 1); }
    }
  }

  /** A player round hit a deployed officer. Two rifle rounds or four pistol rounds put him down. */
  officerHit(c, damage = 26) {
    if (!c?.deployed || c.down > 0) return false;
    c.hp -= damage;
    c.quietFor = 0;
    c.hitT = 0.35;                                     // stagger: torso snaps away from the round, then eases back
    if (c.hp <= 0) { c.state = 'down'; c.down = 0.001; this.chatter?.radioPool?.('down'); this.#dropWeapon(c); return true; }
    return false;
  }

  /* --- rooftop marksmen (four stars and up) ---
     Two rifles on the two tallest roofs 45-130 m out, crossing fire. They are
     not in cars and never come down: they appear when the level is reached,
     fire aimed bursts with a real line of sight from height (their own roof's
     box is excluded from the test, or it would block them), and leave when the
     stars fall. Cost: 2 officers = 16 meshes, and they are seeded like the rest. */
  #rooftops(player, dt) {
    const stars = Math.floor(this.wanted);
    this.marks ??= [];
    if (stars < 4) {
      for (const m of this.marks) { this.scene.remove(m.group); }
      this.marks.length = 0;
      return;
    }
    // you have moved on: marksmen 220 m behind you are scenery, so re-place them
    if (this.marks.length && Math.min(...this.marks.map((m) => Math.hypot(m.group.position.x - player.x, m.group.position.z - player.z))) > 220) {
      for (const m of this.marks) this.scene.remove(m.group);
      this.marks.length = 0;
    }
    if (!this.marks.length && this.world?.district) {
      const roofs = roofsNear(this.world.district, player.x, player.z, 140, 24);
      const picks = pickRooftops(roofs, player.x, player.z);
      for (let i = 0; i < picks.length; i++) {
        const r = picks[i];
        const built = buildOfficer(90 + i);
        built.group.position.set(r.x, r.h + 0.5, r.z);
        const gun = buildWeaponMesh('rifle'); gun.position.set(0, -0.58, 0); gun.rotation.z = -Math.PI / 2;
        built.joints.armR.add(gun);
        this.scene.add(built.group);
        this.marks.push({ group: built.group, joints: built.joints, blender: new PoseBlender(), roof: r, fireT: 1.5 + i, burstLeft: 0, poseT: 0 });
        this.chatter?.radioPool?.('rooftops');
      }
    }
    const prof = targetProfile(!!player.onFoot, !!player.crouch);
    const ty = (player.y ?? 0) + prof.y;
    for (const m of this.marks) {
      const gx = m.group.position.x, gz = m.group.position.z, gy = m.group.position.y + 1.3;
      const face = Math.atan2(-(player.z - gz), player.x - gx);
      m.group.rotation.y = -face + Math.PI / 2;
      m.poseT += dt;
      m.blender.apply(m.joints, 'aim', m.poseT, dt, 0.3);
      const gap = Math.hypot(player.x - gx, player.z - gz);
      const bldg = this.world?.nearbyBuildings ? this.world.nearbyBuildings(player.x, player.z).filter((b) => Math.hypot(b.x - m.roof.x, b.z - m.roof.z) > 1) : [];
      const canSee = hasLineOfSight(gx, gy, gz, player.x, ty, player.z, bldg, this.cars, null);
      m.fireT -= dt;
      if (canSee && m.fireT <= 0) {
        if (m.burstLeft <= 0) m.burstLeft = burstFor('rifle').shots;
        m.burstLeft--;
        m.fireT = m.burstLeft > 0 ? burstFor('rifle').gap : 1.4 + this.rand() * 1.2;
        const w = ARSENAL.rifle;
        const landed = shotLands(gx, gy, gz, player.x, ty, player.z, prof.r, aimJitter(stars, gap, player.speed ?? 0) * 0.8 + w.restSpread, this.rand);
        if (this.onShot) this.onShot(gap, landed, w.damage, m.group.position);
      }
    }
  }

  /* --- the door gunner (five stars) ---
     The helicopter already holds a searchlight on you; at five stars somebody
     leans out of it with an SMG. Bursts every 2.5 s with a line of sight from
     altitude, wide jitter for a moving platform. No new mesh: the muzzle is
     the aircraft's position. */
  #airGunner(player, dt) {
    const h = this.heli;
    if (!h || Math.floor(this.wanted) < 5 || h.landed) { this._gunT = 1.5; return; }
    this._gunT = (this._gunT ?? 1.5) - dt;
    if (this._gunT > 0) return;
    const prof = targetProfile(!!player.onFoot, !!player.crouch);
    const ty = (player.y ?? 0) + prof.y;
    const gap = Math.hypot(player.x - h.pos.x, player.z - h.pos.z);
    const bldg = this.world?.nearbyBuildings ? this.world.nearbyBuildings(player.x, player.z) : [];
    const canSee = hasLineOfSight(h.pos.x, h.pos.y - 1, h.pos.z, player.x, ty, player.z, bldg, [], null);
    this._gunBurst = (this._gunBurst ?? 0) > 0 ? this._gunBurst - 1 : burstFor('smg').shots - 1;
    this._gunT = this._gunBurst > 0 ? burstFor('smg').gap : 2.5 + this.rand() * 1.5;
    if (!canSee) return;
    const w = ARSENAL.smg;
    const landed = shotLands(h.pos.x, h.pos.y - 1, h.pos.z, player.x, ty, player.z, prof.r, aimJitter(5, gap, player.speed ?? 0) * 1.3 + w.restSpread, this.rand);
    if (this.onShot) this.onShot(gap, landed, w.damage, h.pos);
    this.crowd?.panic?.(player.x, player.z, 18);
  }

  update(player, dt, time) {
    for (const v of this.cars) if (v.fleeT > 0) { v.fleeT -= dt; if (v.fleeT <= 0 && v.baseCruise) v.cruise = v.baseCruise; }
    this.#tickDrops(dt);
    this.#rooftops(player, dt);
    this.#airGunner(player, dt);
    this.hot = false;   // set true below by any officer who can see you this frame
    this.time = time !== undefined ? time : this.time + dt;
    const t = this.time;
    this.player = player;
    this.#updateWanted(player, dt, t);

    // Hoist police-active check out of per-car loop
    let policeActive = false;
    if (this.wanted >= 1) {
      for (let i = 0; i < this.police.length; i++) {
        if (this.police[i].live) { policeActive = true; break; }
      }
    }

    for (const car of this.cars) {
      if (!car.live) { this.spawn(car, player, false); continue; }

      // keep at least a junction of path in front of us
      let guard = 0;
      while (car.pathLen - car.s < (this.E ? LOOKAHEAD : CELL * 1.2) && guard++ < 40) {
        if (this.E) this.#extendGraph(car); else this.#extend(car);
      }
      while (car.gates.length && car.gates[0].s < car.s - 2) car.gates.shift();

      let limit = car.cruise;

      /* --- the light at the next junction ---
         The deceleration curve alone is not enough: braking asymptotically
         still trickles a car over the line at walking pace, and once the gate
         is behind it the check stops applying and it bolts across. A stop line
         is a hard constraint, so it is enforced as one below. */
      let hold = null;
      const gate = car.gates[0];
      if (gate) {
        const gap = gate.s - car.s;
        if (gap < 60) {
          const state = signalState(gate.node[0], gate.node[1], gate.axis, t);
          // amber only stops you if you could still pull up for it
          const mustStop = state === 'red'
            || (state === 'amber' && gap > car.speed * 1.1);
          if (mustStop && gap > -0.05) {      // never drag a committed car back
            hold = gate.s;
            limit = Math.min(limit, Math.sqrt(Math.max(0, gap) * 2 * 4.5));
          }
        }
      }

      /* --- whatever is in front, including the player --- */
      limit = Math.min(limit, this.#leaderLimit(car, player));
      /* Sirens: civilians within 70 m of a pursuit slow to a crawl and drift
         to the kerb lane, so a chase runs through parting traffic. */
      if (!car.hunt && policeActive && Math.hypot(car.x - player.x, car.z - player.z) < 70) {
        limit = Math.min(limit, 2.5);
        car.lane = Math.max(car.lane, Math.max(1, car.edge?.lanes || 1) - 1);
      }

      const accel = limit > car.speed ? 4.5 : 9.0;
      car.speed += Math.max(-accel, Math.min(accel, limit - car.speed)) * dt * 2.2;
      car.stopped = car.speed < 0.4;
      if (car.laneCooldown > 0) {
        car.laneCooldown -= dt;
        if (car.laneCooldown <= 0) {
          car.changingLane = false;
          if (car.lane !== 0 && !car.hunt) {
            car.lane = 0;
            car.laneCooldown = 4.0;
          }
        }
      }
      if (car.panic > 0) {
        car.panic -= dt;
        const flash = Math.sin(t * 18) > 0;
        car.brakeMat.emissiveIntensity = flash ? 3.2 : 0.2;
      } else {
        car.brakeMat.emissiveIntensity = limit < car.speed - 0.3 || car.stopped ? 2.4 : 0.35;
      }

      car.s += car.speed * dt;
      if (hold !== null && car.s > hold) { car.s = hold; car.speed = 0; }
      this.#place(car);

      if (Math.hypot(car.x - player.x, car.z - player.z) > 320) {
        car.live = false;
        car.mesh.visible = false;
      }
    }
  }

  /**
   * The chase.
   *
   * Two modes, because neither alone works. On the graph a pursuit car can
   * navigate a 4km city but can never follow you onto a beach; free-driving
   * straight at you looks right up close but has no idea where the roads are.
   * So: graph at range, direct pursuit inside 70m, and a respawn on the graph
   * near you if it loses you badly enough that re-acquiring an edge would be
   * guesswork.
   */
  #updateWanted(player, dt, t) {
    // heat bleeds off once you stop hitting things and get clear
    let nearest = Infinity;
    for (let i = 0; i < this.police.length; i++) {
      const c = this.police[i];
      if (c.live) {
        const d = Math.hypot(c.x - player.x, c.z - player.z);
        if (d < nearest) nearest = d;
      }
    }
    if (this.wanted > 0) {
      // air support does not lose you: breaking line of sight from the cars
      // is not enough while something is circling overhead
      this.cool = (nearest > 240 && !this.eyesOn) ? this.cool + dt : 0;
      if (this.cool > 9) { this.wanted = Math.max(0, this.wanted - dt * 0.55); }
    }

    /* The arrest is the fleet's, not the first car's.
       Running the clock per-cop meant whoever arrived first ended it before
       anyone else had climbed out -- you were nicked by one officer while
       four cruisers were still parking. Now it only counts while at least
       two are out, or one if that is all there is. */
    const out = this.police.filter((c) => c.live && c.deployed);
    const enough = out.length >= Math.min(2, this.#wantedCars());
    const near = out.some((c) => Math.hypot(c.x - player.x, c.z - player.z) < 13);
    this.bustT = (enough && near) ? this.bustT + dt : Math.max(0, this.bustT - dt);
    if (this.bustT > 5.5 && this.onBust) { this.bustT = 0; this.onBust(); return; }

    const want = this.#wantedCars();
    while (this.police.length < want) this.police.push(this.#makePolice());
    for (let i = 0; i < this.police.length; i++) {
      const c = this.police[i];
      if (i >= want) { c.live = false; c.mesh.visible = false; continue; }
      if (!c.live) { this.#spawnGraph(c, player); c.best = Infinity; c.stale = 0; continue; }

      const dx = player.x - c.x, dz = player.z - c.z;
      const gap = Math.hypot(dx, dz);

      // lightbar: alternating, and fast enough to read as urgent
      if (c.bar) {
        const flash = Math.floor(t * 6) % 2;
        c.bar[0].emissiveIntensity = flash ? 5.5 : 0.15;
        c.bar[1].emissiveIntensity = flash ? 0.15 : 5.5;
      }

      /* ponytail: greedy descent, not A*. It closes on the player from
         anywhere connected, but it can sit in a local minimum -- across the
         river from you with the nearest bridge in the wrong direction. Rather
         than pathfind properly, notice a cop that has stopped closing and
         re-deploy it. Swap in A* over `edges` if pursuit routing ever needs
         to be more than plausible. */
      if (c.mode === 'road') {
        if (gap < (c.best ?? Infinity) - 4) { c.best = gap; c.stale = 0; }
        else c.stale += dt;
        if (c.stale > 11) { c.live = false; c.mesh.visible = false; c.best = Infinity; c.stale = 0; continue; }
      }

      if (c.mode === 'road' && gap < 70) c.mode = 'free';
      if (c.mode === 'free' && gap > 150) { c.lost += dt; } else { c.lost = 0; }
      if (c.lost > 3) { c.live = false; c.mesh.visible = false; c.mode = 'road'; c.lost = 0; continue; }

      /* --- out of the car ---
         A pursuit that ends with four cars idling around you is not an
         arrest. Once you have stopped and they have you, officers get out,
         open fire, and if you stay put you are nicked. */
      /* Decay rather than reset. Five cruisers boxing you in are also
         constantly nudging you, so an instant "are you stopped?" test never
         held true for the second it needed -- nobody ever got out. */
      const stopped = (player.speed ?? 0) < 3.4;
      const close = gap < 16;
      if (c.mode === 'free' && stopped && close) c.deployT += dt;
      else c.deployT = Math.max(0, c.deployT - dt * 0.8);
      if (!c.deployed && c.deployT > 1.0 && this.police.filter((q) => q.deployed).length < MAX_DEPLOYED) {
        c.deployed = true; c.fireT = 0.5; c.state = 'cover'; c.stateT = 0; c.hp = 100; c.down = 0;
        // the response draws heavier guns as the stars climb; the mesh swaps geometry, not material
        c.gunKind = weaponForWanted(Math.floor(this.wanted), c.slot);
        c.gun.geometry = buildWeaponMesh(c.gunKind).geometry;
        c.flash.position.x = ARSENAL[c.gunKind].muzzle;
        { const cs = coverSide(c.x, c.z, c.yaw, player.x, player.z); c.coverX = cs.x; c.coverZ = cs.z; }   // the door away from you, car between
        this.chatter?.radioPool?.(Math.floor(this.wanted) >= 3 ? 'deployHot' : 'deploy');
      }
      if (c.deployed && (gap > 30 || c.deployT <= 0)) {
        c.deployed = false;
        c.officer.visible = false;
        c.holdT = 0;
      }

      if (c.deployed) {
        /* --- the firefight (policeAi.js) ---
           Cover behind the door, peek out to fire an aimed burst that needs a
           real line of sight, back into cover, advance to the next cover when
           you go quiet, cuff you when you stop, go down when hit. */
        // run down by the car: a deployed officer within a bonnet's length of a moving car goes down
        if (!c.down && !player.onFoot && (player.speed ?? 0) > 4 && Math.hypot(c.officer.position.x - player.x, c.officer.position.z - player.z) < 1.7) {
          this.officerHit(c, 100);
          this.reportCrime?.('police', 6);
        }
        if (c.down > 0) {
          c.down += dt;
          poseOfficer(c.joints, 'fall', Math.min(1, c.down / 0.6));
          if (c.gun) c.gun.visible = false; if (c.flash) c.flash.visible = false;
          if (c.down > 12) { c.deployed = false; c.officer.visible = false; c.live = false; c.mesh.visible = false; c.mode = 'road'; }
          continue;
        }
        const prof = targetProfile(!!player.onFoot, !!player.crouch);
        const ty = (player.y ?? 0) + prof.y;
        const gunY = c.officer.position.y + (c.state === 'cover' || c.state === 'peek' ? 0.9 : 1.3);
        const bldg = this.world?.nearbyBuildings ? this.world.nearbyBuildings(c.officer.position.x, c.officer.position.z) : [];
        const canSee = c.state === 'cover' ? hasLineOfSight(c.coverX, gunY, c.coverZ, player.x, ty, player.z, bldg, this.cars, null) : hasLineOfSight(c.officer.position.x, gunY, c.officer.position.z, player.x, ty, player.z, bldg, this.cars, null);
        if (canSee) this.hot = true;
        c.quietFor = (player.firedAt !== undefined && performance.now() - player.firedAt < 1500) ? 0 : c.quietFor + dt;
        c.stateT += dt;
        const next = nextState({ state: c.state, hp: c.hp, gap, playerSpeed: player.speed ?? 0, quietFor: c.quietFor, canSee, burstLeft: c.burstLeft, t: c.stateT });
        if (next !== c.state) {
          if (next === 'peek') { const b = burstFor(c.gunKind); c.burstLeft = b.shots; c.fireT = 0.12; }
          if (next === 'advance') { const ang = Math.atan2(player.z - c.coverZ, player.x - c.coverX); const step = Math.min(8, Math.max(0, gap - 7)); c.coverX += Math.cos(ang) * step; c.coverZ += Math.sin(ang) * step; }
          if (next === 'down') { c.down = 0.001; this.chatter?.radioPool?.('down'); this.#dropWeapon(c); }
          else if (next === 'advance') this.chatter?.radioPool?.('advance');
          else if (next === 'arrest') this.chatter?.radioPool?.('arrest');
          else if (next === 'peek' && c.state === 'cover' && c.stateT > 3) this.chatter?.radioPool?.('pinned');
          c.state = next; c.stateT = 0;
        }
        const sx = c.coverX, sz = c.coverZ;
        const face = Math.atan2(-(player.z - sz), player.x - sx);
        // stand ON the road, not at sea level -- officers deploy on bridges too
        c.officer.position.set(sx, groundHeightAt(sx, sz), sz);
        c.officer.rotation.y = -face + Math.PI / 2;
        c.officer.visible = true;
        c.speed = 0;

        /* Close and stopped is an arrest; anything else is a stand-off. The
           pose carries the whole read at this distance -- braced and levelling
           a sidearm, or bent over you with the cuffs out. */
        c.poseT += dt;
        const arresting = c.state === 'arrest';
        const want = arresting ? 'cuff' : c.state === 'peek' ? 'peek' : c.state === 'advance' ? 'walk' : 'crouch';
        if (want !== c.pose) c.pose = want;
        c.blender.apply(c.joints, c.pose, c.state === 'advance' ? c.poseT * 6 : c.poseT, dt, c.pose === 'peek' ? 0.12 : 0.22);
        // eyes on you: the head turns toward the player within what a neck allows
        lookAt(c.joints, Math.atan2(-(player.z - sz), player.x - sx) - face);
        if (c.hitT > 0) {   // the stagger rides on top of whatever pose he is in
          c.hitT -= dt;
          const k = Math.max(0, c.hitT / 0.35);
          c.joints.torso.rotation.z -= 0.35 * k; c.joints.torso.rotation.y += 0.25 * k;
          c.joints.head.rotation.z -= 0.2 * k; c.joints.cap.rotation.z -= 0.2 * k;
        }
        if (c.gun) c.gun.visible = !arresting;

        /* Fire only from 'peek', only with a line, one aimed shot per weapon
           cycle inside the burst. Each shot is a real ray with the officer's
           skill on top of the weapon's spread; a miss is heard, not felt. */
        c.fireT -= dt;
        if (c.flash) c.flash.visible = c.fireT > -0.06 && c.fireT < 0 && c.state === 'peek';
        if (c.state === 'peek' && c.burstLeft > 0 && c.fireT <= -0.06) {
          const b = burstFor(c.gunKind);
          c.fireT = b.gap;
          c.burstLeft--;
          if (c.burstLeft === 0) c.fireT = b.pause;
          const w = ARSENAL[c.gunKind];
          const jit = aimJitter(Math.floor(this.wanted), gap, player.speed ?? 0) + w.restSpread;
          const landed = canSee && shotLands(c.officer.position.x, gunY, c.officer.position.z, player.x, ty, player.z, prof.r, jit, this.rand);
          if (this.onShot) this.onShot(gap, landed, w.damage * (c.gunKind === 'shotgun' ? 3 : 1), c.officer.position);
          this.crowd?.panic?.(c.officer.position.x, c.officer.position.z, 20);
          if (!landed && this.decals && player.onFoot) {
            // the round went somewhere: a mark in the road a stride from you says how close
            const a = this.rand() * Math.PI * 2, r = 0.6 + this.rand() * 1.6;
            const mx = player.x + Math.cos(a) * r, mz = player.z + Math.sin(a) * r;
            this.decals.stamp(mx, groundHeightAt(mx, mz), mz, 0, 1, 0, c.gunKind === 'shotgun' ? 1.6 : 1);
          }
        }
        c.holdT += dt;
        continue;
      }

      if (c.mode === 'free') {
        /* Each car takes a different side.
           All of them steering at the same point produced a scrum: four
           cruisers converging on one spot, shunting each other off the road
           and shoving the player's car through a wall. They aim for a slot
           around you instead, and hold each other at arm's length. */
        const live = this.police.filter((q) => q.live && q.mode === 'free');
        const slot = live.indexOf(c);
        const bearing = Math.atan2(-dz, dx);
        const spread = live.length > 1 ? ((slot / live.length) - 0.5) * 2.2 : 0;
        const standoff = Math.max(3.4, Math.min(11, gap * 0.55));
        const aimX = player.x - Math.cos(bearing + spread) * standoff;
        const aimZ = player.z + Math.sin(bearing + spread) * standoff;

        const want = Math.atan2(-(aimZ - c.z), aimX - c.x);
        let d = ((want - c.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        c.yaw += Math.max(-2.2 * dt, Math.min(2.2 * dt, d));
        const reach = Math.hypot(aimX - c.x, aimZ - c.z);
        // stop shoving once you are cornered: a pursuit that keeps ramming a
        // stationary car can never resolve into an arrest
        const target = gap < 7 ? 0 : reach < 8 ? reach * 1.1 : c.cruise;
        c.speed += Math.max(-14 * dt, Math.min(9 * dt, target - c.speed));
        c.x += Math.cos(c.yaw) * c.speed * dt;
        c.z -= Math.sin(c.yaw) * c.speed * dt;

        // keep the fleet out of each other's paint
        for (const q of live) {
          if (q === c) continue;
          const ox = c.x - q.x, oz = c.z - q.z;
          const od = Math.hypot(ox, oz);
          if (od > 4.6 || od < 1e-3) continue;
          const push = (4.6 - od) * 0.5;
          c.x += (ox / od) * push;
          c.z += (oz / od) * push;
        }

        c.mesh.position.set(c.x, groundHeightAt(c.x, c.z), c.z);
        c.mesh.rotation.y = c.yaw;
        continue;
      }

      // road mode: the civilian machinery, minus any respect for signals
      let guard = 0;
      while (c.pathLen - c.s < LOOKAHEAD && guard++ < 40) this.#extendGraph(c);
      while (c.gates.length && c.gates[0].s < c.s - 2) c.gates.shift();
      const limit = Math.min(c.cruise, this.#leaderLimit(c, player));
      const accel = limit > c.speed ? 6.5 : 11;
      c.speed += Math.max(-accel, Math.min(accel, limit - c.speed)) * dt * 2.4;
      c.speed = Math.max(0, Math.min(c.cruise, c.speed));
      c.s += c.speed * dt;
      this.#place(c);
    }
  }

  /** Distance-keeping: 8m minimum gap, 1.2s headway, overtaking lane changes (Phase 4). */
  #leaderLimit(car, player) {
    const minGap = 8.0;
    const headway = 1.2;
    const look = minGap + car.speed * headway + 14;
    let nearest = Infinity;
    let leaderSpeed = car.cruise;

    const ahead = (x, z, spd = 0) => {
      const dx = x - car.x, dz = z - car.z;
      const fx = Math.cos(car.yaw), fz = -Math.sin(car.yaw);
      const along = dx * fx + dz * fz;
      const side = Math.abs(dx * -fz + dz * fx);
      if (along > 0 && along < look && side < 2.2) {
        if (along < nearest) {
          nearest = along;
          leaderSpeed = spd;
        }
        return along;
      }
      return Infinity;
    };

    for (const other of this.cars) {
      if (other === car || !other.live) continue;
      ahead(other.x, other.z, other.speed);
    }
    ahead(player.x, player.z, player.speed || 0);

    if (nearest === Infinity) return Infinity;

    // Multilane lane-change overtaking when leader is slow
    const edgeObj = typeof car.edge === 'number' ? this.E[car.edge] : car.edge;
    const lanes = Math.max(1, edgeObj?.lanes || 1);
    if (edgeObj && lanes > 1 && leaderSpeed < car.cruise * 0.60 && !car.changingLane) {
      car.changingLane = true;
      car.laneCooldown = 6.0; // resets changingLane so traffic can overtake repeatedly
      car.lane = car.lane === 0 ? 1 : 0;
    }

    const gap = nearest - (car.spec.L * 0.5 + minGap);
    if (gap <= 0) return 0;
    return Math.min(car.cruise, Math.sqrt(gap * 2 * 3.8));
  }
}

/** KARNATAKA POLICE, painted once and shared by the whole fleet. */
let _livery = null;
function liveryTexture() {
  if (_livery) return _livery;
  const W = 512, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);

  // the white flank band the lettering sits on
  g.fillStyle = 'rgba(238,241,246,0.97)';
  g.fillRect(0, 26, W, 76);
  g.fillStyle = 'rgba(47,109,255,0.92)';
  g.fillRect(0, 26, W, 7);
  g.fillStyle = 'rgba(255,42,28,0.9)';
  g.fillRect(0, 95, W, 7);

  g.fillStyle = '#12203c';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '700 40px ui-sans-serif,system-ui,sans-serif';
  g.fillText('KARNATAKA', W / 2, 55);
  g.font = '700 30px ui-sans-serif,system-ui,sans-serif';
  g.letterSpacing = '6px';
  g.fillText('POLICE', W / 2, 86);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  _livery = t;
  return t;
}
