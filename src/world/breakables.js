import * as THREE from 'three';
import { mrt, vec4 } from 'three/tsl';
import { groundHeightAt } from './metrics.js';

/**
 * Destructible street furniture.
 *
 * The catalogue bakes every prop into merged per-material meshes (that is how
 * the kit stays inside the draw budget), so a broken prop cannot be hidden by
 * flipping an instance matrix — it does not have one. Instead the batch
 * records, for every placement of an asset listed here, WHICH vertex range of
 * WHICH merged mesh it landed in (InstanceBatch.trackNames/.tracked), and
 * breaking a prop zeroes that range in place: three identical vertices
 * rasterise nothing, and the upload is one addUpdateRange, not a rebuild.
 * The flying replacement is a real Mesh reusing the catalogue's SHARED
 * geometry and material — never dispose either from here.
 *
 * Costs, per the frame-rate contract: at most MAX_DEBRIS transient meshes
 * (a few draws each while tumbling, then they sleep), plus ≤3 water and ≤3
 * spark particle systems of one draw each. Static props stay zero-cost.
 *
 * Scope: the PLAYER's car breaks props. Traffic shoves through the same
 * furniture un-physically, as it always has — its cars never consulted the
 * street-furniture solids in the first place.
 */

/** Which assets break, how hard that is, and what it looks like. */
export const BREAK_CLASS = new Map(Object.entries({
  // light: any real contact sweeps it aside; the car barely notices
  'props/bin': { cls: 'light' },
  'props/cone': { cls: 'light' },
  'props/barrier': { cls: 'light' },
  'props/a_frame_sign': { cls: 'light' },
  'props/parking_meter': { cls: 'light' },
  'props/post_box': { cls: 'light' },
  'props/notice_board': { cls: 'light' },
  'props/bike_rack': { cls: 'light' },
  'props/bollard': { cls: 'light' },
  'props/cafe_umbrella': { cls: 'light' },
  'props/street_sign': { cls: 'light' },
  'props/junction_box': { cls: 'light' },
  'props/crates': { cls: 'light' },
  'props/pallet_stack': { cls: 'light' },
  'props/hydrant': { cls: 'light', effect: 'water' },
  // heavy: stands firm below ~30 km/h, tears off above it, and the car pays
  'props/banner_pole': { cls: 'heavy' },
  'props/utility_pole': { cls: 'heavy' },
  'props/lamp_local': { cls: 'heavy', effect: 'sparks' },
  'props/lamp_arterial': { cls: 'heavy', effect: 'sparks' },
  'props/phone_box': { cls: 'heavy' },
}));

const LIGHT_SPEED = 2.2;      // m/s — walking pace still knocks a cone over
const HEAVY_SPEED = 8.5;      // m/s — ~30 km/h to fell a lamp post
const MAX_DEBRIS = 26;

/* the car hull as three circles down its length, same model collision.js uses */
const CAR_OFFSETS = [-1.6, 0, 1.6];
const CAR_R = 0.95;
const PROP_R = 0.5;

const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

