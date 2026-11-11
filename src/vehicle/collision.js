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
 * A wall contact as an IMPULSE AT THE CONTACT POINT (2026-11-11).
 *
 * The old response cancelled the centre of gravity's velocity into the wall
 * and multiplied the yaw rate by 0.6 per probe, per pass, per 120 Hz step.
 * Nothing ever turned the car: a nose that met a wall at 30 deg lost its
 * whole normal speed, kept pointing into the masonry, and the engine then
 * held it there -- 60 km/h at 20-45 deg ended at 0.0-0.3 km/h for as long as
 * the throttle was down ('walls pin the car').
 *
 * A rigid body hit off-centre rotates. With r the arm from the centre of
 * gravity to the contact, n the surface normal (pointing at the car) and K2
 * the yaw radius of gyration squared, the inelastic impulse per unit mass is
 *     j = -(vp . n) / (1 + (r x n)^2 / K2),   vp = v + w x r
 * and it changes v by j*n and the yaw rate by j*(r x n)/K2. A centred head-on
 * has r x n = 0 and is the old dead stop (no restitution: on a building that
 * reads as the car bouncing across the street); a corner hit keeps part of
 * its speed and swings the nose along the wall. It acts on velocities once
 * per contact, so it does not depend on the step length -- the per-contact
 * `yawRate *= 0.6` did.
 * Yaw is about +y: w x r = (w*rz, -w*rx), (r x n)_y = rz*nx - rx*nz -- the
 * convention resolveObstacles' glancing kick documents.
 * Returns the closing speed of the contact point (0 when it was separating).
 */
const K2 = 1.7;          // m^2: yaw radius of gyration ~1.3 m (config.js inertia / mass gives 1.33-1.42)
const W_MAX = 3.2;       // rad/s: the most yaw a contact may leave the body with
function contactImpulse(car, nx, nz, px, pz, pen) {
  const rx = px - car.x, rz = pz - car.z;
  const w = car.yawRate || 0;
  const vn = (car.vx + w * rz) * nx + (car.vz - w * rx) * nz;
  if (vn >= 0) return 0;
  const into = -vn;
  if (into > 1.2) {
    if (into > (car.impact || 0)) car.hitAt = { x: px, z: pz };
    car.impact = Math.max(car.impact || 0, into);
  }
  const rn = rz * nx - rx * nz;
  const j = into / (1 + rn * rn / K2);
  car.vx += nx * j;
  car.vz += nz * j;
  let w1 = w + j * rn / K2;
  if (Math.abs(w1) > W_MAX && Math.abs(w1) > Math.abs(w)) w1 = Math.sign(w1) * Math.max(W_MAX, Math.abs(w));
  car.yawRate = w1;
  scrape(car, nx, nz, j, pen);
  return into;
}

/**
 * Wall friction on the TANGENTIAL velocity, sized by how hard the hull was
 * pressed into the surface this step (a dry-friction impulse: the normal
 * impulse contactImpulse applied was m*j, so tangential speed loses at most
 * MU_WALL*into, plus a little for the overlap being corrected). A 6 deg scrape
 * loses a few km/h a second; a head-on has no tangential speed and stops on the
 * normal alone. Replaces `v *= 0.88` per probe hit per 120 Hz step, which took
 * a glancing scrape at 60 km/h to a standstill in 0.05 s (review 2026-09-09).
 */
const MU_WALL = 0.35;
function scrape(car, nx, nz, into, pen) {
  /* Only the part ALONG the surface. An off-centre hit leaves the centre of
     gravity moving into the wall while the body turns about the contact
     (contactImpulse); scaling the whole vector took that as 'tangential' and
     ate it (16.7 -> 0.7 m/s on a clipped corner where the impulse left 4.9). */
  const tx = -nz, tz = nx;
  const vt = car.vx * tx + car.vz * tz, sp = Math.abs(vt);
  if (sp < 1e-6 || into <= 0) return;
  const loss = Math.min(sp, MU_WALL * into + pen * 0.5) * Math.sign(vt);
  car.vx -= tx * loss; car.vz -= tz * loss;
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
    contactImpulse(car, -nx, -nz, wpx, wpz, push);   // masonry does not give anything back
  }
}

