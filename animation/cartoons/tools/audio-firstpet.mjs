// Soundtrack for "The First Pet": cartoon score that changes with every scene,
// slapstick sound effects on the beats, a synthesised pup (yips, whimper, the
// first bark), a cave lion, night crickets, snores, and Oog's lines on top.
// Beat times come from stories/firstpet.beats.json, the same file the picture uses.
//   node tools/audio-firstpet.mjs -> out/cartoon-firstpet.wav
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const B = JSON.parse(fs.readFileSync(path.join(ROOT, 'stories', 'firstpet.beats.json'), 'utf8'));
const SR = 44100, DUR = B.duration, N = Math.ceil(DUR * SR), TAU = Math.PI * 2;
const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const nz = rng(7), n2 = () => nz() * 2 - 1;
const midi = (m) => 440 * 2 ** ((m - 69) / 12);
const MUS = [new Float32Array(N), new Float32Array(N)], FX = [new Float32Array(N), new Float32Array(N)];
const put = (buf, i, l, r = l) => { if (i >= 0 && i < N) { buf[0][i] += l; buf[1][i] += r; } };
const S = (t) => Math.round(t * SR);
const SC = Object.fromEntries(B.scenes.map(([id, t0], i) => [id, [t0, i + 1 < B.scenes.length ? B.scenes[i + 1][1] : DUR]]));
class BP {                                       // a resonant band-pass (RBJ biquad)
  set(f, q) { const w = TAU * f / SR, al = Math.sin(w) / (2 * q), a0 = 1 + al; this.b0 = al / a0; this.b2 = -al / a0; this.a1 = -2 * Math.cos(w) / a0; this.a2 = (1 - al) / a0; return this; }
  constructor(f = 1000, q = 1) { this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(f, q); }
  run(x) { const y = this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; }
}
class LP { constructor() { this.y = 0; } run(x, a) { this.y += a * (x - this.y); return this.y; } }
const lpa = (fc) => 1 - Math.exp(-TAU * fc / SR);

// ---- instruments -------------------------------------------------------------------------------------
function pluck(t0, f, gain, pan = 0.5, len = 1.2, bright = 0.497) {
  const n = Math.max(2, Math.round(SR / f)), b = new Float32Array(n), r = rng(Math.round(f * 13 + t0 * 1000));
  for (let i = 0; i < n; i++) b[i] = r() * 2 - 1;
  const s = S(t0);
  for (let k = 0, j = 0; k < SR * len; k++, j = (j + 1) % n) {
    const a = b[j]; b[j] = bright * (a + b[(j + 1) % n]);
    const e = Math.min(1, (SR * len - k) / (SR * 0.05));
    put(MUS, s + k, a * gain * (1 - pan) * e, a * gain * pan * e);
  }
}
const stac = (t0, m, g, pan) => pluck(t0, midi(m), g, pan, 0.22, 0.45);   // short, dry
function flute(t0, m, d, gain) {
  const s = S(t0), n = S(d), f = midi(m); let ph = 0;
  for (let k = 0; k < n; k++) {
    const t = k / SR, e = Math.min(1, t / 0.07) * Math.min(1, (d - t) / 0.15);
    ph += TAU * f * (1 + 0.006 * Math.sin(TAU * 5 * t) * Math.min(1, t * 2)) / SR;
    const v = (Math.sin(ph) + 0.2 * Math.sin(2 * ph) + 0.04 * n2()) * e * gain;
    put(MUS, s + k, v * 0.9, v);
  }
}
function pad(t0, t1, notes, gain, fc = 700) {
  const s0 = S(t0), s1 = S(t1), ph = notes.map(() => [0, 0]), f = [new LP(), new LP()];
  for (let i = s0; i < s1 && i < N; i++) {
    const t = (i - s0) / SR, e = Math.min(1, t / 0.8) * Math.min(1, (t1 - t0 - t) / 0.8);
    let l = 0, r = 0;
    notes.forEach((m, j) => { for (const d of [0, 1]) { ph[j][d] = (ph[j][d] + midi(m) * (d ? 1.004 : 0.996) / SR) % 1; const v = ph[j][d] * 2 - 1; if (d) r += v; else l += v; } });
    put(MUS, i, f[0].run(l, lpa(fc)) * gain * e / notes.length, f[1].run(r, lpa(fc)) * gain * e / notes.length);
  }
}
// A muted "wah" brass note: saw through a filter that opens and closes.
function wah(t0, m, d, gain) {
  const s = S(t0), n = S(d), f0 = midi(m), lp = new LP(); let ph = 0;
  for (let k = 0; k < n; k++) {
    const t = k / SR, u = t / d;
    ph = (ph + f0 * (1 + 0.012 * Math.sin(TAU * 5.5 * t) * u) / SR) % 1;
    const open = 300 + 1500 * Math.sin(Math.min(1, u * 1.6) * Math.PI) ** 1.5;
    const e = Math.min(1, t / 0.03) * Math.min(1, (d - t) / 0.08);
    const v = lp.run(ph * 2 - 1, lpa(open)) * e * gain;
    put(MUS, s + k, v, v * 0.9);
  }
}

