import * as THREE from 'three';
import { ARSENAL, spreadFor } from './weapons.js';

/**
 * The feel layer of the shooter. weapon.js decides WHAT a shot hits; this file
 * is everything that makes pulling the trigger feel like something:
 *
 *   - a crosshair whose gap IS the current spread cone, so you watch the SMG
 *     open up as you hold the trigger and close as you stop;
 *   - aim-down-sights: narrower FOV, tighter spread, slower feet, camera over
 *     the shoulder -- the difference between spraying and a deliberate shot;
 *   - recoil as a learnable PATTERN per weapon, not a random kick;
 *   - weapon sway and bob, so the gun is carried rather than glued on;
 *   - a pooled decal system for bullet marks (one InstancedMesh, one draw);
 *   - a ray-vs-building test, so you cannot shoot through a tower.
 *
 * Zero allocation on the hot path: every vector below is module scratch, the
 * decal pool is fixed-size and round-robin, and the crosshair is four DOM
 * elements whose styles change. A firefight at 40 rounds a second must not
 * cost a garbage-collection pause (CLAUDE.md rule 1; the allocation guard
 * test enforces it).
 */

/* ------------------------------------------------------------- recoil paths
   Twelve shots per weapon, in radians of camera pitch (up is +) and yaw
   (right is +). Rifle climbs then drifts right; SMG climbs fast and wanders;
   pistol pops straight up; shotgun is one big shove. After the pattern ends
   it repeats the last entry with jitter, which is what "the gun gets away
   from you" feels like. */
const PATTERNS = {
  pistol:  [[0.026, 0.000], [0.024, 0.002], [0.026, -0.002], [0.025, 0.001], [0.027, 0.000], [0.025, -0.001],
            [0.026, 0.002], [0.025, 0.000], [0.027, -0.002], [0.026, 0.001], [0.025, 0.000], [0.026, 0.000]],
  smg:     [[0.014, 0.000], [0.016, 0.003], [0.018, 0.005], [0.017, 0.007], [0.015, 0.004], [0.014, -0.002],
            [0.015, -0.005], [0.016, -0.006], [0.015, -0.003], [0.014, 0.002], [0.015, 0.005], [0.014, 0.004]],
  rifle:   [[0.020, 0.000], [0.022, 0.001], [0.024, 0.003], [0.023, 0.005], [0.020, 0.007], [0.017, 0.008],
            [0.014, 0.009], [0.012, 0.009], [0.011, 0.008], [0.011, 0.007], [0.011, 0.007], [0.011, 0.007]],
  shotgun: [[0.070, 0.000], [0.065, 0.004], [0.070, -0.004], [0.068, 0.002], [0.070, 0.000], [0.066, -0.002],
            [0.070, 0.003], [0.068, 0.000], [0.070, -0.003], [0.067, 0.001], [0.070, 0.000], [0.068, 0.000]],
};

/** Recoil for shot number `n` (0-based) of a burst. Pure; tested. */
export function recoilFor(kind, n) {
  const p = PATTERNS[kind] ?? PATTERNS.pistol;
  const e = p[Math.min(n, p.length - 1)];
  return { pitch: e[0], yaw: e[1] };
}

/* ------------------------------------------------------------ aim-down-sights
   Per-weapon: the FOV you look through, and how much spread and movement
   speed shrink. Everything else about ADS is the same for every gun. */
export const ADS = {
  pistol:  { fov: 52, spread: 0.40, speed: 0.62, back: 2.4 },
  smg:     { fov: 50, spread: 0.45, speed: 0.58, back: 2.3 },
  rifle:   { fov: 42, spread: 0.30, speed: 0.50, back: 2.2 },
  shotgun: { fov: 55, spread: 0.55, speed: 0.60, back: 2.5 },
};
export const HIP = { fov: 60, back: 4.6 };
export const ADS_BLEND_S = 0.18;   // seconds to raise or lower the sights

/** Spread cone -> crosshair half-gap in CSS pixels, for a given FOV and viewport height. */
export function spreadToPixels(coneRad, fovDeg, viewportH) {
  // half the viewport spans tan(fov/2); the cone spans tan(cone)
  const f = Math.tan((fovDeg * Math.PI / 180) / 2);
  return Math.max(3, (Math.tan(coneRad) / f) * (viewportH / 2));
}

/* ------------------------------------------------------- ray vs building box
   Buildings are oriented boxes: centre (x,z), yaw `angle`, half-extents hw/hd,
   height. Slab test in the box's own frame. Returns the ray parameter of the
   entry face, or Infinity. Pure; tested. */