/** soft round sprite for the particle systems */
function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 1, 16, 16, 15);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class Debris {
  constructor(scene) {
    this.catalogue = null;              // set once the catalogue resolves
    this.group = new THREE.Group();
    this.group.name = 'debris';
    scene.add(this.group);
    this.byChunk = new Map();           // chunk key -> breakable entries
    this.active = [];                   // tumbling / resting debris bodies
    this.effects = [];                  // water fountains, spark bursts
    this.boxes = new Map();             // asset name -> cached bounding box
    this.dot = null;                    // lazy: not every session breaks things
  }

  /**
   * A chunk finished dressing. `tracked` comes from InstanceBatch, `solids`
   * is the same array the collision system reads (parkedByChunk), so a heavy
   * prop's collision body can be spliced out the moment it breaks.
   */
  registerChunk(key, tracked, solids, pools = null) {
    const entries = [];
    for (const t of tracked) {
      const spec = BREAK_CLASS.get(t.name);
      if (!spec) continue;
      const e = t.matrix.elements;
      const entry = {
        name: t.name, cls: spec.cls, effect: spec.effect,
        x: e[12], y: e[13], z: e[14],
        scale: Math.hypot(e[0], e[1], e[2]) || 1,
        ranges: t.ranges, solids, solid: null, pool: null, broken: false,
      };
      if (spec.cls === 'heavy') {
        // dressing.js pushed a collision solid for lamps and phone boxes;
        // find it by proximity so the break can remove it
        entry.solid = solids.find((s) => s.tag === 'prop'
          && Math.abs(s.x - entry.x) < 0.6 && Math.abs(s.z - entry.z) < 0.6) || null;
        /* a lamp's sodium glow pool is its own instanced quad, emitted 1.4m
           off the base by the same loop that placed the lamp — claim it so a
           felled lamp doesn't leave its light spill floating on the pavement */
        if (pools && t.name.includes('lamp')) {
          for (let i = 0; i < pools.at.length; i++) {
            const [px, pz] = pools.at[i];
            if (Math.abs(px - entry.x) < 2.2 && Math.abs(pz - entry.z) < 2.2) {
              entry.pool = { mesh: pools.mesh, index: i };
              break;
            }
          }
        }
      }
      entries.push(entry);
    }
    if (entries.length) this.byChunk.set(key, entries);
  }

  dropChunk(key) { this.byChunk.delete(key); }

  update(car, dt) {
    if (this.catalogue) this.#collide(car, dt);
    this.#integrate(dt);
    this.#runEffects(dt);
  }

  /**
   * Break every breakable within `r` metres of a point — the hook for things
   * that are not the car hull: bullet impacts, the blast when a car burns
   * out, a helicopter touching down on a row of bins. `car` supplies the
   * inherited velocity and takes the crime/damage report exactly as a hull
   * hit would; `speed` stands in for how hard the point was struck.
   */
  breakNear(x, z, r, car, speed = 12) {
    if (!this.catalogue) return 0;
    let n = 0;
    const ix = Math.floor(x / 256), iz = Math.floor(z / 256);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const entries = this.byChunk.get(`${ix + dx},${iz + dz}`);
        if (!entries) continue;
        for (const en of entries) {
          if (en.broken) continue;
          const ddx = en.x - x, ddz = en.z - z;
          if (ddx * ddx + ddz * ddz > r * r) continue;
          this.#break(en, car, speed);
          n++;
        }
      }
    }
    return n;
  }

  /* ---- contact & breaking ---------------------------------------------- */

  #collide(car, dt) {
    const speed = Math.hypot(car.vx, car.vz);
    if (speed < LIGHT_SPEED) return;
    /* One frame of travel is added to the contact radius: a fast car would
       otherwise jump the narrow gap between "close enough to detect" and
       "resolved against the solid" between two frames, and slam a lamp post
       for one frame before the break lands. */
    const hitR = CAR_R + PROP_R + speed * dt;
    const hitD2 = hitR * hitR;
    const rough = (4 + speed * dt) ** 2;
    const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    const fx = cy, fz = -sy;
    const ix = Math.floor(car.x / 256), iz = Math.floor(car.z / 256);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const entries = this.byChunk.get(`${ix + dx},${iz + dz}`);
        if (!entries) continue;
        for (const en of entries) {
          if (en.broken) continue;
          const rx = en.x - car.x, rz = en.z - car.z;
          if (rx * rx + rz * rz > rough) continue;   // beyond any hull circle
          for (const o of CAR_OFFSETS) {
            const px = car.x + fx * o, pz = car.z + fz * o;
            const ddx = en.x - px, ddz = en.z - pz;
            if (ddx * ddx + ddz * ddz > hitD2) continue;
            if (en.cls === 'heavy' && speed < HEAVY_SPEED) break;   // it holds
            this.#break(en, car, speed);
            break;
          }
        }
      }
    }
  }

  #break(entry, car, speed) {
    entry.broken = true;
    console.info(`prop broke: ${entry.name} @ ${(speed * 3.6).toFixed(0)} km/h`);
    // vanish from the merged batch: three identical vertices draw nothing
    for (const r of entry.ranges) {
      const pos = r.mesh.geometry.attributes.position;
      pos.array.fill(0, r.start * 3, (r.start + r.count) * 3);
      pos.addUpdateRange(r.start * 3, r.count * 3);
      pos.needsUpdate = true;
    }
    // a felled lamp stops blocking the car, and its glow pool goes with it
    if (entry.solid) {
      const i = entry.solids.indexOf(entry.solid);
      if (i >= 0) entry.solids.splice(i, 1);
    }
    if (entry.pool) {
      entry.pool.mesh.setMatrixAt(entry.pool.index, _zero);
      entry.pool.mesh.instanceMatrix.needsUpdate = true;
    }
    // the car feels it: a bin is a tap, a lamp post is a proper hit
    if (entry.cls === 'heavy') {
      car.vx *= 0.82; car.vz *= 0.82;
      car.yawRate += (Math.random() - 0.5) * speed * 0.02;
      if (speed * 0.5 > (car.hitForce || 0)) {
        car.hitForce = speed * 0.5;
        car.hitTag = 'prop';
        car.hitAt = { x: entry.x, z: entry.z };
      }
    } else {
      car.vx *= 0.996; car.vz *= 0.996;
    }
    this.#spawnDebris(entry, car, speed);
    if (entry.effect === 'water') this.#fountain(entry);
    if (entry.effect === 'sparks') this.#sparks(entry);
  }

  async #spawnDebris(entry, car, speed) {
    const lods = await this.catalogue.fetchAsset(entry.name).catch(() => null);
    const parts = lods?.[0];
    if (!parts?.length) return;

    let box = this.boxes.get(entry.name);
    if (!box) {
      box = new THREE.Box3();
      for (const p of parts) {
        if (!p.geometry.boundingBox) p.geometry.computeBoundingBox();
        box.union(p.geometry.boundingBox);
      }
      this.boxes.set(entry.name, box);
    }
    const halfH = Math.max(0.12, (box.max.y - box.min.y) / 2) * entry.scale;

    // origin is authored at the base; recentre so it tumbles about its middle
    const inner = new THREE.Group();
    inner.position.y = -halfH / entry.scale;
    for (const p of parts) {
      const m = new THREE.Mesh(p.geometry, p.material);   // SHARED — never dispose
      m.castShadow = true;
      inner.add(m);
    }
    const outer = new THREE.Group();
    outer.scale.setScalar(entry.scale);
    outer.position.set(entry.x, entry.y + halfH, entry.z);
    outer.add(inner);
    this.group.add(outer);

    const kick = entry.cls === 'heavy' ? 1.4 : 2.6;
    const body = {
      mesh: outer, halfH,
      vel: new THREE.Vector3(car.vx * 0.75, Math.min(6, speed * 0.35) + kick, car.vz * 0.75),
      ang: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 5,
                             (Math.random() - 0.5) * 8),
      bounces: 0, asleep: false,
    };
    this.active.push(body);
    if (this.active.length > MAX_DEBRIS) {
      const idx = Math.max(0, this.active.findIndex((b) => b.asleep));
      const [old] = this.active.splice(idx, 1);
      this.group.remove(old.mesh);      // geometry/material are the catalogue's
    }
  }

  #integrate(dt) {
    for (const b of this.active) {
      if (b.asleep) continue;
      b.vel.y -= 14 * dt;               // a touch over-g: settles snappily
      const m = b.mesh;
      m.position.addScaledVector(b.vel, dt);
      const w = b.ang.length();
      if (w > 1e-4) {
        _axis.copy(b.ang).multiplyScalar(1 / w);
        _q.setFromAxisAngle(_axis, w * dt);
        m.quaternion.premultiply(_q);
      }
      const rest = groundHeightAt(m.position.x, m.position.z) + b.halfH * 0.55;
      if (m.position.y < rest) {
        m.position.y = rest;
        b.vel.y = -b.vel.y * 0.32;
        b.vel.x *= 0.7; b.vel.z *= 0.7;
        b.ang.multiplyScalar(0.62);
        b.bounces++;
        if (b.bounces > 2 && b.vel.lengthSq() < 0.35) b.asleep = true;
      }
    }
  }

  /* ---- effects ----------------------------------------------------------- */

  #particles(n, colour, size, blending) {
    this.dot ??= dotTexture();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    /* The node PointsMaterial asks the geometry for `uv` when it has a map,
       even though point sprites take their texture coordinate from the sprite
       itself -- without the attribute every burst logs "Vertex attribute uv
       not found". Zero-filled is correct here: it is never read. */
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const mat = new THREE.PointsMaterial({
      map: this.dot, color: colour, size, transparent: true, depthWrite: false,
      blending, sizeAttenuation: true,
    });
    /* Blending applies to EVERY MRT target, so an additive sprite would smear
       its garbage normal into the post stack's normal buffer and GTAO turns
       that into dark speckles (the night-rain bug, same mechanism). Writing a
       zero normal — additive identity — keeps the geometry's normals under
       the particles intact. */
    mat.mrtNode = mrt({ normal: vec4(0) });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.group.add(pts);
    return pts;
  }

  #fountain(entry) {
    if (this.effects.filter((e) => e.kind === 'water').length >= 3) return;
    const n = 90;
    const pts = this.#particles(n, 0xbcd6ee, 0.34, THREE.NormalBlending);
    const vel = new Float32Array(n * 3);
    const pos = pts.geometry.attributes.position.array;
    for (let i = 0; i < n; i++) this.#respawnDrop(pos, vel, i, entry, Math.random() * 1.2);
    // base 0.55: a jet, not a whiteout when the camera drives through it
    this.effects.push({ kind: 'water', pts, vel, entry, t: 0, life: 20, base: 0.55 });
  }

  #respawnDrop(pos, vel, i, entry, delay = 0) {
    pos[i * 3] = entry.x; pos[i * 3 + 1] = entry.y - delay * 8; pos[i * 3 + 2] = entry.z;
    vel[i * 3] = (Math.random() - 0.5) * 1.6;
    vel[i * 3 + 1] = 8.5 + Math.random() * 3.5;
    vel[i * 3 + 2] = (Math.random() - 0.5) * 1.6;
  }

  /**
   * A car window going in. Public, because the on-foot code owns the punch
   * and only knows where the glass was. Rides the sparks integrator -- same
   * gravity, same lifetime -- with a colder colour and a flatter, wider burst
   * so it reads as shards falling out of a frame rather than a lamp arcing.
   */
  shatter(x, y, z) {
    if (this.effects.filter((e) => e.kind === 'sparks').length >= 3) return;
    const n = 64;
    const pts = this.#particles(n, 0xcfe4f2, 0.16, THREE.NormalBlending);
    const vel = new Float32Array(n * 3);
    const pos = pts.geometry.attributes.position.array;
    for (let i = 0; i < n; i++) {
      pos[i * 3] = x + (Math.random() - 0.5) * 0.6;
      pos[i * 3 + 1] = y + (Math.random() - 0.5) * 0.35;
      pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.6;
      vel[i * 3] = (Math.random() - 0.5) * 3.2;
      vel[i * 3 + 1] = Math.random() * 1.6;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 3.2;
    }
    this.effects.push({ kind: 'sparks', pts, vel, entry: { x, y, z, scale: 1 }, t: 0, life: 0.9 });
  }

  #sparks(entry) {
    if (this.effects.filter((e) => e.kind === 'sparks').length >= 3) return;
    const n = 42;
    const pts = this.#particles(n, 0xffc078, 0.3, THREE.AdditiveBlending);
    const vel = new Float32Array(n * 3);
    const pos = pts.geometry.attributes.position.array;
    const top = entry.y + 4.6 * entry.scale;      // lamp head, near enough
    for (let i = 0; i < n; i++) {
      pos[i * 3] = entry.x; pos[i * 3 + 1] = top; pos[i * 3 + 2] = entry.z;
      vel[i * 3] = (Math.random() - 0.5) * 7;
      vel[i * 3 + 1] = Math.random() * 5;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 7;
    }
    this.effects.push({ kind: 'sparks', pts, vel, entry, t: 0, life: 0.55 });
  }

  #runEffects(dt) {
    for (let k = this.effects.length - 1; k >= 0; k--) {
      const e = this.effects[k];
      e.t += dt;
      const pos = e.pts.geometry.attributes.position.array;
      const n = pos.length / 3;
      for (let i = 0; i < n; i++) {
        e.vel[i * 3 + 1] -= (e.kind === 'water' ? 9.8 : 14) * dt;
        pos[i * 3] += e.vel[i * 3] * dt;
        pos[i * 3 + 1] += e.vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += e.vel[i * 3 + 2] * dt;
        if (e.kind === 'water' && pos[i * 3 + 1] < e.entry.y && e.t < e.life - 2) {
          this.#respawnDrop(pos, e.vel, i, e.entry);
        }
      }
      e.pts.geometry.attributes.position.needsUpdate = true;
      const fade = Math.min(1, Math.max(0, (e.life - e.t) / (e.kind === 'water' ? 2 : 0.3)));
      e.pts.material.opacity = fade * (e.base ?? 1);
      if (e.t >= e.life) {
        this.group.remove(e.pts);
        e.pts.geometry.dispose();
        e.pts.material.dispose();
        this.effects.splice(k, 1);
      }
    }
  }
}
