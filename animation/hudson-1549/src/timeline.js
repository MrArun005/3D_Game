// The film's clock. Two times run through everything:
//   v  - video seconds, 0 .. DURATION
//   ft - flight seconds since the takeoff roll began (15:24:54 EST)
// Each shot maps its slice of video time onto a slice of flight time, so shots
// can compress or slow the real 5.8 minutes. Everything in the scene is a pure
// function of ft (plus the shot), so any frame renders on its own.
//
// Shared by the browser (scene) and node (tools/audio.mjs).
import { Vector3, CatmullRomCurve3 } from 'three';
import { ll, PLACES } from './geo.js';

export const FPS = 30;
export const START_CLOCK = 15 * 3600 + 24 * 60 + 54; // 15:24:54

// ---- flight path --------------------------------------------------------
const RWY = PLACES.lgaRwy4, RWY_END = PLACES.lgaRwy22;
export const RWY_DIR = new Vector3(RWY_END.x - RWY.x, 0, RWY_END.z - RWY.z).normalize();
export const LAND_Y = 1.5;     // land plane above the water
export const GEAR_H = 3.7;     // fuselage axis above the wheels' contact patch
export const FLOAT_Y = 1.2;    // fuselage axis above water once afloat

export const LIFTOFF_FT = 32;
export const STRIKE_FT = 137.12;   // 15:27:11
export const DITCH_FT = 345;       // 15:30:39, 208 s after the strike
const ROLL_ACC = 2 * 1229 / (LIFTOFF_FT * LIFTOFF_FT);

const W = (lat, lon, alt) => { const p = ll(lat, lon); return new Vector3(p.x, alt, p.z); };
const liftoff = new Vector3(RWY.x, 0, RWY.z).addScaledVector(RWY_DIR, 1229);
const beforeLiftoff = liftoff.clone().addScaledVector(RWY_DIR, -700);
const TD = W(40.7690, -74.0046, 0);
const PRE_TD = W(40.7770, -73.9990, 52);
const tdDir = TD.clone().sub(PRE_TD).setY(0).normalize();

const pts = [
  beforeLiftoff, liftoff,
  W(40.78577, -73.86800, 95),
  W(40.80300, -73.86000, 330),
  W(40.82100, -73.87100, 545),
  W(40.83700, -73.90600, 859),     // bird strike, ~2,818 ft
  W(40.85000, -73.92150, 930),     // zoom climb peak, ~3,060 ft
  W(40.85900, -73.94100, 790),
  W(40.86250, -73.95300, 620),
  W(40.85200, -73.95750, 430),     // over the George Washington Bridge
  W(40.82200, -73.96700, 305),
  W(40.79500, -73.98500, 170),
  PRE_TD,
  TD,
  TD.clone().addScaledVector(tdDir, 600),
];
const IDX_LIFT = 1, IDX_STRIKE = 5, IDX_TD = pts.length - 2;
const curve = new CatmullRomCurve3(pts, false, 'centripetal', 0.5);

// Arc-length table over the curve parameter.
const N = 24000;
const tab = new Float64Array(N + 1);
{
  let prev = curve.getPoint(0), acc = 0;
  for (let i = 1; i <= N; i++) {
    const p = curve.getPoint(i / N);
    acc += p.distanceTo(prev); tab[i] = acc; prev = p;
  }
}
const arcAtIndex = (i) => tab[Math.round(i / (pts.length - 1) * N)];
const S_LIFT = arcAtIndex(IDX_LIFT), S_STRIKE = arcAtIndex(IDX_STRIKE), S_TD = arcAtIndex(IDX_TD);
function pointAtArc(s, out = new Vector3()) {
  let lo = 0, hi = N;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tab[m] < s) lo = m; else hi = m; }
  const f = (s - tab[lo]) / ((tab[hi] - tab[lo]) || 1);
  return curve.getPoint((lo + f) / N, out);
}

// Speed ramps linearly inside each span, continuous across spans.
const V_LIFT = ROLL_ACC * LIFTOFF_FT;
const TA = STRIKE_FT - LIFTOFF_FT, LA = S_STRIKE - S_LIFT;
const V_STRIKE = 2 * LA / TA - V_LIFT;
const TB = DITCH_FT - STRIKE_FT, LB = S_TD - S_STRIKE;
export const V_TD = 2 * LB / TB - V_STRIKE;
export const SPEEDS = { V_LIFT, V_STRIKE, V_TD, LA, LB };

