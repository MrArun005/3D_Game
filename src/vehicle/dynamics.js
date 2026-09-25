import { V, WHEELBASE, WHEEL_R } from './config.js';
import { surfaceAt, LANE, groundHeightAt } from '../world/metrics.js';
import { resolveBoxes, resolveBuildings, resolveObstacles } from './collision.js';

/** Flat-ish turbo four / high-rev engine. Nm against rpm, with a taper into the limiter. */
export function engineTorque(rpm, redline = V.redline) {
  if (rpm < 500) return 0;
  const r = Math.max(600, Math.min(redline, rpm));
  const t =
    120 +
    250 * Math.exp(-(((r - 3200) / 2200) ** 2)) +
    90 * Math.exp(-(((r - 5200) / 1800) ** 2)) +
    (redline > 7500 ? 115 * Math.exp(-(((r - 7000) / 1600) ** 2)) : 0);
  return r > redline - 250 ? t * Math.max(0, (redline - r) / 250) : t;
}

/**
 * Simplified Pacejka.
 * The 2B/(1+B^2) rise peaks at B=1 but then decays to zero, which would let a
 * spinning wheel escape for ever. Real rubber keeps sliding friction, so past
 * the peak this blends into a plateau at 72% of available grip.
 */
export function tyreForce(slip, stiffness, load, mu) {
  const B = stiffness * slip;
  const aB = Math.abs(B);
  const peak = (2 * B) / (1 + B * B);
  const slide = (B < 0 ? -1 : 1) * 0.72;
  const k = Math.max(0, Math.min(1, (aB - 1) / 4));
  return (peak * (1 - k) + slide * k) * mu * load;
}

export function createCarState() {
  const car = {
    x: 0, z: 0, yaw: 0,
    prevX: 0, prevZ: 0, prevYaw: 0,
    prevPitch: 0, prevRoll: 0, prevHeave: 0,
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
    headlights: false, impact: 0, lightsUser: false,
  };
  return car;
}

export function resetCar(car) {
  const ox = car.x ?? 2351.5, oz = car.z ?? 1356.0, oyaw = car.yaw ?? (-Math.PI / 2 - 0.03);
  Object.assign(car, {
    x: ox, z: oz, yaw: oyaw,
    prevX: ox, prevZ: oz, prevYaw: oyaw,
    prevPitch: 0, prevRoll: 0, prevHeave: 0,
    vx: 0, vz: 0, yawRate: 0,
    rpm: V.idle, gear: 2, gearTimer: 0, steer: 0, pitch: 0, roll: 0, heave: 0,
    speed: 0, fwdSpeed: 0, lastAx: 0, lastAy: 0,
    throttle: 0, brake: 0, hand: 0, slip: 0, offRoad: 0, kerb: 0,
    wantsForward: false, wantsReverse: false, impact: 0,
  });
  car.wheelW = [0, 0, 0, 0];
}

const DRIVEN = [2, 3];   // rear-wheel drive
const GRAV = 9.81;
/* gta scratch for the coupled wheel + body solve in stepVehicle, per wheel
   FL FR RL RR: the tyre's secant stiffness (N per m/s of slip speed), the
   wheel's torque before the brake, the brake torque, the wheel's inertia,
   the steer cos/sin, the step-start longitudinal and lateral forces, the
   longitudinal budget the ellipse leaves, the solve's a/b terms and net
   torque, and whether the brake holds the wheel. Module scope so a 120 Hz
   step allocates nothing. */
const G_K = new Float64Array(4), G_T = new Float64Array(4), G_BT = new Float64Array(4), G_I = new Float64Array(4);
const G_CD = new Float64Array(4), G_SD = new Float64Array(4), G_FL = new Float64Array(4), G_FC = new Float64Array(4);
const G_LON = new Float64Array(4), G_A = new Float64Array(4), G_B = new Float64Array(4), G_TE = new Float64Array(4);
const G_HELD = new Uint8Array(4);

/**
 * The road-wheel angle full lock (steerTarget = +-1) asks for at `speed`, rad.
 * Exported so the autopilot normalises its pure-pursuit angle against the SAME
 * limit the physics applies (it kept its own copy, 0.389 rad at 60 km/h
 * against the physics' 0.426; under gta the lock there is 0.144, 2.7x less).
 *
 * sim (car.assist null): steerMax falling by up to 0.66 with speed -- 26 deg
 * of lock at 50 km/h, 21 at 80. The front tyre peaks at 1/Cf = 4.6 deg of
 * slip, so a held key parks the fronts at 27-33 deg, on the 72% sliding
 * plateau: the car ploughs at 0.55-0.69 g on a 33 m circle at 50 km/h
 * (measured on open tarmac, 2026-09-23).
 * gta: ALSO capped at the angle that asks for `steerG` of lateral at the
 * current forward speed (kinematic L*a/u^2) plus `slipK` of the front's peak
 * slip angle -- a grip-limited lock, at the tyre's peak and not past it, which
 * is what an arcade car gives you: a held key is a 1.1-1.2 g turn at any speed.
 * Forward speed, not ground speed, so a car sliding sideways keeps the lock to
 * catch it.
 */