// ---- sound effects -------------------------------------------------------------------------------------
const tone = (t, f, d, g, dest = FX, pan = 0.5) => { const s = S(t), n = S(d); for (let j = 0; j < n; j++) { const v = Math.sin(TAU * f * j / SR) * Math.exp(-j / (n / 5)) * g; put(dest, s + j, v * (1 - pan) * 2, v * pan * 2); } };
const sweep = (t, f0, f1, d, g, vib = 0) => { const s = S(t), n = S(d); let ph = 0; for (let j = 0; j < n; j++) { const u = j / n; ph += TAU * (f0 * (f1 / f0) ** u) * (1 + vib * Math.sin(TAU * 7 * j / SR)) / SR; put(FX, s + j, Math.sin(ph) * g * Math.min(1, (1 - u) * 6, u * 40)); } };
const thud = (t, g = 0.4) => { tone(t, 62, 0.28, g); const s = S(t), lp = new LP(); for (let j = 0; j < SR * 0.14; j++) put(FX, s + j, lp.run(n2(), 0.15) * g * 1.6 * (1 - j / (SR * 0.14))); };
const snap = (t, g = 0.35) => { const s = S(t); for (let j = 0; j < SR * 0.06; j++) put(FX, s + j, n2() * g * Math.exp(-j / (SR * 0.01))); };
function whoosh(t, d = 0.28, g = 0.3, f0 = 500, f1 = 2400) {
  const s = S(t), n = S(d), bp = new BP();
  for (let j = 0; j < n; j++) { const u = j / n; if (j % 32 === 0) bp.set(f0 * (f1 / f0) ** Math.sin(u * Math.PI * 0.5), 1.4); const v = bp.run(n2()) * g * Math.sin(u * Math.PI) ** 1.5 * 2.2; put(FX, s + j, v, v * 0.9); }
}
function rustle(t, d, g = 0.08) { const s = S(t), n = S(d), bp = new BP(3500, 0.8); for (let j = 0; j < n; j++) { const u = j / n, am = 0.5 + 0.5 * Math.sin(TAU * 13 * j / SR + Math.sin(j / 3000)); put(FX, s + j, bp.run(n2()) * g * am * Math.sin(u * Math.PI)); } }
function crunch(t, g = 0.18) { const s = S(t), lp = new LP(); for (let j = 0; j < SR * 0.09; j++) { const v = lp.run(n2() * (nz() < 0.3 ? 1 : 0.2), 0.35); put(FX, s + j, v * g * 2.5 * (1 - j / (SR * 0.09))); } }
function steps(t0, t1, every, g, f = 90) { for (let t = t0; t < t1; t += every) { tone(t, f + nz() * 20, 0.08, g); snap(t, g * 0.25); } }
function patter(t0, t1, g = 0.06) { for (let t = t0; t < t1; t += 0.075 + nz() * 0.02) { tone(t, 260 + nz() * 160, 0.035, g); } }
const clack = (t, g = 0.2) => { tone(t, 820, 0.06, g); tone(t, 1240, 0.04, g * 0.6); snap(t, g * 0.6); };
const gulp = (t) => sweep(t, 520, 130, 0.2, 0.12);
const popSnd = (t, g = 0.1) => sweep(t, 400, 1400, 0.09, g);
function slide(t, d, f0, f1, g = 0.1) { sweep(t, f0, f1, d, g, 0.02); }
function boing(t, g = 0.12) { const s = S(t), n = S(0.5); let ph = 0; for (let j = 0; j < n; j++) { const u = j / n; ph += TAU * 170 * (1 + 0.25 * Math.sin(TAU * 14 * j / SR) * (1 - u)) / SR; put(FX, s + j, Math.sin(ph) * g * (1 - u)); } }
function scratch(t) { const s = S(t), n = S(0.22), bp = new BP(); for (let j = 0; j < n; j++) { const u = j / n; if (j % 32 === 0) bp.set(2400 - 1900 * u, 3); put(FX, s + j, bp.run(n2()) * 0.5 * (1 - u)); } }
function tom(t, f = 110, g = 0.35) { const s = S(t), n = S(0.3); let ph = 0; for (let j = 0; j < n; j++) { const u = j / n; ph += TAU * f * (1 - 0.4 * u) / SR; put(FX, s + j, (Math.sin(ph) + 0.15 * n2() * Math.exp(-j / 400)) * g * Math.exp(-u * 5)); } }
function heartbeat(t, g = 0.35) { tone(t, 55, 0.16, g); tone(t + 0.2, 50, 0.16, g * 0.7); }