/**
 * The hull rectangle (centre cx,cz; forward f, right r; half extents HL, HW)
 * against one oriented box (centre bx,bz; its +X is (ca, sa); half extents
 * hw, hd). Returns the push-out distance (0 = apart) and leaves the normal
 * (from the box at the hull) and the contact point in _h. vx,vz is the
 * hull's velocity RELATIVE to the box, used only to choose between two
 * shallow axes.
 */
const _h = { nx: 0, nz: 0, px: 0, pz: 0 };
function boxOverlap(cx, cz, fx, fz, rx, rz, HL, HW, bx, bz, ca, sa, hw, hd, vx, vz, R = 0) {
  // hull centre and forward axis in the box's frame (l along its +X, w across)
  const hx = cx - bx, hz = cz - bz;
  const dl = hx * ca + hz * sa, dw = -hx * sa + hz * ca;
  const fl = fx * ca + fz * sa, fw = -fx * sa + fz * ca;
  const afl = Math.abs(fl), afw = Math.abs(fw);       // right is forward turned 90 deg: |r.l| = |f.w|, |r.w| = |f.l|
  // separating axes: the box's two faces...
  const o1 = hw + HL * afl + HW * afw - Math.abs(dl);
  if (o1 <= 0) return 0;
  const o2 = hd + HL * afw + HW * afl - Math.abs(dw);
  if (o2 <= 0) return 0;
  // ...and the hull's two
  const df = hx * fx + hz * fz, dr = hx * rx + hz * rz;
  const o3 = HL + hw * afl + hd * afw - Math.abs(df);
  if (o3 <= 0) return 0;
  const o4 = HW + hw * afw + hd * afl - Math.abs(dr);
  if (o4 <= 0) return 0;

  /* Least overlap; n points from the box at the car. One exception, for
     a corner CLIPPED by a hand's width: there two axes both overlap by
     centimetres (how far the nose is past the front face this step, how
     far the flank is inside the side face), and which is smaller is an
     accident of where the step landed -- 10 cm of overlap at 50 km/h
     was a dead stop or a shrug depending on the frame. When BOTH of the
     box's faces overlap by less than SLIP the one the car is closing on
     LEAST wins: it is shouldered aside, not stopped. Deeper is a crash. */
  const shallow = o1 < SLIP && o2 < SLIP;
  let pen = Infinity, nx = 0, nz = 0, best = Infinity;
  for (let i = 0; i < 4; i++) {
    const o = i === 0 ? o1 : i === 1 ? o2 : i === 2 ? o3 : o4;
    const ax = i === 0 ? ca : i === 1 ? -sa : i === 2 ? fx : rx;
    const az = i === 0 ? sa : i === 1 ? ca : i === 2 ? fz : rz;
    const sgn = (i === 0 ? dl : i === 1 ? dw : i === 2 ? df : dr) < 0 ? -1 : 1;
    /* score: the overlap itself, or for a shallow one the closing speed
       scaled well under any overlap. Only between the BOX's two faces: the
       hull's own axes separate it from this box alone, and along a wall
       built of abutting boxes (a parapet is one every 8 m) 'away from this
       box's centre along the car's side axis' can point through the next. */
    const score = i < 2 && shallow ? Math.max(0, -(vx * ax + vz * az) * sgn) * 1e-4 + o * 1e-6 : o;
    if (score < best) { best = score; pen = o; nx = ax * sgn; nz = az * sgn; }
  }
  /* A vehicle's corners are round (R > 0; a building's are not: its boxes
     abut, and a rounded seam would snag a car sliding along the row). A
     hull caught in the corner zone -- under R inside BOTH faces, and deeper
     than the SLIP shrug -- meets a quarter circle: the normal swings from
     one face to the other, so a part-overlap frontal wedges the car aside
     instead of pivoting it nose-in around a square corner and holding it. */
  if (R > 0 && o1 < R && o2 < R && !shallow) {
    const u = R - o1, v = R - o2, len = Math.hypot(u, v);
    if (len >= R) return 0;                                   // the cut-off tip of the corner
    const s1 = dl < 0 ? -1 : 1, s2 = dw < 0 ? -1 : 1;
    nx = (ca * s1 * u - sa * s2 * v) / len; nz = (sa * s1 * u + ca * s2 * v) / len;
    pen = R - len;
  }

  /* Where they touch: every hull corner inside the box and every box
     corner inside the hull, weighted by how deep it sits along n. Flat
     against a wall both corners of that side weigh the same and the
     contact is the middle of the side: no torque, and no flip-flop
     between corners as the car settles parallel. */
  const boxTop = bx * nx + bz * nz + hw * Math.abs(ca * nx + sa * nz) + hd * Math.abs(ca * nz - sa * nx);   // the box's reach along n
  const hullLow = cx * nx + cz * nz - HL * Math.abs(fx * nx + fz * nz) - HW * Math.abs(rx * nx + rz * nz);  // the hull's reach along -n
  let sw = 0, px = 0, pz = 0;
  for (let i = 0; i < 4; i++) {
    const sf = i & 1 ? HL : -HL, sr = i & 2 ? HW : -HW;
    const qx = cx + fx * sf + rx * sr, qz = cz + fz * sf + rz * sr;
    const lx = (qx - bx) * ca + (qz - bz) * sa, lz = -(qx - bx) * sa + (qz - bz) * ca;
    if (Math.abs(lx) > hw + 1e-6 || Math.abs(lz) > hd + 1e-6) continue;
    const qn = qx * nx + qz * nz, wgt = Math.min(boxTop - qn, qn - hullLow) + 1e-4;
    if (wgt > 0) { sw += wgt; px += qx * wgt; pz += qz * wgt; }
  }
  for (let i = 0; i < 4; i++) {
    const sl = i & 1 ? hw : -hw, sd = i & 2 ? hd : -hd;
    const qx = bx + ca * sl - sa * sd, qz = bz + sa * sl + ca * sd;
    const lf = (qx - cx) * fx + (qz - cz) * fz, lr = (qx - cx) * rx + (qz - cz) * rz;
    if (Math.abs(lf) > HL + 1e-6 || Math.abs(lr) > HW + 1e-6) continue;
    const qn = qx * nx + qz * nz, wgt = Math.min(boxTop - qn, qn - hullLow) + 1e-4;
    if (wgt > 0) { sw += wgt; px += qx * wgt; pz += qz * wgt; }
  }
  if (sw > 0) { px /= sw; pz /= sw; } else { px = cx; pz = cz; }   // crossed like a plus sign: no corner of either inside the other
  _h.nx = nx; _h.nz = nz; _h.px = px; _h.pz = pz;
  return pen;
}

