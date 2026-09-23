// Soundtrack for the farming cartoon: a gentle plucked-and-flute tune, birds and
// breeze, story sound effects on their cues, and Clawd's narration on top with
// the music ducked beneath it. All synthesised except the narration WAV.
//   node tools/audio.mjs [farming|coconut] -> out/cartoon-<story>.wav
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORY = process.argv[2] || 'farming';
const timing = JSON.parse(fs.readFileSync(path.join(ROOT, 'stories', `${STORY}.timing.json`), 'utf8'));
const SR = 44100, DUR = timing.duration, N = Math.ceil(DUR * SR), TAU = Math.PI * 2;
const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const L = Object.fromEntries(timing.lines.map((l) => [l.id, l]));
const at = (id, word) => { const l = L[id]; const i = l.text.indexOf(word); return l.t0 + l.dur * Math.max(0, i) / l.text.length; };
const midi = (m) => 440 * 2 ** ((m - 69) / 12);
const MUS = [new Float32Array(N), new Float32Array(N)], FX = [new Float32Array(N), new Float32Array(N)];
const put = (buf, i, l, r = l) => { if (i >= 0 && i < N) { buf[0][i] += l; buf[1][i] += r; } };
const nz = rng(5);

// ---- music: D major pentatonic, 96 bpm in 6/8 feel ------------------------------------------
function pluck(t0, f, gain, pan) {
  const n = Math.round(SR / f), b = new Float32Array(n), r = rng(Math.round(f * 7 + t0 * 100));
  for (let i = 0; i < n; i++) b[i] = r() * 2 - 1;
  const s = Math.round(t0 * SR);
  for (let k = 0, j = 0; k < SR * 1.4; k++, j = (j + 1) % n) {
    const a = b[j]; b[j] = 0.497 * (a + b[(j + 1) % n]);
    put(MUS, s + k, a * gain * (1 - pan), a * gain * pan);
  }
}
function flute(t0, f, d, gain) {
  const s = Math.round(t0 * SR), n = Math.round(d * SR);
  let ph = 0;
  for (let k = 0; k < n; k++) {
    const t = k / SR, e = Math.min(1, t / 0.06) * Math.min(1, (d - t) / 0.12);
    ph += TAU * f * (1 + 0.006 * Math.sin(TAU * 5 * t) * Math.min(1, t * 3)) / SR;
    const v = (Math.sin(ph) + 0.18 * Math.sin(2 * ph) + 0.05 * (nz() * 2 - 1)) * e * gain;
    put(MUS, s + k, v * 0.9, v);
  }
}
const BEAT = 0.625;                                // 96 bpm
const CH = [[50, 57, 62, 66], [55, 59, 62, 67], [57, 61, 64, 69], [52, 59, 62, 66]];  // D G A Bm-ish
const MEL = [74, 76, 78, 81, 78, 76, 74, 71, 74, 76, 78, 76, 74, 71, 69, 71];
for (let bar = 0; bar * 4 * BEAT < DUR - 2; bar++) {
  const t = bar * 4 * BEAT, ch = CH[bar % 4];
  for (let b = 0; b < 4; b++) ch.forEach((m, j) => { if ((b + j) % 2 === 0) pluck(t + b * BEAT + j * 0.03, midi(m), 0.05, 0.3 + j * 0.12); });
  pluck(t, midi(ch[0] - 12), 0.08, 0.5);
  if (bar >= 1 && bar % 8 !== 7) {                  // the flute rests now and then
    for (let q = 0; q < 2; q++) { const m = MEL[(bar * 2 + q) % MEL.length]; flute(t + q * 2 * BEAT, midi(m), 2 * BEAT * 0.92, 0.045); }
  }
}

