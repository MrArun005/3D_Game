// Soundtrack for "The Unicorn Seal": a synthesised Indian score (tanpura drone,
// sitar-like plucks, bansuri flute, tabla in keherwa), city and river ambience,
// a sound for every beat, and the dialogue on top with the bed ducked under it.
// Beats come from stories/indus.beats.json, the same file the picture reads.
//   node tools/audio-indus.mjs -> out/cartoon-indus.wav
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const B = JSON.parse(fs.readFileSync(path.join(ROOT, 'stories', 'indus.beats.json'), 'utf8'));
const TM = JSON.parse(fs.readFileSync(path.join(ROOT, 'stories', 'indus.timing.json'), 'utf8'));
const SR = 44100, DUR = B.duration, N = Math.ceil(DUR * SR), TAU = Math.PI * 2;
const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const nz = rng(11), n2 = () => nz() * 2 - 1;
const MUS = [new Float32Array(N), new Float32Array(N)], FX = [new Float32Array(N), new Float32Array(N)], DR = [new Float32Array(N), new Float32Array(N)];
const put = (buf, i, l, r = l) => { if (i >= 0 && i < N) { buf[0][i] += l; buf[1][i] += r; } };
const S = (t) => Math.round(t * SR);
const SC = Object.fromEntries(B.scenes.map(([id, t0], i) => [id, [t0, i + 1 < B.scenes.length ? B.scenes[i + 1][1] : DUR]]));
class LP { constructor() { this.y = 0; } run(x, a) { this.y += a * (x - this.y); return this.y; } }
const lpa = (fc) => 1 - Math.exp(-TAU * fc / SR);
class BP { constructor(f = 1000, q = 1) { this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(f, q); }
  set(f, q) { const w = TAU * f / SR, al = Math.sin(w) / (2 * q), a0 = 1 + al; this.b0 = al / a0; this.b2 = -al / a0; this.a1 = -2 * Math.cos(w) / a0; this.a2 = (1 - al) / a0; return this; }
  run(x) { const y = this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; } }

// Key of D. Sa = D. Swaras as MIDI numbers.
const SA = 62;
const BHUP = [0, 2, 4, 7, 9];                        // Bhupali: Sa Re Ga Pa Dha (day, bright)
const YAMAN = [0, 2, 4, 6, 7, 9, 11];               // Yaman: sharp Ma, for the sunset
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const deg = (scale, i, base = SA) => base + scale[((i % scale.length) + scale.length) % scale.length] + 12 * Math.floor(i / scale.length);

