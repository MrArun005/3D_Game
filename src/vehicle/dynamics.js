import { V, WHEELBASE, WHEEL_R } from './config.js';
import { surfaceAt, LANE, groundHeightAt } from '../world/metrics.js';
import { resolveBoxes, resolveBuildings, resolveObstacles } from './collision.js';

/** Flat-ish turbo four. Nm against rpm, with a taper into the limiter. */
export function engineTorque(rpm) {
  if (rpm < 500) return 0;
  const r = Math.max(600, Math.min(V.redline, rpm));
  const t =
    120 +
    250 * Math.exp(-(((r - 3200) / 2200) ** 2)) +
    90 * Math.exp(-(((r - 5200) / 1800) ** 2));
  return r > V.redline - 250 ? t * Math.max(0, (V.redline - r) / 250) : t;
}

/**
 * Simplified Pacejka.
 * The 2B/(1+B^2) rise peaks at B=1 but then decays to zero, which would let a
 * spinning wheel escape for ever. Real rubber keeps sliding friction, so past
 * the peak this blends into a plateau at 82% of available grip.
 * 2026-09-09: the plateau was 0.72 with the blend over B 1..5. That is a
 * 28% cliff the moment a tyre passes its peak; with the rear axle no
 * stiffer than the front, the rear fell off it first and a coast at 80 km/h
 * with full lock spun 179 deg in 2 s (node sim). 0.82 over B 1..7 is the
 * gentler post-peak curve of a road tyre and lets the car drift instead.
 */
export function tyreForce(slip, stiffness, load, mu) {
  const B = stiffness * slip;
  const aB = Math.abs(B);
  const peak = (2 * B) / (1 + B * B);
  const slide = (B < 0 ? -1 : 1) * 0.82;
  const k = Math.max(0, Math.min(1, (aB - 1) / 6));
  return (peak * (1 - k) + slide * k) * mu * load;
}

export function createCarState() {
  const car = {
    x: 0, z: 0, yaw: 0,
    vx: 0, vz: 0, yawRate: 0,
    rpm: V.idle, gear: 2, gearTimer: 0, holdGear: false,
    wheelW: [0, 0, 0, 0],            // FL FR RL RR
    flat: [0, 0, 0, 0],              // 0..1 per wheel, written by main from the model; a flat has ~55% of the grip
    wet: 0,                          // 0..1 rain on the road (main, from weather.amount): up to 28% less grip everywhere
    steer: 0, steerTarget: 0,
    throttle: 0, brake: 0, hand: 0,
    pitch: 0, roll: 0, heave: 0,
    y: WHEEL_R + V.restLength, vy: 0, pitchRate: 0, rollRate: 0,
    suspension: [0, 0, 0, 0], airborne: false,
    slip: 0, offRoad: 0, kerb: 0,
    wantsForward: false, wantsReverse: false,
    speed: 0, fwdSpeed: 0, lastAx: 0, lastAy: 0,
    headlights: true, impact: 0,
  };
  return car;
}

export function resetCar(car) {
  const ox = car.x ?? 2351.5, oz = car.z ?? 1356.0, oyaw = car.yaw ?? (-Math.PI / 2 - 0.03);
  Object.assign(car, {
    x: ox, z: oz, yaw: oyaw, vx: 0, vz: 0, yawRate: 0,
    rpm: V.idle, gear: 2, gearTimer: 0, steer: 0, pitch: 0, roll: 0, heave: 0,
    speed: 0, fwdSpeed: 0, lastAx: 0, lastAy: 0,
    throttle: 0, brake: 0, hand: 0, slip: 0, offRoad: 0, kerb: 0,
    wantsForward: false, wantsReverse: false, impact: 0,
  });
  car.wheelW = [0, 0, 0, 0];
}

const DRIVEN = [2, 3];   // rear-wheel drive

