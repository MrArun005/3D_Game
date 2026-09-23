import * as THREE from 'three';

/**
 * Night light pool: a handful of REAL point lights lent to the lamp heads
 * nearest the player, so people, cars and walls under a lamp are actually lit
 * instead of standing on a painted pool. Workstream B of the Light the City
 * plan, with the hand-off rules from the plan review:
 *
 *  - re-rank every 0.25 s, not every frame;
 *  - a candidate must beat the current owner by 20% to take a light, and an
 *    owner keeps it for at least 1 s once granted, so a lit street at speed
 *    hands off in a steady wave instead of shimmering;
 *  - a light that changes owner fades out at the old head and in at the new
 *    one over 0.4 s, so the pool is N owners plus fading ghosts.
 *
 * Painted pools stay for the rest of the city; this is the near field only.
 * Costs N point lights in the forward pass -- tune with ?lights=N.
 */
/** Rank key for the night pool. Neon kanban are biased in so a closer
 *  sodium lamp on the arterial does not steal every slot in Little Tokyo. */
export function headScore(h, x, z) {
  const d2 = (h.x - x) ** 2 + (h.z - z) ** 2;
  return d2 * (h.neon ? 0.12 : 1);
}

export class LightPool {
  constructor(scene, world, { count = 6, radius = 60, colour = 0xffba75, intensity = 60, range = 26, hero = 3, heroRadius = 85 } = {}) {
    this.scene = scene; this.world = world; this.radius = radius; this.heroRadius = heroRadius;
    this.lights = [];

    const coronaTex = (() => {
      if (typeof document === 'undefined') return null;
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
      g.addColorStop(0, 'rgba(255, 235, 190, 0.95)');
      g.addColorStop(0.25, 'rgba(255, 185, 100, 0.45)');
      g.addColorStop(0.65, 'rgba(255, 130, 40, 0.12)');
      g.addColorStop(1, 'rgba(255, 100, 20, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();

    this.coronas = [];
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(colour, 0, range, 2);
      l.castShadow = false;
      scene.add(l);
      this.lights.push({ light: l, head: null, since: -1e9, fade: 0, from: null, target: intensity });

      if (coronaTex) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: coronaTex,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0,
        }));
        sprite.scale.set(4.2, 4.2, 1);
        sprite.visible = false;
        scene.add(sprite);
        this.coronas.push(sprite);
      }
    }
    this.intensity = intensity;
    this.colour = colour;   // the default head colour; a head may carry its own (Little Tokyo's kanban)
    this.t = 0; this.next = 0;
    // four headlight spots, lent to the nearest moving traffic cars
    this.spots = [];
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.SpotLight(0xdce8ff, 0, 42, 0.45, 0.7, 1.4);
      sp.castShadow = false;
      scene.add(sp, sp.target);
      this.spots.push(sp);
    }
    /* BLOCK HERO lights (Phase 5): a glowing doorway, a laundromat's spill on
       the pavement, a harbour floodlight -- the two or three lights per block
       that say someone is inside. The world hands positions over in
       `world.heroLightsByChunk` (same shape as headsByChunk, one entry per
       chunk key), each { x, y, z, colour?, intensity?, range? }, so a doorway
       is a small warm 12 m light and a dock floodlight a cold 40 m one.
       Created HERE, at boot, with the rest of the pool: adding a light to a
       live WebGPU scene recompiles every pipeline and stalls the frame ~2 s.
       They are not lamp heads -- no corona, no hysteresis, they sit still. */
    /* ponytail: no world.heroLightsByChunk, no lights. Three PointLights at
       intensity 0 are NOT free -- three's WebGPU forward pass has no light
       clustering, so they run the full attenuation loop per lit fragment
       (6 -> 9 heads is ~+50% on it) for nothing until districtWorld fills the
       map. DistrictWorld is constructed before the pool (main.js), so the day
       that hook lands these appear on the next reload. */
    this.heroes = [];
    const heroN = world?.heroLightsByChunk ? hero : 0;
    for (let i = 0; i < heroN; i++) {
      const l = new THREE.PointLight(0xffb060, 0, 14, 2);
      l.castShadow = false;
      scene.add(l);
      this.heroes.push({ light: l, src: null, want: null, fade: 0 });
    }

    /* One real light for the nearest hunting cruiser's bar, red/blue with its
       flash: the wash on the buildings around you that the pool disc on the
       tarmac cannot give. One point light, 30 m, off when nobody is hunting. */
    this.beacon = new THREE.PointLight(0xff2a1c, 0, 30, 2);
    this.beacon.castShadow = false;
    scene.add(this.beacon);

    /* Day/night dimmer (2026-09-14). The pool used to be built ONLY when the
       game booted with ?night (main.js gated it on !DAY), so a normal session
       -- which boots at 16.85 and runs 24 game hours per 24 real minutes --
       drove into midnight with no pool at all: measured on the Little Tokyo
       street, 2 lights alive out of 6, both still parked at the world origin,
       while 2,077 registered lamp heads and 720 doorway lights went unused.
       That is why neon never reached the tarmac and a wet road reflected
       nothing: the road material was right, there was simply no light.

       The pool is built at boot now (adding a PointLight to a live WebGPU
       scene recompiles every pipeline and stalls ~2 s, so it cannot be built
       on the way into dusk) and clock.js fades it with the SAME nightFactor
       that already staggers the lamps, signs and windows. */
    /* Defaults ON. clock.js sets this every frame before the pool updates, so
       the value is only ever a default for a caller that forgot -- and of the
       two ways to be wrong, a lamp lit at noon is one somebody reports, while
       night with no lights is the bug this replaced and it was invisible for
       weeks. Fail loud. */
    this.night = 1;
  }

  /** 0 by day, 1 after dark. clock.js drives this off nightFactor. */
  setNight(k) { this.night = Math.max(0, Math.min(1, +k || 0)); }

  #traffic(traffic, x, z) {
    if (!traffic || !traffic.cars) return;
    let c0 = null, c1 = null, c2 = null, c3 = null;
    let d0 = 4900, d1 = 4900, d2 = 4900, d3 = 4900; // 70m squared
    /* The inner distance used to be `const d2`, shadowing the third slot: the
       third comparison could never be true and `d2 = d1` was an assignment to
       a const -- a TypeError the moment a second car came inside 70 m. Police
       cruisers are candidates too; they had no headlights. */
    let nearestBeacon = null, beaconD = 1600;   // 40 m squared
    for (const list of [traffic.cars, traffic.police ?? []]) for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.live || !c.mesh?.visible) continue;
      const dx = c.x - x, dz = c.z - z;
      const dd = dx * dx + dz * dz;
      if (c.bar && (c.hunt || c.respondT > 0) && dd < beaconD) { beaconD = dd; nearestBeacon = c; }
      if (c.speed <= 1) continue;
      if (dd < d0) {
        c3 = c2; d3 = d2;
        c2 = c1; d2 = d1;
        c1 = c0; d1 = d0;
        c0 = c; d0 = dd;
      } else if (dd < d1) {
        c3 = c2; d3 = d2;
        c2 = c1; d2 = d1;
        c1 = c; d1 = dd;
      } else if (dd < d2) {
        c3 = c2; d3 = d2;
        c2 = c; d2 = dd;
      } else if (dd < d3) {
        c3 = c; d3 = dd;
      }
    }
    if (nearestBeacon) {
      const c = nearestBeacon, flash = Math.floor((traffic.time ?? 0) * 6) % 2;
      this.beacon.position.set(c.x, c.mesh.position.y + 1.9, c.z);
      this.beacon.color.setHex(flash ? 0xff2a1c : 0x2f6dff);
      this.beacon.intensity = 70;
    } else this.beacon.intensity = 0;
    const nearest = [c0, c1, c2, c3];
    for (let i = 0; i < 4; i++) {
      const sp = this.spots[i];
      const c = nearest[i];
      if (!c) { sp.intensity = 0; continue; }
      const fx = Math.cos(c.yaw), fz = -Math.sin(c.yaw), y = c.mesh.position.y;
      sp.position.set(c.x + fx * (c.spec.L * 0.5), y + 0.8, c.z + fz * (c.spec.L * 0.5));
      sp.target.position.set(c.x + fx * 26, y - 0.4, c.z + fz * 26);
      sp.target.updateMatrixWorld();
      sp.intensity = 38;
    }
  }

  /**
   * Re-rank the hero sources on the pool's own 0.25 s tick. A slot only lets
   * its source go when that source drops out of the nearest N+1 -- ordering
   * swaps inside the set change nothing, so driving past a parade of shops
   * does not strobe the lights. The hand-over is a crossfade in update().
   */
  #hero(x, z) {
    const by = this.world?.heroLightsByChunk;
    if (!by || !this.heroes.length) return;
    const r2 = this.heroRadius * this.heroRadius, best = [];
    for (const list of by.values()) {
      for (const p of list) {
        const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d2 < r2) best.push({ p, d2 });
      }
    }
    best.sort((a, b) => a.d2 - b.d2);
    const n = this.heroes.length;
    const keep = new Set(best.slice(0, n + 1).map((e) => e.p));   // hysteresis: one place of slack
    const taken = new Set();
    for (const slot of this.heroes) {
      if (slot.want && keep.has(slot.want)) taken.add(slot.want); else slot.want = null;
    }
    for (const slot of this.heroes) {
      if (slot.want) continue;
      const e = best.slice(0, n).find((c) => !taken.has(c.p));
      if (!e) break;
      slot.want = e.p; taken.add(e.p);
    }
  }

  #candidates(x, z) {
    const out = [], r2 = this.radius * this.radius;
    for (const heads of this.world.headsByChunk.values()) {
      for (const h of heads) {
        /* a head whose light cannot reach the street (the Shibuya crown and
           roof floodlights, 48-57 m up with a 20-24 m range) keeps its glare
           sprite but never takes one of the few real lights from the pavement */
        if (h.y - 0.4 - (h.range ?? 26) > 2) continue;
        const d2 = (h.x - x) ** 2 + (h.z - z) ** 2;
        if (d2 < r2) out.push({ h, d2, score: headScore(h, x, z) });
      }
    }
    out.sort((a, b) => a.score - b.score);
    return out;
  }

  update(dt, x, z, traffic = null) {
    this.t += dt;
    this.#traffic(traffic, x, z);
    /* Fully dark daytime: the lights are at zero anyway, so skip the 0.25 s
       re-rank over every head in every loaded chunk (2,077 of them downtown)
       rather than sort a list nobody can see. */
    if (this.night <= 0) { for (const s of this.lights) { s.light.intensity = 0; } for (const s of this.heroes) s.light.intensity = 0; return; }
    if (this.t >= this.next) {
      this.next = this.t + 0.25;
      this.#hero(x, z);
      const cands = this.#candidates(x, z);
      /* A slot claims its NEXT head as `want` and keeps lighting `head` until
         it has dimmed out -- see the crossfade below. Ownership is checked
         against both, or two slots grab the same lamp while one is fading. */
      const owned = new Set();
      for (const s of this.lights) { if (s.head) owned.add(s.head); if (s.want) owned.add(s.want); }
      const free = cands.filter((c) => !owned.has(c.h));
      for (const slot of this.lights) {
        if (slot.want && slot.want !== slot.head) continue;   // already handing over
        const cur = slot.head ? headScore(slot.head, x, z) : Infinity;
        const best = free[0];
        if (!best) break;
        // hysteresis: 20% closer (on the biased score), and the owner has had its second
        if (slot.head && !(best.score < cur * 0.8 && this.t - slot.since > 1.0)) continue;
        slot.want = best.h; slot.since = this.t;
        owned.add(best.h); free.shift();
      }
    }
    /* Crossfade: a slot dims out where it stands, THEN moves. Half a second
       either way -- a hero light that teleports across the street is worse
       than one that is briefly out. */
    for (const s of this.heroes) {
      if (s.src !== s.want) {
        s.fade = Math.max(0, s.fade - dt / 0.5);
        if (s.fade === 0) {
          s.src = s.want;
          if (s.src) {
            s.light.position.set(s.src.x, s.src.y, s.src.z);
            s.light.color.setHex(s.src.colour ?? 0xffb060);
            s.light.distance = s.src.range ?? 14;
          }
        }
      } else if (s.src) s.fade = Math.min(1, s.fade + dt / 0.5);
      s.light.intensity = s.src ? (s.src.intensity ?? 22) * s.fade * this.night : 0;
    }
    for (let i = 0; i < this.lights.length; i++) {
      const s = this.lights[i];
      const l = s.light;
      const corona = this.coronas[i];
      /* Crossfade, the same shape the hero slots use. The re-rank used to set
         `head` and `fade = 0` together, so the lamp a slot was leaving went
         BLACK on that frame and the new one lit from nothing: driving down a
         street popped a lamp off every time the ranking changed. Now a slot
         dims where it stands, and only moves once it is dark. */
      if (s.want && s.want !== s.head) {
        s.fade = Math.max(0, s.fade - dt / 0.35);
        if (s.fade === 0) {
          s.head = s.want;
          l.color.setHex(s.head.colour ?? this.colour);
        }
      }
      if (!s.head) {
        l.intensity = 0;
        if (corona) corona.visible = false;
        continue;
      }
      if (!s.want || s.want === s.head) s.fade = Math.min(1, s.fade + dt / 0.4);
      // the light sits a little below the head so the pool lands on the pavement, not the lamp
      l.position.set(s.head.x, s.head.y - 0.4, s.head.z);
      l.intensity = (s.head.intensity ?? this.intensity) * s.fade * this.night;
      l.distance = s.head.range ?? 26;
      if (corona) {
        corona.position.set(s.head.x, s.head.y - 0.15, s.head.z);
        corona.visible = s.head.glare !== 0;   // glare 0: a light with no lamp of its own (the screens' spill over the crossing)
        corona.material.color.setHex(s.head.colour ?? this.colour);
        const g = s.head.neon ? 5.4 : 4.2;
        corona.scale.set(g, g, 1);
        corona.material.opacity = 0.85 * s.fade * this.night;
      }
    }
  }
}
