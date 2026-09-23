// The soundtrack, synthesised sample by sample: no recordings, no samples.
// Engines, wind, radio squelch, the bird-strike bangs, the ditching, water,
// a ferry horn, and a slow pad under it all. Timed from src/timeline.js, so
// it stays locked to the picture.
//
//   node tools/audio.mjs   -> out/soundtrack.wav (48 kHz stereo)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DURATION, SHOTS, CAPTIONS, shotAt, videoAtFt, spool, STRIKE_FT, DITCH_FT, smooth, clamp } from '../src/timeline.js';
import { rng } from '../src/rng.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SR = 48000;
const N = Math.ceil(DURATION * SR);
const L = new Float32Array(N), R = new Float32Array(N);
const TAU = Math.PI * 2;
const at = (name) => SHOTS.find((s) => s.name === name);

// ---- building blocks ----------------------------------------------------------
const lp = (fc) => 1 - Math.exp(-TAU * fc / SR);
class OnePole { constructor() { this.y = 0; } run(x, a) { this.y += a * (x - this.y); return this.y; } }
class SVF {   // Chamberlin state-variable filter; returns band-pass
  constructor() { this.l = 0; this.b = 0; }
  run(x, fc, q = 0.7) {
    const f = 2 * Math.sin(Math.PI * Math.min(fc, SR / 6) / SR);
    this.l += f * this.b; const h = x - this.l - q * this.b; this.b += f * h; return this.b;
  }
}
function noiseGen(seed) { const r = rng(seed); return () => r() * 2 - 1; }
const env = (t, a, d) => (t < 0 ? 0 : t < a ? t / a : Math.exp(-(t - a) / d));

// ---- event times (video seconds) ------------------------------------------------
const vStrikeL = videoAtFt(STRIKE_FT), vStrikeR = videoAtFt(STRIKE_FT + 0.09);
const vDitch = videoAtFt(DITCH_FT);
const pops = [0.02, 0.3, 0.62, 1.0, 1.5, 2.3];   // same compressor surges the flames show
const popTimes = [];
for (const base of [STRIKE_FT, STRIKE_FT + 0.09]) for (const d of pops) { const v = videoAtFt(base + d); if (v !== null) popTimes.push(v); }
const vHorn = [videoAtFt(585), videoAtFt(612)].filter((v) => v !== null);
const radio = CAPTIONS.filter((c) => c.kind === 'radio');
const TAKEOFF_PASS = at('takeoff').start + (29.0 - 16) / 24 * at('takeoff').dur;  // the aircraft passes the camera
console.log({ vStrikeL, vStrikeR, vDitch, vHorn, TAKEOFF_PASS });

// ---- per-shot engine and wind levels (the camera's distance, by eye) -------------
function levels(v, shot, local) {
  const u = local / shot.dur;
  switch (shot.name) {
    case 'title': return { eng: 0, wind: 0.05, city: 0.5 };
    case 'takeoff': { const d = Math.abs(v - TAKEOFF_PASS); return { eng: 0.25 + 0.9 * Math.exp(-d * 0.55), wind: 0.05, city: 0.25, pass: v - TAKEOFF_PASS }; }
    case 'climb': return { eng: 0.62, wind: 0.2, city: 0 };
    case 'geese': return { eng: 0.15 + 0.65 * u * u, wind: 0.12, city: 0 };
    case 'strike': return { eng: 1.0, wind: 0.35, city: 0 };
    case 'mayday': return { eng: 0.35, wind: 0.32, city: 0 };
    case 'turn': return { eng: 0.08, wind: 0.12, city: 0 };
    case 'gwb': return { eng: 0.3, wind: 0.4, city: 0 };
    case 'river': return { eng: 0.25, wind: 0.36, city: 0.1 };
    case 'ditch': return { eng: 0, wind: 0.2 + 0.6 * Math.exp(-Math.abs(v - vDitch) * 1.3), city: 0.1 };
    default: return { eng: 0, wind: 0.08, city: 0.2, water: 1 };
  }
}