// The pup's voice: a pitched, band-limited buzz with a noise edge.
function yelp(t, d, fA, fB, g, { shape = 1, vib = 0, noise = 0.25, form = 1500 } = {}) {
  const s = S(t), n = S(d), bp = new BP(form, 1.2), bp2 = new BP(form * 2.3, 2); let ph = 0;
  for (let j = 0; j < n; j++) {
    const u = j / n, f = fA * (fB / fA) ** (u ** shape) * (1 + vib * Math.sin(TAU * 8 * j / SR));
    ph = (ph + f / SR) % 1;
    const src = (ph * 2 - 1) * 0.7 + Math.sin(ph * TAU) * 0.6 + n2() * noise;
    const e = Math.min(1, u * 25) * (1 - u) ** 1.2;
    const v = (bp.run(src) * 1.6 + bp2.run(src) * 0.8 + Math.sin(ph * TAU) * 0.35) * e * g;
    put(FX, s + j, v, v * 0.95);
  }
}
const yip = (t, g = 0.22) => yelp(t, 0.1, 1150, 1550, g, { shape: 0.5, form: 2200 });
const bark = (t, g = 0.5, p = 1) => { yelp(t, 0.17, 780 * p, 420 * p, g, { shape: 0.7, noise: 0.5, form: 1300 }); yelp(t + 0.015, 0.12, 390 * p, 260 * p, g * 0.6, { noise: 0.6, form: 700 }); };
const whimper = (t, d = 0.55, g = 0.12) => yelp(t, d, 1000, 760, g, { vib: 0.04, noise: 0.05, form: 1900 });
function growl(t, d, g, f = 55, fc = 260, am = 26) {
  const s = S(t), n = S(d), lp = new LP(), lp2 = new LP(); let ph = 0;
  for (let j = 0; j < n; j++) {
    const u = j / n; ph = (ph + f * (1 + 0.05 * Math.sin(TAU * 3 * j / SR)) / SR) % 1;
    const a = 0.55 + 0.45 * Math.sin(TAU * am * j / SR + 0.6 * Math.sin(TAU * 2.3 * j / SR));
    const v = (lp.run(n2(), lpa(fc)) * 3 + lp2.run(ph * 2 - 1, lpa(fc * 1.5)) * 0.8) * a * g * Math.min(1, u * 6, (1 - u) * 5);
    put(FX, s + j, v, v * 0.9);
  }
}
function snore(t, g = 0.14, f = 38, fc = 420) {
  const s = S(t), n = S(1.1), lp = new LP();
  for (let j = 0; j < n; j++) { const u = j / n, a = 0.5 + 0.5 * Math.sin(TAU * f * j / SR); const e = u < 0.55 ? Math.sin(u / 0.55 * Math.PI) : 0.35 * Math.sin((u - 0.55) / 0.45 * Math.PI); put(FX, s + j, lp.run(n2(), lpa(fc)) * a * e * g * 3); }
}
function crickets(t0, t1, g = 0.02) {
  const r = rng(31);
  for (const [f, pan, seed] of [[4300, 0.2, 1], [4650, 0.8, 2]]) {
    const rr = rng(seed);
    for (let t = t0 + rr() * 0.4; t < t1; t += 0.6 + rr() * 0.5) for (let k = 0; k < 3; k++) {
      const s = S(t + k * 0.045), n = S(0.03);
      for (let j = 0; j < n; j++) { const v = Math.sin(TAU * f * j / SR) * Math.sin(Math.PI * j / n) * g; put(FX, s + j, v * (1 - pan) * 2, v * pan * 2); }
    }
  }
  void r;
}
function fire(t0, t1, g = 0.05) {
  const lp = new LP();
  for (let i = S(t0); i < S(t1) && i < N; i++) { const e = Math.min(1, (i - S(t0)) / SR / 0.4, (S(t1) - i) / SR / 0.4); put(FX, i, lp.run(n2(), lpa(160)) * g * 2.5 * e); }
  for (let t = t0; t < t1; t += 0.05 + nz() * 0.25) snap(t, g * (0.5 + nz()));
}
function birds(t0, t1, g = 0.025) {
  const r = rng(12);
  for (let t = t0 + 0.5; t < t1 - 0.5; t += 1.1 + r() * 2.2) {
    const reps = 2 + Math.floor(r() * 3), f0 = 2800 + r() * 1800, pan = r();
    for (let k = 0; k < reps; k++) { const s = S(t + k * 0.11), n = S(0.07); let ph = 0; for (let j = 0; j < n; j++) { const u = j / n; ph += TAU * f0 * (1 + 0.35 * Math.sin(u * Math.PI)) / SR; const v = Math.sin(ph) * Math.sin(u * Math.PI) * g; put(FX, s + j, v * (1 - pan) * 2, v * pan * 2); } }
  }
}
function wind(t0, t1, g = 0.03) { const lp = new LP(); for (let i = S(t0); i < S(t1) && i < N; i++) { const t = i / SR, e = Math.min(1, (t - t0) / 0.5, (t1 - t) / 0.5); put(FX, i, lp.run(n2(), 0.004) * g * 8 * e * (0.7 + 0.3 * Math.sin(t * 0.8))); } }

