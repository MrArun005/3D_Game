/**
 * Node contact harness: the hero car against walls, corners, parked cars and
 * traffic (2026-11-11). Drives the shipped stepVehicle at 1/120 s exactly as
 * main.js does -- stepVehicle resolves boxes (car.buildings) and obstacles
 * (car.obstacles) itself, and main.js decays car.impact once per substep.
 *
 *   node tools/sim/contact.mjs            gta assist, muscle profile, open tarmac
 *
 * test/contact-walls.test.js asserts bands on the same functions.
 *
 * Axes: at yaw 0 the car faces +x, its RIGHT is +z, and +yaw turns it LEFT
 * (toward -z). steerTarget +1 is left.
 */
import { stepVehicle } from '../../src/vehicle/dynamics.js';
import { HANDLING, VEHICLE_PROFILES } from '../../src/vehicle/config.js';
import { settled, accelerateTo, openField, CAR, H } from './handling.mjs';
import { cruiserSpeed } from '../../src/game/traffic.js';

const KMH = 3.6, DEG = 180 / Math.PI;
export function gtaMuscle() { CAR.assist = HANDLING.gta; CAR.profile = VEHICLE_PROFILES.muscle; openField(true); }
function step(c, dt = H) { stepVehicle(c, dt); c.impact = (c.impact || 0) * Math.exp(-8 * dt); }
function aim(c, deg) {
  const sp = c.speed; c.yaw = deg / DEG; c.yawRate = 0;
  c.vx = sp * Math.cos(c.yaw); c.vz = -sp * Math.sin(c.yaw);
}

/** Into a long wall on the car's left (face at z = -1.4) at `deg`, full throttle, no steer (steer -1 = away). */
export function wall(kmh = 60, deg = 30, { steer = 0, seconds = 6, seg = 0 } = {}) {
  const c = accelerateTo(settled(), kmh);
  c.x = 0; c.z = 2; aim(c, deg);
  // one long box, or (seg > 0) the same wall as a row of abutting boxes `seg` m long: a terrace, a parapet
  const box = seg > 0 ? Array.from({ length: Math.ceil(600 / seg) }, (_, i) => ({ x: -200 + seg / 2 + i * seg, z: -2.4, angle: 0, hw: seg / 2, hd: 1.0 }))
    : [{ x: 200, z: -2.4, angle: 0, hw: 400, hd: 1.0 }];
  c.buildings = () => box;
  c.throttle = 1; c.steerTarget = steer; c.steer = 0;
  const s0 = c.speed; let tHit = null, t = 0, at1 = null, minSp = Infinity, peak = 0, freeAt = null, deep = 0;
  for (let i = 0; i < seconds * 120; i++) {
    stepVehicle(c, H); t += H;
    peak = Math.max(peak, c.impact || 0);
    if (tHit === null && c.impact > 0) tHit = t;
    c.impact = (c.impact || 0) * Math.exp(-8 * H);
    deep = Math.min(deep, c.z);
    if (tHit !== null) {
      minSp = Math.min(minSp, c.speed);
      if (at1 === null && t - tHit >= 1) at1 = { kmh: c.speed * KMH, yawDeg: c.yaw * DEG };
      // free: moving at 20 km/h+ and the heading no longer points into the wall by more than 3 deg
      if (freeAt === null && t - tHit > 0.05 && c.speed * KMH > 20 && c.yaw * DEG < 3) freeAt = t - tHit;
    }
  }
  return { before: s0 * KMH, tangential: s0 * Math.cos(deg / DEG) * KMH, at1s: at1?.kmh ?? 0, yawAt1s: at1?.yawDeg ?? deg, min: minSp * KMH,
    end: c.speed * KMH, yawEnd: c.yaw * DEG, freeAt, peakImpact: peak, minZ: deep, finite: Number.isFinite(c.x + c.z + c.yaw + c.vx + c.yawRate) };
}

/** Past a building corner with `gap` m of air between the body side (0.88 m half width) and the wall face (negative = the body overlaps it). */
export function corner(kmh = 50, gap = 0.1) {
  const c = accelerateTo(settled(), kmh);
  c.x = 0; c.z = 0; aim(c, 0);
  // a building on the car's right, its near face `gap` beyond the flank, its front face at x = 20
  const hd = 10, face = 0.88 + gap;
  const box = [{ x: 20 + 15, z: face + hd, angle: 0, hw: 15, hd }];
  c.buildings = () => box;
  c.throttle = 0.4; c.steerTarget = 0;
  const s0 = c.speed; let peak = 0, minSp = Infinity;
  for (let i = 0; i < 360 && c.x < 60; i++) { stepVehicle(c, H); peak = Math.max(peak, c.impact || 0); c.impact *= Math.exp(-8 * H); minSp = Math.min(minSp, c.speed); }
  return { before: s0 * KMH, min: minSp * KMH, x: c.x, zShift: c.z, yawDeg: c.yaw * DEG, peakImpact: peak };
}