export function steerLimit(car, speed = Math.hypot(car.vx, car.vz)) {
  const steerMax = car.profile?.steerMax || V.steerMax;
  const speedNorm = Math.min(1, Math.max(0, speed / 38.0)); // 0 to ~137 km/h (38 m/s)
  const limit = steerMax * (1.0 - 0.66 * speedNorm);
  const A = car.assist;
  if (!A) return limit;
  const uu = Math.max(1, Math.abs(car.fwdSpeed || speed));
  const grip = Math.atan(((V.a + V.b) * A.steerG * GRAV) / (uu * uu)) + A.slipK / V.Cf;
  return Math.min(limit, Math.max(A.minLock, grip));
}

export function stepVehicle(car, dt) {
  // Store previous step physics state for visual interpolation
  car.prevX = car.x;
  car.prevZ = car.z;
  car.prevYaw = car.yaw;
  car.prevPitch = car.pitch;
  car.prevRoll = car.roll;
  car.prevHeave = car.heave;
  // Vehicle profile characteristics (GT3 race, supercar, muscle, street)
  const prof = car.profile;
  const steerRateMult = (prof?.steerRateMult || 1.0) * (car.steerBoost || 1.0);
  const mass = prof?.mass || V.mass;
  const sprungMass = prof?.sprungMass || V.sprungMass;
  const inertia = prof?.inertia || V.inertia;
  const Ipitch = prof?.Ipitch || V.Ipitch;
  const Iroll = prof?.Iroll || V.Iroll;
  const springK = prof?.springK || V.springK;
  const damperC = prof?.damperC || V.damperC;
  const damperR = prof?.damperR || V.damperR;
  const antiRollF = prof?.antiRollF || V.antiRollF;
  const antiRollR = prof?.antiRollR || V.antiRollR;
  const redline = prof?.redline || V.redline;
  const shiftUp = prof?.shiftUp || V.shiftUp;
  const shiftDown = prof?.shiftDown || V.shiftDown;
  const launchRpm = prof?.launchRpm || V.launchRpm;
  const gears = prof?.gears || V.gears;
  const final = prof?.final || V.final;
  const brakeMax = prof?.brakeMax || V.brakeMax;
  const gripMult = prof?.gripMult || 1.0;
  const torqueMult = (prof?.torqueMult || 1.0) * (car.damageTorqueScale ?? 1);
  /* The handling profile (config.js HANDLING): null is 'sim', the raw tyre
     model the 2026-09-09 harness pins; the game defaults to HANDLING.gta
     (main.js, ?sim to opt out). Every assist below is gated on it. */
  const A = car.assist || null;

  // --- Steering curve by speed: responsive, agile, preserving high-speed authority ---
  const speed = Math.hypot(car.vx, car.vz);
  const speedNorm = Math.min(1, Math.max(0, speed / 38.0)); // 0 to ~137 km/h (38 m/s)
  /* Steering authority falls with speed, and the rate is the ONLY thing that
     makes a key press progressive -- input.js hands over a binary +-1 the
     instant a key goes down. At 0.50/11.5 (the 2026-09-16 tuning) a tap at
     66 km/h reached 0.301 rad in 0.1 s and 2.16 g of lateral, yaw rate
     2.04 rad/s: "extremely sensitive, goes to the left extreme or right", and
     the camera swung with it. 0.66/8.0 plus the steerTarget ramp in main.js
     lands at 0.06 rad in 0.1 s and ~1 g -- see the table in that comment.
     The limit itself is steerLimit() above (gta caps it at the tyre's grip). */
  const limit = steerLimit(car, speed);
  const returning = (car.steerTarget === 0) || (Math.sign(car.steerTarget) !== Math.sign(car.steer));
  const steerRate = (8.0 - 4.0 * speedNorm) * (returning ? 2.0 : 1.0) * steerRateMult;
  car.steer += (car.steerTarget * limit - car.steer) * Math.min(1, dt * steerRate);

  /* The body frame is ISO: x forward, y LEFT, yaw positive to the left (the
     tyre slip terms, Mz and the u/v coupling below are all written that way).
     `lft` maps y onto the world's left. It used to be the RIGHT axis, so the
     internal (u, v, r) model was self-consistent but every sideways velocity
     the world saw was mirrored (2026-09-23): a car in the air yawing at
     1 rad/s turned its velocity 2.02 rad per rad of heading (tools/sim/
     kin.mjs, ratio 2.00; now 0.08), a gta handbrake turn at 60 km/h went
     nose-out with the path whipping 102 deg for 63 of yaw (now tail-out, 24
     deg of path), and a kerb under the right wheels lifted the LEFT side
     (roll +0.088; now -0.088). Grip and ground are sampled at the right
     corners now too: the mirrored side's surface was read before. */
  const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
  const fwd = { x: cy, z: -sy };
  const lft = { x: -sy, z: -cy };
  let u = car.vx * fwd.x + car.vz * fwd.z;   // longitudinal
  let v = car.vx * lft.x + car.vz * lft.z;   // lateral, + = moving to the car's left
  const r = car.yawRate;

  // --- where each corner sits: [forward, left] in the body frame ---
  // Index order stays FL FR RL RR on the world's left/right, which is what
  // main.js's wheel idx, car.flat and wheelGround consume.
  const offsets = [
    [V.a, V.track / 2], [V.a, -V.track / 2],
    [-V.b, V.track / 2], [-V.b, -V.track / 2],
  ];
  const grip = [], drags = [];
  let kerbCount = 0, offSum = 0;
  const contactX = [], contactZ = [];
  for (let i = 0; i < 4; i++) {
    const px = car.x + fwd.x * offsets[i][0] + lft.x * offsets[i][1];
    const pz = car.z + fwd.z * offsets[i][0] + lft.z * offsets[i][1];
    contactX.push(px); contactZ.push(pz);
    const sf = surfaceAt(px, pz);
    const flat = car.flat ? car.flat[i] : 0;
    grip.push(sf.grip * (1 - 0.45 * flat) * (1 - 0.28 * (car.wet || 0))); drags.push(sf.drag + 6 * flat);
    if (sf.kerb) { kerbCount++; offSum += sf.off; }
  }
  car.offRoad = offSum / 4;
  car.kerb = kerbCount;

  /* --- four rays instead of a weight-transfer formula --- */
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
    const damping = closing > 0 ? damperC : damperR;
    Fz.push(c > 0 ? Math.max(0, springK * c + damping * closing) : 0);
  }
  // anti-roll bars move load across an axle without adding any
  const arbF = (comp[0] - comp[1]) * antiRollF;
  const arbR = (comp[2] - comp[3]) * antiRollR;
  // the bar pushes up on the compressed corner and pulls down on the other
  Fz[0] = Math.max(0, Fz[0] + arbF); Fz[1] = Math.max(0, Fz[1] - arbF);
  Fz[2] = Math.max(0, Fz[2] + arbR); Fz[3] = Math.max(0, Fz[3] - arbR);

  // Aerodynamic downforce: increases normal load on tyres with v^2
  const downFCoeff = prof?.downF ?? V.downF ?? 0.45;
  const aeroDown = downFCoeff * 0.5 * 1.225 * (u * u); // in Newtons
  const aeroF = (aeroDown * 0.45) / 2; // per front wheel
  const aeroR = (aeroDown * 0.55) / 2; // per rear wheel
  if (comp[0] > 0) Fz[0] += aeroF;
  if (comp[1] > 0) Fz[1] += aeroF;
  if (comp[2] > 0) Fz[2] += aeroR;
  if (comp[3] > 0) Fz[3] += aeroR;

  car.suspension = comp;
  car.wheelGround = wheelGround;
  car.airborne = Fz[0] + Fz[1] + Fz[2] + Fz[3] < mass * 2;

  // --- driveline ---
  const ratio = gears[car.gear] * final;
  const wAvg = (car.wheelW[2] + car.wheelW[3]) / 2;
  if (car.gear !== 1) {
    const wheelRpm = (Math.abs(wAvg * ratio) * 60) / (2 * Math.PI);
    const flare = V.idle + car.throttle * launchRpm;
    const target = Math.max(wheelRpm, wheelRpm < flare ? flare : 0);
    car.rpm += (target - car.rpm) * Math.min(1, dt * 9);
  } else {
    car.rpm += (V.idle + car.throttle * 4200 - car.rpm) * Math.min(1, dt * 3);
  }
  car.rpm = Math.max(V.idle, Math.min(redline, car.rpm));

  car.gearTimer -= dt;
  if (!car.holdGear && car.gearTimer <= 0) {
    if (car.gear >= 2 && car.rpm > shiftUp && car.gear < gears.length - 1) {
      car.gear++; car.gearTimer = 0.35;
    } else if (car.gear > 2 && car.rpm < shiftDown) {
      car.gear--; car.gearTimer = 0.35;
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
  let engT = engineTorque(car.rpm, redline) * car.throttle * torqueMult;
  if (A) {
    /* gta: the handbrake owns the rear axle (drive torque kept reaching the
       locked rears, which fought the lever), then traction control -- cut
       torque from tcSlip of driven-wheel slip (the tyre's peak is 1/Cx =
       0.0625) to tcFloor over tcWidth -- and, lever off, a throttle cut past
       betaMax of body slip so a power slide cannot become a spin. tcCut is
       a readout (1 = nothing cut) for the harness and any HUD lamp.
       The slip is the GRIPPING driven wheel's (the slower one), not the
       axle average: the per-wheel drive cap below reins in a spinning one,
       and the average let one unloaded rear -- the one by the wall in a
       scrape -- cut the loaded one's torque (street body, 6 deg scrape at
       60 km/h, full throttle: 36 km/h kept with that rear at 1.59x the
       road; 49 and 1.16x now; the other bodies were within 1 km/h). */
    if (car.hand > 0.5) engT = 0;
    const sr = (Math.min(car.wheelW[2], car.wheelW[3]) * WHEEL_R - u) / Math.max(1.2, Math.abs(u));
    const tc = Math.max(A.tcFloor, Math.min(1, 1 - (sr - A.tcSlip) / A.tcWidth));
    const bNow = Math.abs(Math.atan2(v, Math.max(1, Math.abs(u))));
    const slide = car.hand > 0.1 ? 1 : Math.max(A.betaCutFloor, Math.min(1, 1 - (bNow - A.betaMax) / A.betaCut));
    car.tcCut = tc * slide;
    engT *= car.tcCut;
  }
  // Coast brake scales down in the low gears so a 1st-gear lift is not a wall.
  const gearAbs = Math.abs(gears[car.gear] || 0);
  const engBrake = (car.rpm / redline) * 18 + (car.throttle < 0.02 ? 10 : 0);
  const wSignD = Math.sign(wAvg);   // 0 at rest, so no phantom drive off the line
  const axleT = car.gear === 1 ? 0
    : engT * ratio * 0.92 - engBrake * Math.min(6.5, Math.abs(ratio)) * wSignD * (0.45 + 0.55 * Math.min(1, gearAbs / 3.6));
  const Iref = V.engI * ratio * ratio;

  // --- per-wheel tyre forces ---
  let Fx = 0, Fy = 0, Mz = 0;
  const brakeT = car.brake * brakeMax;
  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    const [ax, az] = offsets[i];
    const uw = u - r * az;
    const vw = v + r * ax;
    /* mild Ackermann: the INSIDE wheel steers more. It was `1 + az * 0.1`,
       which always gave the LEFT wheel more -- right for a left turn and
       backwards (reverse Ackermann) for a right one: at 20-30 km/h the gta
       car turned 14-18% less to the right ("turn to the right is very
       slow", 2026-09-25). az is + on the left, steer + to the left. */
    const delta = front ? car.steer * (1 + az * 0.1 * Math.sign(car.steer)) : 0;
    const cd = Math.cos(delta), sd = Math.sin(delta);
    const uL = uw * cd + vw * sd;
    const vL = -uw * sd + vw * cd;

    const mu = V.muPeak * grip[i] * gripMult;
    const denom = Math.max(1.2, Math.abs(uL));
    const slipRatio = (car.wheelW[i] * WHEEL_R - uL) / denom;
    const slipAngle = Math.atan2(-vL, denom);

    let Fl = tyreForce(slipRatio, V.Cx, Fz[i], mu);
    let Fc = tyreForce(slipAngle, front ? V.Cf : V.Cr, Fz[i], mu);
    /* gta: a locked or spinning tyre cannot also corner (review branch
       d6c7ddf). Here a locked rear kept its full slip-angle force, the
       ellipse only rescaled the total, and up to 0.69 muFz of lateral
       survived -- one reason the handbrake did 4 deg at 60 km/h. A locked
       wheel (slip ratio -1) keeps half. */
    if (A) { const sl = Math.abs(slipRatio) - 0.4; if (sl > 0) Fc /= 1 + sl * 1.67; }
    const FlRaw = Fl, FcRaw = Fc;
    // friction ellipse — you cannot brake and corner at full grip
    const total = Math.hypot(Fl, Fc), max = mu * Fz[i];
    let kEll = 1;
    if (total > max) { kEll = max / total; Fl *= kEll; Fc *= kEll; }

    const isDriven = DRIVEN.includes(i);
    const I = V.wheelI + (isDriven && car.gear !== 1 ? Iref * 0.5 : 0);
    let drive = isDriven ? axleT * 0.5 : 0;
    if (A && isDriven && !car.airborne) {
      /* gta traction control, per driven wheel: never more drive torque than
         the tyre can react while it corners (A.driveCap x max^2/hypot(max,
         Fc), what the ellipse leaves at the peak -- the same budget as the
         brake cap below) plus what it takes to spin the wheel and engine up
         with the road (I*aL/R). The slip-ratio cut above only trims engine
         torque to 35%, and at the cornering limit the inside rear has almost
         no longitudinal budget: W + full lock at 80 km/h spun it to 355 km/h
         of surface speed while the car did 79, climbing through the gears
         and smoking the whole way (sim does the same: 316 km/h at 92).
         Capped, the rears track the road (0.98-1.03x of it), no smoke, and
         the car drives out of the corner (80 -> 102 km/h in 4 s) instead of
         bogging (80 -> 79); the cap costs the launch nothing. 2026-09-23.
         Past the tyre's peak (|slip| > 1/Cx) the budget drops to driveCap x
         what the tyre is giving NOW, about zero: a cap sized for the peak is
         more than the 72% sliding plateau, and the spin-up allowance reads
         last step's TYRE acceleration, which a wall's drag is not part of, so
         a wheel that got past the peak could never come back (a 6 deg wall
         scrape unloads the rear by the wall: it ran 2.1x the road for the
         whole scrape, smoking; now 1.10x). With the whole car in the air
         there is no cap, or the engine could not rev off the ground (the
         driven wheels held at x0.99 of road speed over a 0.5 s jump at full
         throttle; now x1.49, sim x2.0). Per wheel it would un-cap the GT3's
         lifted inside rear at 1.46 g, which then spun to 153 m/s. aL, the
         road's acceleration along the wheel, is last step's body
         acceleration plus the frame terms. */
      const aL = ((car.lastAx || 0) + v * r) * cd + ((car.lastAy || 0) - u * r) * sd;
      let budget = (A.driveCap * WHEEL_R * max * max) / Math.max(1e-6, Math.hypot(max, FcRaw));
      let spin = (I * aL) / WHEEL_R;
      if (Math.abs(slipRatio) > 1 / V.Cx) { budget = Math.min(budget, A.driveCap * WHEEL_R * Math.abs(Fl)); spin = 0; }
      drive = Math.max(spin - budget, Math.min(spin + budget, drive));
    }
    let T = drive - Fl * WHEEL_R;
    /* Foot brake torque capped just under what the tyre can react (0.95 *
       mu*Fz*R), a cheap ABS: uncapped, the front share exceeded the tyre's
       grip and the fronts locked for ~half of every hard stop -- no steering
       under braking, and a longer stop (2026-09-09 sweep: 1.1x -> 47% locked,
       0.95x -> 1%). The handbrake is added AFTER the cap: it is meant to lock.
       gta: A.brakeCap x the braking force the tyre can still make while it
       corners -- max^2 / hypot(max, Fc), what the ellipse leaves at the
       peak slip ratio. The plain muFz cap exceeds that whenever the tyre is
       also cornering, so brake + steer locked the fronts for 92-96% of the
       stop (the inside front first) and the car went straight on; now 1%,
       and full brake + full lock at 80 km/h turns 23 deg in the first second
       instead of 13 (2026-09-23). 0.95 like sim's, not 1.0: a brake torque
       AT the peak is a knife edge -- once a front crossed it at a crawl
       (where the slip band is only +-0.075 m/s wide) the brake out-held the
       72% sliding force and the fronts locked for the last 8 km/h of every
       stop (9-10% of a 100-0). 100-0 is 35.0 m (33.6 at 1.0, sim 36.6). */
    const cap = A ? A.brakeCap * WHEEL_R * max * max / Math.max(1e-6, Math.hypot(max, FcRaw)) : max * WHEEL_R * 0.95;
    const footBt = Math.min(brakeT * (front ? 0.62 : 0.38) * 0.5, cap);
    const bt = footBt + (i >= 2 ? car.hand * V.handbrake * 0.5 : 0);
    if (A) {
      /* gta: the wheel is stepped WITH the body in the coupled solve below
         the loop, not here. Its tyre stiffness there is the SECANT through
         the origin, Fl / slip speed (the curve's small-slip slope 2 Cx mu Fz
         at zero), not the tangent: the curve is concave, so the secant is
         never below the tangent and never 0 -- a wheel past the peak is
         pulled back toward the road instead of jumping clean across it. On
         the tangent (0 past the peak, so an explicit step there) a front let
         go locked at 5 km/h chattered across the road speed 59 times in
         0.5 s and never settled: one step moves it ~2 m/s, the +-0.075 m/s
         linear band ~30 times over. On the secant it is on the road speed in
         3 steps (2026-09-23, harness unlockFront). */
      const e0 = slipRatio * denom;
      G_K[i] = Math.abs(e0) > 1e-6 ? Fl / e0 : (kEll * 2 * V.Cx * mu * Fz[i]) / denom;
      G_T[i] = T; G_BT[i] = bt; G_I[i] = I; G_CD[i] = cd; G_SD[i] = sd;
      G_FL[i] = Fl; G_FC[i] = Fc; G_LON[i] = Math.sqrt(Math.max(0, max * max - Fc * Fc));
      continue;
    }
    T -= Math.sign(car.wheelW[i] || uL || 1) * bt;

    const before = car.wheelW[i];
    car.wheelW[i] += (T / I) * dt;
    if (bt > 1 && before !== 0 && Math.sign(car.wheelW[i]) !== Math.sign(before)) car.wheelW[i] = 0;
    car.wheelW[i] -= car.wheelW[i] * drags[i] * 0.02 * dt;

    const fx = Fl * cd - Fc * sd;
    const fy = Fl * sd + Fc * cd;
    Fx += fx; Fy += fy;
    Mz += fy * ax - fx * az;
  }

  if (A) {
    /* gta: the four wheels and the body's u and yaw rate stepped TOGETHER,
       implicit Euler on the tyres' linearised longitudinal reaction. Why
       implicit: a free wheel against Cx = 16 has a ~5 ms time constant,
       under the 8.3 ms step, so an explicit wheel overshoots the road speed
       every step (at steady full lock the fronts alternated 0.71 / 1.07 of
       u; it is sim's 23-25% 'locked' in a 100-0). Review branch d6c7ddf made
       the WHEEL implicit on its own, and 2026-09-23 fed it last step's body
       acceleration so it would not lag the road. Why together: at a crawl
       the slip is measured against the 1.2 m/s floor, so the tyre is stiff
       against the BODY as well as the wheel -- dt x sum(dFl/du) / m = 2.2 mu per step
       (3.1 on the road cars, 4.0 on the GT3), and an explicit body update is
       unstable above 2; with the wheel implicit alone and the road's
       acceleration taken from last step, the bound is 0.5. What that did,
       measured: below ~6 km/h the body chattered at the step rate (ax
       +-1.1 g on alternate steps) and the chatter's asymmetry DROVE the car.
       Coasting it never came to rest (supercar 6.1 km/h and GT3 5.5 after 3
       min, rolling 43-44 m every 30 s; muscle 0.2); stopped and released it
       crept 6.3 m a minute (74-82 m on the supercar and GT3); with the brake
       held, 0.5-1.6 m in 2 min. Now 0.00 km/h, 0.00-0.02 m and 0.001 m. The
       lag also left a phantom push: in a wall scrape the free fronts
       'anticipated' an acceleration the wall took away and pushed +0.9 kN.
       sim keeps its explicit wheels: they saturate symmetrically, so its
       body chatter only jitters in place.
         Per wheel, the slip speed moves by delta = R dw - (p du + q dr): p =
       cos steer, q = the wheel's yaw arm (sin steer * a - cos steer * z,
       which is also the yaw moment arm of a force along the wheel). With the
       force F0 + K delta, the wheel I dw = dt (Te - R K delta) (Te: the
       step-start net torque, -R F0 included) gives delta = a - b (p du +
       q dr), a = R dt Te / g, b = I / g, g = I + dt R^2 K. A wheel the brake
       HOLDS (it could stop it this step) has dw = 0: a = 0, b = 1. The body,
       m du = dt (Fx0 + m v r + sum p K delta) and Iz dr = dt (Mz0 + sum q K
       delta), is then a symmetric positive 2x2, solved by Cramer. The brake
       is Coulomb friction: it holds the wheel if it can, else pushes against
       the spin with bt (sim's sign(w || uL) flips every step at rest). Cost:
       +0.2-0.4 us a step over the per-wheel version (best of 7 x 60k steps
       2.05 -> 2.25 us; sim 1.6), ~0.5 us a frame. */
    let FxDrag = V.dragC * u * Math.abs(u) + V.rollC * u;
    for (let i = 0; i < 4; i++) FxDrag += drags[i] * u * 0.25;
    let Fx0 = -FxDrag, Mz0 = 0;
    let m11 = mass, m12 = 0, m22 = inertia, s1 = 0, s2 = 0;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = offsets[i];
      const cd = G_CD[i], sd = G_SD[i], K = G_K[i], I = G_I[i], bt = G_BT[i], T = G_T[i];
      const fx = G_FL[i] * cd - G_FC[i] * sd, fy = G_FL[i] * sd + G_FC[i] * cd;
      Fx0 += fx; Mz0 += fy * ax - fx * az;
      const w0 = car.wheelW[i];
      const need = (I * w0) / dt + T;            // the brake torque that would stop this wheel this step
      let a, b;
      G_HELD[i] = bt > 1 && Math.abs(need) <= bt ? 1 : 0;
      if (G_HELD[i]) { a = 0; b = 1; }
      else {
        const Te = T - Math.sign(w0 || need) * bt;
        const g = I + dt * WHEEL_R * WHEEL_R * K;
        a = (WHEEL_R * dt * Te) / g; b = I / g; G_TE[i] = Te;
      }
      G_A[i] = a; G_B[i] = b;
      const p = cd, q = sd * ax - cd * az, c = dt * K * b;
      m11 += c * p * p; m12 += c * p * q; m22 += c * q * q;
      s1 += p * K * a; s2 += q * K * a;
    }
    const r1 = dt * (Fx0 + mass * v * r + s1), r2 = dt * (Mz0 + s2);
    const det = m11 * m22 - m12 * m12;
    const du = (r1 * m22 - r2 * m12) / det, dr = (m11 * r2 - m12 * r1) / det;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = offsets[i];
      const cd = G_CD[i], sd = G_SD[i];
      const delta = G_A[i] - G_B[i] * (cd * du + (sd * ax - cd * az) * dr);
      // the implicit force, kept inside what the ellipse leaves beside the lateral
      const Fl = Math.max(-G_LON[i], Math.min(G_LON[i], G_FL[i] + G_K[i] * delta));
      const w0 = car.wheelW[i];
      if (G_HELD[i]) car.wheelW[i] = 0;
      else {
        car.wheelW[i] = w0 + (dt * (G_TE[i] - (Fl - G_FL[i]) * WHEEL_R)) / G_I[i];   // Te already carries -R F0
        if (G_BT[i] > 1 && w0 !== 0 && Math.sign(car.wheelW[i]) !== Math.sign(w0)) car.wheelW[i] = 0;
      }
      car.wheelW[i] -= car.wheelW[i] * drags[i] * 0.02 * dt;
      const fx = Fl * cd - G_FC[i] * sd, fy = Fl * sd + G_FC[i] * cd;
      Fx += fx; Fy += fy;
      Mz += fy * ax - fx * az;
    }
  }

  Fx -= V.dragC * u * Math.abs(u) + V.rollC * u;   // FxDrag again, in sim's order so its numbers stay bit-identical
  Fy -= V.rollC * v * 1.4;
  for (let i = 0; i < 4; i++) Fx -= drags[i] * u * 0.25;

  /* --- heave, pitch and roll ------------------------------------------- */
  let FspringUp = 0, Mpitch = 0, Mroll = 0;
  for (let i = 0; i < 4; i++) {
    const [ax_, az_] = offsets[i];
    const aeroCorner = i < 2 ? aeroF : aeroR;
    FspringUp += Math.max(0, Fz[i] - aeroCorner);
    Mpitch += Fz[i] * ax_;      // up at the front lifts the nose
    Mroll += Fz[i] * az_;       // springs resist whichever way it is leaning
  }
  Mpitch += V.cgH * Fx;         // braking (Fx<0) pitches the nose down
  Mroll += V.cgH * Fy;          // cornering leans the body out of the turn

  // Aerodynamic downforce pushes the body downward, compressing springs and increasing tire contact
  car.vy += ((FspringUp - aeroDown) / sprungMass - 9.81) * dt;
  car.y += car.vy * dt;
  car.pitchRate += (Mpitch / Ipitch) * dt;
  car.rollRate += (Mroll / Iroll) * dt;
  car.pitchRate -= car.pitchRate * 2.2 * dt;
  car.rollRate -= car.rollRate * 2.6 * dt;
  car.pitch = Math.max(-0.20, Math.min(0.20, car.pitch + car.pitchRate * dt));
  car.roll = Math.max(-0.24, Math.min(0.24, car.roll + car.rollRate * dt));

  const floor = groundHeightAt(car.x, car.z) + WHEEL_R + V.restLength - V.maxTravel;
  if (car.y < floor) { car.y = floor; car.vy = Math.max(0, car.vy); }

  const ax = Fx / mass, ay = Fy / mass;
  car.lastAx = ax; car.lastAy = ay;
  u += (ax + v * r) * dt;
  v += (ay - u * r) * dt;
  car.yawRate += (Mz / inertia) * dt;
  /* Flat yaw damping. sim's 1.6/s is understeer that grows with yaw rate;
     gta takes it to A.yawDamp at a crawl and lets the stability controller
     below do the catching -- but rising with speed^2 (0.67/s at 50 km/h,
     1.07 at 80, 1.94 at 120), because at 0.4 everywhere a held full lock at
     80-160 km/h settled into a yaw limit cycle, 30-53% peak to peak at
     ~0.7 Hz: the car pumping round a long bend. Now 0 / 3 / 5% at
     80 / 120 / 160, for a steady 1.14 / 1.19 / 1.21 g at 50 / 80 / 120
     instead of 1.17 / 1.26 / 1.14 (2026-09-23). */
  car.yawRate -= car.yawRate * (A ? A.yawDamp + A.yawDampHi * speedNorm * speedNorm : 1.6) * dt;
  if (A && u > 2 && !car.airborne) {
    const b = Math.atan2(v, u);   // body slip, + = the car moving to the LEFT of its nose
    if (car.hand > 0.1) {
      /* gta handbrake. Kick: swing the tail out toward the steer (or the
         turn already on), fading to nothing at hbBeta of slip and never
         above hbRmax of yaw, so a held lever settles instead of spinning.
         Cap: past hbCap of slip the nose is pulled back toward the velocity
         -- even with the lever held a slide is a slide, not a spin.
         Measured, muscle, full lock held 1.5 s at 60 / 100 km/h: 46 / 42
         deg of slip (sim 4 / 1), under 8 again 0.40 / 0.65 s after letting
         go. From 40 km/h the slide stops the car inside the 1.5 s: 50 deg of
         slip while it moves and ~95 deg of heading, a handbrake U-turn (the
         light GT3: 39 deg, 109 deg of heading). Its '145 deg spin' in the
         2026-09-23 review was the direction of a ~0 velocity, read through
         the stop; this block is off below u = 2 m/s either way. */
      if (u > 3 && Math.abs(car.yawRate) < A.hbRmax) {
        const dir = Math.sign(car.steer) || Math.sign(r);
        car.yawRate += dir * A.hbKick * car.hand * Math.min(1, u / 8) * Math.max(0, 1 - Math.abs(b) / A.hbBeta) * dt;
      }
      const ex = Math.abs(b) - A.hbCap;
      if (ex > 0) car.yawRate += Math.sign(b) * ex * A.hbStraighten * dt;
    } else {
      /* gta stability control, lever off. Yaw rate: the steer's kinematic
         reference, capped at escG of lateral, with a band of 15% + 0.05
         rad/s either side (zero inside the band, so the car still rotates
         freely into a turn); beyond it the excess is pulled back at A.esc.
         Body slip: past betaMax the nose is turned toward the velocity at
         `straighten` and the sideways speed scrubbed at `scrub` -- how a
         released handbrake slide straightens itself in 0.3-0.7 s. */
      const rMax = (A.escG * GRAV) / u;
      const rRef = Math.max(-rMax, Math.min(rMax, (u / (V.a + V.b)) * Math.tan(car.steer)));
      const band = rMax * 0.15 + 0.05;
      const hi = Math.max(rRef, 0) + band, lo = Math.min(rRef, 0) - band;
      const over = car.yawRate > hi ? car.yawRate - hi : car.yawRate < lo ? car.yawRate - lo : 0;
      car.yawRate -= over * Math.min(1, A.esc * dt);
      const ex = Math.abs(b) - A.betaMax;
      if (ex > 0) {
        car.yawRate += Math.sign(b) * ex * A.straighten * dt;
        v -= Math.sign(v) * Math.min(Math.abs(v), ex * A.scrub * u * dt);
      }
    }
  }

  /* Dynamic counter-steer stability assist:
     When drifting (lateral velocity v has opposite sign to steer angle),
     dampen excessive yaw rate so the slide is progressive and controllable. */
  if (Math.abs(v) > 1.2 && Math.sign(v) !== Math.sign(car.steer)) {
    const driftAssist = Math.min(1, (Math.abs(v) - 1.2) / 4.0);
    car.yawRate -= car.yawRate * (2.2 * driftAssist) * dt;
  }

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

  /* Back to the world frame with the NEW heading, not the one the step began
     with. The body-frame coupling above (u += v*r, v -= u*r) is the rotation
     of a frame that turns by r*dt this step; re-expressing [u, v] with the
     OLD fwd/rgt applied that rotation to the velocity itself, so the path
     turned with the body regardless of grip -- a car on rails. Measured, a
     held key at 120 km/h: tyres producing 0.51 g while the velocity heading
     turned 63 deg in one second (0.5 g can bend it 8); the GT3 96 deg at
     2.83 rad/s, the whole view whipping round -- 'the screen flickers rather
     than the car turning'. With the new heading: 1.0 g / 13 deg per second
     for the road cars, 1.7 g / 20 for the GT3, body yaw == path heading. The
     bug predates the 2026-09-16 handling pass; that pass's lower yaw inertia
     is what made it violent.
     v goes back on the LEFT axis (-sin, -cos), the one it was read from.
     The 2026-09-22 fix (13da2de) moved the write-back to the new heading but
     kept v on the right -- the mirror described at `lft` above -- so on top
     of the frame's own rotation the velocity turned TWICE the heading when
     no tyre was touching it (2026-09-23). */
  car.yaw += car.yawRate * dt;
  { const cy2 = Math.cos(car.yaw), sy2 = Math.sin(car.yaw);
    car.vx = u * cy2 - v * sy2;
    car.vz = -u * sy2 - v * cy2; }
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
