/**
 * Anamorphic headlight streaks -- GTA V draws a long horizontal blue-white
 * streak sprite over very bright sources that face the camera (headlights of
 * oncoming cars), see docs/GTA-VISUALS-RESEARCH.md. One instanced Sprite for
 * the whole pool (MAX lamps), refilled every frame from the nearest oncoming
 * traffic and cruisers: two lamps per car, width by how squarely the car
 * faces the camera, gone once it has passed. Unused instances scale to zero
 * (a zero-count sprite is a WebGPU error). Night-faded through
 * `setStreakNight`; additive, routed into the emissive target so it blooms.
 *
 * Lamp geometry, checked against how each car is built (2026-09-12):
 * - every vehicle faces +X rotated by `yaw`: forward = (cos yaw, -sin yaw)
 *   (traffic.js #move, lighting.js #traffic); mesh-local +Z is the lateral
 *   (sin yaw, cos yaw).
 * - traffic: `c.mesh` sits at (c.x, ground, c.z) (traffic.js:1102) and its
 *   lamps are at local (L/2 - 0.04, bonnetY * 0.78, +-wMax * 0.62)
 *   (traffic.js:311). So the streak rides mesh.position.y + bonnetY * 0.78.
 * - hero: the group sits at ground (main.js:402) and the lenses at
 *   shell-local (0.33, 0.755, +-0.50) inside a half-turned shell offset by
 *   CG_X (model.js:203, :331) => group-local (CG_X - 0.33, 0.755, +-0.50).
 *   `car.y` is the CG, 0.62 m above the ground (main.js:400), so the lamp
 *   height is car.y + 0.135, not car.y + 0.72 (that sat above the bonnet).
 */
import * as THREE from 'three';
import { uv, uniform, vec3, vec4, instancedBufferAttribute, smoothstep, abs, float, cameraPosition } from 'three/tsl';
import { glow } from '../core/additive.js';
import { CG_X } from '../vehicle/config.js';

const MAX = 48;
const night = uniform(0);
export function setStreakNight(k) { night.value = Math.max(0, Math.min(1, k)); }

/** cos of the widest angle off the camera that still streaks (~57 deg). A car at 60 deg gets none. */
export const CUT = 0.55;

/**
 * The CPU half, pure so it is testable: where a car's two lamps are and how
 * wide its streak should be, from the car (centre x,z, yaw, lamp offsets
 * `nose` ahead of the centre and `half` either side) and the camera (cx, cz).
 * Fills `out` {x0,z0,x1,z1,w,h,a} and returns true, or returns false for no
 * streak (too close, too far, or not facing the camera). No allocation.
 */
export function streakLamps(x, z, yaw, nose, half, cx, cz, out) {
  const fx = Math.cos(yaw), fz = -Math.sin(yaw);        // forward
  const dx = cx - x, dz = cz - z, d = Math.hypot(dx, dz);
  if (d < 4 || d > 140) return false;
  const facing = (fx * dx + fz * dz) / d;               // 1 = driving straight at the camera
  if (facing < CUT) return false;
  const k = (facing - CUT) / (1 - CUT);
  /* Long and thin when it looks straight at you (~8 m at 25-60 m), a stub at
     the cut-off; under 25 m it shrinks with distance so a car passing at 6 m
     does not fill the screen. Brightness fades in over the first third of the
     facing range (no pop at the cut-off) and out over 100-140 m. */
  out.w = (1.5 + 6.5 * k * k) * Math.min(1, d / 25);
  out.h = 0.26 + 0.2 * k;
  out.a = Math.min(1, k * 3) * Math.min(1, (140 - d) / 40);
  const nx = x + fx * nose, nz = z + fz * nose;          // the nose
  const lx = -fz * half, lz = fx * half;                  // lateral = mesh-local +Z = (sin yaw, cos yaw)
  out.x0 = nx - lx; out.z0 = nz - lz;
  out.x1 = nx + lx; out.z1 = nz + lz;
  return true;
}