/**
 * Hull versus real building footprints.
 *
 * Both are oriented rectangles, tested exactly (separating axes: the two
 * faces of each). The push-out is along the axis of least overlap, which is
 * what keeps a car sliding along a facade instead of being ejected through
 * the corner it happened to clip; the velocity response is contactImpulse at
 * the contact point. Three passes so a car wedged into an inside corner
 * resolves against both walls.
 *
 * Until 2026-11-11 the hull was eight POINTS, each standing for a 0.42 m
 * radius (PAD) of body. (1) The front corner probes at z = +-0.78 made the
 * nose 2.40 m wide on a 1.76 m body, and for a probe that has just crossed a
 * building's front face the least-penetration axis IS that face: passing a
 * corner with 5-20 cm of air beside the mirrors was a head-on dead stop from
 * any speed (0.35 m passed). (2) The flanks had 2 m between probes, so a box
 * corner could sit inside the doors untouched, and a thin parapet could pass
 * between two probes of a car that was turning. The rectangle is the body:
 * 4.50 x 1.80 m, no pad, no gaps.
 *
 * A body may carry its own `hull` = { front, rear, half } (metres from its
 * origin); the tank uses the default, as it used the default probes.
 */
const HULL = { front: 2.3, rear: 2.2, half: 0.9 };
const SLIP = 0.25;       // m: a corner overlap shallower than this is shouldered aside (see the axis choice)
export function resolveBoxes(car, boxes) {
  if (!boxes || !boxes.length) return;
  const H = car.hull || HULL;
  const HL = (H.front + H.rear) / 2, HW = H.half, off = (H.front - H.rear) / 2;

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
         this L1 reject keeps every box the hull can reach (3.2 > its 2.48 m
         half-diagonal) and the exact test below still decides. What it saves
         is cos+sin on every box out of reach: the list is nearbyBuildings'
         60 m window (~100-300 boxes a substep, x120 substeps a second). */
      const hw = b.hw, hd = b.hd;
      const rough = hw + hd + 3.2;
      if (Math.abs(b.x - car.x) > rough || Math.abs(b.z - car.z) > rough) continue;
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
      const pen = boxOverlap(car.x + fx * off, car.z + fz * off, fx, fz, rx, rz, HL, HW, b.x, b.z, ca, sa, hw, hd, car.vx, car.vz);
      if (pen <= 0) continue;
      const nx = _h.nx, nz = _h.nz, px = _h.px, pz = _h.pz;
      car.x += nx * pen;
      car.z += nz * pen;
      contactImpulse(car, nx, nz, px + nx * pen, pz + nz * pen, pen);
      hit = true;
    }
    if (!hit) return;
  }
}