// ---- instruments ---------------------------------------------------------------------------------------------
// Tanpura: each string a bright additive tone whose upper partials swell and fade (the jawari buzz).
function tanpuraString(t0, f, gain, pan, len = 4.2) {
  const s = S(t0), n = S(len), H = 14;
  const ph = new Float64Array(H), amp = Array.from({ length: H }, (_, k) => 1 / (k + 1) ** 0.9);
  for (let j = 0; j < n; j++) {
    const t = j / SR, env = Math.min(1, t / 0.04) * Math.exp(-t / 2.2);
    const sweep = 2 + 9 * (t / len);                 // the buzzing formant slides up the partials
    let v = 0;
    for (let k = 0; k < H; k++) { ph[k] += TAU * f * (k + 1) * (1 + 0.0006 * k) / SR; v += Math.sin(ph[k]) * amp[k] * (0.35 + 0.65 * Math.exp(-((k + 1 - sweep) ** 2) / 6)); }
    v *= env * gain;
    put(MUS, s + j, v * (1 - pan) * 2, v * pan * 2);
  }
}
function tanpura(t0, t1, gain = 0.035, base = SA) {
  const cyc = [base - 5 - 12, base - 12, base - 12, base - 24];      // Pa, Sa, Sa, low Sa
  for (let t = t0, i = 0; t < t1 - 1; t += 0.65, i++) tanpuraString(t, hz(cyc[i % 4]), gain * (i % 4 === 3 ? 1.2 : 1), 0.35 + (i % 4) * 0.1, Math.min(4.2, t1 - t + 1));
}
// Sitar-ish: a bright Karplus-Strong pluck with a buzzing bridge (soft clip) and an optional slide into the note.
function sitar(t0, m, gain = 0.07, pan = 0.55, len = 1.6, slide = 0) {
  const f = hz(m), n = Math.round(SR / f), b = new Float32Array(n), r = rng(Math.round(f * 31 + t0 * 977));
  for (let i = 0; i < n; i++) b[i] = r() * 2 - 1;
  const s = S(t0); let lp = 0;
  for (let k = 0, j = 0; k < SR * len; k++, j = (j + 1) % n) {
    const a = b[j]; b[j] = 0.4985 * (a + b[(j + 1) % n]);
    const buzz = Math.tanh(a * 3) * 0.6 + a * 0.4;
    lp += 0.5 * (buzz - lp);
    const e = Math.min(1, (SR * len - k) / (SR * 0.08));
    let v = (buzz * 0.8 + lp * 0.2) * gain * e;
    if (slide && k < SR * 0.12) v *= k / (SR * 0.12);
    put(MUS, s + k, v * (1 - pan) * 2, v * pan * 2);
  }
  if (slide) { const s2 = S(t0), n2s = S(0.12); let ph = 0; for (let j = 0; j < n2s; j++) { ph += TAU * hz(m - slide * (1 - j / n2s)) / SR; put(MUS, s2 + j, Math.sin(ph) * gain * 0.5 * (j / n2s)); } }
}
// Bansuri: breathy flute with vibrato and a grace note (kan) from above.
function bansuri(t0, m, d, gain = 0.05, kan = true) {
  if (kan) note(t0 - 0.07, m + 2, 0.08, gain * 0.8);
  note(t0, m, d, gain);
}
function note(t0, m, d, gain) {
  const s = S(t0), n = S(d), f = hz(m), bp = new BP(f * 2, 3); let ph = 0;
  for (let k = 0; k < n; k++) {
    const t = k / SR, e = Math.min(1, t / 0.05) * Math.min(1, (d - t) / 0.12);
    ph += TAU * f * (1 + 0.007 * Math.sin(TAU * 5.3 * t) * Math.min(1, t * 1.5)) / SR;
    const v = (Math.sin(ph) + 0.12 * Math.sin(2 * ph) + bp.run(n2()) * 0.35) * e * gain;
    put(MUS, s + k, v * 0.9, v);
  }
}
function santoor(t0, m, gain = 0.05, pan = 0.5) {
  const f = hz(m), s = S(t0), n = S(2.2);
  for (let k = 0; k < n; k++) { const t = k / SR, v = (Math.sin(TAU * f * t) + 0.5 * Math.sin(TAU * f * 2.01 * t) * Math.exp(-t * 3) + 0.25 * Math.sin(TAU * f * 3.02 * t) * Math.exp(-t * 6)) * Math.exp(-t * 1.6) * Math.min(1, t * 400) * gain; put(MUS, s + k, v * (1 - pan) * 2, v * pan * 2); }
}
// Tabla: the bayan (bass drum, with its pitch bend) and the dayan (tuned to Sa).
function bayan(t, g = 0.3, bend = 1) {
  const s = S(t), n = S(0.45); let ph = 0;
  for (let j = 0; j < n; j++) { const u = j / SR; ph += TAU * (78 + 30 * bend * Math.min(1, u / 0.12)) / SR; put(DR, s + j, Math.sin(ph) * Math.exp(-u / 0.16) * g); }
}
function dayan(t, g = 0.18, ring = 1) {
  const f = hz(SA), s = S(t), n = S(0.5);
  const modes = [[1, 0.3], [2, 0.18], [3, 0.1], [4.1, 0.06], [5.2, 0.04]];
  for (let j = 0; j < n; j++) {
    const u = j / SR; let v = 0;
    for (const [m, d] of modes) v += Math.sin(TAU * f * m * u) * Math.exp(-u / (d * ring));
    v = v * 0.4 + (j < 300 ? n2() * (1 - j / 300) * 0.5 : 0);
    put(DR, s + j, v * g * 0.9, v * g);
  }
}
const ti = (t, g = 0.1) => { const s = S(t); for (let j = 0; j < SR * 0.04; j++) put(DR, s + j, n2() * g * Math.exp(-j / 250) + Math.sin(TAU * 1400 * j / SR) * g * 0.5 * Math.exp(-j / 400)); };
const ke = (t, g = 0.14) => { const s = S(t), lp = new LP(); for (let j = 0; j < SR * 0.05; j++) put(DR, s + j, lp.run(n2(), 0.3) * g * 2 * Math.exp(-j / 500)); };
const BOLS = {
  dha: (t, g) => { bayan(t, 0.32 * g); dayan(t, 0.17 * g); }, dhi: (t, g) => { bayan(t, 0.3 * g); dayan(t, 0.13 * g, 0.5); },
  ge: (t, g) => bayan(t, 0.32 * g), na: (t, g) => dayan(t, 0.17 * g), tin: (t, g) => dayan(t, 0.12 * g, 0.4),
  ti: (t, g) => ti(t, 0.1 * g), ke: (t, g) => ke(t, 0.13 * g), '-': () => {},
};
// Keherwa (8 beats) and a fast tirakita roll.
const KEHERWA = ['dha', 'ge', 'na', 'ti', 'na', 'ke', 'dhi', 'na'];
function tabla(t0, t1, bpm, g = 1, pattern = KEHERWA, fill = true, stops = []) {
  const bt = 60 / bpm;
  for (let i = 0, t = t0; t < t1 - 0.05; i++, t += bt / 2) {
    if (stops.some(([a, b]) => t > a && t < b)) continue;
    const bol = pattern[i % pattern.length];
    BOLS[bol](t, g * (i % 8 === 0 ? 1.15 : 1));
    if (fill && i % 16 === 14) { BOLS.ti(t + bt / 4, g); }
  }
}
function roll(t0, d, g = 1) { for (let t = t0, i = 0; t < t0 + d; t += 0.055, i++) (i % 2 ? BOLS.ti : BOLS.na)(t, g * (0.6 + 0.4 * (t - t0) / d)); BOLS.dha(t0 + d, g * 1.3); }
// A sitar melody over a scale: a list of [beat, degree, beats].
function melody(t0, bpm, notes, scale, gain = 0.07, base = SA, stopAt = 1e9) {
  const bt = 60 / bpm;
  for (const [b, dgr, len, slide] of notes) { const t = t0 + b * bt; if (t < stopAt) sitar(t, deg(scale, dgr, base), gain, 0.55, Math.max(0.6, len * bt + 0.4), slide || 0); }
}

