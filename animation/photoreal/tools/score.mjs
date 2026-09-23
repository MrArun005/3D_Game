// Soundtrack for "Before Us": a slow cinematic score (low strings pad, a rising
// theme at the end), each scene's natural sound, and the narrator on top with
// everything else ducked under the voice.
//   node tools/score.mjs -> out/before-us.wav
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const timing = JSON.parse(fs.readFileSync(path.join(ROOT, 'stories', 'before-us.timing.json'), 'utf8'));
const shots = JSON.parse(fs.readFileSync(path.join(ROOT, 'stories', 'before-us.shots.json'), 'utf8'));
const SR = 44100, DUR = timing.duration, N = Math.ceil(DUR * SR), TAU = Math.PI * 2;
const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const nz = rng(1), nz2 = rng(2);
const MUS = [new Float32Array(N), new Float32Array(N)], FX = [new Float32Array(N), new Float32Array(N)];
const S = Object.fromEntries(shots.map((s) => [s.shot, s]));
const within = (t, s) => t >= s.start && t < s.start + s.seconds;
const env = (t, s, fin = 1.2, fout = 1.2) => Math.min(1, Math.max(0, (t - s.start) / fin), Math.max(0, (s.start + s.seconds - t) / fout));
const midi = (m) => 440 * 2 ** ((m - 69) / 12);
class LP { constructor() { this.y = 0; } run(x, a) { this.y += a * (x - this.y); return this.y; } }
const lpa = (fc) => 1 - Math.exp(-TAU * fc / SR);

// ---- score: slow chords of detuned saws through a soft filter, like a string section ----------
const CH = [[0, [38, 45, 50, 53]], [12.4, [36, 43, 48, 51]], [23.1, [41, 48, 53, 57]], [35.9, [34, 41, 46, 50]], [44.6, [36, 43, 48, 52, 55]], [55, [41, 48, 53, 57, 60]]];
{
  const ph = new Float64Array(64), f = [new LP(), new LP()];
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    let c = 0; while (c + 1 < CH.length && t >= CH[c + 1][0]) c++;
    const x = Math.min(1, (t - CH[c][0]) / 3);
    let l = 0, r = 0;
    for (const [set, w] of [[CH[c][1], x], [c ? CH[c - 1][1] : [], 1 - x]]) {
      if (w <= 0) continue;
      set.forEach((m, j) => {
        for (let d = 0; d < 2; d++) {
          const k = (m * 2 + d) % 64;
          ph[k] = (ph[k] + midi(m) * (1 + (d ? 0.004 : -0.004)) / SR) % 1;
          const saw = ph[k] * 2 - 1;
          if (d) r += saw * w / set.length; else l += saw * w / set.length;
        }
      });
    }
    // The filter opens as Earth warms toward the end.
    const open = 500 + 1800 * Math.min(1, Math.max(0, (t - 44) / 14));
    const swell = 0.6 + 0.4 * Math.sin(t * 0.35);
    const g = 0.13 * swell * Math.min(1, t / 3) * Math.min(1, (DUR - t) / 3);
    MUS[0][i] = f[0].run(l, lpa(open)) * g; MUS[1][i] = f[1].run(r, lpa(open)) * g;
  }
  // A simple rising theme over the wheat.
  const theme = [[46.0, 69, 2.2], [48.4, 72, 2.2], [50.8, 74, 3.0], [54.2, 76, 2.0], [56.3, 74, 1.4], [57.8, 72, 4.5]];
  for (const [t0, m, d] of theme) {
    const s0 = Math.round(t0 * SR), n = Math.round(d * SR); let p = 0;
    for (let k = 0; k < n; k++) {
      const u = k / n, t = k / SR;
      p += TAU * midi(m) * (1 + 0.005 * Math.sin(TAU * 5 * t)) / SR;
      const e = Math.min(1, t / 0.4) * Math.min(1, (d - t) / 0.8);
      const v = (Math.sin(p) + 0.3 * Math.sin(2 * p) + 0.1 * Math.sin(3 * p)) * e * 0.05;
      if (s0 + k < N) { MUS[0][s0 + k] += v * 0.9; MUS[1][s0 + k] += v; }
      void u;
    }
  }
}

