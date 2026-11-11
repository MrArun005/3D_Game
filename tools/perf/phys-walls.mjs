const R = new URL('../../', import.meta.url).pathname;
const { createCarState, resetCar, stepVehicle } = await import(R + 'src/vehicle/dynamics.js');
const { useDistrict } = await import(R + 'src/world/metrics.js');
const { HANDLING, VEHICLE_PROFILES } = await import(R + 'src/vehicle/config.js');
useDistrict({ roadDepth: () => -50, elevationAt: () => 0, blockTypeAt: () => null });
const H = 1 / 120, KMH = 3.6, DEG = 180 / Math.PI;
const mk = () => { const c = createCarState(); resetCar(c); c.x = 0; c.z = 0; c.yaw = 0; c.assist = HANDLING.gta; c.profile = VEHICLE_PROFILES.muscle; for (let i = 0; i < 360; i++) stepVehicle(c, H); return c; };
const setV = (c, kmh, yaw = 0) => { c.yaw = yaw; const s = kmh / KMH; c.vx = s * Math.cos(yaw); c.vz = -s * Math.sin(yaw); for (let i = 0; i < 4; i++) c.wheelW[i] = s / 0.345; c.speed = s; };
const P = (o) => JSON.stringify(o, (k, v) => typeof v === 'number' ? +v.toFixed(2) : v);
for (const kmh of [60, 120]) for (const deg of [6, 12, 20, 30, 45]) for (const st of [0, -1]) {
  const c = mk(); setV(c, kmh, deg / DEG); c.z = 2.0; const wall = [{ x: c.x + 300, z: -2.6, angle: 0, hw: 400, hd: 1.0 }]; c.buildings = () => wall; c.throttle = 1;
  let contact = null, t = 0, v1 = null, vAt = null, tClear = null, yawAt = null, minSp = 1e9, steps = 0, yr = 0;
  for (let i = 0; i < 720; i++) { const im0 = c.impact || 0; c.steerTarget = contact !== null ? st : 0; stepVehicle(c, H); t += H; if (contact === null && (c.impact || 0) > 0) { contact = t; } if (contact !== null) { minSp = Math.min(minSp, c.speed); if (v1 === null && t - contact >= 0.1) { v1 = c.speed * KMH; yawAt = c.yaw * DEG; } if (tClear === null && c.z > 1.5 && t - contact > 0.05) tClear = t - contact; } }
  console.log(`wall ${deg} deg @${kmh}, throttle 1, steer ${st === 0 ? 'none' : 'AWAY'}:`, P({ tangentialBeforeKmh: kmh * Math.cos(deg / DEG), speed0_1sAfterKmh: v1, minKmh: minSp * KMH, yawDeg0_1s: yawAt, secondsToGetClear: tClear, endKmh: c.speed * KMH, endYawDeg: c.yaw * DEG, endZ: c.z }));
}
// corner clip: drive past a building corner with CLEARANCE (no geometric overlap)
for (const clear of [0.5, 0.35, 0.2, 0.05]) for (const kmh of [50, 100]) { const c = mk(); setV(c, kmh); const hw = 3; const edge = -0.88 - clear; const box = [{ x: 30, z: edge - hw, angle: 0, hw, hd: hw }]; c.buildings = () => box; c.throttle = 0.5; let peak = 0, minSp = 1e9; for (let i = 0; i < 360; i++) { stepVehicle(c, H); peak = Math.max(peak, c.impact || 0); minSp = Math.min(minSp, c.speed); } console.log(`pass a building corner with ${clear} m of air between body side and wall @${kmh}:`, P({ peakImpact: peak, minKmh: minSp * KMH, endX: c.x, endZ: c.z, endYawDeg: c.yaw * DEG })); }