const parked = (x, z, yaw = 0) => ({ x, z, yaw, offsets: [-1.45, 0, 1.45], radius: 0.98, reach: 2.9, tag: 'parked' });
/** Side-brushing a parked car on the right: the two bodies (0.9 m from centre to flank each) overlap `overlap` m laterally, throttle held. */
export function brush(kmh = 60, overlap = 0.2) {
  const c = accelerateTo(settled(), kmh);
  c.x = 0; c.z = 0; aim(c, 0);
  const o = [parked(12, 0.9 + 0.9 - overlap)];
  c.obstacles = () => o; c.buildings = () => [];
  c.throttle = 1; c.steerTarget = 0;
  let tHit = null, sHit = c.speed, t = 0, at03 = null, peak = 0, minSp = Infinity;
  for (let i = 0; i < 360; i++) {
    const z0 = c.z, sp0 = c.speed;
    stepVehicle(c, H); t += H; peak = Math.max(peak, c.impact || 0);
    if (tHit === null && (c.impact > 0 || Math.abs(c.z - z0) > 1e-3)) { tHit = t; sHit = sp0; }
    c.impact *= Math.exp(-8 * H);
    if (tHit !== null) minSp = Math.min(minSp, c.speed);
    if (tHit !== null && at03 === null && t - tHit >= 0.3) at03 = c.speed * KMH;
  }
  return { touched: tHit !== null, before: sHit * KMH, at03s: at03 ?? c.speed * KMH, min: (tHit === null ? c.speed : minSp) * KMH, end: c.speed * KMH, shove: -c.z, yawDeg: c.yaw * DEG, peakImpact: peak };
}

/** Rear-ending traffic doing `their` km/h at `ours`, throttle held. The traffic car is a path follower: speed along +x, easing back to its limit. */
export function rearEnd(ours = 60, their = 40, seconds = 4, ram = 1, model = 'civilian') {
  const c = accelerateTo(settled(), ours);
  c.x = 0; c.z = 0; aim(c, 0);
  const tc = { speed: their / KMH, panic: 0, cruise: their / KMH }, limit = their / KMH;
  const body = { x: 14, z: 0, yaw: 0, offsets: [-1.45, 0, 1.45], radius: 0.98, reach: 2.9, tag: model === 'civilian' ? 'traffic' : 'police', car: tc };
  c.obstacles = () => [body]; c.buildings = () => [];
  c.throttle = 1; c.steerTarget = 0; c.ramForce = ram;
  let peak = 0, theirMax = 0, theirMin = Infinity, oursMin = Infinity, hit = false;
  for (let i = 0; i < seconds * 120; i++) {
    // traffic.js's follower, reduced (its civilian speed line): 4.5 up, 9.0 down -- 0.9 while it rolls on from a shove -- x 2.2
    // ...or a police cruiser in free pursuit (traffic.js cruiserSpeed: 9 up, 14 down), or that line as it was before cruisers honoured the shove
    if (model === 'cruiser') cruiserSpeed(tc, limit, H, 9, 14);
    else if (model === 'cruiserOld') tc.speed += Math.max(-14 * H, Math.min(9 * H, limit - tc.speed));
    else {
      if (tc.shoved > 0) tc.shoved -= H;
      const acc = limit > tc.speed ? 4.5 : tc.shoved > 0 ? 0.9 : 9.0;
      tc.speed += Math.max(-acc, Math.min(acc, limit - tc.speed)) * H * 2.2;
    }
    body.x += tc.speed * H;
    stepVehicle(c, H); peak = Math.max(peak, c.impact || 0); c.impact *= Math.exp(-8 * H);
    if (peak > 0) hit = true;
    if (hit) { theirMax = Math.max(theirMax, tc.speed); theirMin = Math.min(theirMin, tc.speed); oursMin = Math.min(oursMin, c.speed); }
  }
  return { ours: c.speed * KMH, oursMin: oursMin * KMH, theirs: tc.speed * KMH, theirMax: theirMax * KMH, theirMin: theirMin * KMH, peakImpact: peak, gap: body.x - c.x, hitTag: c.hitTag };
}

/** Head-on into a wall `thick` m thick at dt: how far the nose got past the near face, and the rebound speed. */
export function headOn(kmh = 60, thick = 2, dt = H) {
  const c = accelerateTo(settled(), kmh);
  c.x = 0; c.z = 0; aim(c, 0);
  const near = 12, box = [{ x: near + thick / 2, z: 0, angle: 0, hw: thick / 2, hd: 20 }];
  c.buildings = () => box; c.throttle = 1;
  let maxX = 0, minU = Infinity;
  for (let t = 0; t < 3; t += dt) { step(c, dt); maxX = Math.max(maxX, c.x); minU = Math.min(minU, c.vx); }
  return { through: maxX > near + thick, nose: maxX + 2.25 - near, rebound: Math.max(0, -minU) * KMH, end: c.speed * KMH, finite: Number.isFinite(c.x + c.z + c.yaw + c.vx) };
}