// ---- the pad ---------------------------------------------------------------------
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const CHORDS = [
  [0, [50, 57, 64, 66, 69]],          // D  A  E  F# A : calm, open
  [28, [38, 45, 51, 57]],             // D  A  Eb A    : the strike, uneasy
  [52, [40, 47, 50, 55]],             // E  B  D  G
  [70, [38, 45]],                     // bare fifth at the water
  [79, [43, 50, 59, 62, 69]],         // G  D  B  D  A : relief
  [91, [50, 57, 62, 66, 69, 76]],     // D major, wide
];
function padAt(v) {
  let i = 0; while (i + 1 < CHORDS.length && v >= CHORDS[i + 1][0]) i++;
  const [t0, notes] = CHORDS[i];
  const prev = i > 0 ? CHORDS[i - 1][1] : [];
  return { notes, prev, x: clamp((v - t0) / 3, 0, 1) };
}
const padLevel = (v) => {
  let g = 0.07;
  if (v > 28 && v < 70) g = 0.045 * (0.75 + 0.25 * Math.sin(TAU * 1.05 * v));  // a slow throb
  if (v > 70 && v < 79) g = 0.02 * (1 - smooth(70, 72, v)) + 0.02 * smooth(76, 79, v);
  if (v >= 79) g = 0.08;
  return g * smooth(0, 3, v) * (1 - smooth(DURATION - 4, DURATION, v));
};

// ---- render --------------------------------------------------------------------
const nA = noiseGen(1), nB = noiseGen(2), nC = noiseGen(3), nD = noiseGen(4), nE = noiseGen(5);
const rumbleL = new OnePole(), rumbleR = new OnePole(), roarL = new OnePole(), roarR = new OnePole();
const windBP = [new SVF(), new SVF()], cityLP = new OnePole(), cityLP2 = new OnePole();
const radioBP = new SVF(), splashLP = [new OnePole(), new OnePole()], waterLP = [new OnePole(), new OnePole()];
const hornLP = new OnePole(), boomLP = new OnePole();
let brownL = 0, brownR = 0, whinePh = 0, whinePh2 = 0, lapPh = 0;
const padPh = new Map();