export function stepVehicle(car, dt) {
  // --- Task 1.3: steering curve by speed (6 rad/s at rest, 2.5 at 120 km/h, 1.5x return-to-centre) ---
  const speed = Math.hypot(car.vx, car.vz);
  const speedNorm = Math.min(1, Math.max(0, speed / 33.3)); // 0 to 120 km/h (33.3 m/s)
  const limit = V.steerMax * (1.0 - 0.68 * speedNorm);
  const returning = (car.steerTarget === 0) || (Math.sign(car.steerTarget) !== Math.sign(car.steer));
  const steerRate = (6.0 - 3.5 * speedNorm) * (returning ? 1.5 : 1.0) * (car.steerBoost || 1.0);
  car.steer += (car.steerTarget * limit - car.steer) * Math.min(1, dt * steerRate);

  const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
  const fwd = { x: cy, z: -sy };
  const rgt = { x: sy, z: cy };
  let u = car.vx * fwd.x + car.vz * fwd.z;   // longitudinal
  let v = car.vx * rgt.x + car.vz * rgt.z;   // lateral
  const r = car.yawRate;

  // --- where each corner sits ---
  const offsets = [
    [V.a, -V.track / 2], [V.a, V.track / 2],
    [-V.b, -V.track / 2], [-V.b, V.track / 2],
  ];
  const grip = [], drags = [];
  let kerbCount = 0, offSum = 0;
  const contactX = [], contactZ = [];
  for (let i = 0; i < 4; i++) {
    const px = car.x + fwd.x * offsets[i][0] + rgt.x * offsets[i][1];
    const pz = car.z + fwd.z * offsets[i][0] + rgt.z * offsets[i][1];
    contactX.push(px); contactZ.push(pz);
    const sf = surfaceAt(px, pz);
    const flat = car.flat ? car.flat[i] : 0;
    grip.push(sf.grip * (1 - 0.45 * flat) * (1 - 0.28 * (car.wet || 0))); drags.push(sf.drag + 6 * flat);   // a burst tyre slides, and drags like a pavement corner (tarmac drag is 0, so this is additive)
    if (sf.kerb) { kerbCount++; offSum += sf.off; }
  }
  car.offRoad = offSum / 4;
  car.kerb = kerbCount;

  /* --- four rays instead of a weight-transfer formula ---------------------
     Each corner casts down, compares the ground it finds against its own
     spring, and that force IS the tyre's normal load. Dive, squat, roll and the
     kick over a kerb all fall out of one model instead of three approximations.

     NOTE the lateral convention: the tyre model uses a LEFT-positive lateral
     axis (see `vw = v + r * ax`), so offsets[i][1] is positive to the LEFT.
     Writing the springs as if it were right-positive inverts every roll term —
     the car then leans into the corner instead of out of it.
     pitch: rotation about the lateral axis, positive = nose up.
     roll:  positive = leaning right.
     A corner at (ax, az) therefore sits at  y + ax*sin(pitch) + az*sin(roll). */
  const Fz = [], comp = [], wheelGround = [];
  const sinP = Math.sin(car.pitch), sinR = Math.sin(car.roll);
  for (let i = 0; i < 4; i++) {
    const [ax, az] = offsets[i];
    const cornerY = car.y + ax * sinP + az * sinR;
    const ground = groundHeightAt(contactX[i], contactZ[i]);
    wheelGround.push(ground);
    let c = V.restLength - ((cornerY - WHEEL_R) - ground);
    c = Math.max(-0.02, Math.min(V.maxTravel, c));
    comp.push(c);

    const cornerVel = car.vy + ax * car.pitchRate + az * car.rollRate;
    const closing = -cornerVel;                       // + is compressing
    const damping = closing > 0 ? V.damperC : V.damperR;
    Fz.push(c > 0 ? Math.max(0, V.springK * c + damping * closing) : 0);
  }
  // anti-roll bars move load across an axle without adding any
  const arbF = (comp[0] - comp[1]) * V.antiRollF;
  const arbR = (comp[2] - comp[3]) * V.antiRollR;
  // the bar pushes up on the compressed corner and pulls down on the other
  Fz[0] = Math.max(0, Fz[0] + arbF); Fz[1] = Math.max(0, Fz[1] - arbF);
  Fz[2] = Math.max(0, Fz[2] + arbR); Fz[3] = Math.max(0, Fz[3] - arbR);

  car.suspension = comp;
  car.wheelGround = wheelGround;
  car.airborne = Fz[0] + Fz[1] + Fz[2] + Fz[3] < V.mass * 2;

  // --- driveline ---
  const ratio = V.gears[car.gear] * V.final;
  const wAvg = (car.wheelW[2] + car.wheelW[3]) / 2;
  if (car.gear !== 1) {
    /* Torque-converter launch.
       Locking rpm to wheel speed meant a standing start ran the engine at idle
       -- about 200Nm against a 370Nm peak -- and the measured launch was 8km/h
       after a full second. A real automatic lets the engine flare against the
       converter off the line; this is that: the rpm floor rises with throttle
       while the wheels are slower than it, and hands over to wheel speed the
       moment they catch up. Costs nothing at cruise. */
    const wheelRpm = (Math.abs(wAvg * ratio) * 60) / (2 * Math.PI);
    const flare = V.idle + car.throttle * V.launchRpm;
    const target = Math.max(wheelRpm, wheelRpm < flare ? flare : 0);
    car.rpm += (target - car.rpm) * Math.min(1, dt * 9);
  } else {
    car.rpm += (V.idle + car.throttle * 4200 - car.rpm) * Math.min(1, dt * 3);
  }
  car.rpm = Math.max(V.idle, Math.min(V.redline, car.rpm));

  car.gearTimer -= dt;
  if (!car.holdGear && car.gearTimer <= 0) {
    if (car.gear >= 2 && car.rpm > V.shiftUp && car.gear < V.gears.length - 1) {
      car.gear++; car.gearTimer = 0.45;
    } else if (car.gear > 2 && car.rpm < V.shiftDown) {
      car.gear--; car.gearTimer = 0.4;
    }
    // select R once you have stopped and are still asking to go back
    if (u < 0.6 && car.wantsReverse && !car.wantsForward && car.gear !== 0) {
      car.gear = 0; car.gearTimer = 0.3;
    }
    // and leave R only on the forward key, never on the reverse pedal itself
    if (u > -0.4 && car.wantsForward && car.gear === 0) {
      car.gear = 2; car.gearTimer = 0.3;
    }
  }

  // a damaged engine will not pull; scale sits at 1 until something hits us
  let engT = engineTorque(car.rpm) * car.throttle * (car.damageTorqueScale ?? 1);
  /* Shift torque cut. gearTimer is set to 0.45 (up) / 0.4 (down) on a change
     and counts DOWN, so `> 0.2` is the first 0.25 s / 0.2 s after the shift:
     the box is between ratios and the engine cannot push through it. Without
     it every upshift was a seamless CVT. Costs ~0.1 s on 0-100 (measured). */
  if (car.gearTimer > 0.2) engT *= 0.15;
  // Coast brake scales down in the low gears so a 1st-gear lift is not a wall.
  const gearAbs = Math.abs(V.gears[car.gear] || 0);
  const engBrake = (car.rpm / V.redline) * 18 + (car.throttle < 0.02 ? 10 : 0);
  const wSignD = Math.sign(wAvg);   // 0 at rest, so no phantom drive off the line
  // the handbrake owns the rear axle: no drive torque fights the locked wheels
  // while it is pulled, or the throttle keeps them rolling (and gripping)
  const driveT = car.hand > 0.5 ? 0 : engT * ratio * 0.92;
  const axleT = car.gear === 1 ? 0
    : driveT - engBrake * Math.min(6.5, Math.abs(ratio)) * wSignD * (0.45 + 0.55 * Math.min(1, gearAbs / 3.6));
  const Iref = V.engI * ratio * ratio;

  // --- per-wheel tyre forces ---
  let Fx = 0, Fy = 0, Mz = 0;
  const brakeT = car.brake * V.brakeMax;
  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    const [ax, az] = offsets[i];
    const uw = u - r * az;
    const vw = v + r * ax;
    /* Mild Ackermann: the INNER wheel steers more. Positive steer turns toward
       -z (suspension.test.js 'left'), and offsets[][1] is the corner's z, so
       the inner wheel is the one whose az has the opposite sign to the steer.
       The old `1 + az*0.1` did that for one direction and the reverse for the
       other; the |steer| form is right both ways. */
    const delta = front ? car.steer - Math.abs(car.steer) * az * 0.1 : 0;
    const cd = Math.cos(delta), sd = Math.sin(delta);
    const uL = uw * cd + vw * sd;
    const vL = -uw * sd + vw * cd;

    const mu = (front ? V.muPeakF : V.muPeakR) * grip[i];   // rear grips more so the FRONT saturates first (understeer, not a spin)
    const denom = Math.max(1.2, Math.abs(uL));
    const slipRatio = (car.wheelW[i] * WHEEL_R - uL) / denom;
    const slipAngle = Math.atan2(-vL, denom);

    let Fl = tyreForce(slipRatio, V.Cx, Fz[i], mu);
    let Fc = tyreForce(slipAngle, front ? V.Cf : V.Cr, Fz[i], mu);
    /* A locked or spinning tyre's force follows its slip VECTOR, so the more
       it slides longitudinally the less it can still push sideways. The two
       1-D models above do not know about each other, and the ellipse below
       only caps the total, so a handbrake-locked rear kept nearly its full
       cornering force and the tail never stepped out (15 deg of body slip
       with the handbrake vs 54 without, node sim). A locked wheel sits at
       |slipRatio| = 1 exactly (wheelW = 0), so the ramp starts at 0.4 and
       reaches the 1/(1+|slipRatio|) = 0.5 of a locked wheel at 1. */
    const sliding = Math.max(0, Math.abs(slipRatio) - 0.4);
    if (sliding > 0) Fc /= 1 + sliding * 1.67;
    // friction ellipse — you cannot brake and corner at full grip
    const total = Math.hypot(Fl, Fc), max = mu * Fz[i];
    if (total > max) { const k = max / total; Fl *= k; Fc *= k; }

    const isDriven = DRIVEN.includes(i);
    let T = (isDriven ? axleT * 0.5 : 0) - Fl * WHEEL_R;
    /* Foot brake torque is capped just under what the tyre can react
       (0.95 * mu*Fz*R), a cheap ABS: 10500 Nm split 62/38 put 3255 Nm on each
       front against a ~1600-2200 Nm grip cap and locked the fronts for 49% of
       a 100-0 stop. The review asked for 1.1x, but anything above 1.0x still
       exceeds the curve's peak so the wheel inevitably winds down to lock
       (measured: 1.1x -> 47% locked, 1.0x -> 1% at 39.4 m, 0.95x -> 1% at
       42.1 m, 0.9x -> 44.8 m). 0.95x keeps the stop within 3 m of the old
       44.2 m with the fronts rolling. The handbrake is added AFTER the cap --
       it exists to lock the rears. */
    const footBt = Math.min(brakeT * (front ? 0.62 : 0.38) * 0.5, max * WHEEL_R * 0.95);
    const bt = footBt + (i >= 2 ? car.hand * V.handbrake * 0.5 : 0);
    T -= Math.sign(car.wheelW[i] || uL || 1) * bt;

    const I = V.wheelI + (isDriven && car.gear !== 1 ? Iref * 0.5 : 0);
    const before = car.wheelW[i];
    /* Semi-implicit wheel update. A free wheel (I = 1.35, no engine behind
       it) against Cx = 16 has a ~5 ms time constant, shorter than the 8.3 ms
       step, so the plain explicit update overshot the road speed every step:
       the fronts chattered at +-7% slip, +-3.7 kN, at the Nyquist rate, and
       the friction ellipse took half their cornering force at all times.
       That, not the axle balance, is why the car spun under steering
       (measured 2026-09-09, tools/sim/trace3.mjs). The rears never showed it
       because they carry the reflected engine inertia.
       Implicit Euler on the LINEARISED tyre reaction: divide the step by
       1 + dt*k*R/I with k = dFl/dw on the rising side of the curve. Same
       fixed point, stable at any dt, and k is 0 past the peak so a wheel
       that really is locking or spinning up keeps its live dynamics. */
    const slope = Math.max(0, tyreForce(slipRatio + 1e-3, V.Cx, Fz[i], mu) - Fl) / 1e-3;   // dFl/dslipRatio
    const damp = 1 + (dt * slope * WHEEL_R * WHEEL_R) / (denom * I);
    car.wheelW[i] += ((T / I) * dt) / damp;
    if (bt > 1 && before !== 0 && Math.sign(car.wheelW[i]) !== Math.sign(before)) car.wheelW[i] = 0;
    car.wheelW[i] -= car.wheelW[i] * drags[i] * 0.02 * dt;

    const fx = Fl * cd - Fc * sd;
    const fy = Fl * sd + Fc * cd;
    Fx += fx; Fy += fy;
    Mz += fy * ax - fx * az;
  }

  Fx -= V.dragC * u * Math.abs(u) + V.rollC * u;
  Fy -= V.rollC * v * 1.4;
  for (let i = 0; i < 4; i++) Fx -= drags[i] * u * 0.25;

  /* --- heave, pitch and roll -------------------------------------------
     Springs hold the car up; the moment that actually makes it dive is the
     tyre force acting at road level with the mass a cgH above it. Springs
     alone would have kept it dead level under braking. */
  let Fvert = 0, Mpitch = 0, Mroll = 0;
  for (let i = 0; i < 4; i++) {
    const [ax_, az_] = offsets[i];
    Fvert += Fz[i];
    Mpitch += Fz[i] * ax_;      // up at the front lifts the nose
    Mroll += Fz[i] * az_;       // springs resist whichever way it is leaning
  }
  Mpitch += V.cgH * Fx;         // braking (Fx<0) pitches the nose down
  Mroll += V.cgH * Fy;          // cornering leans the body out of the turn

  car.vy += (Fvert / V.sprungMass - 9.81) * dt;
  car.y += car.vy * dt;
  car.pitchRate += (Mpitch / V.Ipitch) * dt;
  car.rollRate += (Mroll / V.Iroll) * dt;
  car.pitchRate -= car.pitchRate * 2.2 * dt;
  car.rollRate -= car.rollRate * 2.6 * dt;
  car.pitch = Math.max(-0.20, Math.min(0.20, car.pitch + car.pitchRate * dt));
  car.roll = Math.max(-0.24, Math.min(0.24, car.roll + car.rollRate * dt));

  const floor = groundHeightAt(car.x, car.z) + WHEEL_R + V.restLength - V.maxTravel;
  if (car.y < floor) { car.y = floor; car.vy = Math.max(0, car.vy); }

  const ax = Fx / V.mass, ay = Fy / V.mass;
  car.lastAx = ax; car.lastAy = ay;
  /* No Coriolis terms here, deliberately. u and v are re-projected from the
     WORLD velocity with this step's yaw at the top of stepVehicle and written
     back through the same fwd/rgt below, before `yaw` advances, so the body
     frame does not rotate within a step and there is nothing for `-u*r` /
     `+v*r` to correct. With them, a yaw rate rotated the world velocity by
     r*dt per step for free (tools/sim/kin.mjs: velocity turned 1.04x as far
     as the heading with 0.17 g of tyre force present; ~0.2x is physical).
     The velocity was welded to the heading: body slip could not develop until
     the yaw ran away, the rear never slid, the handbrake could not step the
     tail out and the car spun 179 deg on a coast at 80 km/h. 2026-09-09. */
  u += ax * dt;
  v += ay * dt;
  car.yawRate += (Mz / V.inertia) * dt;
  car.yawRate -= car.yawRate * 1.6 * dt;

  /* Low-speed steering assist.
     Below walking pace the tyre model produces almost no yaw moment -- which
     is physically right and feels broken, because turning the wheel does
     nothing you can see. Blend in the kinematic (Ackermann) yaw rate the
     geometry alone demands, fading out by 7m/s where the tyres take over. */
  const kin = Math.max(0, 1 - Math.abs(u) / 7);
  if (kin > 0) {
    const want = (u / (V.a + V.b)) * Math.tan(car.steer);
    car.yawRate += (want - car.yawRate) * kin * Math.min(1, dt * 9);
  }

  car.vx = u * fwd.x + v * rgt.x;
  car.vz = u * fwd.z + v * rgt.z;
  car.yaw += car.yawRate * dt;
  car.x += car.vx * dt;
  car.z += car.vz * dt;

  // --- solid world -----------------------------------------------------
  // Both of these test the whole hull, not the centre of gravity: a 4.6m car
  // resolved from one point can bury half its length in a wall first.
  /* Real footprints when the district is loaded; the kerb-offset rule only
     as a fallback for the old procedural grid, where it was actually true. */
  const boxes = car.buildings ? car.buildings(car.x, car.z) : null;
  if (boxes) resolveBoxes(car, boxes);
  else resolveBuildings(car);
  if (car.obstacles) resolveObstacles(car, car.obstacles(car.x, car.z));

  // pitch/roll are integrated from the springs above, not faked from
  // acceleration, so heave measures suspension displacement from nominal ride height above local ground
  const groundCG = groundHeightAt(car.x, car.z);
  car.heave = car.y - (groundCG + V.rideHeight);

  const rearSlip = Math.abs(((car.wheelW[2] + car.wheelW[3]) / 2) * WHEEL_R - u);
  car.slip = Math.max(0, Math.min(1, (rearSlip - 1.6) / 7));
  car.speed = Math.hypot(car.vx, car.vz);
  car.fwdSpeed = u;
}