// ---- effects ------------------------------------------------------------------------------------------------------
const tone = (t, f, d, g, pan = 0.5) => { const s = S(t), n = S(d); for (let j = 0; j < n; j++) { const v = Math.sin(TAU * f * j / SR) * Math.exp(-j / (n / 5)) * g; put(FX, s + j, v * (1 - pan) * 2, v * pan * 2); } };
const sweep = (t, f0, f1, d, g) => { const s = S(t), n = S(d); let ph = 0; for (let j = 0; j < n; j++) { const u = j / n; ph += TAU * (f0 * (f1 / f0) ** u) / SR; put(FX, s + j, Math.sin(ph) * g * Math.min(1, (1 - u) * 6, u * 40)); } };
const snap = (t, g = 0.3) => { const s = S(t); for (let j = 0; j < SR * 0.05; j++) put(FX, s + j, n2() * g * Math.exp(-j / (SR * 0.008))); };
const thud = (t, g = 0.4) => { tone(t, 60, 0.3, g); const s = S(t), lp = new LP(); for (let j = 0; j < SR * 0.15; j++) put(FX, s + j, lp.run(n2(), 0.12) * g * 1.8 * (1 - j / (SR * 0.15))); };
function whoosh(t, d = 0.3, g = 0.3, f0 = 400, f1 = 2400) { const s = S(t), n = S(d), bp = new BP(); for (let j = 0; j < n; j++) { const u = j / n; if (j % 32 === 0) bp.set(f0 * (f1 / f0) ** Math.sin(u * Math.PI * 0.5), 1.3); const v = bp.run(n2()) * g * Math.sin(u * Math.PI) ** 1.5 * 2.2; put(FX, s + j, v, v * 0.9); } }
function steps(t0, t1, every, g, f = 110) { for (let t = t0; t < t1; t += every * (0.92 + nz() * 0.16)) { tone(t, f + nz() * 30, 0.06, g); snap(t, g * 0.3); } }
function chatter(t, d = 0.5, g = 0.14) {
  // Monkey: fast rising-falling squeaks.
  for (let u = 0; u < d; u += 0.07 + nz() * 0.04) { const f0 = 1300 + nz() * 900; sweep(t + u, f0, f0 * (1.3 + nz() * 0.4), 0.05, g); }
}
function bells(t, g = 0.05) { for (const [f, d] of [[2093, 0], [2637, 0.004]]) tone(t + d, f, 0.5, g); }
function waterFlow(t0, t1, g = 0.1, fc = 700) { const lp = new LP(), bp = new BP(fc, 0.8); for (let i = S(t0); i < S(t1) && i < N; i++) { const t = i / SR, e = Math.min(1, (t - t0) / 0.4, (t1 - t) / 0.4); const v = bp.run(n2()) * (0.6 + 0.4 * Math.sin(t * 7 + Math.sin(t * 2.3) * 3)); put(FX, i, (v + lp.run(n2(), 0.01)) * g * e, v * g * e * 0.9); } }
function ambience(t0, t1, g = 0.03) {
  // A distant crowd: soft noise with brief vowel-like bursts.
  const lp = new LP();
  for (let i = S(t0); i < S(t1) && i < N; i++) { const t = i / SR, e = Math.min(1, (t - t0) / 0.8, (t1 - t) / 0.8); put(FX, i, lp.run(n2(), 0.02) * g * 4 * e); }
  const r = rng(Math.round(t0 * 10));
  for (let t = t0 + 0.2; t < t1 - 0.3; t += 0.18 + r() * 0.4) { const f = 180 + r() * 160, d = 0.12 + r() * 0.2, s = S(t), n = S(d), bp = new BP(600 + r() * 900, 4); let ph = 0; const pan = r(); for (let j = 0; j < n; j++) { ph = (ph + f * (1 + 0.1 * Math.sin(j / 900)) / SR) % 1; const v = bp.run(ph * 2 - 1) * Math.sin(Math.PI * j / n) * g * 0.8; put(FX, s + j, v * (1 - pan) * 2, v * pan * 2); } }
}
function birds(t0, t1, g = 0.02, seed = 3) { const r = rng(seed); for (let t = t0 + 0.4; t < t1 - 0.4; t += 0.9 + r() * 2) { const reps = 2 + Math.floor(r() * 3), f0 = 2600 + r() * 2000, pan = r(); for (let k = 0; k < reps; k++) { const s = S(t + k * 0.1), n = S(0.07); let ph = 0; for (let j = 0; j < n; j++) { const u = j / n; ph += TAU * f0 * (1 + 0.35 * Math.sin(u * Math.PI)) / SR; const v = Math.sin(ph) * Math.sin(u * Math.PI) * g; put(FX, s + j, v * (1 - pan) * 2, v * pan * 2); } } } }
function river(t0, t1, g = 0.04) { const lp = new LP(); for (let i = S(t0); i < S(t1) && i < N; i++) { const t = i / SR, e = Math.min(1, (t - t0) / 0.8, (t1 - t) / 0.8), sw = 0.6 + 0.4 * Math.sin(t * 1.1) * Math.sin(t * 0.37 + 1); put(FX, i, lp.run(n2(), lpa(500)) * g * 3 * sw * e, lp.y * g * 2.6 * e); } }
function wind(t0, t1, g = 0.04) { const bp = new BP(500, 0.7); for (let i = S(t0); i < S(t1) && i < N; i++) { const t = i / SR, e = Math.min(1, (t - t0) / 0.6, (t1 - t) / 0.6); if (i % 64 === 0) bp.set(300 + 500 * (0.5 + 0.5 * Math.sin(t * 0.9)), 0.7); put(FX, i, bp.run(n2()) * g * e * 2); } }
function splashSnd(t, g = 0.5) { const s = S(t), lp = new LP(); for (let j = 0; j < SR * 0.9; j++) { const u = j / SR; put(FX, s + j, lp.run(n2(), lpa(2500 - 2000 * Math.min(1, u))) * g * Math.exp(-u * 4) * 2); } for (let k = 0; k < 14; k++) sweep(t + 0.2 + nz() * 0.9, 400 + nz() * 500, 900 + nz() * 900, 0.06, 0.05); thud(t, 0.3); }
function beadSpill(t0, d = 1.3, g = 0.05) { for (let u = 0; u < d; u += 0.004 + nz() * 0.01) tone(t0 + u, 2200 + nz() * 2200, 0.025, g * (1 - u / d) * (0.4 + nz() * 0.6), nz()); }
function shimmer(t, g = 0.05, base = SA + 12) { [0, 2, 4, 7, 9, 12].forEach((d, i) => santoor(t + i * 0.06, base + d, g, 0.3 + i * 0.08)); }
function brush(t, d = 0.35, g = 0.08) { const s = S(t), n = S(d), bp = new BP(4500, 0.9); for (let j = 0; j < n; j++) { const u = j / n; put(FX, s + j, bp.run(n2()) * g * Math.sin(u * Math.PI) * 2); } }