// ---- each scene's sound ---------------------------------------------------------------------------
{
  const a = new LP(), b = new LP(), c = new LP(), d = new LP(), e2 = new LP();
  for (let i = 0; i < N; i++) {
    const t = i / SR; let l = 0, r = 0;
    const n1 = nz() * 2 - 1, n2 = nz2() * 2 - 1;
    if (within(t, S.volcano)) {                     // deep rumble and lava crackle
      const k = env(t, S.volcano, 1.5, 1.0);
      const rum = a.run(n1, lpa(60)) * 7 * (0.7 + 0.3 * Math.sin(t * 1.3));
      l += rum * k; r += rum * k * 0.95;
      if (nz() < 0.0009) { const v = (nz() * 2 - 1) * 0.5 * k; l += v; r += v * 0.7; }
    }
    if (within(t, S.rain)) {                        // heavy rain hiss
      const k = env(t, S.rain);
      l += b.run(n1, lpa(4500)) * 0.28 * k; r += c.run(n2, lpa(4200)) * 0.28 * k;
    }
    if (within(t, S.coast)) {                       // surf, in slow swells
      const k = env(t, S.coast), sw = Math.pow(0.5 + 0.5 * Math.sin(t * 0.9), 2);
      l += d.run(n1, lpa(900)) * 1.4 * sw * k; r += e2.run(n2, lpa(850)) * 1.3 * (0.4 + 0.6 * sw) * k;
    }
    if (within(t, S.glacier)) {                     // cold, whistling wind
      const k = env(t, S.glacier), gust = 0.6 + 0.4 * Math.sin(t * 0.7) * Math.sin(t * 1.9);
      const w = a.run(n1, lpa(1400)) * 0.9 * gust * k;
      l += w; r += w * 0.8;
    }
    if (within(t, S.wheat)) {                       // soft wind through grass
      const k = env(t, S.wheat, 1.5, 2.5);
      l += b.run(n1, lpa(2500)) * 0.12 * k * (0.6 + 0.4 * Math.sin(t * 0.5)); r += c.run(n2, lpa(2400)) * 0.12 * k;
    }
    FX[0][i] = l; FX[1][i] = r;
  }
}
// Thunder with the lightning flashes (rain.py flares the sky at 3.25 s and 8.45 s into the shot).
for (const dt of [3.25, 8.45]) {
  const t0 = S.rain.start + dt + 0.35, s0 = Math.round(t0 * SR), n = Math.round(4.5 * SR), f = new LP();
  for (let k = 0; k < n && s0 + k < N; k++) {
    const u = k / SR, e = Math.min(1, u / 0.05) * Math.exp(-u / 1.4) * (0.8 + 0.2 * Math.sin(u * 7));
    const v = f.run(nz() * 2 - 1, lpa(220 - 120 * Math.min(1, u / 3))) * 9 * e;
    FX[0][s0 + k] += v; FX[1][s0 + k] += v * 0.9;
  }
}
// Birds over the wheat.
{ const r = rng(9); for (let t = S.wheat.start + 3; t < DUR - 3; t += 1.5 + r() * 2.5) {
  const f0 = 2600 + r() * 2000, pan = r();
  for (let q = 0; q < 2 + Math.floor(r() * 3); q++) { const s0 = Math.round((t + q * 0.12) * SR), n = Math.round(0.08 * SR); let p = 0;
    for (let k = 0; k < n; k++) { const u = k / n; p += TAU * f0 * (1 + 0.3 * Math.sin(u * Math.PI)) / SR; const v = Math.sin(p) * Math.sin(u * Math.PI) * 0.025; if (s0 + k < N) { FX[0][s0 + k] += v * (1 - pan); FX[1][s0 + k] += v * pan; } } } } }

// ---- narration and mix ----------------------------------------------------------------------------
const wav = fs.readFileSync(path.join(ROOT, 'out', 'before-us-voice.wav'));
const vsr = wav.readUInt32LE(24), bits = wav.readUInt16LE(34);
let off = 12; while (wav.toString('ascii', off, off + 4) !== 'data') off += 8 + wav.readUInt32LE(off + 4);
const vn = wav.readUInt32LE(off + 4) / (bits / 8), d0 = off + 8;
const rd = bits === 16 ? (i) => wav.readInt16LE(d0 + i * 2) / 32768 : (i) => wav.readFloatLE(d0 + i * 4);
const out = Buffer.alloc(44 + N * 4);
out.write('RIFF', 0); out.writeUInt32LE(36 + N * 4, 4); out.write('WAVE', 8);
out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34);
out.write('data', 36); out.writeUInt32LE(N * 4, 40);
let e = 0, peak = 0;
for (let i = 0; i < N; i++) {
  const x = i * vsr / SR, j = Math.floor(x), fr = x - j;
  const vo = j + 1 < vn ? rd(j) * (1 - fr) + rd(j + 1) * fr : 0;
  e = Math.max(Math.abs(vo), e * 0.99996);
  const duck = 1 - 0.5 * Math.min(1, e * 5);
  const fade = Math.min(1, i / (SR * 1.5), (N - i) / (SR * 2));
  const o = [0, 1].map((c) => Math.tanh(((MUS[c][i] + FX[c][i] * 0.8) * duck + vo * 1.0) * fade));
  peak = Math.max(peak, Math.abs(o[0]));
  out.writeInt16LE(Math.round(o[0] * 32000), 44 + i * 4); out.writeInt16LE(Math.round(o[1] * 32000), 46 + i * 4);
}
fs.writeFileSync(path.join(ROOT, 'out', 'before-us.wav'), out);
console.log(`wrote out/before-us.wav, ${DUR}s, peak ${peak.toFixed(2)}`);
