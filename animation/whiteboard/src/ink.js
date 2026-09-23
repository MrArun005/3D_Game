// Hand-drawn marker shapes as point lists, plus the canvas code that draws a
// shape "p" of the way through, the way a marker would. Shapes are pure data so
// node can time sounds from them too.

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let seed = 1;
const R = () => rng(seed++);

// Resample a polyline evenly and add a slow, seeded wobble.
function wobble(pts, amt = 1.6, step = 6) {
  const out = [];
  const r = R(), ph = r() * 10, ph2 = r() * 10;
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / step));
    const nx = -(by - ay) / (L || 1), ny = (bx - ax) / (L || 1);
    for (let k = 0; k < n; k++) {
      const t = k / n, d = s + L * t;
      const w = amt * (Math.sin(d * 0.021 + ph) + 0.5 * Math.sin(d * 0.057 + ph2));
      out.push([ax + (bx - ax) * t + nx * w, ay + (by - ay) * t + ny * w]);
    }
    s += L;
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// Shapes. Each returns { strokes: [[x,y]...][], color, width }.
export const COLORS = { black: '#23262b', blue: '#2359b8', red: '#d2372c', green: '#2e8f4e', orange: '#d9773f', grey: '#8a8f96' };
const shape = (strokes, color = 'black', width = 5, amt) => ({ strokes: strokes.map((s) => wobble(s, amt)), color: COLORS[color] || color, width });
export const line = (a, b, c, w) => shape([[a, b]], c, w);
export const poly = (pts, c, w) => shape([pts], c, w);
export function rect(x, y, w, h, c, lw) { return shape([[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y - 2]]], c, lw); }
export function ellipse(cx, cy, rx, ry, c, w, a0 = -Math.PI / 2, a1 = a0 + Math.PI * 2.08) {
  const pts = [];
  for (let i = 0; i <= 48; i++) { const a = a0 + (a1 - a0) * i / 48; pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
  return shape([pts], c, w, 1.2);
}
export function arrow(pts, c, w) {
  const [ax, ay] = pts[pts.length - 2], [bx, by] = pts[pts.length - 1];
  const a = Math.atan2(by - ay, bx - ax), h = 18;
  const head = [[bx - Math.cos(a - 0.45) * h, by - Math.sin(a - 0.45) * h], [bx, by], [bx - Math.cos(a + 0.45) * h, by - Math.sin(a + 0.45) * h]];
  return shape([pts, head], c, w);
}
export function curve(p0, p1, p2, c, w) {      // quadratic, as an arrow
  const pts = [];
  for (let i = 0; i <= 30; i++) { const t = i / 30; pts.push([(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]]); }
  return arrow(pts, c, w);
}
export function wave(x0, x1, y, amp = 6, len = 40, c = 'blue', w = 4) {
  const pts = [];
  for (let x = x0; x <= x1; x += 4) pts.push([x, y + Math.sin((x - x0) / len * Math.PI * 2) * amp]);
  return shape([pts], c, w, 0.6);
}
export const cross = (x, y, s = 30, c = 'red', w = 7) => shape([[[x - s, y - s], [x + s, y + s]], [[x + s, y - s], [x - s, y + s]]], c, w);
export const check = (x, y, s = 30, c = 'green', w = 8) => shape([[[x - s, y], [x - s * 0.3, y + s * 0.7], [x + s * 1.1, y - s * 0.9]]], c, w);
export function burst(x, y, r = 50, c = 'orange', w = 6) {
  const s = [];
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; s.push([[x + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.45], [x + Math.cos(a) * r, y + Math.sin(a) * r]]); }
  return shape(s, c, w);
}
// A side-view airliner doodle, nose to the right, centred on (x, y), scale k, tilted by rot.
export function airliner(x, y, k = 1, rot = 0, c = 'black', w = 5) {
  const T = ([px, py]) => { const cs = Math.cos(rot), sn = Math.sin(rot); return [x + (px * cs - py * sn) * k, y + (px * sn + py * cs) * k]; };
  const body = [[-150, -8], [110, -12], [140, -6], [158, 6], [140, 18], [-110, 18], [-150, 6], [-150, -8]];
  const tail = [[-140, -8], [-165, -62], [-138, -62], [-100, -10]];
  const wing = [[-10, 10], [-60, 40], [-30, 40], [40, 12]];
  const engine = [[-8, 26], [30, 26], [34, 34], [30, 42], [-8, 42], [-8, 26]];
  const windows = [];
  for (let i = -100; i < 90; i += 16) windows.push([[i, 0], [i + 5, 0]]);
  return shape([body, tail, wing, engine, [[118, -6], [132, -2]], ...windows].map((s) => s.map(T)), c, w);
}
export function goose(x, y, k = 1, c = 'black', w = 4) {
  return shape([[[x - 18 * k, y - 6 * k], [x, y + 4 * k], [x + 18 * k, y - 6 * k]]], c, w, 0.5);
}
export function boat(x, y, k = 1, c = 'blue', w = 4) {
  const P = (pts) => pts.map(([a, b]) => [x + a * k, y + b * k]);
  return shape([P([[-40, 0], [40, 0], [30, 14], [-32, 14], [-40, 0]]), P([[-20, 0], [-20, -16], [16, -16], [16, 0]]), P([[-12, -8], [-4, -8]]), P([[4, -8], [10, -8]])], c, w);
}
export function checkbox(x, y, s = 34, c = 'black', w = 4) { return rect(x, y, s, s, c, w); }

// Length of a shape, for timing and progressive drawing.
export function lengthOf(sh) {
  let L = 0;
  for (const s of sh.strokes) for (let i = 1; i < s.length; i++) L += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
  return L;
}

// Canvas: draw a shape p (0..1) of the way through its total length.
export function drawShape(g, sh, p) {
  if (p <= 0) return null;
  const total = lengthOf(sh);
  let budget = total * Math.min(1, p), tip = null;
  g.strokeStyle = sh.color; g.lineWidth = sh.width; g.lineCap = 'round'; g.lineJoin = 'round';
  for (const s of sh.strokes) {
    if (budget <= 0) break;
    g.beginPath(); g.moveTo(s[0][0], s[0][1]);
    for (let i = 1; i < s.length; i++) {
      const seg = Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
      if (budget < seg) {
        const t = budget / seg;
        tip = [s[i - 1][0] + (s[i][0] - s[i - 1][0]) * t, s[i - 1][1] + (s[i][1] - s[i - 1][1]) * t];
        g.lineTo(tip[0], tip[1]); budget = 0; break;
      }
      g.lineTo(s[i][0], s[i][1]); budget -= seg; tip = s[i];
    }
    g.stroke();
  }
  return p < 1 ? tip : null;
}