function arcAtFt(ft) {
  if (ft <= STRIKE_FT) {
    const t = ft - LIFTOFF_FT;
    return S_LIFT + V_LIFT * t + 0.5 * (V_STRIKE - V_LIFT) / TA * t * t;
  }
  const t = ft - STRIKE_FT;
  return S_STRIKE + V_STRIKE * t + 0.5 * (V_TD - V_STRIKE) / TB * t * t;
}

// Skid after touchdown, then drift downriver.
const SKID_LEN = 290;
const SKID_DEC = V_TD * V_TD / (2 * SKID_LEN);
const SKID_T = V_TD / SKID_DEC;
export const STOP_FT = DITCH_FT + SKID_T;
const DRIFT = 0.55; // m/s, ebb current

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
export { clamp, smooth, lerp };

// Position of the fuselage axis centre, raw (no attitude).
function rawPos(ft, out = new Vector3()) {
  if (ft < LIFTOFF_FT) {
    const t = Math.max(0, ft);
    out.set(RWY.x, LAND_Y + GEAR_H, RWY.z).addScaledVector(RWY_DIR, 0.5 * ROLL_ACC * t * t);
    return out;
  }
  if (ft < DITCH_FT) {
    pointAtArc(arcAtFt(ft), out);
    out.y += lerp(LAND_Y + GEAR_H, 2.3, smooth(LIFTOFF_FT, LIFTOFF_FT + 30, ft));
    return out;
  }
  const t = Math.min(ft - DITCH_FT, SKID_T);
  const s = V_TD * t - 0.5 * SKID_DEC * t * t;
  const yaw = -0.10 * smooth(0, SKID_T, t);  // drifts a few degrees left
  const d = tdDir.clone().applyAxisAngle(new Vector3(0, 1, 0), yaw * 0.5);
  out.set(TD.x, 0, TD.z).addScaledVector(d, s);
  if (ft > STOP_FT) out.addScaledVector(DRIFT_DIR, DRIFT * (ft - STOP_FT));
  out.y = lerp(2.3, FLOAT_Y, smooth(0, 2.5, ft - DITCH_FT)) + 0.08 * Math.sin(0.9 * ft) * smooth(0, 6, ft - DITCH_FT);
  return out;
}
const DRIFT_DIR = new Vector3(Math.sin(200 * Math.PI / 180), 0, -Math.cos(200 * Math.PI / 180));

function headingAt(ft) {
  if (ft < LIFTOFF_FT) return Math.atan2(RWY_DIR.x, -RWY_DIR.z);
  if (ft >= DITCH_FT) {
    const t = Math.min(ft - DITCH_FT, SKID_T);
    return Math.atan2(tdDir.x, -tdDir.z) - 0.10 * smooth(0, SKID_T, t) + (ft > STOP_FT ? -0.0012 * (ft - STOP_FT) : 0);
  }
  const a = rawPos(ft - 0.2), b = rawPos(ft + 0.2);
  return Math.atan2(b.x - a.x, -(b.z - a.z));
}
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function rawBank(ft) {
  if (ft < LIFTOFF_FT + 2 || ft > DITCH_FT - 1) return 0;
  const dpsi = wrap(headingAt(ft + 1.5) - headingAt(ft - 1.5)) / 3;
  const v = speedAt(ft);
  return clamp(Math.atan(v * dpsi / 9.81), -0.55, 0.55);
}
export function speedAt(ft) {
  if (ft < LIFTOFF_FT) return ROLL_ACC * Math.max(0, ft);
  if (ft < STRIKE_FT) return V_LIFT + (V_STRIKE - V_LIFT) * (ft - LIFTOFF_FT) / TA;
  if (ft < DITCH_FT) return V_STRIKE + (V_TD - V_STRIKE) * (ft - STRIKE_FT) / TB;
  return Math.max(0, V_TD - SKID_DEC * (ft - DITCH_FT));
}

