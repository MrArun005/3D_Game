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
  const steerMax = prof?.steerMax || V.steerMax;
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

  // --- Steering curve by speed: responsive, agile, preserving high-speed authority ---
  const speed = Math.hypot(car.vx, car.vz);
  const speedNorm = Math.min(1, Math.max(0, speed / 38.0)); // 0 to ~137 km/h (38 m/s)
  /* Steering authority falls with speed, and the rate is the ONLY thing that
     makes a key press progressive -- input.js hands over a binary +-1 the
     instant a key goes down. At 0.50/11.5 (the 2026-09-16 tuning) a tap at
     66 km/h reached 0.301 rad in 0.1 s and 2.16 g of lateral, yaw rate
     2.04 rad/s: "extremely sensitive, goes to the left extreme or right", and
     the camera swung with it. 0.66/8.0 plus the steerTarget ramp in main.js
     lands at 0.06 rad in 0.1 s and ~1 g -- see the table in that comment. */
  const limit = steerMax * (1.0 - 0.66 * speedNorm);
  const returning = (car.steerTarget === 0) || (Math.sign(car.steerTarget) !== Math.sign(car.steer));
  const steerRate = (8.0 - 4.0 * speedNorm) * (returning ? 2.0 : 1.0) * steerRateMult;
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
  const engT = engineTorque(car.rpm, redline) * car.throttle * torqueMult;
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
    const delta = front ? car.steer * (1 + az * 0.1) : 0;    // mild Ackermann
    const cd = Math.cos(delta), sd = Math.sin(delta);
    const uL = uw * cd + vw * sd;
    const vL = -uw * sd + vw * cd;

    const mu = V.muPeak * grip[i] * gripMult;
    const denom = Math.max(1.2, Math.abs(uL));
    const slipRatio = (car.wheelW[i] * WHEEL_R - uL) / denom;
    const slipAngle = Math.atan2(-vL, denom);

    let Fl = tyreForce(slipRatio, V.Cx, Fz[i], mu);
    let Fc = tyreForce(slipAngle, front ? V.Cf : V.Cr, Fz[i], mu);
    // friction ellipse — you cannot brake and corner at full grip
    const total = Math.hypot(Fl, Fc), max = mu * Fz[i];
    if (total > max) { const k = max / total; Fl *= k; Fc *= k; }

    const isDriven = DRIVEN.includes(i);
    let T = (isDriven ? axleT * 0.5 : 0) - Fl * WHEEL_R;
    const bt = brakeT * (front ? 0.62 : 0.38) * 0.5 + (i >= 2 ? car.hand * V.handbrake * 0.5 : 0);
    T -= Math.sign(car.wheelW[i] || uL || 1) * bt;

    const I = V.wheelI + (isDriven && car.gear !== 1 ? Iref * 0.5 : 0);
    const before = car.wheelW[i];
    car.wheelW[i] += (T / I) * dt;
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
  car.yawRate -= car.yawRate * 1.6 * dt;

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
     is what made it violent. */
  car.yaw += car.yawRate * dt;
  { const cy2 = Math.cos(car.yaw), sy2 = Math.sin(car.yaw);
    car.vx = u * cy2 + v * sy2;
    car.vz = -u * sy2 + v * cy2; }
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
