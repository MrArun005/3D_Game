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
function absorb(car, nx, nz, bite = 1.0) {
  const into = car.vx * nx + car.vz * nz;
  if (into <= 0) return 0;
  if (into > 1.2) car.impact = Math.max(car.impact || 0, into);
  car.vx -= nx * into * bite;
  car.vz -= nz * into * bite;
  return into;
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
    absorb(car, nx, nz, 1.0);
    car.yawRate *= 0.55;
    car.vx *= 0.86; car.vz *= 0.86;      // masonry does not give anything back
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
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
      const hw = b.hw + PAD, hd = b.hd + PAD;
      const rough = Math.hypot(hw, hd) + 3.2;
      if (Math.abs(b.x - car.x) > rough || Math.abs(b.z - car.z) > rough) continue;

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
        absorb(car, -nx, -nz, 1.0);
        car.yawRate *= 0.6;
        car.vx *= 0.88; car.vz *= 0.88;
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
        const into = -(car.vx * nx + car.vz * nz);
        if (into > 0) {
          if (into > 1.2) {
            car.impact = Math.max(car.impact || 0, into);
            // who you hit decides whether anyone comes looking for you
            if (into > (car.hitForce || 0)) { car.hitForce = into; car.hitTag = o.tag || 'prop'; }
          }
          car.vx += nx * into * 1.05;    // a parked car gives a little, a wall none
          car.vz += nz * into * 1.05;
          // glancing blows should slew you, not stop you dead
          const armX = sx - car.x, armZ = sz - car.z;
          car.yawRate += (armX * nz - armZ * nx) * into * 0.05;
          car.vx *= 0.9; car.vz *= 0.9;
        }
      }
    }
  }
}