// ---- ambience ----------------------------------------------------------------------------------------
if (STORY === 'coconut') {
  // Surf: slow swells of filtered noise.
  let lp = 0; for (let i = 0; i < N; i++) { lp += 0.01 * ((nz() * 2 - 1) - lp); const t = i / SR; const sw = 0.5 + 0.5 * Math.sin(t * 0.9) * Math.sin(t * 0.37 + 1); put(FX, i, lp * 1.5 * sw, lp * 1.4 * (1 - sw * 0.3)); }
} else {
  let lp = 0; for (let i = 0; i < N; i++) { lp += 0.003 * ((nz() * 2 - 1) - lp); const w = lp * 1.6 * (0.7 + 0.3 * Math.sin(i / SR * 0.3)); put(FX, i, w, w * 0.9); }
}
{
  const r = rng(11);
  const quiet = STORY === 'farming' ? [at('change', 'It all'), L.bye.t0] : [L.tool.t0 - 0.5, L.tool.t0 + L.tool.dur];
  for (let t = 1.5; t < DUR - 2; t += 1.2 + r() * 2.8) {
    if (t > quiet[0] && t < quiet[1]) continue;
    const reps = 2 + Math.floor(r() * 3), f0 = 2800 + r() * 1800, pan = r();
    for (let k = 0; k < reps; k++) {
      const s = Math.round((t + k * 0.11) * SR), n = Math.round(0.07 * SR);
      let ph = 0;
      for (let j = 0; j < n; j++) { const u = j / n; ph += TAU * f0 * (1 + 0.35 * Math.sin(u * Math.PI)) / SR; const v = Math.sin(ph) * Math.sin(u * Math.PI) * 0.03; put(FX, s + j, v * (1 - pan), v * pan); }
    }
  }
}

// ---- story sound effects ----------------------------------------------------------------------------
const tick = (t, f, d, g) => { const s = Math.round(t * SR), n = Math.round(d * SR); for (let j = 0; j < n; j++) { const v = Math.sin(TAU * f * j / SR) * Math.exp(-j / (n / 5)) * g; put(FX, s + j, v); } };
const sweep = (t, f0, f1, d, g) => { const s = Math.round(t * SR), n = Math.round(d * SR); let ph = 0; for (let j = 0; j < n; j++) { const u = j / n; ph += TAU * (f0 + (f1 - f0) * u) / SR; put(FX, s + j, Math.sin(ph) * g * Math.min(1, (1 - u) * 6, u * 30)); } };
const thud = (t, g = 0.35) => { tick(t, 70, 0.25, g); const s = Math.round(t * SR); let lp = 0; for (let j = 0; j < SR * 0.12; j++) { lp += 0.2 * ((nz() * 2 - 1) - lp); put(FX, s + j, lp * g * (1 - j / (SR * 0.12))); } };
const snap = (t, g = 0.4) => { const s = Math.round(t * SR); for (let j = 0; j < SR * 0.09; j++) put(FX, s + j, (nz() * 2 - 1) * g * Math.exp(-j / (SR * 0.015))); };
const chime = (t, g = 0.08) => { for (const [f, d] of [[1318, 0], [1760, 0.09], [2637, 0.18]]) tick(t + d, f, 0.6, g); };
if (STORY === 'coconut') {
  { const a = at('play', 'Racing'); for (let t = L.play.t0 - 0.4; t < L.play.t0 + L.play.dur + 0.3; t += 0.11) tick(t, 150 + nz() * 80, 0.04, 0.07); void a; }
  chime(at('spot', 'Coconuts'), 0.07);
  { const w = at('slip', 'whoops'); sweep(w, 1400, 300, 0.7, 0.09); thud(w + 0.72); }
  { const c0 = L.climb.t0 - 0.45; sweep(c0 + 0.78, 1200, 400, 0.5, 0.07); thud(c0 + 1.3, 0.2); sweep(c0 + 2.1, 1200, 400, 0.5, 0.07); thud(c0 + 2.6, 0.2);
    for (let t = at('climb', 'Grip'); t < L.climb.t0 + L.climb.dur; t += 0.28) tick(t, 600 + nz() * 300, 0.05, 0.05); }
  { const f = at('pick', 'free'), th = at('pick', 'Thud'); tick(f - 0.3, 300, 0.2, 0.08); sweep(f, 1800, 500, th - f, 0.06); thud(th, 0.45); }
  { snap(at('try', 'bites'), 0.18); tick(at('try', 'bites') + 0.15, 900, 0.05, 0.1);
    for (let k = 0; k < 6; k++) tick(at('try', 'squeezes') + k * 0.12, 220, 0.08, 0.05);
    thud(at('try', 'kicks') + 0.3, 0.3); sweep(at('try', 'Ow'), 500, 900, 0.3, 0.08); }
  chime(at('idea', 'idea'), 0.1);
  { tick(at('crack', 'Bash'), 90, 0.2, 0.3); thud(at('crack', 'Bash'), 0.3); thud(at('crack', 'Bash! C'), 0.35); snap(at('crack', 'Crack'), 0.5); thud(at('crack', 'Crack'), 0.3);
    const s0 = at('crack', 'Crack') + 0.1; for (let k = 0; k < 8; k++) tick(s0 + k * 0.05, 2000 + k * 150, 0.03, 0.05); }
  chime(at('tool', 'tool'), 0.08);
  { const t = at('share', 'try'); for (const [m, d] of [[74, 0], [78, 0.12], [81, 0.24], [86, 0.36]]) tick(t + d, midi(m), 0.4, 0.07); }
}
if (STORY === 'farming') {
// Grains pattering to the ground as the wheat shatters.
{ const d0 = at('shatter', 'shatter'); for (let i = 0; i < 10; i++) { const t = d0 + (i / 10) * 2.2 + 0.55; tick(t, 1800 + i * 90, 0.05, 0.12); tick(t + 0.07, 1400, 0.03, 0.06); } }
// Gazelle hooves.
{ const h0 = at('nomads', 'hunt'); for (let t = h0; t < h0 + 3.2; t += 0.14) tick(t, 180 + nz() * 60, 0.05, 0.09); }
// Picking the good heads.
{ const p0 = at('sticky', 'easiest'); for (const x of [244, 532, 772, 1060]) { const t = p0 - 0.8 + 4.6 * (x + 10 - 60) / 1040; tick(t, 900, 0.08, 0.1); tick(t + 0.06, 1300, 0.06, 0.08); } }
// Mud bricks going up.
{ const b0 = at('village', 'Tents'); for (let k = 0; k < 6; k++) tick(b0 + k * 0.32, 120, 0.12, 0.2); }
// Sheep.
for (const t of [at('animals', 'Sheep') + 0.3, at('animals', 'store') + 0.4]) {
  const s = Math.round(t * SR), n = Math.round(0.55 * SR); let ph = 0;
  for (let j = 0; j < n; j++) { const u = j / n; ph += TAU * (330 + 30 * Math.sin(TAU * 7 * j / SR)) / SR; const saw = ((ph / TAU) % 1) * 2 - 1; put(FX, s + j, saw * Math.sin(Math.PI * u) * 0.05); }
}
// Map pins pop.
for (const [id, w] of [['world', 'And'], ['world', 'China'], ['world', 'Mexico'], ['world', 'Andes'], ['world', 'Africa']]) {
  const t = id === 'world' && w === 'And' ? L.world.t0 : at(id, w);
  const s = Math.round(t * SR), n = Math.round(0.12 * SR); let ph = 0;
  for (let j = 0; j < n; j++) { ph += TAU * (500 + 900 * j / n) / SR; put(FX, s + j, Math.sin(ph) * (1 - j / n) * 0.12); }
}

}

