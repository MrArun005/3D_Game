import * as THREE from 'three';
import { FigureFleet, FOOT_DROP } from '../world/figure.js';
import { CYCLE } from '../world/signals.js';

/**
 * People on the pavements.
 *
 * They exist for three reasons: a city with no one in it reads as a model, the
 * pavements built last round had nothing standing on them, and the wanted
 * system shipped with a `person` crime that nothing could ever commit -- the
 * only people in the world were on a beach with no collision bodies.
 *
 * Streamed like traffic: assigned to a graph edge near the player, walked
 * along the kerb line, recycled when they fall behind.
 */

const COUNT = 320;   // Phase 4: 320 downtown; spawn radius keeps them where the camera is
const SPAWN_MIN = 22, SPAWN_MAX = 150, DESPAWN = 200;

const SKIN = [0xf0c8a0, 0xd9a173, 0xa8724a, 0x7a4f33, 0x5a3a26];
const WEAR = [0x2b3444, 0x6a3f38, 0x2f5d4a, 0x7a6a48, 0x4a3f5e, 0x8a3a3a, 0x35485e, 0xa8a29a,
  0xc94a3a, 0xe0b23a, 0x2e7fb8, 0xd8d3c8, 0x6a9a4a, 0x8a4a9a, 0xe07a3a, 0x1f1f24];   // real clothes: reds, mustard, blues, white
// trousers: denim, black, khaki, grey -- deliberately duller than the tops
const TROUSERS = [0x2a3550, 0x1d1f24, 0x6b6045, 0x3b3f47, 0x27303d];

export class Crowd {
  constructor(scene, district) {
    this.district = district;
    this.edges = district.graph.edges.filter(
      (e) => e.class !== 'freeway' && e.class !== 'ramp' && (e.length || 0) > 40,
    );
    this.people = [];
    this.rand = mulberry(9137);

    this.fleet = new FigureFleet(scene, COUNT, { shadows: true });
    for (let i = 0; i < COUNT; i++) {
      this.fleet.colour(i, WEAR[i % WEAR.length], SKIN[(i * 3) % SKIN.length], TROUSERS[(i * 7) % TROUSERS.length]);
      this.people.push({ live: false, x: 0, z: 0, yaw: 0, speed: 0, phase: 0, down: 0,
                         height: 0.94 + this.rand() * 0.14 });
    }
    this.fleet.flush(true);
    this.clock = 0;
    // junction nodes (degree >= 3): people gather at their kerbs and cross in waves
    const deg = new Map();
    for (const e of district.graph.edges) for (const id of [e.a, e.b]) deg.set(id, (deg.get(id) || 0) + 1);
    this.junctions = new Map(district.graph.nodes.filter((n) => (deg.get(n.id) || 0) >= 3).map((n) => [n.id, n]));
  }

