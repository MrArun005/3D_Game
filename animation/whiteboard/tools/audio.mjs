// Soundtrack for the whiteboard story, synthesised from the story's own timing:
// marker squeaks while ink goes down, eraser swishes, the critter's 8-bit
// chatter while it talks, little boings for hops, and a plucked ukulele-ish tune
// (Karplus-Strong strings).
// A story with a VOICE file gets the narration mixed in, with the music ducked
// under it.
//   node tools/audio.mjs              -> out/whiteboard-1549.wav
//   node tools/audio.mjs pythagoras   -> out/whiteboard-pythagoras.wav
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng } from '../src/ink.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = process.argv[2];
const story = await import(NAME ? `../stories/${NAME}.js` : '../src/story.js');
const { DURATION, ITEMS, WIPES, WIPE_DUR, BUBBLES, TYPE_RATE, HOPS } = story;
const OUTNAME = NAME ? `whiteboard-${NAME}` : 'whiteboard-1549';
const SR = 44100, N = Math.ceil(DURATION * SR), TAU = Math.PI * 2;
const L = new Float32Array(N), Rr = new Float32Array(N);
const ML = new Float32Array(N), MR = new Float32Array(N);   // music, ducked under the voice
let music = false;
const add = (i, l, r = l) => { if (i >= 0 && i < N) { if (music) { ML[i] += l; MR[i] += r; } else { L[i] += l; Rr[i] += r; } } };
const nz = rng(3);

// ---- the tune: C G Am F, one chord a bar, strummed plucks ------------------------------
function pluck(t0, freq, gain, pan) {
  const n = Math.round(SR / freq), buf = new Float32Array(n), r = rng(Math.round(freq * 100 + t0 * 10));
  for (let i = 0; i < n; i++) buf[i] = r() * 2 - 1;
  const start = Math.round(t0 * SR), len = Math.round(SR * 1.6);
  let idx = 0;
  for (let k = 0; k < len; k++) {
    const a = buf[idx], b = buf[(idx + 1) % n];
    buf[idx] = 0.4985 * (a + b);
    const e = Math.min(1, k / 60) * gain;
    add(start + k, a * e * (1 - pan), a * e * pan);
    idx = (idx + 1) % n;
  }
}
const midi = (m) => 440 * 2 ** ((m - 69) / 12);
const CHORDS = [[60, 64, 67, 72], [55, 62, 67, 71], [57, 60, 64, 69], [53, 60, 65, 69]];
const BAR = 2.4;
music = true;
for (let bar = 0; bar * BAR < DURATION - 1; bar++) {
  const ch = CHORDS[bar % 4];
  for (const [beat, down] of [[0, 1], [0.6, 0], [1.2, 1], [1.8, 0]]) {
    const t = bar * BAR + beat;
    const notes = down ? ch : [...ch].reverse();
    notes.forEach((m, j) => pluck(t + j * 0.012, midi(m), down ? 0.07 : 0.045, 0.3 + j * 0.13));
  }
  // A little bass on the downbeat.
  pluck(bar * BAR, midi(CHORDS[bar % 4][0] - 12), 0.09, 0.5);
}

music = false;

// ---- marker squeak / scribble while ink goes down ---------------------------------------------
{
  let y1 = 0, y2 = 0;
  for (const it of ITEMS) {
    if (it.kind === 'custom') continue;
    const a = Math.round(it.t0 * SR), b = Math.round((it.t0 + it.dur) * SR);
    const r = rng(a), f0 = it.kind === 'text' ? 2600 : 1900;
    for (let i = a; i < b; i++) {
      const t = (i - a) / SR;
      // Strokes come in bursts: speed wobbles, so the squeak does too.
      const speed = 0.5 + 0.5 * Math.sin(t * (it.kind === 'text' ? 38 : 17) + r() * 0.2);
      const f = 2 * Math.sin(Math.PI * (f0 + 500 * speed) / SR);
      const x = nz() * 2 - 1;
      y1 += f * y2; const h = x - y1 - 0.25 * y2; y2 += f * h;   // resonant band-pass: the squeak
      const env = Math.min(1, t / 0.02) * Math.min(1, (b - i) / SR / 0.03);
      add(i, y2 * 0.05 * speed * env + x * 0.012 * env);
    }
  }
}

