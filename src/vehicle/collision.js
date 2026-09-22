import { roadDepth, WALK_W } from '../world/metrics.js';

/**
 * The building line sits exactly WALK_W beyond the kerb. Pull in a hair so the
 * car stops against the facade rather than in it.
 */
const BUILD_LINE = WALK_W - 0.06;

/**
 * Probe points around the hull, in body coordinates (x forward from the centre
 * of gravity, z to the left). Testing the CG alone let a 4.6m car push its nose
 * two metres into a wall before anything resisted.
 */
const HULL_PROBES = [
  [2.25, 0.0], [2.05, 0.78], [2.05, -0.78],
  [0.0, 0.88], [0.0, -0.88],
  [-2.15, 0.0], [-1.95, 0.78], [-1.95, -0.78],
];

/**
 * Cancel the part of the velocity heading into a surface, keep the tangential
 * part. bite = 1.0 is a dead stop against the normal; anything above 1 adds
 * restitution, which on a building reads as the car bouncing across the street.
 */
function absorb(car, nx, nz, bite = 1.0, px = 0, pz = 0) {
  const into = car.vx * nx + car.vz * nz;
  if (into <= 0) return 0;
  if (into > 1.2) {
    if (into > (car.impact || 0)) car.hitAt = { x: px, z: pz };
    car.impact = Math.max(car.impact || 0, into);
  }
  car.vx -= nx * into * bite;
  car.vz -= nz * into * bite;
  return into;
}

/**
 * Wall friction on the TANGENTIAL velocity, sized by how hard the hull was
 * pressed into the surface this step (a dry-friction impulse: the normal
 * impulse `absorb` removed was m*into, so tangential speed loses at most
 * MU_WALL*into, plus a little for the overlap being corrected). A 6 deg scrape
 * loses a few km/h a second; a head-on has no tangential speed and stops on the
 * normal alone. Replaces `v *= 0.88` per probe hit per 120 Hz step, which took
 * a glancing scrape at 60 km/h to a standstill in 0.05 s (review 2026-09-09).
 */
const MU_WALL = 0.35;
function scrape(car, into, pen) {
  const sp = Math.hypot(car.vx, car.vz);
  if (sp < 1e-6 || into <= 0) return;
  const loss = Math.min(sp, MU_WALL * into + pen * 0.5);
  const k = 1 - loss / sp;
  car.vx *= k; car.vz *= k;
}

/** Push the car off the building line, testing the whole hull, not one point. */
export function resolveBuildings(car) {
  const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
  const fx = cy, fz = -sy;      // forward
  const rx = sy, rz = cy;       // right

  for (let pass = 0; pass < 3; pass++) {
    let worst = 0, wx = 0, wz = 0, wpx = 0, wpz = 0;
    for (const [px, pz] of HULL_PROBES) {
      const x = car.x + fx * px + rx * pz;
      const z = car.z + fz * px + rz * pz;
      const d = roadDepth(x, z);
      if (d > worst) { worst = d; wpx = x; wpz = z; }
    }
    if (worst <= BUILD_LINE) return;

    const eps = 0.3;
    const gx = (roadDepth(wpx + eps, wpz) - roadDepth(wpx - eps, wpz)) / (2 * eps);
    const gz = (roadDepth(wpx, wpz + eps) - roadDepth(wpx, wpz - eps)) / (2 * eps);
    const L = Math.hypot(gx, gz) || 1;
    const nx = gx / L, nz = gz / L;      // points away from the road

    const push = (worst - BUILD_LINE) * 1.02;
    car.x -= nx * push;
    car.z -= nz * push;
    const into = absorb(car, nx, nz, 1.0, wpx, wpz);   // masonry does not give anything back
    car.yawRate *= 0.55;
    scrape(car, into, push);
  }
}

/**
 * Hull versus real building footprints.
 *
 * Each footprint is an oriented box. For every hull probe inside a box we find
 * the axis of least penetration and push out along it, which is what keeps a
 * car sliding along a facade instead of being ejected through the corner it
 * happened to clip. Three passes so a car wedged into an inside corner
 * resolves against both walls.
 */