// ---- the score, scene by scene ---------------------------------------------------------------------------------------
// Opening: tanpura, a slow bansuri alap in Bhupali, a shimmer under the title.
tanpura(0.3, SC.street[0] + 0.5, 0.042);
[[1.2, 4, 1.6], [2.9, 3, 0.8], [3.8, 2, 1.2], [5.2, 4, 0.8], [6.1, 5, 1.6]].forEach(([t, d, len]) => bansuri(t, deg(BHUP, d), len, 0.075));
shimmer(2.2, 0.07);
// Workshop: a gentle keherwa, sitar phrases; carving taps; a shimmer when the seal appears.
tabla(8.7, SC.street[0] - 0.1, 92, 0.55, KEHERWA, true, [[12.5, 12.75]]);
melody(8.8, 92, [[0, 0, 1], [1, 2, 1], [2, 4, 2, 2], [4, 3, 1], [5, 2, 1], [6, 1, 2], [8, 0, 1], [9, 2, 1], [10, 4, 1], [11, 5, 1], [12, 4, 2, 2], [14, 2, 2]], BHUP, 0.06);
melody(15.3, 92, [[0, 4, 1], [1, 5, 1], [2, 7, 2, 2], [4, 5, 1], [5, 4, 3]], BHUP, 0.065);
for (let t = 8.6; t < SC.sealcu[1]; t += 0.13) tone(t, 2400 + nz() * 900, 0.03, 0.03);
shimmer(SC.sealcu[0] + 0.1, 0.045);
// The street: upbeat keherwa at 126, a running sitar line; cart bells, steps.
tabla(SC.street[0], SC.snatch[0] + 0.9, 126, 0.85);
{ const run = [[0, 0, 0.5], [0.5, 1, 0.5], [1, 2, 0.5], [1.5, 4, 0.5], [2, 5, 1], [3, 4, 0.5], [3.5, 2, 0.5], [4, 4, 1], [5, 2, 0.5], [5.5, 1, 0.5], [6, 0, 1], [7, 1, 1]];
  for (let rep = 0; rep < 5; rep++) melody(SC.street[0] + rep * (8 * 60 / 126), 126, run.map(([b, d, l]) => [b, d + (rep % 2 ? 2 : 0), l]), BHUP, 0.065, SA, SC.snatch[0] + 0.8); }
