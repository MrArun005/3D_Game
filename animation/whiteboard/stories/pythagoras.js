// Whiteboard story 2: the Pythagorean theorem, proved by moving four triangles.
// Every visual is timed from the narration (pythagoras.timing.json, written by
// tools/voice.py), so the drawing lands on the words.
import * as I from '../src/ink.js';
import timing from './pythagoras.timing.json' with { type: 'json' };

export const FPS = 30;
export const DURATION = timing.duration;
export const VOICE = 'pythagoras-voice.wav';
const L = Object.fromEntries(timing.lines.map((l) => [l.id, l]));
const end = (id) => L[id].t0 + L[id].dur;
// When a word is spoken, estimated from its position in the line.
const at = (id, word) => { const l = L[id]; const i = l.text.indexOf(word); return l.t0 + l.dur * Math.max(0, i) / l.text.length; };

export const WIPES = [L.tri.t0 - 1.0, L.check.t0 - 1.0];
export const WIPE_DUR = 0.9;
export const SUBTITLES = timing.lines.map((l) => ({ t0: l.t0 - 0.1, t1: l.t0 + l.dur + 0.35, text: l.text }));
export const TALK = timing.lines.map((l) => ({ t0: l.t0, t1: l.t0 + l.dur }));
export const BUBBLES = [];
export const TYPE_RATE = 30;

export const ITEMS = [];
export const MOVER = [];
const S = (t0, dur, shape) => ITEMS.push({ kind: 'shape', t0, dur, shape });
const T = (t0, dur, text, x, y, size = 40, color = 'black', align = 'center') =>
  ITEMS.push({ kind: 'text', t0, dur, text, x, y, size, color: I.COLORS[color], align });
const C = (t0, draw) => ITEMS.push({ kind: 'custom', t0, dur: 0.01, draw });

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) ** 2);
const fadeIn = (t, t0, d = 0.5) => clamp((t - t0) / d, 0, 1);

// ---- 1 · title ------------------------------------------------------------------
T(1.2, 1.4, 'PYTHAGORAS', 640, 220, 88, 'red');
T(2.8, 1.8, 'a proof with no algebra', 640, 300, 44, 'blue');
S(4.7, 0.6, I.line([420, 330], [860, 330], 'blue', 5));

// ---- 2 · the proof -----------------------------------------------------------------
const a = 180, b = 240, SZ = a + b;       // a 3-4-5 triangle, 60 px per unit
const x0 = 700, y0 = 95;
// The small triangle on the left: right angle at R, leg a up, leg b right.
const sR = [120, 330], ss = 0.55;
S(L.tri.t0 + 0.2, 1.4, I.poly([[sR[0], sR[1] - a * ss], sR, [sR[0] + b * ss, sR[1]], [sR[0], sR[1] - a * ss]], 'black', 5));
S(L.tri.t0 + 1.6, 0.3, I.poly([[sR[0], sR[1] - 16], [sR[0] + 16, sR[1] - 16], [sR[0] + 16, sR[1]]], 'black', 3));
T(at('tri', ' a '), 0.3, 'a', sR[0] - 26, sR[1] - a * ss / 2 + 12, 38, 'blue');
T(at('tri', ' b'), 0.3, 'b', sR[0] + b * ss / 2, sR[1] + 42, 38, 'orange');
T(at('tri', ' c.'), 0.3, 'c', sR[0] + b * ss / 2 + 22, sR[1] - a * ss / 2 - 10, 38, 'red');
T(L.claim.t0 + 0.2, L.claim.dur - 0.4, 'a² + b² = c²', 205, 445, 52, 'blue');