export function resolveBoxes(car, boxes) {
  if (!boxes || !boxes.length) return;
  const PAD = 0.42;                     // hull radius the probe points stand for

  for (let pass = 0; pass < 3; pass++) {
    const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    const fx = cy, fz = -sy, rx = sy, rz = cy;
    let hit = false;

    for (const b of boxes) {
      /* A structure the car is driving UNDER is not in its way (2026-09-14).
         This test is otherwise a pure 2D footprint check -- it never read
         `height` or the car's y -- so every elevated thing that reported a
         solid was a wall at ground level. A bridge parapet sitting on a 7.6 m
         deck blocked the road passing beneath the bridge.
         Only boxes that declare a `baseY` are skipped: a building's footprint
         has no base to be above, and must keep blocking at every height. */
      if (b.baseY !== undefined && (car.y ?? 0) + 1.7 < b.baseY) continue;
      /* Broad phase first, trig after (2026-09-22). hw+hd >= hypot(hw, hd), so
         this L1 reject keeps every box the old circle kept and the exact
         probe-in-box test below still decides -- same contacts, same pushes.
         What it saves is cos+sin+sqrt on every box the hull cannot reach: the
         list is nearbyBuildings' 60 m window (~100-300 boxes a substep, x120
         substeps a second). Bench, scratchpad/rec/collision-bench.mjs, N=300,
         identical state hash over 60,000 steps: 18.2 -> 4.9 us per resolve. */
      const hw = b.hw + PAD, hd = b.hd + PAD;
      const rough = hw + hd + 3.2;
      if (Math.abs(b.x - car.x) > rough || Math.abs(b.z - car.z) > rough) continue;
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle);

      for (const [ppx, ppz] of HULL_PROBES) {
        const px = car.x + fx * ppx + rx * ppz;
        const pz = car.z + fz * ppx + rz * ppz;
        // into the box's own frame
        const dx = px - b.x, dz = pz - b.z;
        const lx = dx * ca + dz * sa;
        const lz = -dx * sa + dz * ca;
        if (Math.abs(lx) >= hw || Math.abs(lz) >= hd) continue;

        // least-penetration axis
        const ox = hw - Math.abs(lx), oz = hd - Math.abs(lz);
        let nlx = 0, nlz = 0, pen;
        if (ox < oz) { nlx = lx < 0 ? -1 : 1; pen = ox; }
        else { nlz = lz < 0 ? -1 : 1; pen = oz; }
        // back to world
        const nx = nlx * ca - nlz * sa;
        const nz = nlx * sa + nlz * ca;

        car.x += nx * pen;
        car.z += nz * pen;
        const into = absorb(car, -nx, -nz, 1.0, px, pz);
        car.yawRate *= 0.6;
        scrape(car, into, pen);
        hit = true;
        break;                          // one correction per box per pass
      }
    }
    if (!hit) return;
  }
}

/**
 * Car-to-car. Both hulls are approximated as three circles down their length —
 * cheap, orientation-aware, and it behaves sensibly in a row of parked cars
 * where a single bounding circle would shove you sideways into traffic.
 */
const SELF_OFFSETS = [-1.6, 0, 1.6];
const SELF_R = 0.95;

export function resolveObstacles(car, obstacles) {
  if (!obstacles || !obstacles.length) return;
  const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
  const fx = cy, fz = -sy;

  for (const o of obstacles) {
    const dxc = o.x - car.x, dzc = o.z - car.z;
    const rough = o.reach + 2.6;
    if (dxc * dxc + dzc * dzc > rough * rough) continue;

    const ofx = Math.cos(o.yaw), ofz = -Math.sin(o.yaw);
    /* The other body's velocity. A traffic car is not a wall: measuring
       "into" against the ground made a 40 km/h nudge alongside a 40 km/h car
       read as a 40 km/h crash, zeroed OUR speed along the normal (a dead stop
       in the lane), and every re-contact while catching up was another crash
       -- the "whole game rumbles when you touch a vehicle" bug (2026-09-12).
       Closing speed is relative; parked cars have none, so nothing changes
       for them. */
    const ov = (o.car && o.car.speed) || 0;
    const ovx = ofx * ov, ovz = ofz * ov;
    for (const so of SELF_OFFSETS) {
      const sx = car.x + fx * so, sz = car.z + fz * so;
      for (const oo of o.offsets) {
        const ox = o.x + ofx * oo, oz = o.z + ofz * oo;
        let dx = sx - ox, dz = sz - oz;
        let d = Math.hypot(dx, dz);
        const minD = SELF_R + o.radius;
        if (d >= minD) continue;
        if (d < 1e-4) { dx = 1; dz = 0; d = 1e-4; }
        const nx = dx / d, nz = dz / d;
        const pen = minD - d;
        // the parked car is immovable, so all of the correction lands on us
        car.x += nx * pen;
        car.z += nz * pen;
        const rvx = car.vx - ovx, rvz = car.vz - ovz;   // our velocity relative to the body we hit
        const into = -(rvx * nx + rvz * nz);              // closing speed along the contact normal
        if (into > 0) {
          /* impact is an EVENT: the closing speed this resolution cancels.
             The camera, the dents and the sparks key off it once (main.js
             decays it); a resting or sliding contact closes at ~0 and adds
             nothing after the first step. */
          if (into > 1.2) {
            if (into > (car.impact || 0)) car.hitAt = { x: sx, z: sz };
            car.impact = Math.max(car.impact || 0, into);
            /* Who you hit decides whether anyone comes looking for you -- but
               only if YOU drove into IT. `into` is relative, so a cruiser
               PIT-ramming you or traffic rear-ending you at the lights closes
               too; the ground-frame test (what the old code measured) keeps
               their contact from becoming your crime and their ram from
               costing THEIR engine (main.js damageVehicle on hitRef). */
            const ours = -(car.vx * nx + car.vz * nz);
            if (ours > 0 && into > (car.hitForce || 0)) { car.hitForce = into; car.hitTag = o.tag || 'prop'; car.hitRef = o.car || null; }   // hitRef: the traffic car behind the body, for ram damage
            if (o.car) {
              o.car.panic = 4.0;
              o.car.speed = Math.max(0, o.car.speed - into * 0.4 * (car.ramForce || 1.0));
            }
          }
          car.vx += nx * into * 1.05;    // a parked car gives a little, a wall none
          car.vz += nz * into * 1.05;
          // glancing blows should slew you, not stop you dead
          const armX = sx - car.x, armZ = sz - car.z;
          car.yawRate += (armX * nz - armZ * nx) * into * 0.05;
          // contact friction bleeds the RELATIVE velocity: riding alongside a moving car must not drag us to a halt
          car.vx = ovx + (car.vx - ovx) * 0.9; car.vz = ovz + (car.vz - ovz) * 0.9;
        }
      }
    }
  }
}