// Full state: position, heading/pitch/bank (radians), basis vectors.
// Plane body frame: +X nose, +Y up, +Z right wing.
export function planeState(ft) {
  const pos = rawPos(ft);
  const heading = headingAt(ft);
  let pitch = 0, bank = 0;
  if (ft < LIFTOFF_FT) {
    pitch = 0.14 * smooth(LIFTOFF_FT - 4, LIFTOFF_FT, ft);
  } else if (ft < DITCH_FT) {
    const a = rawPos(ft - 0.3), b = rawPos(ft + 0.3);
    const gamma = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
    const aoa = lerp(0.05, 0.08, smooth(STRIKE_FT, STRIKE_FT + 20, ft)) + 0.12 * smooth(DITCH_FT - 7, DITCH_FT - 1, ft);
    pitch = gamma + aoa;
    if (ft < LIFTOFF_FT + 6) pitch = Math.max(pitch, 0.14);
    let acc = 0;
    for (let k = -4; k <= 4; k++) acc += rawBank(ft + k * 0.6);
    bank = acc / 9;
  } else {
    const t = ft - DITCH_FT;
    pitch = lerp(0.19, 0.045, smooth(0, 3.5, t)) + 0.03 * Math.sin(t * 3.1) * Math.exp(-t * 0.6)
      + 0.007 * Math.sin(0.7 * ft) * smooth(4, 10, t);
    bank = 0.012 * Math.sin(0.55 * ft + 1) * smooth(4, 10, t);
  }
  const f = new Vector3(Math.sin(heading) * Math.cos(pitch), Math.sin(pitch), -Math.cos(heading) * Math.cos(pitch));
  const r0 = new Vector3().crossVectors(f, new Vector3(0, 1, 0)).normalize();
  const u0 = new Vector3().crossVectors(r0, f);
  const r = r0.clone().multiplyScalar(Math.cos(bank)).addScaledVector(u0, -Math.sin(bank));
  const u = u0.clone().multiplyScalar(Math.cos(bank)).addScaledVector(r0, Math.sin(bank));
  const fh = new Vector3(Math.sin(heading), 0, -Math.cos(heading));
  const rh = new Vector3(Math.cos(heading), 0, Math.sin(heading));
  return { ft, pos, heading, pitch, bank, f, u, r, fh, rh, speed: speedAt(ft) };
}

// Engine spool, 0..1 of takeoff N1. Left engine is hit first.
export function spool(ft, side) {
  if (ft >= DITCH_FT) return 0;
  const hit = STRIKE_FT + (side < 0 ? 0 : 0.09);
  if (ft < hit) return lerp(0.25, 1, smooth(-2, 6, ft)) - 0.08 * smooth(60, 70, ft);
  return 0.12 + 0.72 * Math.exp(-(ft - hit) * 0.9);
}

export function nearestFt(target, a, b) {
  let best = a, bd = Infinity;
  for (let ft = a; ft <= b; ft += 0.1) {
    const p = rawPos(ft);
    const d = Math.hypot(p.x - target.x, p.z - target.z);
    if (d < bd) { bd = d; best = ft; }
  }
  return best;
}
const GWB_MID = { x: (PLACES.gwbNJ.x + PLACES.gwbNY.x) / 2, z: (PLACES.gwbNJ.z + PLACES.gwbNY.z) / 2 };
export const GWB_FT = nearestFt(GWB_MID, 180, 280);

// ---- shots ----------------------------------------------------------------
// ft(u) maps shot progress u (0..1) to flight time.
const linear = (a, b) => (u) => a + (b - a) * u;
export const SHOTS = [
  { name: 'title',   dur: 6,  ft: () => 0 },
  { name: 'takeoff', dur: 9,  ft: linear(16, 40) },
  { name: 'climb',   dur: 7,  ft: linear(88, 126) },
  { name: 'geese',   dur: 6,  ft: linear(131, 137.08) },
  { name: 'strike',  dur: 6,  ft: linear(137.0, 139.6) },
  { name: 'mayday',  dur: 10, ft: linear(139.6, 182) },
  { name: 'turn',    dur: 8,  ft: linear(182, GWB_FT - 14) },
  { name: 'gwb',     dur: 8,  ft: linear(GWB_FT - 9, GWB_FT + 7) },
  { name: 'river',   dur: 10, ft: linear(282, 331) },
  { name: 'ditch',   dur: 10, ft: (u) => u < 0.35 ? lerp(333, 344, u / 0.35) : lerp(344, 362, (u - 0.35) / 0.65) },
  { name: 'evac',    dur: 11, ft: linear(375, 640) },
  { name: 'end',     dur: 9,  ft: linear(640, 780) },
];
{
  let t = 0;
  for (const s of SHOTS) { s.start = t; t += s.dur; }
}
export const DURATION = SHOTS.reduce((a, s) => a + s.dur, 0);