export class HeadlightStreaks {
  constructor(scene) {
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.sc = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2);
    this.br = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    this.pos.setUsage(THREE.DynamicDrawUsage); this.sc.setUsage(THREE.DynamicDrawUsage); this.br.setUsage(THREE.DynamicDrawUsage);
    const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false });
    /* Depth-tested so a building in front hides the streak; the sprite sits at
       the lens, recessed in its housing, so pull it 1 m toward the camera
       (glare.js does the same on lamp heads) or the car's own nose eats it. */
    const pos = instancedBufferAttribute(this.pos);
    m.positionNode = pos.add(cameraPosition.sub(pos).normalize().mul(1.0));
    m.scaleNode = instancedBufferAttribute(this.sc);
    // a horizontal streak: bright thin core, long soft falloff along x, tight along y
    const c = uv().sub(0.5);
    const along = smoothstep(float(0.5), float(0.0), abs(c.x));
    const across = smoothstep(float(0.5), float(0.0), abs(c.y).mul(2.2));
    const s = along.mul(along).mul(across).mul(across);
    const col = vec3(0.62, 0.78, 1.0).mul(s).mul(night).mul(instancedBufferAttribute(this.br)).mul(0.9);
    m.colorNode = vec4(col, 1);
    glow(m, 0.5);   // NOT the zero-normal guard: on a quad it draws black (CLAUDE.md)
    this.sprite = new THREE.Sprite(m);
    this.sprite.count = MAX;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 5;
    scene.add(this.sprite);
    this.n = 0;
    this.out = { x0: 0, z0: 0, x1: 0, z1: 0, w: 0, h: 0, a: 0 };   // reused: zero allocation per frame
  }

  #push(x, y, z, yaw, nose, half, cx, cz) {
    if (this.n > MAX - 2) return;
    const o = this.out;
    if (!streakLamps(x, z, yaw, nose, half, cx, cz, o)) return;
    const P = this.pos.array, S = this.sc.array, B = this.br.array;
    let n = this.n;
    P[n * 3] = o.x0; P[n * 3 + 1] = y; P[n * 3 + 2] = o.z0; S[n * 2] = o.w; S[n * 2 + 1] = o.h; B[n] = o.a; n++;
    P[n * 3] = o.x1; P[n * 3 + 1] = y; P[n * 3 + 2] = o.z1; S[n * 2] = o.w; S[n * 2 + 1] = o.h; B[n] = o.a; n++;
    this.n = n;
  }

  #list(list, cx, cz) {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.live || !c.mesh?.visible) continue;   // stopped cars keep their lamps: a queue at a red light facing you is the GTA shot
      const spec = c.spec;
      this.#push(c.x, c.mesh.position.y + (spec?.bonnetY ?? 1.0) * 0.78, c.z, c.yaw, (spec?.L ?? 4.4) * 0.5 - 0.04, (spec?.wMax ?? 0.9) * 0.62, cx, cz);
    }
  }

  /** Refill from traffic + police (+ the hero car when the camera looks into its lamps: the chase cam sits behind it, so facing < CUT skips it). */
  update(camera, traffic, car) {
    this.n = 0;
    const cx = camera.position.x, cz = camera.position.z;
    if (traffic) {
      if (traffic.cars) this.#list(traffic.cars, cx, cz);
      if (traffic.police) this.#list(traffic.police, cx, cz);
    }
    if (car && car.headlights) this.#push(car.x, (car.y ?? 0.62) + 0.135, car.z, car.yaw, CG_X - 0.33, 0.50, cx, cz);
    const S = this.sc.array;
    for (let i = this.n; i < MAX; i++) { S[i * 2] = 0; S[i * 2 + 1] = 0; }   // unused instances collapse to nothing
    this.pos.needsUpdate = true; this.sc.needsUpdate = true; this.br.needsUpdate = true;
  }
}
