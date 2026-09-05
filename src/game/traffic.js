import * as THREE from 'three';
import { CELL, LANE, ROAD_HALF } from '../world/metrics.js';
import { signalState, STOP_LINE } from '../world/signals.js';
import { mulberry32 } from '../core/rng.js';
import { personGeometry } from '../world/beach.js';
import { PAINT_COLOURS, BODY_KEYS, BODY_TYPES } from '../vehicle/config.js';
import { groundHeightAt } from '../world/metrics.js';
import { buildOfficer, poseOfficer, PoseBlender, lookAt, officerMaterial, dressOfficer } from '../world/officer.js';
import { buildWeaponMesh, ARSENAL } from './weapons.js';
import { weaponForWanted, aimJitter, burstFor, hasLineOfSight, shotLands, targetProfile, nextState, MAX_DEPLOYED, pickRooftops, coverSide, evasionDecay, searchRadius, crimeWitnessed, shouldFire } from './policeAi.js';
import { roofsNear } from '../world/districtWorld.js';
import { glow } from '../core/additive.js';

/* Every officer's muzzle-flash sphere shares one geometry and one material;
   a redeploy used to allocate both and never dispose them. */
let _flashGeo = null, _flashMat = null;
const _UP = new THREE.Vector3(0, 1, 0);

/* Pickup halos: GTA's glowing disc under a thing you can take. One shared
   circle, one additive glow material per kind (gun / grenade / armour). */
let _haloGeo = null; const _haloMat = {};
let _poolGeo = null;   // the cruisers' light pool disc
/* Two shared pool materials (red, blue) swapped per frame, not a material per
   cruiser: two pipelines to compile up front instead of one per cruiser on
   the first frame it lights up mid-chase. */
const _poolMat = {};
const poolMat = (hex) => (_poolMat[hex] ??= glow(new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.20, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }), 0.7));

/** The shared muzzle-flash sphere on a gun, placed at that weapon's muzzle. roadblock.js uses it too. */
export function muzzleFlashMesh(kind = 'rifle') {
  const m = new THREE.Mesh(flashGeo(), flashMat());
  m.position.x = ARSENAL[kind].muzzle; m.visible = false;
  return m;
}