// The four triangles: right-angle vertex R, leg vectors va (length a) and vb (length b).
const FILL = ['rgba(122,168,230,0.8)', 'rgba(242,166,106,0.8)', 'rgba(140,206,150,0.8)', 'rgba(190,150,228,0.8)'];
const ARR1 = [
  { R: [x0, y0], ang: 0 },            // va along +x
  { R: [x0 + SZ, y0], ang: 90 },
  { R: [x0 + SZ, y0 + SZ], ang: 180 },
  { R: [x0, y0 + SZ], ang: -90 },
];
const ARR2 = [
  { R: [x0, y0 + a], ang: 0 },
  { R: [x0 + SZ, y0], ang: 90 },
  { R: [x0 + a, y0 + SZ], ang: 180 },
  { R: [x0 + a, y0 + a], ang: -90 },
];
const SRC = { R: sR, ang: -90, k: ss };
const FLY = at('build', 'four');           // copies leave the little triangle
const SLIDE0 = L.slide.t0 + 0.9, SLIDE1 = SLIDE0 + 2.6;
function triPose(i, t) {
  const t1 = FLY + i * 0.5, k1 = ease(clamp((t - t1) / 1.4, 0, 1));
  const tgt = ARR1[i];
  let d = ((tgt.ang - SRC.ang + 540) % 360) - 180;       // shortest turn
  let R = [SRC.R[0] + (tgt.R[0] - SRC.R[0]) * k1, SRC.R[1] + (tgt.R[1] - SRC.R[1]) * k1];
  const ang = SRC.ang + d * k1, k = SRC.k + (1 - SRC.k) * k1;
  const k2 = ease(clamp((t - SLIDE0 - i * 0.35) / 1.5, 0, 1));
  if (k2 > 0) R = [ARR1[i].R[0] + (ARR2[i].R[0] - ARR1[i].R[0]) * k2, ARR1[i].R[1] + (ARR2[i].R[1] - ARR1[i].R[1]) * k2];
  return { R, ang: k2 > 0 ? ARR1[i].ang : ang, k, flying: t > t1 };
}
function triPath(g, { R, ang, k }) {
  const r = ang * Math.PI / 180, ca = Math.cos(r), sa = Math.sin(r);
  // va along angle, vb 90 degrees clockwise on screen (positive cross in y-down space).
  const va = [ca * a * k, sa * a * k], vb = [-sa * b * k, ca * b * k];
  g.beginPath(); g.moveTo(R[0], R[1]); g.lineTo(R[0] + va[0], R[1] + va[1]); g.lineTo(R[0] + vb[0], R[1] + vb[1]); g.closePath();
}
const markerFont = (s) => `bold ${s}px "Liberation Sans", Arial, sans-serif`;
const label = (g, text, x, y, size, color, alpha) => {
  g.save(); g.globalAlpha = alpha; g.font = markerFont(size); g.fillStyle = color; g.textAlign = 'center'; g.fillText(text, x, y); g.restore();
};

// The big square's frame and side labels.
const BUILD = at('build', 'big square');
S(BUILD - 0.6, 1.3, I.rect(x0, y0, SZ, SZ, 'black', 5));
T(BUILD + 0.6, 0.3, 'a', x0 + a / 2, y0 - 14, 30, 'blue');
T(BUILD + 0.8, 0.3, 'b', x0 + a + b / 2, y0 - 14, 30, 'orange');
T(BUILD + 1.0, 0.3, 'b', x0 - 22, y0 + b / 2 + 10, 30, 'orange');
T(BUILD + 1.2, 0.3, 'a', x0 - 22, y0 + b + a / 2 + 10, 30, 'blue');

// Everything that moves or shades lives in one custom layer, in draw order.
const CSQ = at('csq', 'empty'), ASQ = at('absq', 'One is'), BSQ = at('absq', 'the other');
C(L.tri.t0, (g, t) => {
  // c² (arrangement 1) and a², b² (arrangement 2): the empty space, shaded.
  const cOn = fadeIn(t, CSQ, 0.8) * (1 - fadeIn(t, SLIDE0, 0.6));
  if (cOn > 0) {
    g.save(); g.globalAlpha = 0.45 * cOn; g.fillStyle = '#f07d72';
    g.beginPath(); g.moveTo(x0 + a, y0); g.lineTo(x0 + SZ, y0 + a); g.lineTo(x0 + b, y0 + SZ); g.lineTo(x0, y0 + b); g.closePath(); g.fill(); g.restore();
    label(g, 'c²', x0 + SZ / 2, y0 + SZ / 2 + 22, 64, '#d2372c', fadeIn(t, at('csq', 'c squared'), 0.3) * (1 - fadeIn(t, SLIDE0, 0.6)));
  }
  const aOn = fadeIn(t, ASQ, 0.6), bOn = fadeIn(t, BSQ, 0.6);
  if (aOn > 0) {
    g.save(); g.globalAlpha = 0.4 * aOn; g.fillStyle = '#6f9be0'; g.fillRect(x0, y0, a, a); g.restore();
    label(g, 'a²', x0 + a / 2, y0 + a / 2 + 20, 56, '#2359b8', aOn);
  }
  if (bOn > 0) {
    g.save(); g.globalAlpha = 0.4 * bOn; g.fillStyle = '#f0a066'; g.fillRect(x0 + a, y0 + a, b, b); g.restore();
    label(g, 'b²', x0 + a + b / 2, y0 + a + b / 2 + 20, 60, '#c46a2c', bOn);
  }
  // The triangles themselves.
  for (let i = 0; i < 4; i++) {
    const p = triPose(i, t);
    if (!p.flying) continue;
    triPath(g, p);
    g.fillStyle = FILL[i]; g.fill();
    g.strokeStyle = '#23262b'; g.lineWidth = 4; g.lineJoin = 'round'; g.stroke();
  }
});