/**
 * Car-to-car, and car-to-prop.
 *
 * A VEHICLE (two or more offsets down its length) is a rectangle: half-length
 * = its furthest offset + radius - 0.1, half-width = radius - 0.08 -- and so
 * is ours (HULL), tested exactly as against a building (boxOverlap), one
 * contact per body. A PROP (one offset) is a circle against our rectangle.
 *
 * Until 2026-11-11 both hulls were three CIRCLES, every pair tested, every
 * step. (1) A flank made of circles is scalloped and a nose made of one is a
 * wedge: grazing a parked car by 5 cm at 60 km/h was a 4.3 m/s 'impact' with
 * a 2.6 m/s sideways kick; with 0.2 m of overlap the car was thrown 7.5 m
 * aside in 3 s. (2) Every contacting pair multiplied the relative velocity
 * by 0.9 ('contact friction'), up to nine times a step at 120 Hz. Now a
 * graze under SLIP is shouldered aside along the flank, friction is dry
 * friction sized by the normal impulse (as on walls), and the impulse acts
 * at the contact point with its lever arm, so an angled hit turns the car
 * along what it hit instead of holding it nose-in.
 */
const MU_CAR = 0.3;      // paint on paint
const CORNER_R = 0.85;   // m: the corner radius of another vehicle's body (boxOverlap): its ends are nearly half-round, as the circles they replace were
const K2_CAR = 3.0;      // m^2: softer than the wall's K2 on purpose -- clipping a parked car should slew the nose, not spin the car