/** Parked nose against a wall, no input: creep over 5 s. */
export function rest() {
  const c = settled(); c.x = 0; c.z = 0;
  const box = [{ x: 2.25 + 0.42 + 1.0 - 0.01, z: 0, angle: 0, hw: 1.0, hd: 20 }];
  c.buildings = () => box;
  for (let i = 0; i < 12; i++) stepVehicle(c, H);     // the first steps push the 1 cm overlap out
  const x0 = c.x; let peak = 0;
  for (let i = 0; i < 600; i++) { stepVehicle(c, H); peak = Math.max(peak, c.impact || 0); }
  return { creep: Math.abs(c.x - x0), peakImpact: peak, yawDeg: c.yaw * DEG };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  gtaMuscle();
  const f = (v, d = 1) => (v == null ? '  -' : v.toFixed(d));
  console.log('WALL, full throttle, no steer (km/h): before | tangential | 1 s after hit (yaw) | min | after 6 s (yaw)');
  for (const kmh of [60, 120]) for (const deg of [6, 20, 30, 45, 60, 70, 80, 86, 90]) {
    const r = wall(kmh, deg);
    console.log(`  ${kmh} @ ${String(deg).padStart(2)} deg   ${f(r.before, 0)} | ${f(r.tangential, 0)} | ${f(r.at1s)} (${f(r.yawAt1s)}) | ${f(r.min)} | ${f(r.end)} (${f(r.yawEnd)})  impact ${f(r.peakImpact)}  minZ ${f(r.minZ, 2)}`);
  }
  console.log('WALL as a row of abutting 8 m boxes (must match the one-piece wall): after 6 s (yaw) | min | impact');
  for (const kmh of [60, 120]) for (const deg of [6, 20, 45]) {
    const r = wall(kmh, deg, { seg: 8 }), o = wall(kmh, deg);
    console.log(`  ${kmh} @ ${String(deg).padStart(2)} deg   row ${f(r.end)} (${f(r.yawEnd)}) min ${f(r.min)} impact ${f(r.peakImpact)} minZ ${f(r.minZ, 2)}   one piece ${f(o.end)} (${f(o.yawEnd)}) min ${f(o.min)} impact ${f(o.peakImpact)}`);
  }
  console.log('WALL, steering away: seconds until free (>20 km/h, heading within 3 deg of the wall)');
  for (const kmh of [60, 120]) for (const deg of [20, 30, 45]) console.log(`  ${kmh} @ ${deg} deg   ${f(wall(kmh, deg, { steer: -1 }).freeAt, 2)} s`);
  console.log('CORNER pass: gap m | min km/h | z shift | yaw');
  for (const kmh of [50, 100]) for (const gap of [0.05, 0.1, 0.2, 0.35, -0.1, -0.3, -0.5, -0.65, -0.8, -1.2]) { const r = corner(kmh, gap); console.log(`  ${kmh} gap ${f(gap, 2)}   min ${f(r.min)}  z ${f(r.zShift, 2)}  yaw ${f(r.yawDeg)}  impact ${f(r.peakImpact)}`); }
  console.log('PARKED-CAR brush @60: overlap | 0.3 s after | min | end | shove m | yaw');
  for (const ov of [0.05, 0.2, 0.3, 0.5, 0.9]) { const r = brush(60, ov); console.log(`  overlap ${f(ov, 2)}   ${f(r.before)} -> ${f(r.at03s)} | ${f(r.min)} | ${f(r.end)} | shove ${f(r.shove, 2)} | yaw ${f(r.yawDeg)}  impact ${f(r.peakImpact)}`); }
  { const r = rearEnd(); console.log(`REAR-END 60 into 40: ours ${f(r.ours)} (min ${f(r.oursMin)})  theirs ${f(r.theirs)} (min ${f(r.theirMin)}, max ${f(r.theirMax)})  impact ${f(r.peakImpact)}  gap ${f(r.gap, 2)}`); }
  for (const m of ['cruiserOld', 'cruiser']) { const r = rearEnd(60, 40, 4, 1, m); console.log(`REAR-END a police cruiser (${m}) 60 into 40: ours ${f(r.ours)} (min ${f(r.oursMin)})  theirs ${f(r.theirs)} (min ${f(r.theirMin)}, max ${f(r.theirMax)})  impact ${f(r.peakImpact)}  gap ${f(r.gap, 2)}  tag ${r.hitTag}`); }
  console.log('HEAD-ON: nose past the near face m | rebound km/h');
  for (const [kmh, thick, dt] of [[60, 2, H], [150, 2, H], [250, 2, H], [250, 0.3, H], [150, 2, 1 / 30], [150, 2, 1 / 10], [250, 0.3, 1 / 30]]) {
    const r = headOn(kmh, thick, dt); console.log(`  ${kmh} km/h, ${thick} m wall, dt 1/${Math.round(1 / dt)}   ${r.through ? 'THROUGH' : 'held'}  nose ${f(r.nose, 2)}  rebound ${f(r.rebound)}  end ${f(r.end)}  ${r.finite ? '' : 'NaN'}`);
  }
  { const r = rest(); console.log(`REST against a wall: creep ${f(r.creep, 4)} m  impact ${f(r.peakImpact, 2)}`); }
}