/** Every material the police layer creates lazily, built now so main can pre-compile their pipelines (a first-use compile is a 30-80 ms hitch). */
export function policeMaterials() {
  return [flashMat(), poolMat(0xff2a1c), poolMat(0x2f6dff), haloMesh('gun').material, haloMesh('grenade').material, haloMesh('armour').material];
}
const HALO_TINT = { gun: 0xfff2c8, grenade: 0x7cff8a, armour: 0x6fb2ff };
function haloMesh(kind) {
  _haloGeo ??= new THREE.CircleGeometry(0.55, 18).rotateX(-Math.PI / 2);
  const key = HALO_TINT[kind] ? kind : 'gun';
  _haloMat[key] ??= glow(new THREE.MeshBasicMaterial({ color: HALO_TINT[key], transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 0.9);
  const m = new THREE.Mesh(_haloGeo, _haloMat[key]);
  m.renderOrder = 3;
  return m;
}
const flashGeo = () => (_flashGeo ??= new THREE.SphereGeometry(0.12, 8, 6));
const flashMat = () => (_flashMat ??= glow(new THREE.MeshBasicMaterial({ color: 0xfff0c0, toneMapped: false }), 2.5));

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
    const px = this.player?.x ?? 0, pz = this.player?.z ?? 0;
    if (!crimeWitnessed(tag, px, pz, this.crowd?.people ?? [], this.police, this.wanted)) return;   // nobody saw it (policeAi.crimeWitnessed)
    // one pedestrian is about two stars, not five: `force` is m/s, so the
    // multiplier has to be gentle or a single hit at speed maxes the meter
    const gain = worth * Math.min(1.4, 0.5 + force * 0.05);
    if (this.wanted === 0) { this.seenX = px; this.seenZ = pz; this.coldFor = 0; }   // the report says where: that is where they head
    this.wanted = Math.min(5, this.wanted + gain);
    this.cool = 0;
    if (typeof window !== 'undefined' && window._reputation) {
      window._reputation.adjust(-Math.round(gain * 10), 'CRIME REPORTED');
    }
  }

  /** How many cars should be hunting at this wanted level. */
  #wantedCars() {
    // one cruiser is always out on patrol (a witness, and a city that looks policed); the hunt scales with the stars
    return Math.max(this.patrol === false || !this.E ? 0 : 1, Math.min(6, Math.floor(this.wanted)));   // the patrol needs the road graph
  }

  /** Off-graph pursuit steering toward a point: the free-mode maths without the fleet spread. Used by the patrol's own chases. */
  #steerToward(c, tx, tz, dt, standoff, speedCap) {
    const bearing = Math.atan2(-(tz - c.z), tx - c.x);
    const aimX = tx - Math.cos(bearing) * standoff, aimZ = tz + Math.sin(bearing) * standoff;
    const want = Math.atan2(-(aimZ - c.z), aimX - c.x);
    const d = ((want - c.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    c.yaw += Math.max(-2.2 * dt, Math.min(2.2 * dt, d));
    const reach = Math.hypot(aimX - c.x, aimZ - c.z);
    const target = reach < 8 ? reach * 1.1 : speedCap;
    c.speed += Math.max(-14 * dt, Math.min(9 * dt, target - c.speed));
    c.x += Math.cos(c.yaw) * c.speed * dt;
    c.z -= Math.sin(c.yaw) * c.speed * dt;
  }

  /** The civilian road machinery for a cruiser: follow the graph, keep distance, place. */
  #driveRoad(c, player, dt) {
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
    /* The lightbar's pool on the road: an additive disc under the cruiser that
       takes the lit lens's colour each frame. At night the red/blue wash on the
       tarmac is most of what says 'police' from a distance; it is also what
       you see of a cruiser behind you. One quad per cruiser, six at most. */
    const pool = new THREE.Mesh(_poolGeo ??= new THREE.CircleGeometry(3.4, 20).rotateX(-Math.PI / 2), poolMat(0xff2a1c));
    pool.position.set(0, 0.04, 0); pool.visible = false; pool.renderOrder = 3;
    c.mesh.add(pool); c.pool = pool;

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
    car.baseCruise = undefined; car.fleeT = 0; car.vhp = undefined;   // a new incarnation: a new base for the flee boost, a whole engine
    car.path = []; car.gates = []; car.pathLen = 0; car.s = 0;
    const line = this.#shift(this.#oriented(e, e.a), this.#laneOffset(e, car.lane));
    this.#push(car, line[0]);
    let guard = 0;
    while (car.pathLen < LOOKAHEAD && guard++ < 40) this.#extendGraph(car);
    car.speed = car.cruise * 0.7;
    car.live = true;
    car.mesh.visible = true;
    this.#place(car);
    // Little Tokyo runs on taxis: two in five civilians spawning there take the classic liveries (black, yellow-green, deep green)
    if (!car.hunt && this.world?.district?.districtAt?.(car.x, car.z) === 'LITTLE TOKYO' && this.rand() < 0.4) car.mesh.material?.color?.setHex([0x101214, 0xd8d24c, 0x1d5a3a][Math.floor(this.rand() * 3)]);
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
    this.drops.push({ kind: c.gunKind, mesh: g, t: 40, x: g.position.x, z: g.position.z, halo: this.#halo('gun', g.position.x, g.position.z) });
    c.gun = null;
    if (this.rand() < 0.15) {   // some wore a vest worth having: half your armour back (main handles 'armour')
      /* ponytail: a vertex-coloured box in the officers' material, shared geometry. A transient pickup, not city detail (rule 3's range-board exception). */
      if (!this._vestGeo) {
        const g = new THREE.BoxGeometry(0.44, 0.10, 0.34), n = g.attributes.position.count, col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { col[i * 3] = 0.10; col[i * 3 + 1] = 0.14; col[i * 3 + 2] = 0.26; }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        this._vestGeo = g;
      }
      const v = new THREE.Mesh(this._vestGeo, officerMaterial());
      v.position.set(c.officer.position.x - 0.3, groundHeightAt(c.officer.position.x, c.officer.position.z) + 0.05, c.officer.position.z + 0.5);
      v.rotation.y = this.rand() * Math.PI;
      this.scene.add(v);
      this.drops.push({ kind: 'armour', mesh: v, t: 40, x: v.position.x, z: v.position.z, halo: this.#halo('armour', v.position.x, v.position.z) });
    }
    if (this.rand() < 0.2) {   // one in five carried a grenade
      const look = this.grenadeLook;   // the thrown grenade's own geometry and material, so a dropped one is the same object
      if (!look) return;
      const n = new THREE.Mesh(look.geo, look.mat);
      n.position.set(c.officer.position.x - 0.5, groundHeightAt(c.officer.position.x, c.officer.position.z) + 0.08, c.officer.position.z - 0.2);
      this.scene.add(n);
      this.drops.push({ kind: 'grenade', mesh: n, t: 40, x: n.position.x, z: n.position.z, halo: this.#halo('grenade', n.position.x, n.position.z) });
    }
  }

  /** The glowing disc under a drop, a hair above the ground. */
  #halo(kind, x, z) {
    const h = haloMesh(kind);
    h.position.set(x, groundHeightAt(x, z) + 0.02, z);
    this.scene.add(h);
    return h;
  }

  /** One entry point for 'a player round hit an officer-shaped thing': door officer or rooftop marksman. Posts belong to the roadblock. */
  hitAny(ref, damage = 26) {
    if (!ref) return false;
    if (ref.mesh) return this.officerHit(ref, damage);
    if (ref.roof) return this.hitMark(ref, damage);
    return false;
  }

  /** Rooftop marksmen as weapon targets. */
  markTargets(out) {
    for (const m of this.marks ?? []) if (!m.down) out.push({ x: m.group.position.x, z: m.group.position.z, y: m.group.position.y + 1.15, r: 0.42, kind: 'officer', ref: m });
  }

  /** A player round hit a marksman: two rifle rounds and he is gone from the roof. */
  hitMark(m, damage = 26) {
    if (!m || m.down) return false;
    m.hp = (m.hp ?? 60) - damage;
    if (m.hp <= 0) {
      // he falls where he stood and lies on the roof for a while; #rooftops plays the fall and clears him
      m.down = 0.001; m.gun && (m.gun.visible = false);
      this.blood?.stamp(m.group.position.x, m.group.position.y + 0.01, m.group.position.z, 0, 1, 0, 1.1);
      this.chatter?.radioPool?.('down');
      return true;
    }
    return false;
  }

  /** Called by main each frame: hands back a dropped weapon kind if the player stands on one. */
  pickupAt(x, z) {
    if (!this.drops) return null;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      if (Math.hypot(d.x - x, d.z - z) < 1.2) { this.scene.remove(d.mesh); if (d.halo) this.scene.remove(d.halo); this.drops.splice(i, 1); return d.kind; }
    }
    return null;
  }

  #tickDrops(dt) {
    if (!this.drops) return;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]; d.t -= dt;
      d.mesh.rotateOnWorldAxis(_UP, dt * 1.4);                        // a pickup turns slowly: it reads as something to take, not litter
      if (d.t < 6) d.mesh.visible = Math.floor(d.t * 5) % 2 === 0;   // the last six seconds blink, the way GTA's pickups say 'last chance'
      if (d.halo) { d.halo.visible = d.mesh.visible; d.halo.scale.setScalar(1 + 0.12 * Math.sin(d.t * 4)); }   // the halo breathes
      if (d.t <= 0) { this.scene.remove(d.mesh); if (d.halo) this.scene.remove(d.halo); this.drops.splice(i, 1); }
    }
  }

  /** A player round hit a deployed officer. Two rifle rounds or four pistol rounds put him down. */
  officerHit(c, damage = 26) {
    if (!c?.deployed || c.down > 0) return false;
    c.hp -= damage;
    c.quietFor = 0;
    c.hitT = 0.35;                                     // stagger: torso snaps away from the round, then eases back
    if (c.hp <= 0) { c.state = 'down'; c.down = 0.001; this.chatter?.radioPool?.('down'); this.#dropWeapon(c); this.blood?.stamp(c.officer.position.x, c.officer.position.y + 0.01, c.officer.position.z, 0, 1, 0, 1 + this.rand() * 0.6); return true; }
    return false;
  }

  /* One aimed police round at the player, whoever fires it: the target's
     profile (crouched is smaller), the shooter's skill at this star level on
     top of the weapon's own spread, the roll, and the report to main. The
     door officers, the rooftop rifles, the door gunner and the roadblock's
     posts all fire through here, so a change to how the police shoot is one
     change. Public for roadblock.js. */
  fireAt(ox, oy, oz, player, kind, stars, jitterMul = 1, dmgMul = 1) {
    const prof = targetProfile(!!player.onFoot, !!player.crouch);
    const ty = (player.y ?? 0) + prof.y;
    const gap = Math.hypot(player.x - ox, player.z - oz);
    const w = ARSENAL[kind];
    const landed = shotLands(ox, oy, oz, player.x, ty, player.z, prof.r, aimJitter(stars, gap, player.speed ?? 0) * jitterMul + w.restSpread, this.rand);
    this._from ??= { x: 0, y: 0, z: 0 };
    this._from.x = ox; this._from.y = oy; this._from.z = oz;
    this.onShot?.(gap, landed, w.damage * dmgMul, this._from, kind);
    if (gap < 60) this.puffs?.puff(ox, oy, oz, { r: 0.20, g: 0.19, b: 0.18, life: 0.5, vy: 0.5 });   // a wisp off his muzzle too
    if (gap < 30) { const dl = Math.hypot(player.x - ox, player.z - oz) || 1; this.brass?.(ox, oy - 0.05, oz, (player.x - ox) / dl, (player.z - oz) / dl); }   // and brass off his breech (weapon.eject)
    if (this.flashLight && gap < 35) {
      // the muzzle lights the street for a frame: the player's flash light, borrowed (grenades borrow it too)
      this.flashLight.position.set(ox, oy, oz); this.flashLight.intensity = 3.2; this._flashT = 0.06;
    }
    if (this.tracers) {
      // a hit stops at you; a miss goes past, offset the way a miss is: a stride wide, on through
      const miss = landed ? 0 : 0.6 + this.rand() * 1.4, a = this.rand() * Math.PI * 2;
      const ex = player.x + Math.cos(a) * miss, ey = ty + (landed ? 0 : (this.rand() - 0.5) * 0.8), ez = player.z + Math.sin(a) * miss;
      const over = landed ? 1 : 1 + 18 / Math.max(1, gap);   // a miss carries ~18 m past you
      this.tracers.add(ox, oy, oz, ox + (ex - ox) * over, oy + (ey - oy) * over, oz + (ez - oz) * over, 'police');
    }
    return landed;
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
    let nearest = Infinity; for (const m of this.marks) { const d = Math.hypot(m.group.position.x - player.x, m.group.position.z - player.z); if (d < nearest) nearest = d; }
    if (this.marks.length && nearest > 220) {
      for (const m of this.marks) this.scene.remove(m.group);
      this.marks.length = 0;
    }
    if (!this.marks.length && this.world?.district) {
      const roofs = roofsNear(this.world.district, player.x, player.z, 140, 24);
      const picks = pickRooftops(roofs, player.x, player.z);
      for (let i = 0; i < picks.length; i++) {
        const r = picks[i];
        const built = buildOfficer(90 + i, { swat: true });   // rooftops are a four-star response: tactical dress
        built.group.position.set(r.x, r.h + 0.5, r.z);
        const gun = buildWeaponMesh('rifle'); gun.position.set(0, -0.58, 0); gun.rotation.z = -Math.PI / 2;
        const flash = muzzleFlashMesh('rifle'); gun.add(flash);   // you see the rooftop shot before you hear it
        built.joints.armR.add(gun);
        this.scene.add(built.group);
        this.marks.push({ group: built.group, joints: built.joints, blender: new PoseBlender(), roof: r, fireT: 1.5 + i, burstLeft: 0, poseT: 0, gun, flash, flashT: 0, down: 0 });
        this.chatter?.radioPool?.('rooftops');
      }
    }
    const ty = (player.y ?? 0) + targetProfile(!!player.onFoot, !!player.crouch).y;
    for (let mi = this.marks.length - 1; mi >= 0; mi--) {
      const m = this.marks[mi];
      if (m.down > 0) {   // down: the fall plays out, then he is cleared from the roof
        m.down += dt;
        m.blender.apply(m.joints, 'fall', Math.min(1, m.down / 0.6), dt, 0.1);
        if (m.down > 9) { this.scene.remove(m.group); this.marks.splice(mi, 1); }
        continue;
      }
      const gx = m.group.position.x, gz = m.group.position.z, gy = m.group.position.y + 1.3;
      const face = Math.atan2(-(player.z - gz), player.x - gx);
      m.group.rotation.y = -face + Math.PI / 2;
      m.poseT += dt;
      m.blender.apply(m.joints, 'aim', m.poseT, dt, 0.3);
      if (m.flash) { m.flashT -= dt; m.flash.visible = m.flashT > 0; }
      const bldg = (this._bldg || []).filter((b) => Math.hypot(b.x - m.roof.x, b.z - m.roof.z) > 1);   // his own roof cannot block him
      const canSee = hasLineOfSight(gx, gy, gz, player.x, ty, player.z, bldg, this.cars, null);
      m.fireT -= dt;
      if (canSee && m.fireT <= 0) {
        if (m.burstLeft <= 0) m.burstLeft = burstFor('rifle').shots;
        m.burstLeft--;
        m.fireT = m.burstLeft > 0 ? burstFor('rifle').gap : 1.4 + this.rand() * 1.2;
        this.fireAt(gx, gy, gz, player, 'rifle', stars, 0.8);   // a braced rifle from height: steadier than the street
        m.flashT = 0.07;
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
    if (this._heliFlashT > 0) { this._heliFlashT -= dt; if (this._heliFlashT <= 0 && h.gunFlash) h.gunFlash.visible = false; }
    this._gunT = (this._gunT ?? 1.5) - dt;
    if (this._gunT > 0) return;
    const ty = (player.y ?? 0) + targetProfile(!!player.onFoot, !!player.crouch).y;
    const canSee = hasLineOfSight(h.pos.x, h.pos.y - 1, h.pos.z, player.x, ty, player.z, this._bldg || [], [], null);
    this._gunBurst = (this._gunBurst ?? 0) > 0 ? this._gunBurst - 1 : burstFor('smg').shots - 1;
    this._gunT = this._gunBurst > 0 ? burstFor('smg').gap : 2.5 + this.rand() * 1.5;
    if (!canSee) return;
    this.fireAt(h.pos.x, h.pos.y - 1, h.pos.z, player, 'smg', 5, 1.3);   // a moving platform: wide
    if (h.group && !h.gunFlash) { h.gunFlash = muzzleFlashMesh('smg'); h.gunFlash.position.set(0.4, -0.9, 1.3); h.group.add(h.gunFlash); }   // the door gun's flash, on the aircraft
    if (h.gunFlash) { h.gunFlash.visible = true; this._heliFlashT = 0.07; }
    this.crowd?.panic?.(player.x, player.z, 18);
  }

  update(player, dt, time) {
    /* One building scan for the whole frame: every shooter is within ~65 m of
       the player, so the player's 9-chunk neighbourhood serves them all. Eleven
       per-shooter scans at four stars were eleven allocations a frame. */
    this.player = player;   // the roadblock's rifles aim at whoever this is, on foot or in the car
    this._bldg = this.world?.nearbyBuildings ? this.world.nearbyBuildings(player.x, player.z) : [];
    this._deployed = 0; for (const q of this.police) if (q.deployed) this._deployed++;
    for (const v of this.cars) if (v.fleeT > 0) { v.fleeT -= dt; if (v.fleeT <= 0 && v.baseCruise) v.cruise = v.baseCruise; }
    this.#tickDrops(dt);
    if (this._flashT > 0) { this._flashT -= dt; if (this._flashT <= 0) this.flashLight.intensity = 0; }
    if (this.puffs) {   // dead engines smoke: every disabled vehicle within 120 m puts up a grey puff eight times a second
      this._puffT = (this._puffT ?? 0) - dt;
      if (this._puffT <= 0) {
        this._puffT = 0.125;
        for (const v of this.cars) if (v.live && v.vhp === 0 && Math.hypot(v.x - player.x, v.z - player.z) < 120) this.puffs.puff(v.x + Math.cos(v.yaw) * 1.4, (v.mesh?.position.y ?? 0) + 1.0, v.z - Math.sin(v.yaw) * 1.4, { r: 0.13, g: 0.13, b: 0.14, life: 2.2, vy: 1.1 });
        for (const v of this.police) if (v.live && v.vhp === 0 && Math.hypot(v.x - player.x, v.z - player.z) < 120) this.puffs.puff(v.x + Math.cos(v.yaw) * 1.4, (v.mesh?.position.y ?? 0) + 1.0, v.z - Math.sin(v.yaw) * 1.4, { r: 0.13, g: 0.13, b: 0.14, life: 2.2, vy: 1.1 });
      }
    }
    this.#rooftops(player, dt);
    this.#airGunner(player, dt);
    this.hot = false;   // set true below by any officer who can see you this frame
    this.time = time !== undefined ? time : this.time + dt;
    const t = this.time;
    this.player = player;
    this.#updateWanted(player, dt, t);
    /* Two ways to lose them (policeAi.evasionDecay): get 240 m clear of
       every cruiser, or break line of sight and stay unseen for ten seconds
       while they search where they last had you. `hot` is THIS frame's
       answer: update() resets it, #updateWanted's loop sets it, then this runs. */
    if (this.hot) {
      if (this.coldFor > 6 && this.wanted > 0) this.chatter?.radioPool?.('regained');
      this.coldFor = 0; this.seenX = player.x; this.seenZ = player.z;
    } else {
      this.coldFor = (this.coldFor ?? 0) + dt;
      if (this.wanted > 0 && this.coldFor > 5 && (this._nearest ?? Infinity) < 200) {
        this._searchT = (this._searchT ?? 0) - dt;
        if (this._searchT <= 0) { this._searchT = 9 + this.rand() * 5; this.chatter?.radioPool?.('search'); }
      }
    }
    if (this.wanted > 0) {
      this.cool = ((this._nearest ?? Infinity) > 240 && !this.eyesOn) ? this.cool + dt : 0;
      const rate = evasionDecay({ hot: this.hot, eyesOn: this.eyesOn, coldFor: this.coldFor, nearest: this._nearest ?? Infinity, wanted: this.wanted, cool: this.cool });
      if (rate > 0) {
        const before = this.wanted;
        this.wanted = Math.max(0, this.wanted - dt * rate);
        if (before > 0 && this.wanted === 0 && this.coldFor > 5) { this.chatter?.radioPool?.('lost'); this.hud?.flash?.('YOU LOST THEM'); }
      }
    } else this.coldFor = 0;
    if (this.wanted < 4) this._swatShown = false;

    // Hoist police-active check out of per-car loop
    /* Which cruisers have their lights on -- hunting you, or a patrol on a
       call / chase. Civilians pull over for any of them, not only for yours. */
    const lit = this._lit ??= [];
    lit.length = 0;
    for (let i = 0; i < this.police.length; i++) {
      const q = this.police[i];
      if (q.live && ((this.wanted >= 1 && q.hunt) || q.respondT > 0)) lit.push(q);
    }
    const policeActive = lit.length > 0;
    const nearLit = (x, z, r) => { for (let i = 0; i < lit.length; i++) { const q = lit[i]; if (Math.hypot(q.x - x, q.z - z) < r) return true; } return false; };

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
      const lead = this.#leaderLimit(car, player);
      limit = Math.min(limit, lead);
      /* Held by a CAR (not a light) at a standstill for a few seconds: a horn,
         with a cooldown so a jam is a scatter of horns, not a chord. The player
         parked across a lane gets the same treatment -- that is the point. */
      if (!car.hunt && lead < 1.0 && car.speed < 0.6) {
        car.stuckT = (car.stuckT ?? 0) + dt;
        if (car.stuckT > 2.5 + this.rand() * 2) { car.stuckT = -2 - this.rand() * 4; this.honk?.(car.x, car.z); }
      } else if ((car.stuckT ?? 0) > 0) car.stuckT = 0;
      /* Sirens: civilians within 70 m of a pursuit slow to a crawl and drift
         to the kerb lane, so a chase runs through parting traffic. */
      if (!car.hunt && policeActive && car.fleeT <= 0 && nearLit(car.x, car.z, 70)) {   // (a fleeing fugitive does not pull over for its own pursuer)
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
    this._nearest = nearest;

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
    this._free = this.police.filter((q) => q.live && q.mode === 'free');   // was rebuilt per cruiser per frame
    for (let i = 0; i < this.police.length; i++) {
      const c = this.police[i];
      if (i >= want) { c.live = false; c.mesh.visible = false; continue; }
      if (!c.live) { this.#spawnGraph(c, player); c.best = Infinity; c.stale = 0; continue; }

      const dx = player.x - c.x, dz = player.z - c.z;
      const gap = Math.hypot(dx, dz);

      /* No stars: this is a PATROL. Lights off, no pursuit steering
         (#pickExit routes toward the player only for a hunter), officers in
         the car, and it re-spawns nearby once you have left it behind. It is
         what makes crimeWitnessed bite -- a cruiser 80 m away saw that. */
      c.hunt = this.wanted >= 1;
      if (c.hunt && c.chase) { const f = c.chase; if (f.baseCruise) { f.cruise = f.baseCruise; f.fleeT = 0; } c.chase = null; }   // you outrank the fugitive
      if (!c.hunt) {
        /* Street life: every so often the patrol 'takes a call' -- lights on,
           foot down for eight seconds, then back to a crawl. Nothing to do
           with you; a city where sirens pass is a city with other people in it. */
        c.respondT = (c.respondT ?? 0) - dt;
        if (c.respondT < -30 && this.rand() < dt / 25) {
          c.respondT = 8; c.cruise = (c.baseCruise ??= c.cruise) * 1.7;
          /* Two calls in five are a real one: a civilian within 160 m becomes
             the fugitive. It runs (the flee boost), the patrol hunts it with
             lights and siren, pulls it over when it gets alongside, and after
             the stop -- or 25 s -- the cruiser is released and re-spawns on
             the graph. None of it involves you; that is the point. */
          if (this.rand() < 0.4) {
            let best = null, bd = 160;
            for (const v of this.cars) { if (!v.live || v.vhp === 0) continue; const d = Math.hypot(v.x - c.x, v.z - c.z); if (d < bd && d > 25) { bd = d; best = v; } }
            if (best) { c.chase = best; c.chaseT = 25; c.stopT = 0; best.baseCruise ??= best.cruise; best.cruise = best.baseCruise * 1.8; best.fleeT = 25; c.respondT = 25; this.chatter?.radioPool?.('npcChase'); }
          }
        }
        if (c.chase) {
          const f = c.chase; c.chaseT -= dt;
          const gapF = Math.hypot(f.x - c.x, f.z - c.z);
          if (!f.live || c.chaseT <= 0 || gapF > 260) { c.chase = null; c.live = false; c.mesh.visible = false; c.respondT = 0; if (f.baseCruise) { f.cruise = f.baseCruise; f.fleeT = 0; } continue; }
          if (gapF < 7 && (f.speed || 0) < 3) {
            // pulled over: both sit with lights going for six seconds, then the fugitive drives off and the cruiser is released
            c.stopT += dt; c.speed = Math.max(0, c.speed - 14 * dt);
            if (c.stopT > 2 && !c.bailed) { c.bailed = true; if (this.rand() < 0.3) this.crowd?.eject?.(f.x, f.z, f.yaw); }   // some make a run for it
            if (c.stopT > 6) { c.chaseT = 0; c.bailed = false; }
          } else if (gapF < 9) { f.fleeT = 0; f.cruise = 0; }                 // alongside: the fugitive gives up and stops
          else this.#steerToward(c, f.x, f.z, dt, 4, (c.baseCruise ?? c.cruise) * 1.7);
          c.mesh.position.set(c.x, groundHeightAt(c.x, c.z), c.z); c.mesh.rotation.y = c.yaw;
          const lit = Math.floor(t * 6) % 2;
          if (c.bar) { c.bar[0].emissiveIntensity = lit ? 5.5 : 0.15; c.bar[1].emissiveIntensity = lit ? 0.15 : 5.5; }
          if (c.pool) { c.pool.visible = true; c.pool.material = poolMat(lit ? 0xff2a1c : 0x2f6dff); }
          continue;
        }
        if (c.respondT <= 0 && c.baseCruise && c.cruise > c.baseCruise) c.cruise = c.baseCruise;
        const lit = c.respondT > 0 && Math.floor(t * 6) % 2;
        if (c.bar) { c.bar[0].emissiveIntensity = lit ? 5.5 : 0.15; c.bar[1].emissiveIntensity = c.respondT > 0 && !lit ? 5.5 : 0.15; }
        if (c.pool) { c.pool.visible = c.respondT > 0; c.pool.material = poolMat(lit ? 0xff2a1c : 0x2f6dff); }
        if (c.deployed) { c.deployed = false; c.officer.visible = false; }
        c.mode = 'road'; c.best = Infinity; c.stale = 0; c.deployT = 0;
        if (gap > 320) { c.live = false; c.mesh.visible = false; continue; }
        this.#driveRoad(c, player, dt);
        continue;
      }

      // lightbar: alternating, and fast enough to read as urgent
      if (c.bar) {
        const flash = Math.floor(t * 6) % 2;
        c.bar[0].emissiveIntensity = flash ? 5.5 : 0.15;
        c.bar[1].emissiveIntensity = flash ? 0.15 : 5.5;
        if (c.pool) { c.pool.visible = true; c.pool.material = poolMat(flash ? 0xff2a1c : 0x2f6dff); }
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

      // a cruiser at speed scatters the pavement it passes: pedestrians within 10 m break into a run
      if (c.speed > 8) { c.panicT = (c.panicT ?? 0) - dt; if (c.panicT <= 0) { c.panicT = 0.5; this.crowd?.panic?.(c.x, c.z, 10); } }
      // a cruiser with a line on you inside 70 m has eyes on you as much as an officer on foot does
      c.seesYou = !c.deployed && gap < 70 && hasLineOfSight(c.x, 1.2, c.z, player.x, (player.y ?? 0) + 1.0, player.z, this._bldg, [], null);
      if (c.seesYou) this.hot = true;
      /* From three stars the passenger leans out and fires on the move: a
         pistol from a swerving car, so the jitter is wide (1.6x). GTA's cops
         do this and it is what makes a three-star chase feel different from
         a two-star one before anyone has stepped out. */
      if (c.seesYou && c.mode === 'free' && this.wanted >= 3 && gap < 42 && c.speed > 2) {
        c.driveByT = (c.driveByT ?? 1.5) - dt;
        if (c.driveByT <= 0) { c.driveByT = 1.4 + this.rand() * 1.2; this.fireAt(c.x, 1.3, c.z, player, 'pistol', Math.floor(this.wanted), 1.6); }
      }
      if (c.mode === 'road' && gap < 70) c.mode = 'free';
      if (c.mode === 'free' && gap > 150) { c.lost += dt; } else { c.lost = 0; }
      if (c.lost > 3) { c.live = false; c.mesh.visible = false; c.mode = 'road'; c.lost = 0; this.chatter?.radioPool?.('lost'); continue; }

      /* --- out of the car ---
         A pursuit that ends with four cars idling around you is not an
         arrest. Once you have stopped and they have you, officers get out,
         open fire, and if you stay put you are nicked. */
      /* Decay rather than reset. Five cruisers boxing you in are also
         constantly nudging you, so an instant "are you stopped?" test never
         held true for the second it needed -- nobody ever got out. */
      const stopped = (player.speed ?? 0) < 3.4;
      const close = gap < 24;   // GTA's cops step out from further than a car length
      /* Officers get out when you have stopped close by -- or whenever you are
         ON FOOT within 40 m. Before, a player who left the car and kept moving
         never met an officer: they circled in their cruisers forever. */
      const footContact = !!player.onFoot && gap < 40 && c.mode === 'free';
      const disabled = c.cruise === 0 && gap < 60;   // shot up: the car is done, so they come out whatever you are doing
      if ((c.mode === 'free' && stopped && close) || footContact || disabled) c.deployT += dt * (footContact ? 1.6 : 1);
      else c.deployT = Math.max(0, c.deployT - dt * 0.8);
      if (!c.deployed && c.deployT > 1.0 && this._deployed < MAX_DEPLOYED) {
        c.deployed = true; this._deployed++; c.fireT = 0.5; c.state = 'cover'; c.stateT = 0; c.hp = 100; c.down = 0;
        // the response draws heavier guns as the stars climb; the mesh swaps geometry, not material
        c.gunKind = weaponForWanted(Math.floor(this.wanted), c.slot);
        const swat = Math.floor(this.wanted) >= 4;   // four stars: the tactical unit steps out (geometry swap, same material)
        if (!!c.joints.swat !== swat) dressOfficer(c.joints, swat);
        if (swat) c.hp = 150;   // plate carrier: half again as many rounds to put down
        if (!c.gun) {   // his last one is lying in the road from the time he went down
          c.gun = buildWeaponMesh(c.gunKind); c.gun.position.set(0, -0.58, 0); c.gun.rotation.z = -Math.PI / 2; c.joints.armR.add(c.gun);
          c.flash = new THREE.Mesh(flashGeo(), flashMat()); c.flash.visible = false; c.gun.add(c.flash);   // shared: one sphere, one material for every muzzle
        }
        c.gun.geometry = buildWeaponMesh(c.gunKind).geometry;
        c.flash.position.x = ARSENAL[c.gunKind].muzzle;
        { const cs = coverSide(c.x, c.z, c.yaw, player.x, player.z); c.coverX = cs.x; c.coverZ = cs.z; }   // the door away from you, car between
        if (swat) {
          this.chatter?.radioPool?.('swat');
          if (!this._swatShown) { this._swatShown = true; this.hud?.flash?.('TACTICAL UNIT ON SCENE'); }   // once per four-star spell (reset below four)
        } else this.chatter?.radioPool?.(Math.floor(this.wanted) >= 3 ? 'deployHot' : 'deploy');
      }
      if (c.deployed && (gap > (player.onFoot ? 65 : 30) || c.deployT <= 0)) {   // on foot they stay out and follow further
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
          if (c.down > 10.5) c.officer.position.y -= dt * 0.9;   // the last seconds: the body sinks out of the street rather than blinking off
          if (c.down > 12) { c.deployed = false; c.officer.visible = false; c.live = false; c.mesh.visible = false; c.mode = 'road'; }
          continue;
        }
        const ty = (player.y ?? 0) + targetProfile(!!player.onFoot, !!player.crouch).y;
        const gunY = c.officer.position.y + (c.state === 'cover' || c.state === 'peek' ? 0.9 : 1.3);
        const bldg = this._bldg;
        // parked cars are cover too: their collision solids join the moving traffic in the line-of-sight test
        const parked = this.world?.nearbyParked ? this.world.nearbyParked(player.x, player.z) : null;
        if (parked !== this._losParkedSrc) { this._losParkedSrc = parked; this._losBlockers = [...this.cars, ...((parked || []).filter((s) => s.tag === 'parked').map((s) => ({ x: s.x, z: s.z, r: (s.radius ?? 1) + 0.3, y: 0.8 })))]; }
        const blockers = this._losBlockers || this.cars;
        const canSee = c.state === 'cover' ? hasLineOfSight(c.coverX, gunY, c.coverZ, player.x, ty, player.z, bldg, blockers, null) : hasLineOfSight(c.officer.position.x, gunY, c.officer.position.z, player.x, ty, player.z, bldg, blockers, null);
        if (canSee) this.hot = true;
        /* Four stars: a tactical officer who has had no line on you for four
           seconds, with you 10-28 m away and behind something, lobs a grenade
           at where you were last seen (Grenades.throwFrom -- your count is
           untouched). Twelve-second cooldown per officer; never inside 10 m,
           he is not suicidal. Cover stops bullets, not this. */
        c.noLosT = canSee ? 0 : (c.noLosT ?? 0) + dt;
        c.nadeT = (c.nadeT ?? 6) - dt;
        if (c.joints.swat && c.noLosT > 4 && c.nadeT <= 0 && gap > 10 && gap < 28 && this.grenadeLook?.throwFrom && this.seenX !== undefined) {
          c.nadeT = 12; c.noLosT = 0;
          const gx = c.officer.position.x, gz = c.officer.position.z;
          if (this.grenadeLook.throwFrom(gx, c.officer.position.y + 1.4, gz, this.seenX, this.seenZ, Math.hypot(this.seenX - gx, this.seenZ - gz))) this.chatter?.radioPool?.('frag');
        }
        c.quietFor = (player.firedAt !== undefined && performance.now() - player.firedAt < 1500) ? 0 : c.quietFor + dt;
        c.stateT += dt;
        const next = nextState({ state: c.state, hp: c.hp, gap, playerSpeed: player.speed ?? 0, quietFor: c.quietFor, canSee, burstLeft: c.burstLeft, t: c.stateT, playerOnFoot: !!player.onFoot });
        if (next !== c.state) {
          if (next === 'peek') {
            const b = burstFor(c.gunKind); c.burstLeft = b.shots; c.fireT = 0.12;
            c.bursts = (c.bursts ?? 0) + 1;
            if (c.bursts % 4 === 0) { c.reloading = ARSENAL[c.gunKind].reload; this.chatter?.radioPool?.('reload'); }
          }
          if (next === 'advance') {
            // the next cover is up to 8 m closer; he WALKS there over the advance second (below), he does not appear there
            const ang = Math.atan2(player.z - c.coverZ, player.x - c.coverX); const step = Math.min(8, Math.max(0, gap - 7));
            c.fromX = c.coverX; c.fromZ = c.coverZ; c.toX = c.coverX + Math.cos(ang) * step; c.toZ = c.coverZ + Math.sin(ang) * step;
          }
          if (next === 'down') { c.down = 0.001; this.chatter?.radioPool?.('down'); this.#dropWeapon(c); this.blood?.stamp(c.officer.position.x, c.officer.position.y + 0.01, c.officer.position.z, 0, 1, 0, 1 + this.rand() * 0.6); }
          else if (next === 'advance') this.chatter?.radioPool?.('advance');
          else if (next === 'arrest') this.chatter?.radioPool?.('arrest');
          else if (next === 'peek' && c.state === 'cover' && c.stateT > 3) this.chatter?.radioPool?.('pinned');
          c.state = next; c.stateT = 0;
        }
        if (c.state === 'advance' && c.toX !== undefined) {
          const k = Math.min(1, c.stateT);   // nextState ends the advance at t >= 1, so this is the whole walk
          c.coverX = c.fromX + (c.toX - c.fromX) * k; c.coverZ = c.fromZ + (c.toZ - c.fromZ) * k;
        }
        const sx = c.coverX, sz = c.coverZ;
        // he faces where he thinks you are: you, with a line; where he last had you, without one for a few seconds
        const cold = this.coldFor > 3 && this.seenX !== undefined;
        const fx = cold ? this.seenX : player.x, fz = cold ? this.seenZ : player.z;
        const face = Math.atan2(-(fz - sz), fx - sx);
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
        lookAt(c.joints, Math.atan2(-(fz - sz), fx - sx) - face);
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
        if (c.reloading > 0) { c.reloading -= dt; c.burstLeft = 0; }   // a reload is a burst that never comes; he goes back to cover
        if (c.state === 'peek' && c.burstLeft > 0 && c.fireT <= -0.06 && shouldFire(Math.floor(this.wanted), c.quietFor)) {   // one star: they come to cuff you, and shoot only if you have
          const b = burstFor(c.gunKind);
          c.fireT = b.gap;
          c.burstLeft--;
          if (c.burstLeft === 0) c.fireT = b.pause;
          // a shotgun at street range is the whole spread of pellets, three pistol rounds' worth
          const landed = canSee && this.fireAt(c.officer.position.x, gunY, c.officer.position.z, player, c.gunKind, Math.floor(this.wanted), 1, c.gunKind === 'shotgun' ? 3 : 1);
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
        const live = this._free;   // built once per frame before the loop; a cruiser that went 'free' THIS frame is not in it yet
        const slot = Math.max(0, live.indexOf(c));
        /* Where they think you are. With a line on you it is you; once you
           have been out of sight for a few seconds it is where they last had
           you, and they sweep a ring around it that widens as the trail goes
           cold (the same searchRadius the minimap draws). They only find you
           again by SEEING you -- a cruiser's line of sight sets `hot`. */
        const cold = this.coldFor > 3 && this.seenX !== undefined;
        let hx = player.x, hz = player.z;
        if (cold) {
          const ring = searchRadius(this.coldFor) * 0.6, a = t * 0.25 + slot * 2.1;
          hx = this.seenX + Math.cos(a) * ring; hz = this.seenZ + Math.sin(a) * ring;
        }
        const hdx = hx - c.x, hdz = hz - c.z, hgap = Math.hypot(hdx, hdz);
        const bearing = Math.atan2(-hdz, hdx);
        const spread = live.length > 1 ? ((slot / live.length) - 0.5) * 2.2 : 0;
        const standoff = cold ? 0 : Math.max(3.4, Math.min(11, hgap * 0.55));
        const aimX = hx - Math.cos(bearing + spread) * standoff;
        const aimZ = hz + Math.sin(bearing + spread) * standoff;

        const want = Math.atan2(-(aimZ - c.z), aimX - c.x);
        let d = ((want - c.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        c.yaw += Math.max(-2.2 * dt, Math.min(2.2 * dt, d));
        const reach = Math.hypot(aimX - c.x, aimZ - c.z);
        // stop shoving once you are cornered: a pursuit that keeps ramming a
        // stationary car can never resolve into an arrest
        const target = (!cold && gap < 7) ? 0 : reach < 8 ? reach * 1.1 : (cold ? c.cruise * 0.55 : c.cruise);   // a search is driven slowly
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
      this.#driveRoad(c, player, dt);
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