export function shotAt(v) {
  let s = SHOTS[0];
  for (const x of SHOTS) if (v >= x.start) s = x;
  const u = clamp((v - s.start) / s.dur, 0, 1);
  return { shot: s, u, local: v - s.start, ft: s.ft(u) };
}
// First video time at which flight time reaches ft (for sound cues).
export function videoAtFt(ft) {
  for (const s of SHOTS) {
    const a = s.ft(0), b = s.ft(1);
    if (b > a && ft >= a && ft <= b) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (s.ft(m) < ft) lo = m; else hi = m; }
      return s.start + lo * s.dur;
    }
  }
  return null;
}

// ---- words on screen ---------------------------------------------------------
// kind: title | caption | radio | end. Times are seconds inside the named shot.
export const CAPTIONS = [
  { shot: 'title', a: 0.6, b: 5.6, kind: 'title', text: 'US Airways Flight 1549', sub: 'New York City · Thursday, 15 January 2009' },
  { shot: 'takeoff', a: 0.5, b: 4.4, kind: 'caption', text: '15:24 EST · LaGuardia Airport, runway 4' },
  { shot: 'takeoff', a: 4.6, b: 8.7, kind: 'caption', text: 'An Airbus A320 bound for Charlotte · 150 passengers, 5 crew' },
  { shot: 'climb', a: 0.5, b: 6.6, kind: 'caption', text: 'Captain Chesley Sullenberger and First Officer Jeffrey Skiles climb out over the Bronx' },
  { shot: 'geese', a: 0.8, b: 5.8, kind: 'caption', text: '15:27:11 · about 2,800 ft · a flock of Canada geese' },
  { shot: 'strike', a: 0.6, b: 5.8, kind: 'caption', text: 'Birds are ingested by both engines. Both lose thrust almost at once.' },
  { shot: 'mayday', a: 0.5, b: 5.2, kind: 'radio', who: 'CAPTAIN', text: 'Mayday, mayday, mayday… hit birds. We’ve lost thrust in both engines. We’re turning back towards LaGuardia.' },
  { shot: 'mayday', a: 5.5, b: 9.8, kind: 'caption', text: 'The captain starts the APU and takes the controls; the first officer works the engine-restart checklist.' },
  { shot: 'turn', a: 0.3, b: 3.7, kind: 'caption', text: 'Approach control offers a return to LaGuardia.' },
  { shot: 'turn', a: 3.9, b: 7.9, kind: 'radio', who: 'CAPTAIN', text: 'We’re unable. We may end up in the Hudson.' },
  { shot: 'gwb', a: 0.3, b: 3.6, kind: 'caption', text: 'Teterboro, New Jersey, is offered next. The airliner crosses the George Washington Bridge.' },
  { shot: 'gwb', a: 3.8, b: 7.9, kind: 'radio', who: 'CAPTAIN', text: 'We can’t do it… We’re gonna be in the Hudson.' },
  { shot: 'river', a: 0.5, b: 4.4, kind: 'radio', who: 'CAPTAIN · TO THE CABIN', text: 'This is the captain. Brace for impact.' },
  { shot: 'river', a: 4.8, b: 9.8, kind: 'caption', text: 'Flight attendants Sheila Dail, Doreen Welsh and Donna Dent shout their commands: “Brace, brace! Heads down, stay down!”' },
  { shot: 'ditch', a: 4.0, b: 9.7, kind: 'caption', text: '15:30 · Flight 1549 touches down on the Hudson, 208 seconds after the bird strike' },
  { shot: 'evac', a: 0.5, b: 5.3, kind: 'caption', text: 'Everyone gets out: onto the wings and into the slide-rafts. Water 5 °C, air −6 °C.' },
  { shot: 'evac', a: 5.6, b: 10.8, kind: 'caption', text: 'Commuter ferries and rescue boats reach the aircraft within minutes.' },
  { shot: 'end', a: 0.8, b: 8.8, kind: 'end', text: 'All 155 people on board survived.', sub: 'Reconstruction. Flight path and timing approximate, after NTSB report AAR-10/03.<br>Every model, texture and sound in this film is generated in code.' },
];
for (const c of CAPTIONS) {
  const s = SHOTS.find((x) => x.name === c.shot);
  c.t0 = s.start + c.a; c.t1 = s.start + c.b;
}

export function clockText(ft) {
  const t = Math.floor(START_CLOCK + ft);
  const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} EST`;
}