for (let i = 0; i < N; i++) {
  const v = i / SR;
  const { shot, local, ft } = shotAt(v);
  const lv = levels(v, shot, local);
  let l = 0, r = 0;

  // Engines: brown-noise rumble, a filtered roar, the fan's buzz.
  const sp = (spool(ft, -1) + spool(ft, 1)) / 2;
  brownL = brownL * 0.995 + nA() * 0.05; brownR = brownR * 0.995 + nB() * 0.05;
  if (lv.eng > 0.001) {
    const rum = rumbleL.run(brownL, lp(120)) * 3.2, rumR = rumbleR.run(brownR, lp(120)) * 3.2;
    const cut = 300 + 2200 * sp;
    const roar = roarL.run(nC(), lp(cut)), roarRr = roarR.run(nD(), lp(cut));
    // Doppler on the takeoff pass: pitch falls as it goes by.
    const dop = lv.pass !== undefined ? 1 + 0.06 * Math.tanh(-lv.pass * 1.5) : 1;
    whinePh += TAU * (620 + 1450 * sp) * dop / SR;
    whinePh2 += TAU * (310 + 725 * sp) * 1.013 * dop / SR;
    const whine = (Math.sin(whinePh) * 0.5 + Math.sin(whinePh2) * 0.6) * (0.25 + 0.75 * sp) * 0.18;
    const g = 0.55 * lv.eng * (0.35 + 0.65 * sp);
    l += g * (rum * 0.9 + roar * 1.1 + whine);
    r += g * (rumR * 0.9 + roarRr * 1.1 + whine * 0.95);
  }

  // Wind over the airframe.
  if (lv.wind > 0.001) {
    const fc = 700 + 300 * Math.sin(v * 0.37) + 200 * Math.sin(v * 1.1);
    const w = lv.wind * 0.9;
    l += windBP[0].run(nE(), fc, 0.9) * w;
    r += windBP[1].run(nA(), fc * 1.07, 0.9) * w;
  }

  // Distant city: low rumble, the odd horn-like swell.
  if (lv.city > 0.001) {
    const c = cityLP2.run(cityLP.run(nB(), lp(300)), lp(180)) * 2.2 * lv.city * (0.8 + 0.2 * Math.sin(v * 0.5));
    l += c; r += c * 0.9;
  }

  // Bird strike: two heavy thumps, then compressor surges.
  for (const [vs, pan] of [[vStrikeL, 0.75], [vStrikeR, 0.35]]) {
    const t = v - vs;
    if (t > -0.01 && t < 1.2) {
      const e = env(t, 0.004, 0.16);
      const thump = Math.sin(TAU * (55 - 25 * Math.min(1, t * 4)) * t) * e * 0.9 + boomLP.run(nC(), lp(900)) * e * 2.5;
      l += thump * pan; r += thump * (1 - pan);
    }
  }
  for (const vp of popTimes) {
    const t = v - vp;
    if (t > 0 && t < 0.5) { const e = env(t, 0.003, 0.06); const p = (nD() * 0.7 + Math.sin(TAU * 80 * t)) * e * 0.55; l += p; r += p; }
  }

  // Radio: squelch clicks, band-limited hiss while the words are up.
  for (const c of radio) {
    for (const edge of [c.t0, c.t1 - 0.3]) {
      const t = v - edge;
      if (t > 0 && t < 0.09) { const k = radioBP.run(nE(), 2400, 0.4) * env(t, 0.002, 0.02) * 0.6; l += k; r += k; }
    }
    if (v > c.t0 && v < c.t1 - 0.3) {
      const h = radioBP.run(nE(), 1800, 0.6) * 0.05 * (0.7 + 0.3 * Math.sin(v * 31));
      l += h; r += h;
    }
  }

  // Ditching: the impact, the splash, the spray coming down.
  {
    const t = v - vDitch;
    if (t > -0.02 && t < 7) {
      const boom = Math.sin(TAU * (48 - 20 * Math.min(1, t)) * t) * env(t, 0.01, 0.7) * 1.3;
      const cut = 7000 * Math.exp(-t * 0.9) + 350;
      const burst = env(t, 0.03, 1.1) * 2.2;
      const sL = splashLP[0].run(nA(), lp(cut)) * burst, sR = splashLP[1].run(nB(), lp(cut)) * burst;
      const rain = t > 0.8 ? nC() * 0.06 * env(t - 0.8, 0.5, 2.2) : 0;
      l += boom + sL + rain; r += boom + sR + rain * 0.9;
    }
  }

  // Afterwards: water against the hull.
  if (lv.water) {
    lapPh += TAU * 0.35 / SR;
    const lap = 0.5 + 0.5 * Math.sin(lapPh) * Math.sin(lapPh * 2.3 + 1);
    l += waterLP[0].run(nD(), lp(500)) * 0.7 * lap * smooth(79, 81, v);
    r += waterLP[1].run(nE(), lp(520)) * 0.7 * (1 - lap * 0.5) * smooth(79, 81, v);
  }

  // A ferry's horn as it comes alongside.
  for (const vh of vHorn) {
    const t = v - vh;
    if (t > 0 && t < 2.2) {
      const e = Math.min(1, t / 0.08) * (t > 1.7 ? Math.max(0, 1 - (t - 1.7) / 0.5) : 1);
      let s = 0;
      for (const f of [110, 138.6]) for (let h = 1; h <= 6; h++) s += Math.sin(TAU * f * h * t) / h;
      const hs = hornLP.run(s, lp(900)) * e * 0.16;
      l += hs * 0.8; r += hs;
    }
  }

  // Pad.
  const pg = padLevel(v);
  if (pg > 0) {
    const { notes, prev, x } = padAt(v);
    for (const [set, w] of [[notes, x], [prev, 1 - x]]) {
      if (w <= 0) continue;
      for (const m of set) {
        for (const det of [-0.12, 0.12]) {
          const key = `${m}${det}`;
          const ph = (padPh.get(key) || 0) + TAU * midi(m + det * 0.1) / SR;
          padPh.set(key, ph);
          const s = (Math.sin(ph) + 0.18 * Math.sin(ph * 2) + 0.06 * Math.sin(ph * 3)) * w * pg / set.length;
          if (det < 0) l += s; else r += s;
        }
      }
    }
  }

  // Master fades and a soft limiter.
  const fade = smooth(0, 1.2, v) * (1 - smooth(DURATION - 2, DURATION, v));
  L[i] = Math.tanh(l * fade * 0.9);
  R[i] = Math.tanh(r * fade * 0.9);
}

// ---- write WAV ---------------------------------------------------------------------
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(clamp(L[i], -1, 1) * 32000), 44 + i * 4);
  buf.writeInt16LE(Math.round(clamp(R[i], -1, 1) * 32000), 46 + i * 4);
}
fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });
const out = path.join(ROOT, 'out', 'soundtrack.wav');
fs.writeFileSync(out, buf);
let peak = 0, rms = 0;
for (let i = 0; i < N; i++) { peak = Math.max(peak, Math.abs(L[i])); rms += L[i] * L[i]; }
console.log(`wrote ${path.relative(ROOT, out)}: ${DURATION}s, peak ${peak.toFixed(2)}, rms ${Math.sqrt(rms / N).toFixed(3)}`);