// Snatch: music thins to a hush while she admires it; a tabla roll after the grab; the chase begins.
shimmer(B.admire, 0.04);
roll(B.grab + 0.05, 0.5, 0.9);
// The chase: fast keherwa from the flee to the drain, with stops for the leap, the splash and the plink.
const chaseStops = [[B.leap, B.land], [B.splash - 0.05, B.surface + 0.2], [B.plink - 0.05, B.cut]];
tabla(B.flee, SC.quay[0] - 0.2, 150, 0.9, KEHERWA, true, chaseStops);
{ const bt = 60 / 150, riff = [[0, 7, 0.5], [0.5, 5, 0.5], [1, 4, 0.5], [1.5, 2, 0.5], [2, 4, 0.5], [2.5, 5, 0.5], [3, 7, 1], [4, 9, 0.5], [4.5, 7, 0.5], [5, 5, 0.5], [5.5, 4, 0.5], [6, 2, 1], [7, 0, 1]];
  for (let t = B.flee + 0.1, rep = 0; t < SC.quay[0] - 0.5; t += 8 * bt, rep++) melody(t, 150, riff.filter(([b]) => !chaseStops.some(([a, z]) => t + b * bt > a && t + b * bt < z)).map(([b, d, l]) => [b, d + (rep % 3 === 1 ? -2 : rep % 3 === 2 ? 3 : 0), l]), BHUP, 0.06, SA, SC.quay[0] - 0.3); }
