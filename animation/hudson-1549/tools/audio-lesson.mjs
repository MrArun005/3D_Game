// Soundtrack for film 2: a light, warm pad, Spark's chirpy "voice" while it
// talks, a loading tick, wind in the air shots, the splash, water afterwards.
//
//   node tools/audio-lesson.mjs   -> out/lesson-soundtrack.wav
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DITCH_FT, smooth, clamp } from '../src/timeline.js';
import { LESSON_DURATION, LESSON_SHOTS, lessonShotAt, BUBBLES, talkEnd } from '../src/lesson.js';
import { rng } from '../src/rng.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SR = 48000, N = Math.ceil(LESSON_DURATION * SR), TAU = Math.PI * 2;
const L = new Float32Array(N), R = new Float32Array(N);
const lp = (fc) => 1 - Math.exp(-TAU * fc / SR);
class OnePole { constructor() { this.y = 0; } run(x, a) { this.y += a * (x - this.y); return this.y; } }
class SVF { constructor() { this.l = 0; this.b = 0; }
  run(x, fc, q = 0.7) { const f = 2 * Math.sin(Math.PI * Math.min(fc, SR / 6) / SR); this.l += f * this.b; const h = x - this.l - q * this.b; this.b += f * h; return this.b; } }
const noise = (() => { const r = rng(9); return () => r() * 2 - 1; })();
const noise2 = (() => { const r = rng(10); return () => r() * 2 - 1; })();
const env = (t, a, d) => (t < 0 ? 0 : t < a ? t / a : Math.exp(-(t - a) / d));
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const shot = (n) => LESSON_SHOTS.find((s) => s.name === n);

// Where the ditching lands in this film.
const ds = shot('ditch');
let vDitch = null;
for (let k = 0; k <= 4000; k++) { const v = ds.start + ds.dur * k / 4000; if (lessonShotAt(v).ft >= DITCH_FT) { vDitch = v; break; } }

// Spark's voice: a syllable every ~95 ms while the text types, pitch wandering
// on a pentatonic scale, a little formant filter to sound like a small creature.
const SCALE = [0, 2, 4, 7, 9, 12, 14];
const syllables = [];
for (const c of BUBBLES) {
  const r = rng(Math.round(c.t0 * 100));
  for (let t = c.t0 + 0.05; t < talkEnd(c) - 0.05; t += 0.085 + r() * 0.05) {
    if (r() < 0.12) continue;                       // gaps between words
    syllables.push({ t, f: midi(72 + SCALE[Math.floor(r() * SCALE.length)]), d: 0.05 + r() * 0.04, g: 0.6 + r() * 0.4 });
  }
}

const CHORDS = [
  [0, [60, 64, 67, 71]], [7, [57, 60, 64, 67]], [18, [53, 57, 60, 64]], [31, [55, 59, 62, 66]],
  [40, [60, 64, 67, 71]], [50, [57, 60, 64, 67]], [62, [53, 57, 60, 65]], [72, [55, 60, 64, 67, 72]],
];
const padPh = new Map();
let sy0 = 0;
const windBP = [new SVF(), new SVF()], voiceBP = new SVF(), splash = [new OnePole(), new OnePole()], water = [new OnePole(), new OnePole()];

