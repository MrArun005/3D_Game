// "How we invented farming": a cartoon told by Clawd. Each narration line has a
// scene; scenes cross-fade at the line boundaries. Timing comes from
// stories/farming.timing.json (tools/voice.py). window.renderFrame(i) for the renderer.
import * as A from './art.js';
import timing from '../stories/farming.timing.json' with { type: 'json' };

const { W, H, clamp, lerp, ease, mix } = A;
const FPS = 30, DURATION = timing.duration;
const c = document.getElementById('c'), g = c.getContext('2d');
const off = document.createElement('canvas'); off.width = W; off.height = H;
const og = off.getContext('2d');
const LINES = timing.lines;
const L = Object.fromEntries(LINES.map((l) => [l.id, l]));
const at = (id, word) => { const l = L[id]; const i = l.text.indexOf(word); return l.t0 + l.dur * Math.max(0, i) / l.text.length; };
const fade = (t, t0, d = 0.5) => clamp((t - t0) / d, 0, 1);
const FONT = '"Liberation Sans", Arial, sans-serif';
const GROUND_Y = 560;

// Common daylight landscape.
function land(g, t, { hillsCol = ['#c9d59a', '#aebf73', '#94a85c'], groundCol = '#b9c26a', sunX = 1030, sunY = 120, riverY = null } = {}) {
  A.sky(g);
  A.sun(g, sunX, sunY);
  A.clouds(g, t);
  A.hills(g, [
    { y: 390, amp: 26, len: 170, phase: 1, color: hillsCol[0] },
    { y: 450, amp: 20, len: 120, phase: 3, color: hillsCol[1] },
  ]);
  if (riverY) A.river(g, riverY);
  A.ground(g, GROUND_Y - 30, groundCol);
}
function wheatField(g, t, x0, x1, y, n, opts = {}) {
  const r = A.rng(x0 + n);
  for (let i = 0; i < n; i++) {
    const x = x0 + (x1 - x0) * (i + r() * 0.6) / n;
    A.wheat(g, x, y + r() * 16, 70 + r() * 30, t, { phase: r() * 6, ...opts });
  }
}