tanpura(B.flee, SC.quay[0] + 0.5, 0.022);
// Hits: the leap swell, the comic splash stop, a sad little descending phrase after the plink.
sweep(B.leap, 300, 900, B.land - B.leap, 0.05); BOLS.dha(B.land, 1.4);
[[0, 4], [0.25, 2], [0.5, 1], [0.75, 0]].forEach(([d, x]) => sitar(B.plink + 0.25 + d, deg(BHUP, x) - 12, 0.07, 0.5, 0.8));
// The drain: a tense bass drone under the chase; a triumphant sting when she grabs it.
tanpura(B.lid, B.outlet + 0.6, 0.03, SA - 12);
shimmer(B.grabSeal, 0.06);
// The quay: urgent tabla, the leap lifts, a big resolved chord on landing.
roll(SC.quay[0] + 0.1, 0.6, 0.8);
tabla(SC.quay[0] + 0.7, B.aboard - 0.05, 160, 0.95);
sweep(B.jump, 250, 1000, B.aboard - B.jump, 0.05);
for (const m of [SA - 12, SA - 5, SA, SA + 4, SA + 7, SA + 12]) sitar(B.aboard, m, 0.06, 0.5, 2.2);
BOLS.dha(B.aboard, 1.5);
tanpura(B.aboard, SC.farewell[1] + 1, 0.04);
// The stamp: quiet; a warm phrase when the impression shows.
[[0, 4, 1], [0.6, 5, 1], [1.2, 7, 2]].forEach(([d, x, l]) => bansuri(B.lift + 0.2 + d, deg(YAMAN, x), l * 0.6, 0.045));
// Sunset: a bansuri melody in Yaman, slow, over the drone and a soft dadra.
tabla(SC.farewell[0] + 0.4, 77.5, 76, 0.4, ['dha', 'dhi', 'na', 'dha', 'tin', 'na'], false);
{ const bt = 60 / 76, tune = [[0, 7, 2], [2, 9, 1], [3, 11, 1], [4, 14, 3], [7, 11, 1], [8, 9, 2], [10, 7, 1], [11, 6, 1], [12, 4, 2], [14, 2, 1], [15, 4, 1], [16, 0, 4]];
  for (const [b, d, l] of tune) bansuri(SC.farewell[0] + 0.6 + b * bt, deg(YAMAN, d - 7), l * bt * 0.95, 0.08); }
// Epilogue: wind, a rising whoosh through the years, brush strokes, the signs shimmer, a final chord.
whoosh(79.2, 3.8, 0.12, 200, 1800); wind(79, B.brush + 0.5, 0.04);
tanpura(79, DUR, 0.042, SA);
for (let t = B.brush + 0.1; t < B.glyphs - 0.2; t += 0.45) brush(t);
for (let i = 0; i < 5; i++) santoor(B.glyphs + 0.25 + i * 0.35, deg(BHUP, 7 + i * 2), 0.085, 0.3 + i * 0.1);
note(B.cap4, SA - 12, 1.2, 0.05);
for (const m of [SA - 24, SA - 12, SA - 5, SA, SA + 4, SA + 9]) sitar(B.endCard, m, 0.05, 0.5, 2.4);
bansuri(B.endCard + 0.2, SA + 12, 1.4, 0.05);

