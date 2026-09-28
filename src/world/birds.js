import * as THREE from 'three';
import {
  positionGeometry, attribute, instancedDynamicBufferAttribute, time, vec3, float, sin, cos, abs, mix, smoothstep, select,
} from 'three/tsl';
import { mulberry32 } from '../core/rng.js';

/**
 * City birds (2026-09-28): pigeons on the pavements that lift off when you
 * come close, gulls wheeling over the river and the harbour, and now and then
 * a skein crossing high over the roofs.
 *
 * ONE draw for every bird: a Mesh on an InstancedBufferGeometry, ~16
 * triangles a bird. Each instance carries (x, y, z, yaw), (flap phase, flap
 * rate, flap amplitude, wing fold) and (scale, bank, kind); the VERTEX stage
 * folds, flaps, banks and places the wings from those -- the CPU only moves
 * one point per bird a frame (a few hundred floats uploaded), nothing per
 * vertex. Every choice is seeded (core/rng.js mulberry32).
 *
 * The logic that decides behaviour is pure and exported for the tests:
 * `fleeRadius`, `threatened`, `pickRoost`, `flockLayout`, `skeinLayout`.
 */

export const KIND = { pigeon: 0, gull: 1, skein: 2 };

/** How close a threat may come before a flock goes up: walking 5 m, a car at 50 km/h ~11 m, capped at 18 m. */
export function fleeRadius(speed = 0) {
  return 5 + Math.min(Math.abs(speed), 29) * 0.45;
}

/** True when any threat {x, z, speed} is inside its flee radius of (x, z). */
export function threatened(x, z, threats) {
  for (const t of threats) {
    if (!t) continue;
    const r = fleeRadius(t.speed);
    const dx = t.x - x, dz = t.z - z;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

/**
 * A pavement spot for a flock, seeded: `rnd` is a mulberry32 stream, the
 * point lands `minR..maxR` from (cx, cz), and `ok(x, z)` (pavement, not water)
 * must accept it. Null after `tries` misses -- the caller keeps the flock
 * where it is.
 */
export function pickRoost(rnd, cx, cz, ok, minR = 45, maxR = 130, tries = 12) {
  for (let i = 0; i < tries; i++) {
    const a = rnd() * Math.PI * 2, r = minR + rnd() * (maxR - minR);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (ok(x, z)) return { x, z };
  }
  return null;
}

/** Offsets of `n` birds pecking round a roost: a loose seeded scatter inside `r` metres. */
export function flockLayout(rnd, n, r = 2.6) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r;
    out.push([Math.cos(a) * d, Math.sin(a) * d]);
  }
  return out;
}

/** A skein's V: bird i's (back, side) offset in metres behind the leader. */
export function skeinLayout(n, gap = 3.2) {
  const out = [[0, 0]];
  for (let i = 1; i < n; i++) {
    const rank = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
    out.push([rank * gap, side * rank * gap * 0.8]);
  }
  return out;
}

/* --- the bird mesh: body + two wings, two panels each so the tip can bend ---
   +X is forward (CLAUDE.md), wings span Z. Attribute `aWing` is 0 on the body
   and the fraction of the span (0 root .. 1 tip) on a wing, so the shader
   knows what to flap and how far. UVs: u along the body, v across the span. */