// ---- the scenes -------------------------------------------------------------------------
const S = {
  hook(g, t) {
    // Dawn over the hills: Clawd introduces the story.
    const k = fade(t, 0, 4);
    A.sky(g, mix('#2b2f55', '#8fc6ea', k), mix('#e8906a', '#f3e3c3', k));
    A.sun(g, 960, lerp(520, 300, ease(k)), 60);
    A.hills(g, [{ y: 440, amp: 30, len: 180, phase: 2, color: mix('#5a5f55', '#b8c78a', k) }, { y: 500, amp: 16, len: 120, phase: 0, color: mix('#4a5040', '#9fb065', k) }]);
    A.ground(g, GROUND_Y, mix('#3f4632', '#a9b660', k));
    A.title(g, 'CLAWD’S STORIES', 640, 120, 26, '#7a4b2e', fade(t, 0.6), '#fff5e6');
    A.title(g, 'How we invented farming', 640, 190, 66, '#b8452c', fade(t, 1.2), '#fff5e6');
    const hop = [0.4, 1.3].reduce((h, s) => { const q = (t - L.hook.t0 - s) / 0.4; return q > 0 && q < 1 ? Math.max(h, Math.sin(q * Math.PI) * 30) : h; }, 0);
    A.clawd(g, 640 - 5.5 * 13, GROUND_Y, 13, t, { talking: talkingAt(t), hop, wave: t > 1.2 && t < 3.5 });
  },
  ana(g, t, lt) {
    land(g, t, { riverY: 505 });
    wheatField(g, t, 40, 1240, 548, 38, { ripe: 0.8 });
    const x = lerp(-60, 560, ease(lt / 3.2));
    const walking = lt < 3.2;
    A.person(g, x, GROUND_Y + 8, A.ANA, { walk: walking ? lt * 7 : null, wave: !walking && lt > 3.4 ? lt - 3.4 : 0 });
    A.label(g, 'Ana', x + 4, GROUND_Y - 170, { size: 30, alpha: fade(lt, 1.2) });
    // Inset map of the Fertile Crescent.
    const m = fade(t, at('ana', 'Fertile'), 0.6);
    if (m > 0) {
      g.save(); g.globalAlpha = m;
      g.fillStyle = 'rgba(250,240,215,0.96)'; g.beginPath(); g.roundRect(820, 40, 420, 250, 16); g.fill();
      g.strokeStyle = '#8a6b45'; g.lineWidth = 3; g.stroke();
      g.fillStyle = '#9fcbe6'; g.beginPath(); g.ellipse(870, 190, 60, 90, 0.2, 0, 7); g.fill();       // Mediterranean
      g.fillStyle = '#9fcbe6'; g.beginPath(); g.ellipse(1175, 245, 50, 26, -0.5, 0, 7); g.fill();     // Persian Gulf
      g.strokeStyle = '#5d9dc6'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(1010, 90); g.quadraticCurveTo(1080, 170, 1160, 235); g.stroke();         // Tigris
      g.beginPath(); g.moveTo(975, 110); g.quadraticCurveTo(1040, 200, 1150, 240); g.stroke();         // Euphrates
      g.strokeStyle = 'rgba(95,150,60,0.75)'; g.lineWidth = 26; g.lineCap = 'round';
      g.beginPath(); g.moveTo(940, 250); g.quadraticCurveTo(935, 110, 1030, 100); g.quadraticCurveTo(1120, 110, 1170, 215); g.stroke();
      g.font = `bold 22px ${FONT}`; g.fillStyle = '#3d5a24'; g.textAlign = 'center'; g.fillText('Fertile Crescent', 1040, 78);
      g.font = `15px ${FONT}`; g.fillStyle = '#3f6f93'; g.fillText('Mediterranean', 868, 265);
      g.restore();
    }
  },
  nomads(g, t, lt) {
    land(g, t, { riverY: 500 });
    A.tent(g, 180, GROUND_Y - 10, 1); A.tent(g, 330, GROUND_Y - 4, 0.8, '#95764f');
    A.bush(g, 900, GROUND_Y - 20, 1.1);
    wheatField(g, t, 560, 800, 552, 9, { ripe: 0.9 });
    // A gazelle bounds past; the father gives chase.
    const gx = lerp(-120, 1400, clamp((t - at('nomads', 'hunt')) / 3.2, 0, 1));
    A.gazelle(g, gx, GROUND_Y - 10 - Math.abs(Math.sin(t * 7)) * 24, 1, t, 1);
    const dx = lerp(-200, 1250, clamp((t - at('nomads', 'hunt') - 0.4) / 4.2, 0, 1));
    A.person(g, dx, GROUND_Y + 10, A.DAD, { walk: t * 11 });
    // Ana picks berries; the child carries grain.
    const reach = 0.5 + 0.5 * Math.sin(t * 3);
    A.person(g, 830, GROUND_Y + 10, A.ANA, { reach, dir: 1 });
    A.basket(g, 790, GROUND_Y + 8, 1, fade(lt, 2, 4) * 0.6);
    A.person(g, lerp(420, 640, clamp(lt / 7, 0, 1)), GROUND_Y + 14, A.KID, { walk: lt * 9, carry: true, basketFill: 0.4 });
    A.label(g, 'hunter-gatherers', 640, 80, { size: 30, alpha: fade(lt, 0.6) });
  },
  shatter(g, t, lt) {
    // Close-up: a ripe wild wheat head drops its grains.
    A.sky(g, '#9fd0ee', '#f5e7c8');
    A.hills(g, [{ y: 470, amp: 16, len: 160, phase: 1, color: '#c3cf8e' }]);
    A.ground(g, 600, '#b3a466', '#9e9055');
    const drop = at('shatter', 'shatter');
    const left = 1 - clamp((t - drop) / 2.2, 0, 1);
    const [hx, hy] = A.wheat(g, 520, 610, 380, t, { big: 3.2, seeds: left, ripe: 1, sway: 0.7 });
    // Falling grains: each leaves the head in turn and tumbles to the ground.
    for (let i = 0; i < 10; i++) {
      const tl = drop + (i / 10) * 2.2;
      const a = t - tl;
      if (a < 0) continue;
      const side = i % 2 ? 1 : -1, k = Math.floor(i / 2);
      const sx = hx + side * 16, sy = hy - k * 22;
      const y = Math.min(640, sy + 180 * a * a + 40 * a), x = sx + side * 50 * Math.min(a, 1);
      A.grain(g, x, y, 3.2, '#e0b44e', a * 5 * side);
    }
    A.label(g, 'wild wheat', 520, 90, { size: 34, alpha: fade(lt, 0.5) });
    A.label(g, 'ripe seeds fall off: “shattering”', 940, 330, { size: 28, color: '#8a3b22', alpha: fade(t, drop + 0.6) });
  },
  sticky(g, t, lt) {
    land(g, t);
    // A field of shattered stalks, with a few that kept their seeds, glowing.
    const keep = new Set([3, 9, 14, 20]);
    const pick = at('sticky', 'easiest');
    const r = A.rng(7);
    const heads = [];
    const ax = lerp(60, 1100, clamp((t - pick + 0.8) / 4.6, 0, 1));
    let n = 0;
    for (let i = 0; i < 24; i++) {
      const x = 90 + i * 48 + r() * 20;
      const kept = keep.has(i);
      const taken = kept && ax > x + 10;       // picked as she reaches it
      if (taken) { n++; continue; }
      heads.push(A.wheat(g, x, 575, 110 + r() * 30, t, { seeds: kept ? 1 : 0.1, ripe: 1, glow: kept ? 0.6 + 0.4 * Math.sin(t * 4) : 0, phase: i }));
    }
    // Ana walks along and gathers the full heads into her basket.
    A.person(g, ax, GROUND_Y + 30, A.ANA, { walk: t < pick + 3.8 ? t * 7 : null, carry: true, basketFill: n / 4 });
    A.label(g, 'seeds stay on', 640, 90, { size: 32, color: '#7a5a10', alpha: fade(lt, 0.8) });
  },
  sprout(g, t, lt) {
    // Time passes at camp: days flicker, the ground greens, dropped seeds come up.
    const days = clamp((lt - 1.5) / 4.5, 0, 1);
    const cyc = days * 5, dayness = 0.5 + 0.5 * Math.cos(cyc * Math.PI * 2);
    A.sky(g, mix('#1f2548', '#8fc6ea', dayness), mix('#3a3f5a', '#f3e3c3', dayness));
    const ang = cyc * Math.PI * 2;
    A.sun(g, 640 + Math.sin(ang) * 520, 420 - Math.cos(ang) * 320);
    A.moon(g, 640 - Math.sin(ang) * 520, 420 + Math.cos(ang) * 320);
    A.hills(g, [{ y: 420, amp: 24, len: 170, phase: 1, color: mix('#6d7050', '#b9cb86', dayness) }]);
    A.ground(g, GROUND_Y - 30, mix(mix('#9a8a5a', '#8fbf5a', days), '#2f3a2a', 1 - dayness));
    A.tent(g, 300, GROUND_Y - 20, 1.1);
    // Seeds spill as Ana walks past, before the time-lapse.
    const ax = lerp(-80, 700, clamp(lt / 1.8, 0, 1));
    if (lt < 2.4) A.person(g, ax, GROUND_Y + 10, A.ANA, { walk: lt * 7, carry: true, basketFill: 0.8 });
    for (let i = 0; i < 9; i++) {
      const x = 420 + i * 38;
      const grow = clamp((days - i * 0.04) * 1.4, 0, 1);
      if (grow <= 0) { if (lt > 0.4 + i * 0.12) A.grain(g, x, GROUND_Y - 6, 0.9); continue; }
      A.wheat(g, x, GROUND_Y + 2, 20 + 80 * grow, t, { ripe: grow > 0.9 ? 0.6 : 0, seeds: grow > 0.6 ? 1 : 0, big: 0.9, sway: grow });
    }
    A.label(g, days > 0.95 ? 'next spring' : 'seeds dropped near camp', 640, 80, { size: 30, alpha: fade(lt, 0.5) });
  },
  select(g, t, lt) {
    // The same crop over many generations: seeds stay on and get bigger.
    A.sky(g, '#a9d6ef', '#f6ead0');
    A.ground(g, 520, '#7d5f3b', '#6d5232');
    const n = 5;
    for (let i = 0; i < n; i++) {
      const on = fade(lt, 1.0 + i * 1.3, 0.6);
      if (on <= 0) continue;
      const x = 180 + i * 230, big = 1.2 + i * 0.35;
      g.save(); g.globalAlpha = on;
      A.wheat(g, x, 525, 200 + i * 24, t, { big, seeds: 1, ripe: 1, sway: 0.4 });
      A.label(g, i === 0 ? 'wild' : i === n - 1 ? 'crop' : '…', x, 562, { size: 26, bg: null, color: '#fff' });
      g.restore();
    }
    const k = fade(lt, 1.0, 6.0);
    g.strokeStyle = '#b8452c'; g.lineWidth = 6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(160, 592); g.lineTo(160 + 960 * k, 592); g.stroke();
    if (k > 0.98) { g.beginPath(); g.moveTo(1120, 592); g.lineTo(1100, 580); g.moveTo(1120, 592); g.lineTo(1100, 604); g.stroke(); }
    A.label(g, 'generation after generation', 640, 80, { size: 32, alpha: fade(lt, 0.4) });
  },
  village(g, t, lt) {
    land(g, t, { riverY: 492 });
    // Tents give way to mud-brick houses.
    const swap = at('village', 'Tents');
    const k = clamp((t - swap) / 1.6, 0, 1);
    for (const [x, s] of [[230, 1], [470, 0.85], [700, 0.95]]) {
      if (k < 1) { g.save(); g.globalAlpha = 1 - k; A.tent(g, x, GROUND_Y - 18, s); g.restore(); }
      A.house(g, x, GROUND_Y - 18, s, ease(k));
    }
    const k2 = clamp((t - at('village', 'houses become')) / 1.8, 0, 1);
    for (const [x, s, d] of [[930, 0.8, 0], [1110, 0.9, 0.3], [90, 0.75, 0.5]]) A.house(g, x, GROUND_Y - 26, s, ease((k2 - d) / (1 - d)));
    // Fields in rows in front.
    for (let row = 0; row < 3; row++) wheatField(g, t, 60, 1220, 610 + row * 36, 30, { ripe: 0.7, big: 0.8 });
    A.person(g, 560, GROUND_Y + 60, A.ANA, { bend: 0.4 + 0.2 * Math.sin(t * 3), reach: 0.5 });
    A.person(g, 820, GROUND_Y + 58, A.DAD, { walk: t * 6 });
    A.label(g, 'Jericho: one of the first towns', 640, 70, { size: 30, alpha: fade(t, at('village', 'Jericho'), 0.4) });
  },
  animals(g, t, lt) {
    land(g, t);
    A.house(g, 200, GROUND_Y - 28, 0.9); A.house(g, 1080, GROUND_Y - 28, 0.8);
    A.fence(g, 360, 920, GROUND_Y + 10);
    for (const [x, kind, d] of [[420, 's', 1], [520, 'g', -1], [610, 's', 1], [720, 'g', 1], [820, 's', -1]]) {
      const xx = x + Math.sin(t * 0.8 + x) * 20;
      (kind === 's' ? A.sheep : A.goat)(g, xx, GROUND_Y + 4, 1, t, d);
    }
    for (const x of [980, 1020, 1060]) A.jar(g, x, GROUND_Y + 40, 1);
    A.label(g, 'food to store', 1020, GROUND_Y - 60, { size: 24, alpha: fade(t, at('animals', 'store'), 0.4) });
    A.person(g, 300, GROUND_Y + 40, A.KID, { wave: lt });
    A.person(g, 240, GROUND_Y + 44, A.GRAN, {});
  },
  world(g, t, lt) {
    // A stylised world map; each place farming began pops up as it is named.
    g.fillStyle = '#9fd0ee'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#d8c79a';
    const blob = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); };
    blob([[140, 150], [330, 120], [420, 170], [380, 250], [300, 300], [270, 360], [230, 330], [180, 260], [120, 210]]);   // North America
    blob([[300, 380], [360, 380], [410, 430], [390, 520], [350, 610], [320, 600], [300, 500], [280, 430]]);               // South America
    blob([[560, 140], [700, 110], [760, 160], [700, 220], [620, 230], [560, 200]]);                                       // Europe
    blob([[580, 260], [700, 250], [760, 320], [740, 420], [690, 520], [640, 530], [610, 430], [560, 350]]);               // Africa
    blob([[720, 130], [960, 110], [1130, 160], [1150, 230], [1060, 320], [960, 330], [880, 300], [780, 260], [740, 200]]); // Asia
    blob([[1030, 440], [1140, 430], [1180, 490], [1120, 540], [1040, 520]]);                                              // Australia
    const pins = [
      ['wheat, barley', 745, 245, L.world.t0, '#b8452c'],
      ['rice, millet', 1000, 250, at('world', 'China'), '#b8452c'],
      ['maize', 245, 330, at('world', 'Mexico'), '#b8452c'],
      ['potatoes', 330, 500, at('world', 'Andes'), '#b8452c'],
      ['sorghum', 650, 360, at('world', 'Africa'), '#b8452c'],
    ];
    for (const [name, x, y, t0, col] of pins) {
      const k = fade(t, t0, 0.3);
      if (k <= 0) continue;
      const pop = 1 + 0.4 * Math.sin(clamp((t - t0) / 0.3, 0, 1) * Math.PI);
      g.fillStyle = col; g.beginPath(); g.arc(x, y, 10 * pop, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill();
      A.label(g, name, x, y - 28, { size: 22, alpha: k });
    }
    A.label(g, 'farming began in many places, independently', 640, 60, { size: 30, alpha: fade(lt, 0.4) });
  },
  change(g, t, lt) {
    // The village grows into a town, then a city; ends on a single wheat head.
    const k = clamp(lt / 5, 0, 1);
    A.sky(g, '#9fcbe9', '#f7e3c0');
    A.hills(g, [{ y: 430, amp: 20, len: 180, phase: 2, color: '#c6cf94' }]);
    A.ground(g, 520, '#c8b27a');
    const r = A.rng(33);
    for (let i = 0; i < 16; i++) {
      const x = 80 + i * 72 + r() * 20, s = 0.45 + r() * 0.35;
      A.house(g, x, 520 + r() * 20, s, ease((k * 16 - i * 0.6) / 3));
    }
    // A city wall and a stepped temple rise last.
    const wk = ease((k - 0.55) / 0.45);
    if (wk > 0) {
      g.fillStyle = '#b8935c'; g.fillRect(40, 560 - 60 * wk, 1200, 60 * wk);
      for (let x = 40; x < 1240; x += 40) g.fillRect(x, 560 - 60 * wk - 14, 22, 14);
      g.fillStyle = '#c9a36a';
      for (let s = 0; s < 4; s++) g.fillRect(560 + s * 30, 400 - s * 40 * wk, 160 - s * 60, 40 * wk);
    }
    // Words appear with the narration.
    const words = [['towns', 'Towns'], ['trade', 'trade'], ['writing', 'writing'], ['cities', 'cities']];
    words.forEach(([w, key], i) => A.label(g, w, 250 + i * 260, 110, { size: 34, alpha: fade(t, at('change', key), 0.3) }));
    // Close on one wheat head, glowing.
    const endK = fade(t, at('change', 'It all'), 0.8);
    if (endK > 0) {
      g.fillStyle = `rgba(30,24,18,${0.55 * endK})`; g.fillRect(0, 0, W, H);
      g.save(); g.globalAlpha = endK;
      A.wheat(g, 640, 640, 340, t, { big: 2.8, seeds: 1, ripe: 1, glow: 1, sway: 0.5 });
      g.restore();
    }
  },
  bye(g, t, lt) {
    land(g, t);
    wheatField(g, t, 40, 1240, 575, 40, { ripe: 1 });
    A.title(g, 'See you in the next story!', 640, 200, 56, '#b8452c', fade(lt, 0.3), '#fff5e6');
    const hop = (() => { const q = lt / 0.45; return q > 0 && q < 1 ? Math.sin(q * Math.PI) * 30 : 0; })();
    A.clawd(g, 640 - 5.5 * 13, GROUND_Y + 10, 13, t, { talking: talkingAt(t), hop, wave: true });
  },
};