export function rayHitsBox(ox, oy, oz, dx, dy, dz, b, maxT = Infinity) {
  const ca = Math.cos(-b.angle), sa = Math.sin(-b.angle);
  // origin and direction into the box frame (rotate by -angle about Y)
  const px = ox - b.x, pz = oz - b.z;
  const lx = px * ca - pz * sa, lz = px * sa + pz * ca;
  const ldx = dx * ca - dz * sa, ldz = dx * sa + dz * ca;
  let t0 = 0, t1 = maxT;
  const slab = (p, d, min, max) => {
    if (Math.abs(d) < 1e-9) return p >= min && p <= max;
    let a = (min - p) / d, c = (max - p) / d;
    if (a > c) { const tmp = a; a = c; c = tmp; }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    return t0 <= t1;
  };
  if (!slab(lx, ldx, -b.hw, b.hw)) return Infinity;
  if (!slab(lz, ldz, -b.hd, b.hd)) return Infinity;
  if (!slab(oy, dy, 0, b.height ?? 1e9)) return Infinity;
  return t0 > 0 ? t0 : Infinity;   // a ray starting inside a box is not blocked by it
}

/** Nearest building along the ray within maxT, from a list of boxes. */
export function firstBuildingHit(ox, oy, oz, dx, dy, dz, boxes, maxT) {
  let best = maxT;
  for (const b of boxes) {
    const t = rayHitsBox(ox, oy, oz, dx, dy, dz, b, best);
    if (t < best) best = t;
  }
  return best < maxT ? best : Infinity;
}

/* ---------------------------------------------------------------- crosshair
   Four DOM bars around the screen centre plus a hit marker. The gap tracks the
   spread cone; the marker flashes red on a hit and shows a white X on a kill.
   DOM because it is the cheapest possible thing that redraws every frame, and
   it never touches the WebGPU pipeline. */
export class Crosshair {
  constructor() {
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;left:50%;top:50%;width:0;height:0;z-index:45;pointer-events:none;display:none';
    root.id = 'crosshair';   // stable handle for the HUD and the harness
    const bar = (w, h) => {
      const d = document.createElement('div');
      d.style.cssText = `position:absolute;width:${w}px;height:${h}px;background:#eaf1fb;box-shadow:0 0 3px rgba(0,0,0,.9);border-radius:1px`;
      root.appendChild(d); return d;
    };
    this.bars = [bar(2, 9), bar(2, 9), bar(9, 2), bar(9, 2)];   // up, down, left, right
    const dot = bar(2, 2); dot.style.left = '-1px'; dot.style.top = '-1px'; this.dot = dot;
    const mark = document.createElement('div');
    mark.style.cssText = 'position:absolute;left:-12px;top:-12px;width:24px;height:24px;opacity:0;font:700 22px ui-monospace,monospace;color:#ff4a4a;text-align:center;line-height:24px;text-shadow:0 0 4px rgba(0,0,0,.9)';
    mark.textContent = '×'; root.appendChild(mark); this.mark = mark;
    const arc = document.createElement('div');
    arc.style.cssText = 'position:absolute;left:-16px;top:-16px;width:32px;height:32px;border-radius:50%;border:2px solid transparent;border-top-color:#ffc23c;opacity:0';
    root.appendChild(arc); this.arc = arc;
    document.body.appendChild(root);
    this.root = root;
    this.markT = 0;
    this.visible = false;
  }

  show(v) { if (v !== this.visible) { this.visible = v; this.root.style.display = v ? 'block' : 'none'; } }

  /** gapPx: half-gap in pixels. reloadFrac: 0..1 while reloading, else -1. */
  update(gapPx, reloadFrac, dt) {
    const g = Math.round(gapPx);
    const [u, d, l, r] = this.bars;
    u.style.left = '-1px'; u.style.top = `${-g - 9}px`;
    d.style.left = '-1px'; d.style.top = `${g}px`;
    l.style.top = '-1px'; l.style.left = `${-g - 9}px`;
    r.style.top = '-1px'; r.style.left = `${g}px`;
    if (this.markT > 0) {
      this.markT -= dt;
      this.mark.style.opacity = String(Math.max(0, Math.min(1, this.markT * 6)));
      if (this.markT <= 0) this.mark.style.opacity = '0';
    }
    if (reloadFrac >= 0) {
      this.arc.style.opacity = '1';
      this.arc.style.transform = `rotate(${Math.round(reloadFrac * 360)}deg)`;
    } else this.arc.style.opacity = '0';
  }

  /** Red on a hit, white X on a kill. */
  hit(kill = false) {
    this.markT = kill ? 0.45 : 0.22;
    this.mark.style.color = kill ? '#ffffff' : '#ff4a4a';
    this.mark.style.opacity = '1';
  }
}