export function resolveObstacles(car, obstacles) {
  if (!obstacles || !obstacles.length) return;
  const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
  const fx = cy, fz = -sy, rx = sy, rz = cy;
  const H = car.hull || HULL;
  const HL = (H.front + H.rear) / 2, HW = H.half, off = (H.front - H.rear) / 2;

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
    const cx = car.x + fx * off, cz = car.z + fz * off;              // hull centre
    let pen, nx, nz, px, pz;                                         // n: from them to us; p: the contact point
    const offs = o.offsets;
    if (offs.length > 1) {
      let lo = offs[0], hi = offs[0];
      for (let i = 1; i < offs.length; i++) { if (offs[i] < lo) lo = offs[i]; if (offs[i] > hi) hi = offs[i]; }
      const mid = (lo + hi) / 2;
      pen = boxOverlap(cx, cz, fx, fz, rx, rz, HL, HW, o.x + ofx * mid, o.z + ofz * mid, ofx, ofz,
        (hi - lo) / 2 + o.radius - 0.1, o.radius - 0.08, car.vx - ovx, car.vz - ovz, CORNER_R);
      if (pen <= 0) continue;
      nx = _h.nx; nz = _h.nz; px = _h.px; pz = _h.pz;
    } else {
      // a circle against the hull: the nearest point of the rectangle to its centre
      const ox = o.x + ofx * offs[0], oz = o.z + ofz * offs[0];
      const lf = (ox - cx) * fx + (oz - cz) * fz, lr = (ox - cx) * rx + (oz - cz) * rz;
      const qf = Math.max(-HL, Math.min(HL, lf)), qr = Math.max(-HW, Math.min(HW, lr));
      const ef = lf - qf, er = lr - qr, d = Math.hypot(ef, er);
      if (d >= o.radius) continue;
      if (d > 1e-6) {                                                // centre outside the body
        pen = o.radius - d;
        nx = -(fx * ef + rx * er) / d; nz = -(fz * ef + rz * er) / d;
      } else {                                                       // centre inside it: out through the nearest side
        const gf = HL - Math.abs(lf), gr = HW - Math.abs(lr);
        if (gf < gr) { const s = lf < 0 ? 1 : -1; nx = fx * s; nz = fz * s; pen = gf + o.radius; }
        else { const s = lr < 0 ? 1 : -1; nx = rx * s; nz = rz * s; pen = gr + o.radius; }
      }
      px = cx + fx * qf + rx * qr; pz = cz + fz * qf + rz * qr;
    }
    // the other body is immovable in position, so all of the correction lands on us
    car.x += nx * pen;
    car.z += nz * pen;
    px += nx * pen; pz += nz * pen;
    const ax = px - car.x, az = pz - car.z;                          // lever arm
    const w = car.yawRate || 0;
    const into = -((car.vx - ovx + w * az) * nx + (car.vz - ovz - w * ax) * nz);   // closing speed of the contact point, relative to the body we hit
    if (into <= 0) continue;
    /* impact is an EVENT: the closing speed this resolution cancels.
       The camera, the dents and the sparks key off it once (main.js
       decays it); a resting or sliding contact closes at ~0 and adds
       nothing after the first step. */
    if (into > 1.2) {
      if (into > (car.impact || 0)) car.hitAt = { x: px, z: pz };
      car.impact = Math.max(car.impact || 0, into);
      /* Who you hit decides whether anyone comes looking for you -- but
         only if YOU drove into IT. `into` is relative, so a cruiser
         PIT-ramming you or traffic rear-ending you at the lights closes
         too; the ground-frame test (what the old code measured) keeps
         their contact from becoming your crime and their ram from
         costing THEIR engine (main.js damageVehicle on hitRef). */
      const ours = -(car.vx * nx + car.vz * nz);
      if (ours > 0 && into > (car.hitForce || 0)) { car.hitForce = into; car.hitTag = o.tag || 'prop'; car.hitRef = o.car || null; }   // hitRef: the traffic car behind the body, for ram damage
      if (o.car) o.car.panic = 4.0;
    }
    /* A traffic car takes its part of the hit along its own path (it is a
       path follower: one speed, along its heading). al = how much of the
       normal lies along its travel: -1 = we are behind it, pushing; +1 = it
       runs into us; 0 = a side hit.
       From BEHIND it is shoved forward by half of the closing speed and we
       lose only the other half (two cars of a mass, no bounce). Until
       2026-11-11 a hit from any direction SLOWED it and we lost everything:
       rear-end a 40 km/h car at 60 with the throttle down and both were
       doing 16 km/h. Head-on and side hits slow it as before (0.4 of the
       closing speed, x ramForce: the PIT), above the 1.2 m/s event line. */
    let share = 1;                                                    // the part of the closing speed WE lose
    if (o.car) {
      const al = nx * ofx + nz * ofz;
      const ram = car.ramForce || 1.0;
      /* ...up to half as fast again as it cruises: it steers on rails, and a
         follower shoved round its corners at any speed we can reach is not a
         car any more. Past that it is as immovable as it used to be. */
      const top = (o.car.cruise ?? ov) * 1.5 + 2;
      if (al < -0.7) {
        const give = Math.max(0, Math.min(0.6, 0.5 * ram, (top - ov) / into));
        o.car.speed += into * give;
        o.car.shoved = 0.8;                                           // s: traffic.js lets a shoved car roll on instead of braking back into our bumper
        share = 1 - give;
      } else if (into > 1.2) {
        o.car.speed = Math.max(0, o.car.speed - into * 0.4 * ram);
      }
    }
    /* The impulse acts at the contact, so a glancing blow slews the car
       away from what it clipped instead of stopping it dead: yaw gains
       j * (arm x n)_y / K2, + = nose left (the sign was once the negative
       and wrapped the car round the obstacle: 2026-09-23, test/contact). */
    const rn = az * nx - ax * nz;
    const j = into * share / (1 + rn * rn / K2_CAR);
    const e = share < 1 ? 1 : 1.05;                                   // a parked car gives a little, a wall none; a shoved car has already taken its half
    car.vx += nx * j * e;
    car.vz += nz * j * e;
    let w1 = w + j * rn / K2_CAR;
    if (Math.abs(w1) > W_MAX && Math.abs(w1) > Math.abs(w)) w1 = Math.sign(w1) * Math.max(W_MAX, Math.abs(w));
    car.yawRate = w1;
    // contact friction on the RELATIVE tangential velocity, sized by the normal impulse: riding alongside a moving car must not drag us to a halt
    const tx = -nz, tz = nx;
    const vt = (car.vx - ovx) * tx + (car.vz - ovz) * tz, sp = Math.abs(vt);
    if (sp > 1e-6) {
      const loss = Math.min(sp, MU_CAR * j) * Math.sign(vt);
      car.vx -= tx * loss; car.vz -= tz * loss;
    }
  }
}
