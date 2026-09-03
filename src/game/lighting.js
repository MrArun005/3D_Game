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
export class LightPool {
  constructor(scene, world, { count = 10, radius = 80, colour = 0xffba75, intensity = 72, range = 30 } = {}) {
    this.scene = scene; this.world = world; this.radius = radius;
    this.lights = [];
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(colour, 0, range, 2);
      l.castShadow = false;
      scene.add(l);
      this.lights.push({ light: l, head: null, since: -1e9, fade: 0, from: null, target: intensity });
    }
    this.intensity = intensity;
    this.t = 0; this.next = 0;
    // four headlight spots, lent to the nearest moving traffic cars
    this.spots = [];
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.SpotLight(0xdce8ff, 0, 42, 0.45, 0.7, 1.4);
      sp.castShadow = false;
      scene.add(sp, sp.target);
      this.spots.push(sp);
    }
  }

  #traffic(traffic, x, z) {
    if (!traffic) return;
    const live = traffic.cars.filter((c) => c.live && c.mesh.visible && c.speed > 1)
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    this.spots.forEach((sp, i) => {
      const c = live[i];
      if (!c || Math.hypot(c.x - x, c.z - z) > 70) { sp.intensity = 0; return; }
      const fx = Math.cos(c.yaw), fz = -Math.sin(c.yaw), y = c.mesh.position.y;
      sp.position.set(c.x + fx * (c.spec.L * 0.5), y + 0.8, c.z + fz * (c.spec.L * 0.5));
      sp.target.position.set(c.x + fx * 26, y - 0.4, c.z + fz * 26);
      sp.target.updateMatrixWorld();
      sp.intensity = 38;
    });
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
        owned.add(best.h); free.shift();
      }
    }
    for (const s of this.lights) {
      const l = s.light;
      if (!s.head) { l.intensity = 0; continue; }
      s.fade = Math.min(1, s.fade + dt / 0.4);
      // the light sits a little below the head so the pool lands on the pavement, not the lamp
      l.position.set(s.head.x, s.head.y - 0.4, s.head.z);
      l.intensity = this.intensity * s.fade;
    }
  }
}