// ---- score ----------------------------------------------------------------------------------------------
// Hook: a cheerful riff, a record scratch on the snatch, then the title sting.
{ const bt = 60 / 140 / 2; [72, 76, 79, 76, 72, 76].forEach((m, i) => { if (i * bt < B.snatch - 0.1) stac(0.1 + i * bt, m, 0.1, 0.4 + (i % 2) * 0.2); }); stac(0.1, 48, 0.14, 0.5); }
scratch(B.snatch + 0.02);
{ const t = B.title; for (const [m, d] of [[60, 0], [64, 0.03], [67, 0.06], [72, 0.09]]) pluck(t + d, midi(m), 0.09, 0.3 + d * 3); pluck(t, midi(36), 0.16, 0.5, 1.6); wah(t + 0.02, 72, 0.5, 0.05); }
// Chase: 160 bpm, bass root-fifth, scampering scale runs. Stops dead on the THUD.
{ const bt = 60 / 160, t0 = SC.chase[0];
  const bass = [36, 43, 36, 43, 41, 48, 43, 38], run = [72, 74, 76, 77, 79, 77, 76, 74];
  for (let i = 0; t0 + i * bt < B.plant - 0.05; i++) {
    const t = t0 + i * bt;
    stac(t, bass[i % 8], 0.16, 0.5);
    for (let k = 0; k < 2; k++) if (t + k * bt / 2 < B.plant - 0.05) stac(t + k * bt / 2, run[(i * 2 + k) % 8] + (i >= 8 ? 5 : 0), 0.07, 0.35 + k * 0.3);
  }
  // After a beat of silence, a soft cheeky walk under the pup's gloating.
  for (let i = 0, t = B.wag + 0.1; t < SC.chase[1]; i++, t += bt) { stac(t, [36, 43, 40, 43][i % 4], 0.13, 0.5); if (i % 2) stac(t + bt / 2, [67, 64][(i >> 1) % 2], 0.05, 0.6); }
  // A cheeky "tee-hee" as the pup looks back, and again as it trots off.
  for (const t of [B.wag + 0.35, B.trot]) [79, 76, 79, 76, 72].forEach((m, i) => stac(t + i * 0.12, m, 0.08, 0.6));
}
// Plan A: sneaky tiptoe in A minor; the slam cuts it; a suspicious hold; the lunge flourish.
{ const bt = 60 / 112, t0 = B.capA + 0.2;
  const hi = [69, 72, 76, 75, 76, 72, 69, 71];
  for (let i = 0; t0 + i * bt < B.pull - 0.05; i++) {
    const t = t0 + i * bt;
    stac(t, i % 2 ? 40 : 33, 0.18, 0.5);
    if (t + bt / 2 < B.pull - 0.05) stac(t + bt / 2, hi[i % 8], 0.07, 0.65);
  }
  for (const [m, d] of [[69, 0], [72, 0.04], [76, 0.08]]) pluck(B.capA + d, midi(m), 0.07, 0.5, 0.6);
  // Oog runs to the basket: a quick scale up; then a questioning note on "Huh?"
  [69, 71, 72, 74, 76].forEach((m, i) => stac(B.run + i * 0.1, m, 0.07, 0.5));
  wah(B.look, 64, 0.35, 0.05); wah(B.look + 0.4, 67, 0.55, 0.05);
  [76, 74, 72, 71, 69, 67, 65, 64].forEach((m, i) => stac(B.lunge + i * 0.06, m, 0.06, 0.5));
}
// Plan B: busy working music, a proud flourish, then the slide whistle and the sad trombone.
{ const bt = 60 / 132, t0 = B.capB + 0.1;
  const ch = [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]], bass = [36, 41, 43, 36];
  for (let i = 0; t0 + i * bt < B.see - 0.05; i++) {
    const t = t0 + i * bt, c = Math.floor(i / 4) % 4;
    stac(t, bass[c] + (i % 2 ? 7 : 0), 0.19, 0.5);
    if (t + bt / 2 < B.see - 0.05) ch[c].forEach((m, j) => stac(t + bt / 2 + j * 0.01, m + 12, 0.06, 0.3 + j * 0.2));
  }
  for (const [m, d] of [[72, 0], [76, 0.08], [79, 0.16], [84, 0.24]]) pluck(B.capB + d, midi(m), 0.06, 0.5, 0.5);
  [79, 84].forEach((m, i) => pluck(B.meat + 0.35 + i * 0.12, midi(m), 0.07, 0.5, 0.8));
  [72, 74, 76, 77, 79, 81].forEach((m, i) => stac(B.charge + i * 0.055, m, 0.07, 0.5));
  // Wah, wah, wah, waaah.
  [[67, 0.28], [66, 0.28], [65, 0.28], [64, 0.9]].forEach(([m, d], i) => wah(B.yip + 0.35 + i * 0.3, m - 5, d, 0.075));
}
// Dusk: slow and a little glum; a warmer turn when he nearly smiles.
{ const bt = 60 / 72, t0 = SC.dusk[0] + 0.6;
  const arp = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [57, 60, 64]];
  for (let i = 0; t0 + i * bt < SC.dusk[1] - 0.2; i++) { const a = arp[Math.floor(i / 2) % 4]; a.forEach((m, j) => pluck(t0 + i * bt + j * bt / 3, midi(m), 0.05, 0.3 + j * 0.2, 1.4)); }
  pad(SC.dusk[0], SC.dusk[1] + 0.4, [45, 52, 57], 0.1, 500);
  pluck(B.catch + 0.05, midi(76), 0.06, 0.6, 0.8);
  [72, 76, 79].forEach((m, i) => pluck(B.smile + i * 0.09, midi(m), 0.05, 0.5, 1.2));
}
// Night: crickets, a low drone that thickens, a heartbeat that speeds up, silence, WOOF,
// then drums and a rising line as they drive it off.
{ pad(B.eyes - 0.2, B.woof - 0.15, [38, 45, 50], 0.14, 260);
  pad(B.creep, B.woof - 0.15, [39, 46], 0.08, 380);
  let t = B.creep + 0.2, gap = 0.85; while (t < B.woof - 0.35) { heartbeat(t, 0.3); t += gap; gap = Math.max(0.42, gap * 0.9); }
  // The stab on the first bark.
  for (const m of [38, 50, 53, 57, 62]) pluck(B.woof, midi(m), 0.07, 0.5, 1.4, 0.499);
  for (let t2 = B.torch, i = 0; t2 < B.flee + 0.7; t2 += 0.19, i++) tom(t2, i % 4 === 0 ? 90 : i % 2 ? 140 : 115, i % 4 === 0 ? 0.33 : 0.2);
  pad(B.torch, B.flee + 0.9, [50, 57, 62, 65], 0.1, 900);
  [62, 65, 69, 74].forEach((m, i) => wah(B.torch + 0.2 + i * 0.35, m, 0.34, 0.045));
  for (const [m, d] of [[62, 0], [66, 0.05], [69, 0.1], [74, 0.15]]) pluck(B.flee + 0.75 + d, midi(m), 0.07, 0.5, 1.5);
}
// Morning into the end: warm F major, plucked chords and a flute tune; it slows for the lullaby.
{ const bt = 60 / 84, t0 = SC.morning[0] + 0.3;
  const prog = [[53, 57, 60, 65], [58, 62, 65, 70], [60, 64, 67, 72], [53, 57, 60, 65]];
  const mel = [[72, 2], [74, 1], [76, 1], [77, 3], [76, 1], [74, 2], [72, 2], [69, 4], [70, 2], [72, 2], [74, 2], [72, 2], [77, 4]];
  for (let i = 0; t0 + i * bt < B.endTitle; i++) {
    const c = prog[Math.floor(i / 4) % 4], t = t0 + i * bt * (i > 16 ? 1.12 : 1);
    c.forEach((m, j) => { if ((i + j) % 2 === 0) pluck(t + j * 0.04, midi(m), 0.065, 0.3 + j * 0.13, 1.6); });
    if (i % 4 === 0) pluck(t, midi(c[0] - 12), 0.11, 0.5, 2);
  }
  let t = VO_END('saved') + 0.2;
  for (const [m, beats] of mel) { if (t > B.endTitle - 0.3) break; flute(t, m, beats * bt * 0.95, 0.055); t += beats * bt; }
  for (const [m, d] of [[53, 0], [60, 0.06], [65, 0.12], [69, 0.18], [72, 0.24], [77, 0.3]]) pluck(B.endTitle + d, midi(m), 0.08, 0.5, 2.6, 0.4985);
  pad(B.endTitle, DUR, [53, 60, 65, 69], 0.08, 700);
}
function VO_END(id) { const tm = JSON.parse(fs.readFileSync(path.join(ROOT, 'stories', 'firstpet.timing.json'), 'utf8')); const l = tm.lines.find((x) => x.id === id); return l.t0 + l.dur; }

