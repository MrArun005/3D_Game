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
  constructor(scene, world, { count = 6, radius = 60, colour = 0xffba75, intensity = 60, range = 26 } = {}) {
    this.scene = scene; this.world = world; this.radius = radius;
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
    if (!traffic || !traffic.cars) return;
    let c0 = null, c1 = null, c2 = null, c3 = null;
    let d0 = 4900, d1 = 4900, d2 = 4900, d3 = 4900; // 70m squared
    const cars = traffic.cars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c.live || !c.mesh?.visible || c.speed <= 1) continue;
      const dx = c.x - x, dz = c.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < d0) {
        c3 = c2; d3 = d2;
        c2 = c1; d2 = d1;
        c1 = c0; d1 = d0;
        c0 = c; d0 = d2;
      } else if (d2 < d1) {
        c3 = c2; d3 = d2;
        c2 = c1; d2 = d1;
        c1 = c; d1 = d2;
      } else if (d2 < d2) {
        c3 = c2; d3 = d2;
        c2 = c; d2 = d2;
      } else if (d2 < d3) {
        c3 = c; d3 = d2;
      }
    }
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
    for (let i = 0; i < this.lights.length; i++) {
      const s = this.lights[i];
      const l = s.light;
      const corona = this.coronas[i];
      if (!s.head) {
        l.intensity = 0;
        if (corona) corona.visible = false;
        continue;
      }
      s.fade = Math.min(1, s.fade + dt / 0.4);
      // the light sits a little below the head so the pool lands on the pavement, not the lamp
      l.position.set(s.head.x, s.head.y - 0.4, s.head.z);
      l.intensity = this.intensity * s.fade;
      if (corona) {
        corona.position.set(s.head.x, s.head.y - 0.15, s.head.z);
        corona.visible = true;
        corona.material.opacity = 0.85 * s.fade;
      }
    }
  }
}