// ---- effects on the beats ----------------------------------------------------------------------------------------------
river(0, SC.workshop[0] + 0.3, 0.05); birds(0.5, 8, 0.025, 1);
birds(SC.workshop[0], SC.street[0], 0.018, 2);
snap(B.take, 0.12);
steps(B.exit, SC.street[0] + 0.1, 0.16, 0.12);
ambience(SC.street[0], SC.snatch[1], 0.028);
steps(SC.street[0], SC.snatch[0], 0.155, 0.13);
for (let t = 23.0; t < 27.5; t += 0.55) bells(t, 0.035);
{ const lp = new LP(); for (let i = S(22.5); i < S(27.8); i++) { const t = i / SR; put(FX, i, lp.run(n2(), 0.05) * 0.05 * (0.5 + 0.5 * Math.sin(t * 5))); } }   // cart wheels
whoosh(B.hop - 0.1, 0.35, 0.2);
chatter(B.peek, 0.3, 0.08); whoosh(B.grab - 0.02, 0.25, 0.35); chatter(B.grab + 0.2, 0.6, 0.14); chatter(31.6, 0.5, 0.12);
whoosh(B.flee, 0.4, 0.25);
// Roofs.
for (let t = B.ladder; t < B.onRoof; t += 0.18) tone(t, 180, 0.05, 0.08);
steps(B.onRoof, B.leap, 0.15, 0.13); whoosh(B.leap, 0.8, 0.28, 300, 1600); thud(B.land, 0.35); steps(B.land + 0.2, SC.beads[0], 0.15, 0.13);
chatter(35.5, 0.4, 0.1); chatter(38.2, 0.4, 0.1);
// Beads.
ambience(SC.beads[0], SC.bath[0], 0.028);
thud(B.mDrop, 0.2); chatter(B.mDrop + 0.1, 0.4, 0.12); thud(B.tip, 0.18); beadSpill(B.tip + 0.05, 1.4, 0.05);
steps(40.3, B.slip, 0.14, 0.13); whoosh(B.slip, B.slideEnd - B.slip, 0.2, 800, 3000); beadSpill(B.slip, B.slideEnd - B.slip, 0.03);
// Bath.
waterFlow(SC.bath[0], SC.bath[1], 0.03, 900);
steps(SC.bath[0], B.sLeap, 0.15, 0.12);
B.hops.forEach((t) => { tone(t, 330, 0.12, 0.12); chatter(t + 0.05, 0.15, 0.08); });
whoosh(B.sLeap, 0.5, 0.2); splashSnd(B.splash, 0.55);
for (let t = B.surface + 0.3; t < B.climb; t += 0.5) sweep(t, 600, 300, 0.2, 0.04);    // spluttering
for (let t = B.climb; t < B.out; t += 0.35) { tone(t, 200, 0.05, 0.06); sweep(t + 0.1, 1800, 1200, 0.04, 0.03); }   // wet steps, drips
chatter(B.surface + 0.4, 0.8, 0.14);
B.bounces.forEach((t, i) => tone(t, 1200 - i * 100, 0.06, 0.12)); tone(B.drop + 0.05, 1300, 0.06, 0.1);
sweep(B.plink, 2200, 3200, 0.12, 0.12);
// Drain.
thud(B.lid, 0.15); tone(B.lid, 400, 0.08, 0.1);
waterFlow(B.cut - 0.3, B.outlet + 0.4, 0.1, 500);
steps(B.cut + 0.5, B.outlet, 0.15, 0.12);
waterFlow(B.outlet - 0.3, SC.quay[0], 0.14, 1200);
thud(B.mud, 0.3); { const s0 = S(B.mud), lp = new LP(); for (let j = 0; j < SR * 0.25; j++) put(FX, s0 + j, lp.run(n2(), 0.25) * 0.4 * Math.exp(-j / 2500)); }
// Quay.
river(SC.quay[0], SC.farewell[1], 0.04); birds(SC.quay[0], SC.farewell[1], 0.012, 5);
steps(SC.quay[0], B.jump, 0.15, 0.15, 150);
whoosh(B.jump, 0.9, 0.25, 300, 1400); thud(B.aboard, 0.4);
{ const s0 = S(B.aboard + 0.1), n = S(0.8); let ph = 0; for (let j = 0; j < n; j++) { ph += TAU * (110 + 20 * Math.sin(j / 3000)) / SR; put(FX, s0 + j, Math.sin(ph) * 0.03 * Math.sin(Math.PI * j / n)); } }   // the hull creaks
// Stamp.
thud(B.press, 0.3); { const s0 = S(B.press), lp = new LP(); for (let j = 0; j < SR * 0.3; j++) put(FX, s0 + j, lp.run(n2(), 0.08) * 0.25 * Math.exp(-j / 4000)); }
shimmer(B.lift, 0.035);
// Farewell.
chatter(B.monkeyIn + 0.2, 0.3, 0.08); tone(B.offer + 0.1, 1800, 0.08, 0.05); chatter(B.laugh + 0.4, 0.4, 0.09);
// Epilogue.
wind(B.brush, B.glyphs + 0.3, 0.025);