  /** Something frightening happened at (x,z): everyone within r runs from it. */
  panic(x, z, r = 18) {
    for (const p of this.people) {
      if (!p.live || p.down) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d > r) continue;
      p.panic = 5 + this.rand() * 3;
      p.yaw = Math.atan2(-(p.z - z), p.x - x);      // away from it
      p.cross = null;
    }
  }

  /** Put a pedestrian on the pavement of some edge in a ring around the car. */
  #spawn(p, car) {
    for (let tries = 0; tries < 40; tries++) {
      const e = this.edges[Math.floor(this.rand() * this.edges.length)];
      const pts = e.points;
      const i = Math.floor(this.rand() * (pts.length - 1));
      const ax = pts[i][0], az = pts[i][1];
      const dx = pts[i + 1][0] - ax, dz = pts[i + 1][1] - az;
      const L = Math.hypot(dx, dz) || 1;
      /* Keep clear of the junctions. A pavement offset from one road's
         centreline lands in the middle of the crossing road's carriageway
         near a junction, which is how pedestrians ended up standing in
         four lanes of traffic. */
      const margin = Math.min(L * 0.4, e.width / 2 + 8);
      if (L < margin * 2 + 6) continue;
      const t = (margin + this.rand() * (L - margin * 2)) / L;
      const ux = dx / L, uz = dz / L;
      const side = this.rand() < 0.5 ? 1 : -1;
      const off = (e.width / 2 + 2.4) * side;
      const x = ax + ux * L * t - uz * off;
      const z = az + uz * L * t + ux * off;
      const d = Math.hypot(x - car.x, z - car.z);
      if (d < SPAWN_MIN || d > SPAWN_MAX) continue;
      /* Offsetting from one road's centreline is not enough. Halstead Bay's
         roads run 14-44m wide and overlap freely at junctions and where they
         run in parallel, so a correct pavement offset from road A regularly
         lands in the middle of road B. Ask the world what is actually
         underfoot instead. */
      if (this.district.roadDepth(x, z) < 0.8) continue;
      p.live = true; p.x = x; p.z = z; p.down = 0;
      p.hx = x; p.hz = z;          // leash anchor: the verified pavement spot
      // walk along the kerb, in the direction the pavement runs
      p.yaw = Math.atan2(-uz, ux) + (this.rand() < 0.5 ? 0 : Math.PI);
      p.speed = this.rand() < 0.12 ? 0 : 1.0 + this.rand() * 0.5;   // some just stand: phones, shop windows
      p.phase = this.rand() * 6.28;
      p.wait = 0; p.jitter = this.rand() * CYCLE;
      // the far pavement: mirror this spot across the road's centreline (Phase 4b crossing target)
      p.ox = 2 * uz * off; p.oz = -2 * ux * off; p.cross = null; p.crossed = false;
      const ja = this.junctions.get(e.a), jb = this.junctions.get(e.b);
      const near = [ja, jb].filter(Boolean).sort((m, n) => Math.hypot(m.x - x, m.y - z) - Math.hypot(n.x - x, n.y - z))[0];
      p.j = near && Math.hypot(near.x - x, near.y - z) < 60 ? near : null;
      // a companion: one in four spawns as a pair walking together
      if (this.rand() < 0.25) {
        const q = this.people.find((o) => !o.live && o !== p);
        if (q) { Object.assign(q, { live: true, x: x + Math.cos(p.yaw + 1.57) * 0.7, z: z - Math.sin(p.yaw + 1.57) * 0.7, hx: x, hz: z, yaw: p.yaw, speed: p.speed, phase: this.rand() * 6.28, down: 0, wait: 0, jitter: p.jitter, j: p.j }); }
      }
      return;
    }
  }

  /** Turf a driver out onto the road and let them run for it. */
  eject(x, z, yaw) {
    const p = this.people.find((q) => !q.live) || this.people[0];
    p.live = true; p.down = 0;
    p.x = x + Math.cos(yaw + Math.PI / 2) * 1.9;
    p.z = z - Math.sin(yaw + Math.PI / 2) * 1.9;
    p.hx = p.x; p.hz = p.z;
    p.yaw = yaw + Math.PI / 2;
    p.speed = 2.6;                       // running, not strolling
    p.phase = 0;
  }

  update(car, dt, onHit) {
    this.clock += dt;
    for (let i = 0; i < COUNT; i++) {
      const p = this.people[i];
      if (!p.live) { this.#spawn(p, car); if (!p.live) { this.fleet.hide(i); continue; } }

      const gap = Math.hypot(p.x - car.x, p.z - car.z);
      /* Being run over is reported from here, not from the hull collision.
         Going down removes them from bodies(), so the collision pass never
         sees the impact it would have had to infer the crime from -- and a
         0.36m circle barely registers against the hull probes anyway. */
      if (!p.down && gap < 1.7 && car.speed > 2.2) {
        p.down = 0.001;
        if (onHit) onHit(car.speed);
      }
      if (p.down) {
        p.down += dt;
        if (p.down > 7) { p.live = false; continue; }
      } else {
        /* Kerb wave (Phase 4b, first cut): within 7m of a junction node,
           the crowd holds on the kerb during the red half of the signal cycle
           and moves off together on the green half. */
        let speed = p.speed;
        if (p.panic > 0) { p.panic -= dt; speed = 2.8; }   // running
        const atKerb = p.j && Math.hypot(p.j.x - p.x, p.j.y - p.z) < 7;
        if (atKerb && !p.cross) {
          const ph = ((this.clock + p.jitter * 0.1) % CYCLE) / CYCLE;
          if (ph < 0.45) speed = 0;
          // green: the ones who waited cross together to the far pavement
          else if (!p.crossed && p.ox !== undefined && this.rand() < dt * 1.5) {
            p.cross = { tx: p.x + p.ox, tz: p.z + p.oz };
          }
        }
        if (p.cross) {
          const dx = p.cross.tx - p.x, dz = p.cross.tz - p.z, dist = Math.hypot(dx, dz);
          const step = Math.min(dist, 1.4 * dt);
          p.x += dx / dist * step; p.z += dz / dist * step;
          p.yaw = Math.atan2(-dz, dx);
          if (dist < 0.3) { p.cross = null; p.crossed = true; p.hx = p.x; p.hz = p.z; p.yaw += Math.PI / 2 * (this.rand() < 0.5 ? 1 : -1); }
          p.phase += 1.4 * dt * 2.6;
          if (gap > DESPAWN) { p.live = false; continue; }
          this.fleet.write(i, p.x, FOOT_DROP * p.height + (this.district?.elevationAt?.(p.x, p.z) ?? 0), p.z, p.yaw, p.phase, 1, p.height);
          continue;
        }
        const nx = p.x + Math.cos(p.yaw) * speed * dt;
        const nz = p.z - Math.sin(p.yaw) * speed * dt;
        /* Walking in a straight line off a verified pavement spot eventually
           walks you past the end of the road and into the junction. Leash
           them to the stretch of kerb they started on, and turn them round if
           the next step would put them on tarmac. */
        const fromHome = Math.hypot(nx - p.hx, nz - p.hz);
        if (p.panic > 0 ? fromHome > 60 : (fromHome > 26 || this.district.roadDepth(nx, nz) < 0.5)) {
          p.yaw += Math.PI;
        } else { p.x = nx; p.z = nz; }
        if (gap > DESPAWN) { p.live = false; continue; }
      }

      // the stride advances with distance covered, so feet do not skate
      const moving = p.panic > 0 || p.speed > 0.15 && !(p.j && Math.hypot(p.j.x - p.x, p.j.y - p.z) < 7 && ((this.clock + p.jitter * 0.1) % CYCLE) / CYCLE < 0.45);
      if (!p.down && moving) p.phase += p.speed * dt * 2.6;
      const state = p.down ? 3 : !moving ? 0 : (p.panic > 0 || p.speed > 2.2) ? 2 : 1;
      if (!p.down && state === 0) p.phase += dt * 1.4;      // idle breathing
      // lift by FOOT_DROP or they hover 11.5 cm above the pavement
      const lift = this.district?.elevationAt ? this.district.elevationAt(p.x, p.z) : 0;   // bridge pavements
      this.fleet.write(i, p.x, FOOT_DROP * p.height + lift, p.z, p.yaw, p.phase, state, p.height);
    }
    this.fleet.flush();
  }
}

/* Local RNG so the crowd cannot perturb any other deterministic stream. */
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