// Scene boundaries: each line's scene starts just before the line.
const ORDER = LINES.map((l) => l.id);
const START = ORDER.map((id, i) => (i === 0 ? 0 : L[id].t0 - 0.45));
const XF = 0.6;
const talkingAt = (t) => LINES.some((l) => t >= l.t0 && t < l.t0 + l.dur);

function subtitles(t) {
  const s = LINES.find((l) => t >= l.t0 - 0.1 && t < l.t0 + l.dur + 0.35);
  if (!s) return;
  g.font = `bold 25px ${FONT}`;
  const words = s.text.split(' '), lines = [];
  let cur = '';
  for (const w of words) { const x = cur ? `${cur} ${w}` : w; if (g.measureText(x).width > 900 && cur) { lines.push(cur); cur = w; } else cur = x; }
  lines.push(cur);
  const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 36, h = lines.length * 32 + 16;
  const cx = 700, y = H - 20 - h;
  g.fillStyle = 'rgba(20,18,16,0.78)'; g.beginPath(); g.roundRect(cx - w / 2, y, w, h, 12); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center';
  lines.forEach((l, i) => g.fillText(l, cx, y + 32 + i * 32));
  g.textAlign = 'left';
}

function frame(t) {
  let i = 0; while (i + 1 < ORDER.length && t >= START[i + 1]) i++;
  const id = ORDER[i];
  S[id](g, t, t - START[i]);
  // Cross-fade from the previous scene.
  const since = t - START[i];
  if (i > 0 && since < XF) {
    og.clearRect(0, 0, W, H);
    S[ORDER[i - 1]](og, t, t - START[i - 1]);
    g.save(); g.globalAlpha = 1 - since / XF; g.drawImage(off, 0, 0); g.restore();
  }
  // Clawd narrates from the corner in the middle scenes.
  if (id !== 'hook' && id !== 'bye') A.clawd(g, 26, H - 24, 7, t, { talking: talkingAt(t) });
  subtitles(t);
  const f = Math.max(1 - clamp(t / 0.6, 0, 1), clamp((t - (DURATION - 0.8)) / 0.8, 0, 1));
  if (f > 0) { g.fillStyle = `rgba(0,0,0,${f})`; g.fillRect(0, 0, W, H); }
}

window.DURATION = DURATION;
window.FPS = FPS;
window.renderFrame = (i) => frame(i / FPS);
window.ready = true;
if (!new URLSearchParams(location.search).has('render')) {
  const t0 = performance.now();
  const loop = () => { frame(((performance.now() - t0) / 1000) % DURATION); requestAnimationFrame(loop); };
  loop();
}