// ---- reverb on the music ---------------------------------------------------------------------------------------------------
function reverb(buf, mix = 0.25) {
  for (let c = 0; c < 2; c++) {
    const x = buf[c], y = new Float32Array(N), combs = [1557, 1617, 1491, 1422].map((d) => ({ d: d + c * 23, b: new Float32Array(d + c * 23), i: 0, f: 0 }));
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (const cb of combs) { const o = cb.b[cb.i]; cb.f = o * 0.8 + cb.f * 0.2; cb.b[cb.i] = x[i] + cb.f * 0.84; cb.i = (cb.i + 1) % cb.d; s += o; }
      y[i] = s * 0.25;
    }
    for (const d of [225, 556]) { const b = new Float32Array(d); let k = 0; for (let i = 0; i < N; i++) { const o = b[k], v = y[i]; b[k] = v + o * 0.5; y[i] = o - v * 0.5; k = (k + 1) % d; } }
    for (let i = 0; i < N; i++) x[i] = x[i] * (1 - mix * 0.4) + y[i] * mix;
  }
}
reverb(MUS, 0.3);
reverb(DR, 0.12);

// ---- dialogue + mix ------------------------------------------------------------------------------------------------------------
const VO = new Float32Array(N), duck = new Float32Array(N).fill(1);
{
  const wav = fs.readFileSync(path.join(ROOT, 'out', 'indus-voice.wav'));
  const sr = wav.readUInt32LE(24), bits = wav.readUInt16LE(34);
  let off = 12; while (wav.toString('ascii', off, off + 4) !== 'data') off += 8 + wav.readUInt32LE(off + 4);
  const n = wav.readUInt32LE(off + 4) / (bits / 8), d0 = off + 8;
  const rd = bits === 16 ? (i) => wav.readInt16LE(d0 + i * 2) / 32768 : (i) => wav.readFloatLE(d0 + i * 4);
  let e = 0;
  for (let i = 0; i < N; i++) { const x = i * sr / SR, j = Math.floor(x), f = x - j; VO[i] = j + 1 < n ? rd(j) * (1 - f) + rd(j + 1) * f : 0; e = Math.max(Math.abs(VO[i]), e * 0.99995); duck[i] = 1 - 0.55 * Math.min(1, e * 5); }
}
const fadeAt = (i) => Math.min(1, i / (SR * 0.6), (N - i) / (SR * 1.6));
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
let peak = 0, clip = 0;
for (let i = 0; i < N; i++) {
  const out = [0, 1].map((c) => { const bed = Math.tanh(MUS[c][i] * 1.6) * 0.62 * duck[i] + Math.tanh(DR[c][i] * 1.4) * 0.6 * (0.55 + 0.45 * duck[i]) + Math.tanh(FX[c][i] * 1.3) * 0.7 * (0.6 + 0.4 * duck[i]); return Math.tanh((bed + VO[i] * 1.05) * fadeAt(i)); });
  peak = Math.max(peak, Math.abs(out[0]), Math.abs(out[1])); if (Math.abs(out[0]) > 0.95) clip++;
  buf.writeInt16LE(Math.round(out[0] * 32000), 44 + i * 4); buf.writeInt16LE(Math.round(out[1] * 32000), 46 + i * 4);
}
fs.writeFileSync(path.join(ROOT, 'out', 'cartoon-indus.wav'), buf);
console.log(`wrote out/cartoon-indus.wav, ${DUR}s, peak ${peak.toFixed(2)}, ${clip} samples > 0.95`);
void TM;