// ---- narration + mix ------------------------------------------------------------------------------
const VO = new Float32Array(N), duck = new Float32Array(N).fill(1);
{
  const wav = fs.readFileSync(path.join(ROOT, 'out', `${STORY}-voice.wav`));
  const sr = wav.readUInt32LE(24), bits = wav.readUInt16LE(34);
  let off = 12; while (wav.toString('ascii', off, off + 4) !== 'data') off += 8 + wav.readUInt32LE(off + 4);
  const n = wav.readUInt32LE(off + 4) / (bits / 8), d0 = off + 8;
  const rd = bits === 16 ? (i) => wav.readInt16LE(d0 + i * 2) / 32768 : (i) => wav.readFloatLE(d0 + i * 4);
  let e = 0;
  for (let i = 0; i < N; i++) {
    const x = i * sr / SR, j = Math.floor(x), f = x - j;
    VO[i] = j + 1 < n ? rd(j) * (1 - f) + rd(j + 1) * f : 0;
    e = Math.max(Math.abs(VO[i]), e * 0.99996);
    duck[i] = 1 - 0.55 * Math.min(1, e * 5);
  }
}
const fade = (i) => Math.min(1, i / (SR * 0.8), (N - i) / (SR * 1.5));
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
let peak = 0;
for (let i = 0; i < N; i++) {
  const out = [0, 1].map((c) => Math.tanh((Math.tanh(MUS[c][i] * 2.2) * 0.55 * duck[i] + FX[c][i] * 1.2 + VO[i] * 0.95) * fade(i)));
  peak = Math.max(peak, Math.abs(out[0]));
  buf.writeInt16LE(Math.round(out[0] * 32000), 44 + i * 4);
  buf.writeInt16LE(Math.round(out[1] * 32000), 46 + i * 4);
}
fs.writeFileSync(path.join(ROOT, 'out', `cartoon-${STORY}.wav`), buf);
console.log(`wrote out/cartoon-${STORY}.wav, peak ${peak.toFixed(2)}`);