// ---- effects on the beats ---------------------------------------------------------------------------------
fire(0, SC.hook[1], 0.05); birds(0, SC.planB[1], 0.02); wind(SC.chase[0], SC.planB[1], 0.012);
whoosh(B.snatch - 0.03, 0.25, 0.35);
snap(B.chomp, 0.4); tone(B.chomp, 1400, 0.05, 0.12); tone(B.chomp + 0.03, 300, 0.08, 0.2);
patter(B.snatch + 0.3, 2.4, 0.05);
// Chase.
patter(SC.chase[0], 5.5, 0.06); steps(3.45, 4.55, 0.19, 0.18);
whoosh(4.5, 0.35, 0.2, 300, 900);                         // the skid
whoosh(B.under + 0.1, 0.3, 0.25);
thud(B.plant, 0.55); for (let i = 0; i < 7; i++) tone(B.plant + 0.2 + i * 0.19, [2600, 3100, 2900][i % 3], 0.07, 0.035);   // tweety stars
yip(B.wag + 0.2); patter(B.trot, SC.chase[1], 0.05);
// Plan A.
patter(B.pupIn, B.sniff, 0.035);
for (let i = 0; i < 4; i++) { const s0 = S(B.sniff + i * 0.13), bp = new BP(2500, 1); for (let j = 0; j < SR * 0.06; j++) put(FX, s0 + j, bp.run(n2()) * 0.12 * Math.sin(Math.PI * j / (SR * 0.06))); }
{ const s0 = S(B.pull), n = S(0.35); let ph = 0; for (let j = 0; j < n; j++) { const u = j / n; ph += TAU * 180 * (1 - 0.35 * u) / SR; put(FX, s0 + j, ((ph / TAU) % 1 * 2 - 1) * 0.1 * (1 - u) ** 2); } }  // the twang
whoosh(B.pull + 0.02, 0.18, 0.3);
thud(B.slam, 0.4); clack(B.slam, 0.25);
steps(B.run, B.peek, 0.15, 0.14);
for (let t = B.slam + 0.2; t < B.gulp; t += 0.16) tone(t, 180 + nz() * 50, 0.04, 0.04);   // chewing
gulp(B.gulp); yip(B.gulp + 0.25);
whoosh(B.lunge + 0.05, 0.3, 0.3); patter(B.lunge + 0.05, B.lunge + 0.4, 0.06);
// Plan B.
for (let t = B.dig0; t < B.dig1; t += 0.2) crunch(t, 0.2);
rustle(B.dig1, B.leaves - B.dig1, 0.1);
tone(B.meat, 160, 0.1, 0.12);
tone(B.pupB, 900, 0.05, 0.04); boing(B.see, 0.1);
steps(B.charge, B.fall, 0.12, 0.18);
rustle(B.fall - 0.02, 0.5, 0.14);
slide(B.fall, B.land - B.fall, 1500, 280, 0.1);
thud(B.land, 0.5); for (let i = 0; i < 6; i++) tone(B.land + 0.25 + i * 0.2, [2600, 3100, 2900][i % 3], 0.07, 0.03);
for (let t = B.arm + 0.15; t < B.steal; t += 0.09) tone(t, 240, 0.04, 0.05);
whoosh(B.steal - 0.03, 0.2, 0.28);
yip(B.yip, 0.2);
// Dusk.
fire(SC.dusk[0], SC.dusk[1], 0.045);
for (let t = SC.dusk[0] + 0.3; t < B.toss - 0.2; t += 0.3) crunch(t, 0.07);
whoosh(B.toss, 0.35, 0.18, 400, 1200);
snap(B.catch, 0.3); tone(B.catch, 900, 0.05, 0.08);
yelp(B.catch + 0.5, 0.35, 900, 1200, 0.07, { vib: 0.03, noise: 0.05, form: 2000 });   // a pleased little whine
// Night.
crickets(SC.night[0], B.torch, 0.018); fire(SC.night[0], SC.night[1], 0.025);
for (let t = SC.night[0] + 0.3; t < B.wake - 0.9; t += 1.7) snore(t, 0.12);
tone(B.ear, 1600, 0.04, 0.05);
growl(B.creep, B.loom - B.creep, 0.22);
growl(B.loom, B.whimper + 0.5 - B.loom, 0.4, 70, 420, 30);              // the snarl
whimper(B.whimper, 0.45, 0.1);
bark(B.woof, 0.62, 0.95);
whoosh(B.wake, 0.3, 0.15, 300, 1000);
{ const s0 = S(B.torch), n = S(0.7), lp = new LP(); for (let j = 0; j < n; j++) { const u = j / n; put(FX, s0 + j, lp.run(n2(), lpa(200 + 1800 * u)) * 0.35 * Math.sin(u * Math.PI)); } }  // whoomp of the torch
fire(B.torch, SC.night[1], 0.05);
B.barks.forEach((t, i) => bark(t, 0.45, 1 + i * 0.05));
growl(B.flinch, 0.35, 0.3, 80, 500, 34);
yelp(B.flee, 0.5, 420, 180, 0.3, { noise: 0.7, form: 700 });             // the lion's yowl
steps(B.flee, B.flee + 0.8, 0.13, 0.2, 70);
// Morning.
fire(SC.morning[0], SC.morning[1], 0.02); birds(SC.morning[0], SC.morning[1], 0.03);
snap(B.break, 0.3);
for (let t = B.take + 0.1; t < B.pat - 0.2; t += 0.14) tone(t, 200 + nz() * 60, 0.04, 0.05);
for (let i = 0; i < 4; i++) tone(B.pat + 0.05 + i * 0.17, 140, 0.06, 0.12);
{ const s0 = S(B.lick), n = S(0.55), bp = new BP(); for (let j = 0; j < n; j++) { const u = j / n; if (j % 32 === 0) bp.set(600 + 1800 * u, 2.5); put(FX, s0 + j, bp.run(n2()) * 0.25 * Math.sin(u * Math.PI)); } }
yip(B.lick + 0.55, 0.16); popSnd(B.heart, 0.12);
// End.
crickets(SC.end[0], DUR, 0.012); fire(SC.end[0], DUR, 0.03);
for (let t = SC.end[0] + 0.4; t < DUR - 1.2; t += 1.9) { snore(t, 0.08); snore(t + 0.9, 0.035, 60, 1400); }

