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
 *  - a light that changes owner fades out at the old head (`from`) over the
 *    first 0.2 s and in at the new one over the next 0.2 s -- the SAME light
 *    moving, so a hand-off costs no ghost lights and does not pop.
 *
 * Painted pools stay for the rest of the city; this is the near field only.
 * Costs N point lights in the forward pass -- tune with ?lights=N. The pool
 * exists day and night (one shader variant, no dusk recompile); `night`, the
 * clock's nightFactor, scales every intensity, so by day the lights are zero.
 * No corona sprites here: world/glare.js draws the glare at the same heads.
 */
export class LightPool {
  constructor(scene, world, { count = 6, radius = 60, colour = 0xffba75, intensity = 60, range = 26 } = {}) {
    this.scene = scene; this.world = world; this.radius = radius;
    this.lights = [];

    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(colour, 0, range, 2);
      l.castShadow = false;
      scene.add(l);
      this.lights.push({ light: l, head: null, since: -1e9, fade: 0, from: null, target: intensity });

    }
    this.intensity = intensity;
    this.night = 1;   // clock.nightFactor; main sets it every frame
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
    /* One real light for the nearest hunting cruiser's bar, red/blue with its
       flash: the wash on the buildings around you that the pool disc on the
       tarmac cannot give. One point light, 30 m, off when nobody is hunting. */
    this.beacon = new THREE.PointLight(0xff2a1c, 0, 30, 2);
    this.beacon.castShadow = false;
    scene.add(this.beacon);
  }

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
      this.beacon.intensity = 70;   // a cruiser's bar is lit by day too
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
      sp.intensity = 38 * this.night;
    }
  }

  #candidates(x, z) {
    const out = [], r2 = this.radius * this.radius;
    for (const heads of this.world.headsByChunk.values()) {
      for (const h of heads) { const d2 = (h.x - x) ** 2 + (h.z - z) ** 2; if (d2 < r2) out.push({ h, d2 }); }
    }
    out.sort((a, b) => a.d2 - b.d2);
    return out;
  }

  update(dt, x, z, traffic = null) {
    this.t += dt;
    this.#traffic(traffic, x, z);
    if (this.t >= this.next) {
      this.next = this.t + 0.25;
      const cands = this.#candidates(x, z);
      const owned = new Set(this.lights.map((s) => s.head).filter(Boolean));
      const free = cands.filter((c) => !owned.has(c.h));
      for (const slot of this.lights) {
        const cur = slot.head ? (slot.head.x - x) ** 2 + (slot.head.z - z) ** 2 : Infinity;
        const best = free[0];
        if (!best) break;
        // hysteresis: 20% closer, and the owner has had its second
        if (slot.head && !(best.d2 < cur * 0.8 && this.t - slot.since > 1.0)) continue;
        slot.from = slot.head; slot.head = best.h; slot.since = this.t; slot.fade = 0;
        slot.light.color.setHex(best.h.colour ?? this.colour);
        owned.add(best.h); free.shift();
      }
    }
    for (let i = 0; i < this.lights.length; i++) {
      const s = this.lights[i];
      const l = s.light;
      if (!s.head) { l.intensity = 0; continue; }
      s.fade = Math.min(1, s.fade + dt / 0.4);
      // the light sits a little below the head so the pool lands on the pavement, not the lamp
      let at = s.head, k = s.fade;
      if (s.from && s.fade < 0.5) { at = s.from; k = 1 - s.fade * 2; }        // first half: dim out where it was
      else if (s.from) { k = (s.fade - 0.5) * 2; if (s.fade >= 1) s.from = null; }   // second half: brighten where it is
      l.position.set(at.x, at.y - 0.4, at.z);
      l.intensity = this.intensity * k * this.night;
    }
  }
}