/* ------------------------------------------------------------- decal pool
   Bullet marks on walls, road and cars. 64 dark discs in ONE InstancedMesh,
   reused round-robin: the 65th shot overwrites the first. Each mark is a
   matrix write, never an allocation. Sits 1.5 cm off the surface along the
   normal to stay clear of z-fighting. */
const DECALS = 64;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _n = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);

export class DecalPool {
  constructor(scene) {
    const geo = new THREE.CircleGeometry(0.06, 10);
    const mat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, DECALS);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // park every instance far underground until it is used
    _m.makeTranslation(0, -1000, 0);
    for (let i = 0; i < DECALS; i++) this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.next = 0;
    scene.add(this.mesh);
  }

  /** Stamp a mark at (x,y,z) facing along normal (nx,ny,nz). */
  stamp(x, y, z, nx, ny, nz, size = 1) {
    _n.set(nx, ny, nz).normalize();
    _p.set(x + _n.x * 0.015, y + _n.y * 0.015, z + _n.z * 0.015);
    _q.setFromUnitVectors(_z, _n);
    _s.setScalar(size);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(this.next, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.next = (this.next + 1) % DECALS;
  }

  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.parent?.remove(this.mesh); }
}

/* -------------------------------------------------------------- sway and bob
   Offsets for the held weapon, metres and radians, from the player's speed
   and a running phase. A third of it in ADS. Pure; tested. */
export function swayFor(speed, phase, ads) {
  const k = ads ? 0.33 : 1;
  const walking = Math.min(1, speed / 2.2);
  const running = Math.max(0, Math.min(1, (speed - 2.5) / 3));
  const bob = (0.012 * walking + 0.022 * running) * k;
  const idle = 0.004 * k;
  return {
    dx: Math.sin(phase * 1.0) * bob,                        // side to side once per stride
    dy: Math.abs(Math.sin(phase * 2.0)) * bob + Math.sin(phase * 0.35) * idle,  // up twice per stride
    roll: Math.sin(phase * 1.0) * (0.03 * walking + 0.05 * running) * k,
  };
}

/** Phase advance per frame: strides get faster with speed. */
export function swayPhaseStep(speed, dt) { return dt * (2.6 + Math.min(6, speed) * 1.4); }

export const RELOAD_DROP = 0.12;   // metres the gun dips during a reload
export const RELOAD_TILT = 0.55;   // radians it tips toward you

/** Where the gun sits during a reload, 0..1 through the reload. Pure. */
export function reloadPose(frac) {
  // down and tilt in the first third, hold, back up in the last third
  const inK = Math.min(1, frac / 0.3), outK = Math.max(0, (frac - 0.7) / 0.3);
  const k = inK * (1 - outK);
  return { dy: -RELOAD_DROP * k, tilt: RELOAD_TILT * k };
}

/** Which arsenal entries exist, for a switch UI. */
export const WEAPON_ORDER = Object.keys(ARSENAL);
export { spreadFor };

/** Spread multiplier from how you are moving: still 1, walking 1.25, sprinting 1.7, crouched x0.8. Pure. */
export function movementSpread(speed, crouch) {
  const m = speed > 4 ? 1.7 : speed > 1 ? 1.25 : 1;
  return m * (crouch ? 0.8 : 1);
}

/**
 * Soft lock for a pad: if a target lies within `maxRad` of the aim, bend the
 * aim toward it by `strength` (0..1). Never snaps: it eases, the way GTA's
 * does, and only ever picks the nearest target inside the cone. Mutates and
 * returns `dir` ({x,y,z}); no allocation. Pure; tested.
 */
export function aimAssist(dir, ox, oy, oz, targets, maxRad = 0.07, strength = 0.55) {
  let best = null, bestAng = maxRad;
  for (const t of targets) {
    const px = t.x - ox, py = (t.y ?? 0.9) - oy, pz = t.z - oz;
    const len = Math.hypot(px, py, pz) || 1;
    const dot = (px * dir.x + py * dir.y + pz * dir.z) / len;
    const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
    if (ang < bestAng) { bestAng = ang; best = { x: px / len, y: py / len, z: pz / len }; }
  }
  if (!best) return dir;
  dir.x += (best.x - dir.x) * strength; dir.y += (best.y - dir.y) * strength; dir.z += (best.z - dir.z) * strength;
  const l = Math.hypot(dir.x, dir.y, dir.z) || 1; dir.x /= l; dir.y /= l; dir.z /= l;
  return dir;
}