function birdGeometry() {
  const P = [], W = [], UV = [], I = [];
  const v = (x, y, z, w) => { P.push(x, y, z); W.push(w); UV.push(x + 0.5, z * 0.5 + 0.5); return W.length - 1; };
  // body: a slim double pyramid, nose to tail
  const nose = v(0.2, 0.0, 0, 0), tail = v(-0.26, 0.01, 0, 0);
  const top = v(0.0, 0.06, 0, 0), bot = v(0.0, -0.05, 0, 0), l = v(0.0, 0, 0.05, 0), r = v(0.0, 0, -0.05, 0);
  for (const [a, b] of [[top, l], [l, bot], [bot, r], [r, top]]) { I.push(nose, a, b); I.push(tail, b, a); }
  // tail fan
  const t1 = v(-0.34, 0.01, 0.06, 0), t2 = v(-0.34, 0.01, -0.06, 0);
  I.push(tail, t1, t2);
  // wings: root chord at x -0.06..0.08, elbow at 0.55 span, swept tip
  for (const s of [1, -1]) {
    const r0 = v(0.08, 0.02, 0.04 * s, 0), r1 = v(-0.08, 0.02, 0.04 * s, 0);
    const e0 = v(0.06, 0.02, 0.24 * s, 0.55), e1 = v(-0.1, 0.02, 0.22 * s, 0.55);
    const tip = v(-0.08, 0.02, 0.42 * s, 1);
    I.push(r0, e0, r1, r1, e0, e1, e0, tip, e1);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(P.map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(W, 1));
  g.setIndex(I);
  return g;
}

function birdMaterial(iPos, iAnim, iLook) {
  const mat = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
  mat.name = 'birds';
  const pos = instancedDynamicBufferAttribute(iPos);    // x, y, z, yaw
  const anim = instancedDynamicBufferAttribute(iAnim);  // phase, rate, amp, fold (1 spread .. 0 folded)
  const look = instancedDynamicBufferAttribute(iLook);  // scale, bank, kind, -
  const w = attribute('aWing', 'float');
  const p = positionGeometry;
  // fold: a perched bird's wings lie along its back
  const z0 = p.z.mul(mix(float(0.18), float(1), anim.w));
  const x0 = p.x.sub(w.mul(float(1).sub(anim.w)).mul(0.12));
  // flap: the wing turns about the body axis, the outer panel a little further
  const a = sin(time.mul(anim.y).add(anim.x)).mul(anim.z).mul(w.mul(0.45).add(0.75)).mul(anim.w);
  const span = abs(z0);
  const y1 = p.y.add(span.mul(sin(a)));
  const z1 = z0.mul(cos(a));
  // bank about the body axis, then yaw, then scale and place
  const cb = cos(look.y), sb = sin(look.y);
  const y2 = y1.mul(cb).sub(z1.mul(sb)), z2 = y1.mul(sb).add(z1.mul(cb));
  const cy = cos(pos.w), sy = sin(pos.w);
  const x3 = x0.mul(cy).add(z2.mul(sy)), z3 = x0.mul(sy).negate().add(z2.mul(cy));
  mat.positionNode = vec3(x3, y2, z3).mul(look.x).add(pos.xyz);
  // plumage: pigeon slate with a darker tip and pale bar; gull white with grey mantle and black tips
  const pigeon = mix(vec3(0.32, 0.34, 0.38), vec3(0.12, 0.12, 0.14), smoothstep(0.7, 0.95, w));
  const gullBack = mix(vec3(0.86, 0.87, 0.88), vec3(0.55, 0.58, 0.62), smoothstep(0.05, 0.3, w));
  const gull = mix(gullBack, vec3(0.08, 0.08, 0.09), smoothstep(0.82, 0.97, w));
  mat.colorNode = select(look.z.lessThan(0.5), pigeon, gull);
  return mat;
}

/**
 * @param scene
 * @param district  a District (tarmacDepth, inOpenWater, elevationAt, data.water) or null
 * @param opts      { count: pool size (the quality preset's `birds`), seed }
 */
export function createBirds(scene, district, { count = 96, seed = 0xb1d5 } = {}) {
  const N = Math.max(0, Math.floor(count));
  if (!N) return null;
  const rnd = mulberry32(seed);

  // the pool: 55% pigeons (flocks of 7), 30% gulls, the rest one skein
  const nSkein = Math.min(9, Math.max(0, Math.round(N * 0.12)));
  const nGull = Math.round(N * 0.3);
  const FLOCK = 7;
  const nFlock = Math.max(0, Math.floor((N - nSkein - nGull) / FLOCK));
  const total = nFlock * FLOCK + nGull + nSkein;

  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(total * 4), 4);
  const iAnim = new THREE.InstancedBufferAttribute(new Float32Array(total * 4), 4);
  const iLook = new THREE.InstancedBufferAttribute(new Float32Array(total * 4), 4);
  for (const a of [iPos, iAnim, iLook]) a.setUsage(THREE.DynamicDrawUsage);
  const geo = birdGeometry();
  geo.setAttribute('iPos', iPos);
  geo.setAttribute('iAnim', iAnim);
  geo.setAttribute('iLook', iLook);
  geo.instanceCount = total;
  const mat = birdMaterial(iPos, iAnim, iLook);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'birds';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  scene.add(mesh);

  const pave = (x, z) => {
    if (!district) return true;
    if (district.inOpenWater?.(x, z)) return false;
    const d = district.tarmacDepth?.(x, z);
    return d === undefined || (d > 1.2 && d < 5.5);
  };
  const groundY = (x, z) => (district?.elevationAt ? district.elevationAt(x, z) : 0) + 0.15;

  // water points gulls can wheel over: the river line and a coarse sample of the bay
  const waterPts = [];
  const W = district?.data?.water;
  if (W?.river?.points) W.river.points.forEach((p, i) => { if (i % 3 === 0) waterPts.push(p); });
  if (W?.bay?.length && district.inOpenWater) {
    const xs = W.bay.map((p) => p[0]), zs = W.bay.map((p) => p[1]);
    for (let x = Math.min(...xs); x < Math.max(...xs); x += 90) for (let z = Math.min(...zs); z < Math.max(...zs); z += 90) {
      if (district.inOpenWater(x, z)) waterPts.push([x, z]);
    }
  }

  // --- state ---
  const birds = [];
  for (let i = 0; i < total; i++) birds.push({ x: 0, y: -999, z: 0, yaw: 0, bank: 0, flap: 0, rate: 0, amp: 0, fold: 1, scale: 0, kind: 0, vy: 0, t: 0, phase: rnd() * 6.283 });
  const flocks = [];
  for (let f = 0; f < nFlock; f++) {
    const members = birds.slice(f * FLOCK, (f + 1) * FLOCK);
    const offs = flockLayout(rnd, FLOCK);
    members.forEach((b, k) => { b.kind = KIND.pigeon; b.ox = offs[k][0]; b.oz = offs[k][1]; b.delay = rnd() * 0.35; b.scale = 0.95 + rnd() * 0.15; });
    flocks.push({ members, mode: 'none', x: 0, z: 0, y: 0, t: 0, fx: 0, fz: 0, cx: 0, cz: 0, alt: 0, ang: rnd() * 6.283 });
  }
  const gulls = birds.slice(nFlock * FLOCK, nFlock * FLOCK + nGull).map((b) => {
    b.kind = KIND.gull; b.scale = 2.0 + rnd() * 0.5;
    return { b, cx: 0, cz: 0, r: 20 + rnd() * 35, alt: 7 + rnd() * 16, ang: rnd() * 6.283, w: (0.16 + rnd() * 0.1) * (rnd() < 0.5 ? 1 : -1), beat: rnd() * 10, placed: false };
  });
  const skein = { members: birds.slice(nFlock * FLOCK + nGull), active: false, wait: 20 + rnd() * 40, t: 0, x: 0, z: 0, dx: 1, dz: 0, alt: 70 };
  const V = skeinLayout(skein.members.length);
  skein.members.forEach((b) => { b.kind = KIND.skein; b.scale = 1.9; });

  const settle = (fl, x, z) => {
    fl.mode = 'ground'; fl.x = x; fl.z = z; fl.y = groundY(x, z); fl.t = 0;
    for (const b of fl.members) { b.x = x + b.ox; b.z = z + b.oz; b.y = fl.y; b.fold = 0; b.amp = 0; b.yaw = rnd() * 6.283; b.bank = 0; b.hop = 0; }
  };

  const write = () => {
    const P = iPos.array, A = iAnim.array, L = iLook.array;
    for (let i = 0; i < total; i++) {
      const b = birds[i], k = i * 4;
      P[k] = b.x; P[k + 1] = b.y; P[k + 2] = b.z; P[k + 3] = b.yaw;
      A[k] = b.phase; A[k + 1] = b.rate; A[k + 2] = b.amp; A[k + 3] = b.fold;
      L[k] = b.y < -900 ? 0 : b.scale; L[k + 1] = b.bank; L[k + 2] = b.kind === KIND.pigeon ? 0 : 1; L[k + 3] = 0;
    }
    iPos.needsUpdate = iAnim.needsUpdate = iLook.needsUpdate = true;
  };
  write();

  let clock = 0;
  return {
    mesh,
    count: total,
    /** px, pz: where the player is (car or on foot); speed in m/s; extra: more threats [{x, z, speed}]. */
    update(dt, px, pz, speed = 0, extra = null) {
      dt = Math.min(dt, 0.1);
      clock += dt;
      const threats = extra ? [{ x: px, z: pz, speed }, ...extra] : [{ x: px, z: pz, speed }];

      // --- pigeons ---
      for (const fl of flocks) {
        const far = Math.hypot(fl.x - px, fl.z - pz);
        if (fl.mode === 'none' || (fl.mode === 'ground' && far > 190)) {
          const r = pickRoost(rnd, px, pz, pave, 60, 150);
          if (r) settle(fl, r.x, r.z);
          else continue;
        }
        if (fl.mode === 'ground') {
          fl.t += dt;
          for (const b of fl.members) {
            // peck and shuffle: a hop now and then, the head-bob is the flap rate at zero amplitude
            b.hop = Math.max(0, (b.hop || 0) - dt);
            if (rnd() < dt * 0.25) { b.hop = 0.25; b.yaw += (rnd() - 0.5) * 2; }
            if (b.hop > 0) { b.x += Math.cos(b.yaw) * dt * 1.2; b.z -= Math.sin(b.yaw) * dt * 1.2; }
            b.y = fl.y + (b.hop > 0 ? Math.sin((b.hop / 0.25) * Math.PI) * 0.08 : 0);
            b.fold = 0; b.amp = 0; b.rate = 0;
          }
          if (threatened(fl.x, fl.z, threats)) {
            // up and away from whatever is nearest
            let best = threats[0], bd = Infinity;
            for (const t of threats) { const d = Math.hypot(t.x - fl.x, t.z - fl.z); if (d < bd) { bd = d; best = t; } }
            const L = bd || 1;
            fl.fx = (fl.x - best.x) / L || 1; fl.fz = (fl.z - best.z) / L || 0;
            fl.mode = 'flee'; fl.t = 0; fl.alt = 9 + rnd() * 8;
            for (const b of fl.members) { b.vy = 0; b.t = -b.delay; }
          }
        } else if (fl.mode === 'flee' || fl.mode === 'circle') {
          fl.t += dt;
          if (fl.mode === 'flee' && fl.t > 2.2) {
            fl.mode = 'circle'; fl.t = 0;
            fl.cx = fl.x + fl.fx * 18; fl.cz = fl.z + fl.fz * 18;
          }
          if (fl.mode === 'circle') fl.ang += dt * 0.45;
          for (const b of fl.members) {
            b.t += dt;
            if (b.t < 0) continue;   // the staggered start: not every bird goes at once
            let tx, tz, ty;
            if (fl.mode === 'flee') { tx = b.x + fl.fx * 7; tz = b.z + fl.fz * 7; ty = fl.y + Math.min(fl.alt, b.t * 5.5); }
            else {
              const r = 16 + b.ox * 1.5;
              tx = fl.cx + Math.cos(fl.ang + b.oz * 0.08) * r; tz = fl.cz + Math.sin(fl.ang + b.oz * 0.08) * r; ty = fl.y + fl.alt + b.oz;
            }
            const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz) || 1, sp = Math.min(9, d * 2);
            b.x += (dx / d) * sp * dt; b.z += (dz / d) * sp * dt;
            b.y += (ty - b.y) * Math.min(1, dt * 2.5);
            const yaw = Math.atan2(-dz, dx);
            b.bank += (THREE.MathUtils.euclideanModulo(yaw - b.yaw + Math.PI, Math.PI * 2) - Math.PI) * 0.4 - b.bank * Math.min(1, dt * 3);
            b.bank = Math.max(-0.7, Math.min(0.7, b.bank));
            b.yaw = yaw;
            b.fold = Math.min(1, b.fold + dt * 6); b.rate = fl.mode === 'flee' ? 24 : 15; b.amp = fl.mode === 'flee' ? 1.0 : 0.7;
          }
          // land again once the circling is done and the coast is clear
          if (fl.mode === 'circle' && fl.t > 7) {
            const r = pickRoost(rnd, fl.cx, fl.cz, pave, 25, 70);
            if (r && !threatened(r.x, r.z, threats)) { fl.mode = 'land'; fl.t = 0; fl.x = r.x; fl.z = r.z; fl.y = groundY(r.x, r.z); }
            else fl.t = 4;
          }
        } else if (fl.mode === 'land') {
          fl.t += dt;
          let down = 0;
          for (const b of fl.members) {
            const tx = fl.x + b.ox, tz = fl.z + b.oz;
            const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
            const sp = Math.min(8, d * 1.5 + 0.5);
            if (d > 0.05) { b.x += (dx / d) * Math.min(d, sp * dt); b.z += (dz / d) * Math.min(d, sp * dt); b.yaw = Math.atan2(-dz, dx); }
            b.y += (fl.y - b.y) * Math.min(1, dt * (d < 6 ? 3 : 0.8));
            b.bank *= 0.9; b.rate = 11; b.amp = d < 3 ? 1.1 : 0.4;
            if (d < 0.2 && b.y - fl.y < 0.1) down++;
          }
          if (down === fl.members.length || fl.t > 12) settle(fl, fl.x, fl.z);
        }
      }

      // --- gulls: wheel over the nearest water, gliding, a few beats now and then ---
      if (gulls.length && waterPts.length) {
        let near = null, nd = Infinity;
        for (const p of waterPts) { const d = (p[0] - px) ** 2 + (p[1] - pz) ** 2; if (d < nd) { nd = d; near = p; } }
        const show = nd < 700 * 700;
        gulls.forEach((g, i) => {
          const b = g.b;
          if (!show) { b.y = -999; g.placed = false; return; }
          if (!g.placed || Math.hypot(g.cx - near[0], g.cz - near[1]) > 400) {
            // spread over the water near the player: jitter each gull's centre round the nearest point
            const a = (i / gulls.length) * 6.283 + rnd() * 0.5;
            g.cx = near[0] + Math.cos(a) * (30 + rnd() * 90); g.cz = near[1] + Math.sin(a) * (30 + rnd() * 90);
            g.placed = true;
          }
          g.ang += g.w * dt * (1 + 0.2 * Math.sin(clock * 0.3 + i));
          const x = g.cx + Math.cos(g.ang) * g.r, z = g.cz + Math.sin(g.ang) * g.r;
          const y = -2.6 + g.alt + Math.sin(clock * 0.4 + i) * 2;
          b.yaw = Math.atan2(-(Math.cos(g.ang) * g.w), -Math.sin(g.ang) * g.w);
          b.x = x; b.y = y; b.z = z;
          b.bank = -Math.sign(g.w) * 0.35;
          g.beat -= dt;
          if (g.beat < -1.6) g.beat = 4 + rnd() * 8;
          b.fold = 1; b.rate = 8; b.amp = g.beat < 0 ? 0.8 : 0.06;   // a glide, then a burst of beats
        });
      } else for (const g of gulls) g.b.y = -999;

      // --- the skein: every 30-90 s a V crosses high over the player ---
      if (skein.members.length) {
        if (!skein.active) {
          skein.wait -= dt;
          for (const b of skein.members) b.y = -999;
          if (skein.wait <= 0) {
            const a = rnd() * 6.283, off = (rnd() - 0.5) * 160;
            skein.dx = Math.cos(a); skein.dz = Math.sin(a);
            skein.x = px - skein.dx * 450 - skein.dz * off; skein.z = pz - skein.dz * 450 + skein.dx * off;
            skein.alt = 55 + rnd() * 30; skein.t = 0; skein.active = true;
          }
        } else {
          skein.t += dt;
          skein.x += skein.dx * 13 * dt; skein.z += skein.dz * 13 * dt;
          const yaw = Math.atan2(-skein.dz, skein.dx);
          skein.members.forEach((b, i) => {
            const [back, side] = V[i];
            b.x = skein.x - skein.dx * back - skein.dz * side;
            b.z = skein.z - skein.dz * back + skein.dx * side;
            b.y = skein.alt + Math.sin(clock * 0.7 + i) * 0.4;
            b.yaw = yaw; b.bank = 0; b.fold = 1; b.rate = 9; b.amp = 0.55;
          });
          if (skein.t > 70) { skein.active = false; skein.wait = 30 + rnd() * 60; }
        }
      }
      write();
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
    },
  };
}