for (let i = 0; i < N; i++) {
  const v = i / SR;
  const { shot: s, local } = lessonShotAt(v);
  let l = 0, r = 0;

  // Pad: soft triangle-ish tones, slow chord changes.
  let ci = 0; while (ci + 1 < CHORDS.length && v >= CHORDS[ci + 1][0]) ci++;
  const x = clamp((v - CHORDS[ci][0]) / 2.5, 0, 1);
  const pg = 0.07 * smooth(0, 2.5, v) * (1 - smooth(LESSON_DURATION - 3, LESSON_DURATION, v)) * (s.name === 'ditch' && v > vDitch - 1 && v < vDitch + 3 ? 0.3 : 1);
  for (const [set, w] of [[CHORDS[ci][1], x], [ci ? CHORDS[ci - 1][1] : [], 1 - x]]) {
    if (w <= 0) continue;
    set.forEach((m, j) => {
      const key = `${m}`;
      const ph = (padPh.get(key) || 0) + TAU * midi(m - 12) / SR;
      padPh.set(key, ph);
      const tone = (Math.sin(ph) + Math.sin(ph * 3) / 9 + Math.sin(ph * 2.002) * 0.25) * w * pg / set.length;
      if (j % 2) l += tone; else r += tone;
      l += tone * 0.5; r += tone * 0.5;
    });
  }

  // Loading tick while Spark spins.
  const loading = (s.name === 'intro' && local < 2.4) || (s.name === 'lessons' && local > 8.6);
  if (loading) {
    const t = (v * 6) % 1 / 6;
    const tick = Math.sin(TAU * 1760 * t) * env(t, 0.001, 0.012) * 0.12;
    l += tick; r += tick;
  }

  // Voice.
  while (sy0 < syllables.length && v > syllables[sy0].t + syllables[sy0].d + 0.05) sy0++;
  for (let k = sy0; k < syllables.length; k++) {
    const y = syllables[k], t = v - y.t;
    if (t < 0) break;
    if (t > y.d + 0.03) continue;
    const e = Math.min(1, t / 0.008) * Math.max(0, 1 - Math.max(0, t - y.d) / 0.03);
    const f = y.f * (1 + 0.08 * Math.sin(TAU * 7 * t)) * (1 - 0.15 * t / y.d);
    const src = Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * f * 2 * t) + 0.2 * Math.sin(TAU * f * 3 * t);
    const out = (src * 0.8 + voiceBP.run(src, f * 2.5, 0.5) * 0.6) * e * y.g * 0.12;
    l += out; r += out;
  }

  // Wind in the airborne shots.
  if (['glide', 'apu', 'river'].includes(s.name) || (s.name === 'ditch' && v < vDitch)) {
    const g = s.name === 'apu' ? 0.32 : 0.2;
    l += windBP[0].run(noise(), 650 + 250 * Math.sin(v * 0.4), 0.9) * g;
    r += windBP[1].run(noise2(), 700 + 250 * Math.sin(v * 0.5), 0.9) * g;
  }

  // The ditching.
  if (vDitch !== null) {
    const t = v - vDitch;
    if (t > -0.02 && t < 6) {
      const boom = Math.sin(TAU * (48 - 20 * Math.min(1, t)) * t) * env(t, 0.01, 0.6) * 0.9;
      const cut = 6000 * Math.exp(-t * 0.9) + 300, b = env(t, 0.03, 1.0) * 1.6;
      l += boom + splash[0].run(noise(), lp(cut)) * b;
      r += boom + splash[1].run(noise2(), lp(cut)) * b;
    }
  }

  // Water after.
  if (s.name === 'rescue' || s.name === 'lessons') {
    const lap = 0.5 + 0.5 * Math.sin(v * 2.1) * Math.sin(v * 4.9 + 1);
    const g = s.name === 'lessons' ? 0.4 * (1 - smooth(0, 6, local)) : 0.6;
    l += water[0].run(noise(), lp(480)) * g * lap;
    r += water[1].run(noise2(), lp(500)) * g * (1 - lap * 0.5);
  }

  const fade = smooth(0, 1, v) * (1 - smooth(LESSON_DURATION - 1.5, LESSON_DURATION, v));
  L[i] = Math.tanh(l * fade);
  R[i] = Math.tanh(r * fade);
}

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
fs.writeFileSync(path.join(ROOT, 'out', 'lesson-soundtrack.wav'), buf);
console.log(`wrote out/lesson-soundtrack.wav: ${LESSON_DURATION}s, ${syllables.length} syllables, ditch at ${vDitch?.toFixed(2)}s`);