// ---- narration + mix ------------------------------------------------------------------------------------
const VO = new Float32Array(N), duck = new Float32Array(N).fill(1);
{
  const wav = fs.readFileSync(path.join(ROOT, 'out', 'firstpet-voice.wav'));
  const sr = wav.readUInt32LE(24), bits = wav.readUInt16LE(34);
  let off = 12; while (wav.toString('ascii', off, off + 4) !== 'data') off += 8 + wav.readUInt32LE(off + 4);
  const n = wav.readUInt32LE(off + 4) / (bits / 8), d0 = off + 8;
  const rd = bits === 16 ? (i) => wav.readInt16LE(d0 + i * 2) / 32768 : (i) => wav.readFloatLE(d0 + i * 4);
  let e = 0;
  for (let i = 0; i < N; i++) {
    const x = i * sr / SR, j = Math.floor(x), f = x - j;
    VO[i] = j + 1 < n ? rd(j) * (1 - f) + rd(j + 1) * f : 0;
    e = Math.max(Math.abs(VO[i]), e * 0.99995);
    duck[i] = 1 - 0.5 * Math.min(1, e * 5);
  }
}
const fadeAt = (i) => Math.min(1, i / (SR * 0.15), (N - i) / (SR * 1.2));
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
let peak = 0, clip = 0;
for (let i = 0; i < N; i++) {
  const out = [0, 1].map((c) => {
    const bed = Math.tanh(MUS[c][i] * 1.8) * 0.6 * duck[i] + Math.tanh(FX[c][i] * 1.3) * 0.75 * (0.6 + 0.4 * duck[i]);
    return Math.tanh((bed + VO[i] * 1.05) * fadeAt(i));
  });
  peak = Math.max(peak, Math.abs(out[0]), Math.abs(out[1]));
  if (Math.abs(out[0]) > 0.95) clip++;
  buf.writeInt16LE(Math.round(out[0] * 32000), 44 + i * 4);
  buf.writeInt16LE(Math.round(out[1] * 32000), 46 + i * 4);
}
fs.writeFileSync(path.join(ROOT, 'out', 'cartoon-firstpet.wav'), buf);
console.log(`wrote out/cartoon-firstpet.wav, ${DUR}s, peak ${peak.toFixed(2)}, ${clip} samples > 0.95`);