// "Same square, same triangles."
T(at('same', 'Same big'), 0.9, 'same square ✓', 800, 562, 26, 'green');
T(at('same', 'Same four'), 0.9, 'same 4 triangles ✓', 1050, 562, 26, 'green');
// Q.E.D.: box the formula, tick it.
S(L.qed.t0 + 1.2, 0.8, I.rect(50, 392, 312, 76, 'green', 5));
S(at('qed', 'Proved'), 0.4, I.check(395, 425, 26));
T(at('qed', 'Proved') + 0.3, 0.8, 'proved!', 205, 520, 40, 'green');

// ---- 3 · check it: 3, 4, 5 -------------------------------------------------------------
function grid(x, y, n, cell, color, t0) {
  C(t0, (g, t) => {
    const k = fadeIn(t, t0, 0.9);
    g.save(); g.globalAlpha = 0.35 * k; g.fillStyle = color; g.fillRect(x, y, n * cell, n * cell); g.restore();
  });
  S(t0, 0.5, I.rect(x, y, n * cell, n * cell, 'black', 4));
  for (let i = 1; i < n; i++) {
    S(t0 + 0.3 + i * 0.05, 0.15, I.line([x + i * cell, y], [x + i * cell, y + n * cell], 'grey', 2));
    S(t0 + 0.3 + i * 0.05, 0.15, I.line([x, y + i * cell], [x + n * cell, y + i * cell], 'grey', 2));
  }
}
const CK = L.check.t0, cell = 36;
grid(250, 400 - 3 * cell, 3, cell, '#6f9be0', CK + 0.2);
T(CK + 0.9, 0.3, '+', 420, 360, 60);
grid(470, 400 - 4 * cell, 4, cell, '#f0a066', CK + 0.9);
T(CK + 1.7, 0.3, '=', 670, 360, 60);
grid(720, 400 - 5 * cell, 5, cell, '#f07d72', CK + 1.6);
T(at('check', 'Nine'), 0.4, '9', 250 + 1.5 * cell, 460, 48, 'blue');
T(at('check', 'sixteen'), 0.5, '16', 470 + 2 * cell, 460, 48, 'orange');
T(at('check', 'twenty'), 0.5, '25', 720 + 2.5 * cell, 460, 48, 'red');
T(at('check', 'three'), 0.9, '3² + 4² = 5²', 640, 110, 56, 'black');

export const sceneOf = (t) => WIPES.filter((w) => w <= t).length;
for (const it of ITEMS) it.scene = sceneOf(it.t0);

// ---- the critter ------------------------------------------------------------------------
export const WALKS = [
  { t0: 0.0, t1: 2.0, x0: -140, x1: 150 },
  { t0: end('bye') + 0.1, t1: end('bye') + 2.2, x0: 150, x1: 1450 },
];
export const HOPS = [3.2, at('qed', 'Proved'), at('qed', 'Proved') + 0.45, at('check', 'twenty') + 0.3, L.bye.t0];
export const POINTS = [
  { t0: CSQ, t1: CSQ + 3 }, { t0: ASQ, t1: BSQ + 2 }, { t0: L.tri.t0 + 0.5, t1: L.tri.t0 + 4 },
];
export const critterX = (t) => {
  let x = WALKS[0].x0;
  for (const w of WALKS) {
    if (t >= w.t1) x = w.x1;
    else if (t >= w.t0) return { x: w.x0 + (w.x1 - w.x0) * (t - w.t0) / (w.t1 - w.t0), walking: true, dir: Math.sign(w.x1 - w.x0) };
  }
  return { x, walking: false, dir: 1 };
};