// ---- eraser swish ---------------------------------------------------------------------------
for (const w of WIPES) {
  let lp = 0;
  const a = Math.round(w * SR), n = Math.round(WIPE_DUR * SR);
  for (let k = 0; k < n; k++) {
    const t = k / n;
    lp += 0.08 * ((nz() * 2 - 1) - lp);
    const e = Math.sin(Math.PI * t) * (0.7 + 0.3 * Math.sin(t * 60));
    add(a + k, lp * 0.9 * e * (1 - t), lp * 0.9 * e * t);
  }
}

// ---- the critter's voice: square-wave syllables ---------------------------------------------
for (const b of BUBBLES) {
  const r = rng(Math.round(b.t0 * 1000));
  const end = b.t0 + b.text.length / TYPE_RATE;
  for (let t = b.t0 + 0.03; t < end; t += 0.07 + r() * 0.04) {
    if (r() < 0.15) continue;
    const f = midi(76 + [0, 2, 4, 7, 9, 12][Math.floor(r() * 6)]), d = 0.045 + r() * 0.03;
    const a = Math.round(t * SR), n = Math.round(d * SR);
    for (let k = 0; k < n; k++) {
      const tt = k / SR, ph = (f * (1 - 0.1 * tt / d) * tt) % 1;
      const sq = ph < 0.5 ? 1 : -1;
      const e = Math.min(1, k / 80) * (1 - k / n);
      add(a + k, sq * e * 0.045);
    }
  }
}

// ---- hops: a quick upward boing ----------------------------------------------------------------
for (const h of HOPS) {
  const a = Math.round(h * SR), n = Math.round(0.22 * SR);
  let ph = 0;
  for (let k = 0; k < n; k++) {
    const t = k / n;
    ph += TAU * (300 + 600 * t) / SR;
    add(a + k, Math.sin(ph) * (1 - t) * 0.12);
  }
}

// ---- narration --------------------------------------------------------------------------------
const duck = new Float32Array(N).fill(1), VO = new Float32Array(N);
if (story.VOICE) {
  const wav = fs.readFileSync(path.join(ROOT, 'out', story.VOICE));
  const sr = wav.readUInt32LE(24), bits = wav.readUInt16LE(34);
  let off = 12; while (wav.toString('ascii', off, off + 4) !== 'data') off += 8 + wav.readUInt32LE(off + 4);
  const n = wav.readUInt32LE(off + 4) / (bits / 8), d0 = off + 8;
  const rd = bits === 16 ? (i) => wav.readInt16LE(d0 + i * 2) / 32768 : (i) => wav.readFloatLE(d0 + i * 4);
  let envl = 0;
  for (let i = 0; i < N; i++) {
    const x = i * sr / SR, j = Math.floor(x), f = x - j;
    const v = j + 1 < n ? rd(j) * (1 - f) + rd(j + 1) * f : 0;
    VO[i] = v;
    envl = Math.max(Math.abs(v), envl * 0.99995);
    duck[i] = 1 - 0.6 * Math.min(1, envl * 6);
  }
}
for (let i = 0; i < N; i++) { L[i] += ML[i] * duck[i]; Rr[i] += MR[i] * duck[i]; }

// ---- write ----------------------------------------------------------------------------------
const fade = (i) => Math.min(1, i / (SR * 0.6), (N - i) / (SR * 1.2));
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
let peak = 0;
for (let i = 0; i < N; i++) {
  // Effects and music through the soft drive; the voice added clean on top.
  const vo = VO[i] * 0.95;
  const l = Math.tanh(Math.tanh(L[i] * 2.6) * 0.75 + vo) * fade(i), r = Math.tanh(Math.tanh(Rr[i] * 2.6) * 0.75 + vo) * fade(i);
  peak = Math.max(peak, Math.abs(l));
  buf.writeInt16LE(Math.round(l * 32000), 44 + i * 4);
  buf.writeInt16LE(Math.round(r * 32000), 46 + i * 4);
}
fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'out', `${OUTNAME}.wav`), buf);
console.log(`wrote out/${OUTNAME}.wav, peak ${peak.toFixed(2)}`);
