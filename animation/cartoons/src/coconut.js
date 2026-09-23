// "The Coconut Problem": Clawd tells how Koa learns to use a tool.
// One scene per narration line (stories/coconut.timing.json), cross-faded.
import * as A from './art.js';
import * as Hm from './humans.js';
import timing from '../stories/coconut.timing.json' with { type: 'json' };

const { W, H, clamp, lerp, ease, mix } = A;
const { P } = Hm;
// Bigger on screen than the rig's defaults.
const KOA = { ...Hm.KOA, s: 1.3 }, MIRA = { ...Hm.MIRA, s: 1.2 }, TIKI = { ...Hm.TIKI, s: 0.95 };
const FPS = 30, DURATION = timing.duration;
const c = document.getElementById('c'), g = c.getContext('2d');
const off = document.createElement('canvas'); off.width = W; off.height = H;
const og = off.getContext('2d');
const LINES = timing.lines;
const L = Object.fromEntries(LINES.map((l) => [l.id, l]));
const at = (id, word) => { const l = L[id]; const i = l.text.indexOf(word); return l.t0 + l.dur * Math.max(0, i) / l.text.length; };
const fade = (t, t0, d = 0.5) => clamp((t - t0) / d, 0, 1);
const talkingAt = (t) => LINES.some((l) => t >= l.t0 && t < l.t0 + l.dur);
const FONT = '"Liberation Sans", Arial, sans-serif';
const BEACH_Y = 590;

function beach(g, t, { sky = ['#7cc4ec', '#fbe8c0'] } = {}) {
  A.sky(g, sky[0], sky[1]);
  A.sun(g, 1120, 110, 54, '#ffcf4a');
  A.clouds(g, t);
  Hm.sea(g, 430, W, t);
  Hm.sand(g, 520, W, H);
}
// Koa's place on the palm trunk: k (0 = ground, 1 = crown).
function onTrunk(g, k, pose, t) {
  const q = Hm.palmPoint(k);
  g.save(); g.translate(q.x, q.y); g.rotate(q.ang);
  Hm.human(g, -36, 74, KOA, pose, 1);
  g.restore();
}

const S = {
  hook(g, t) {
    const k = fade(t, 0, 3.5);
    beach(g, t, { sky: [mix('#3b3f73', '#7cc4ec', k), mix('#f19a6c', '#fbe8c0', k)] });
    Hm.palm(g, t, 3);
    A.title(g, 'CLAWD’S STORIES', 360, 120, 26, '#7a4b2e', fade(t, 0.6), '#fff5e6');
    A.title(g, 'The Coconut Problem', 360, 190, 60, '#b8452c', fade(t, 1.2), '#fff5e6');
    const hop = [0.4, 1.3].reduce((h, s) => { const q = (t - L.hook.t0 - s) / 0.4; return q > 0 && q < 1 ? Math.max(h, Math.sin(q * Math.PI) * 30) : h; }, 0);
    A.clawd(g, 400 - 5.5 * 13, BEACH_Y + 30, 13, t, { talking: talkingAt(t), hop, wave: t > 1.2 && t < 3.5 });
  },
  play(g, t, lt) {
    // A corn patch on dark earth; the three friends chase through it.
    A.sky(g, '#8fcbee', '#f7e6c2');
    A.sun(g, 1060, 120);
    A.clouds(g, t);
    A.hills(g, [{ y: 380, amp: 24, len: 170, phase: 1, color: '#b8cf84' }]);
    Hm.soil(g, 470, W, H);
    const r = A.rng(4);
    const back = [], front = [];
    for (let i = 0; i < 22; i++) (i % 2 ? back : front).push([30 + i * 58 + r() * 20, 150 + r() * 50, r() * 6]);
    for (const [x, h, ph] of back) Hm.corn(g, x, 520, h + 20, t, ph);
    // Chase: Tiki leads, Mira and Koa after; they loop across the field.
    const run = (x0, speed, look, bob) => {
      const x = ((x0 + lt * speed) % (W + 300)) - 150;
      Hm.human(g, x, 600 - Math.abs(Math.sin(lt * 9 + bob)) * 10, look, P.run(lt * 13 + bob), 1);
    };
    run(360, 230, TIKI, 0.5);
    run(180, 225, MIRA, 1.7);
    run(20, 232, KOA, 2.9);
    for (const [x, h, ph] of front) Hm.corn(g, x, 700, h + 60, t, ph);
    A.label(g, 'Koa', ((20 + lt * 232) % (W + 300)) - 150, 420, { size: 26, alpha: fade(t, at('play', 'Koa'), 0.3) * (1 - fade(t, at('play', 'Racing'), 0.4)) });
  },
  spot(g, t, lt) {
    beach(g, t);
    Hm.palm(g, t, 3);
    const walkEnd = 2.2;
    const x = lerp(-60, 690, ease(lt / walkEnd));
    if (lt < walkEnd) Hm.human(g, x, BEACH_Y + 40, KOA, P.walk(lt * 8), 1);
    else Hm.human(g, 690, BEACH_Y + 40, KOA, lt > at('spot', 'spots') - L.spot.t0 + 0.4 ? P.lookUp() : { mouth: 'flat', eyes: 'closed', ra: [0.5, 1.9] }, 1);
    // Heat haze and a thirsty "..." then the sparkle on the coconuts.
    if (lt > walkEnd && t < at('spot', 'spots')) A.label(g, 'hot… thirsty…', 690, 400, { size: 26 });
    const sp = fade(t, at('spot', 'Coconuts'), 0.3);
    if (sp > 0) { Hm.stars(g, 905, 180, t, 4, 44); Hm.word(g, 'Coconuts!', 690, 330, 54, '#ffd24a', fade(t, at('spot', 'Coconuts'), 0.4)); }
  },
  slip(g, t, lt) {
    beach(g, t);
    Hm.palm(g, t, 3);
    // Up a little, then down he slides and lands on his bottom.
    const up = at('slip', 'Up') - L.slip.t0, whoops = at('slip', 'whoops') - L.slip.t0;
    let k;
    if (lt < up) k = 0.05 + 0.08 * ease(lt / up);
    else if (lt < whoops) k = 0.13 + 0.12 * ease((lt - up) / (whoops - up));
    else k = Math.max(0, 0.25 - 0.25 * ease((lt - whoops) / 0.7));
    const landed = lt > whoops + 0.7;
    if (!landed) onTrunk(g, k, lt < whoops ? P.climb(lt * 6) : P.slide(), t);
    else { Hm.human(g, 790, BEACH_Y + 40, KOA, P.sit(), 1); Hm.stars(g, 812, 474, t, 3, 30); }
    if (lt > whoops && !landed) Hm.word(g, 'whoops!', 680, 360, 46, '#ff8a4a', fade(lt, whoops, 0.3));
  },
  climb(g, t, lt) {
    beach(g, t);
    Hm.palm(g, t, 3);
    // Two more slips, then the trick works and he goes all the way up.
    const tries = [[0.0, 1.3], [1.4, 2.6]];
    const trick = at('climb', 'Grip') - L.climb.t0;
    let k, pose;
    const tr = tries.find(([a, b]) => lt >= a && lt < b);
    if (tr) {
      const u = (lt - tr[0]) / (tr[1] - tr[0]);
      k = u < 0.6 ? 0.2 * ease(u / 0.6) : 0.2 * (1 - ease((u - 0.6) / 0.4));
      pose = u < 0.6 ? P.climb(lt * 7) : P.slide();
    } else if (lt < trick) { k = 0; pose = P.climb(0); }
    else { k = Math.min(0.9, 0.9 * ease((lt - trick) / (L.climb.dur - trick + 0.4))); pose = P.climb(lt * 9); }
    onTrunk(g, k, pose, t);
    if (lt > trick) {
      const words = ['Grip', 'push', 'reach', 'pull'];
      words.forEach((w, i) => A.label(g, w.toLowerCase(), 300, 170 + i * 56, { size: 30, alpha: fade(t, at('climb', w), 0.25) }));
      Hm.word(g, 'Up, up, up!', 560, 110, 48, '#8fe07a', fade(t, at('climb', 'Up, up'), 0.3));
    }
  },
  pick(g, t, lt) {
    beach(g, t);
    const free = at('pick', 'free'), thud = at('pick', 'Thud');
    Hm.palm(g, t, t < free ? 3 : 2);
    onTrunk(g, 0.9, t < free ? P.twist(t * 10) : P.climb(0.3), t);
    if (t >= free) {
      // The coconut drops from the crown to the sand, then rests.
      const a = clamp((t - free) / (thud - free), 0, 1);
      const x = lerp(937, 990, a), y = lerp(185, BEACH_Y + 26, a * a);
      Hm.coconut(g, x, y, 1.1, a * 6);
      Hm.impact(g, 990, BEACH_Y + 26, (t - thud) / 0.5, '#fff5d6');
      if (t > thud) Hm.word(g, 'THUD!', 1030, 520, 50, '#ffb04a', fade(t, thud, 0.3));
    }
  },
  try(g, t, lt) {
    beach(g, t);
    Hm.palm(g, t, 2);
    const bite = at('try', 'bites'), sq = at('try', 'squeezes'), kick = at('try', 'kicks'), ow = at('try', 'Ow');
    const cx = 640, cy = BEACH_Y + 26;
    let pose = P.stand(), cocoAt = [cx + 60, cy], label = null;
    if (t < sq) { pose = P.bite(); cocoAt = null; label = 'CHOMP!'; }
    else if (t < kick) { pose = P.squeeze(t * 30); cocoAt = null; label = 'squeeze…'; }
    else if (t < ow) { const k = clamp((t - kick) / 0.35, 0, 1); pose = P.kick(k); cocoAt = [cx + 60 + ease((t - kick - 0.3) / 0.6) * 120, cy]; label = 'KICK!'; }
    else { pose = P.ow(t * 12); cocoAt = [cx + 180, cy]; label = 'OW!'; }
    const hands = Hm.human(g, cx, BEACH_Y + 40, KOA, pose, 1);
    if (!cocoAt) { const [hx, hy] = hands.handF; Hm.coconut(g, hx + 8, hy - 6, 1.3, t < sq ? 0 : Math.sin(t * 30) * 0.1); }
    else Hm.coconut(g, cocoAt[0], cocoAt[1], 1.3, (cocoAt[0] - cx) / 20);
    if (label) Hm.word(g, label, cx + 10, 400, 44, label === 'OW!' ? '#ff6b5a' : '#ffd24a', 0.5 + 0.5 * Math.abs(Math.sin(t * 3)));
    if (t > at('try', 'Nothing')) A.label(g, 'That shell is tough.', 640, 90, { size: 30, alpha: fade(t, at('try', 'That'), 0.3) });
  },
  idea(g, t, lt) {
    beach(g, t);
    Hm.palm(g, t, 2);
    const cx = 640, pick = at('idea', 'picks');
    Hm.coconut(g, cx + 70, BEACH_Y + 26, 1.3);
    if (t < pick) {
      Hm.human(g, cx, BEACH_Y + 40, KOA, { eyes: 'up', mouth: 'o', head: -0.15, ra: [0.9, 1.9] }, 1);
      Hm.stone(g, cx - 110, BEACH_Y + 34, 1.4);
      // The idea: a bright "!" over his head.
      Hm.word(g, '!', cx + 6, 400, 80, '#ffd24a', fade(t, at('idea', 'idea'), 0.3), 0);
    } else {
      const k = clamp((t - pick) / 0.8, 0, 1);
      const hands = Hm.human(g, cx, BEACH_Y + 40, KOA, k < 0.4 ? P.crouch() : P.lift(ease((k - 0.4) / 0.6)), 1);
      const [hx, hy] = hands.handF;
      Hm.stone(g, k < 0.4 ? cx - 110 + (k / 0.4) * 110 : hx + 4, k < 0.4 ? BEACH_Y + 34 : hy - 6, 1.4);
      A.label(g, 'a heavy stone', cx - 180, 380, { size: 26, alpha: fade(t, pick + 0.3, 0.3) });
    }
  },
  crack(g, t, lt) {
    beach(g, t);
    Hm.palm(g, t, 2);
    const cx = 640, b1 = at('crack', 'Bash'), b2 = at('crack', 'Bash!', ) + 0.0, crack = at('crack', 'Crack');
    const hitTimes = [b1, at('crack', 'Bash! C') , crack];
    // Each swing: raise then bring down onto the coconut.
    let k = 0;
    for (const h of hitTimes) { const u = (t - (h - 0.35)) / 0.45; if (u > 0 && u < 1) k = u < 0.7 ? u / 0.7 : 1 - (u - 0.7) / 0.3 * 0.2; }
    const opened = fade(t, crack + 0.05, 0.4);
    const hands = Hm.human(g, cx, BEACH_Y + 40, KOA, opened > 0.9 && t > crack + 1.2 ? P.drink() : P.bash(k), 1);
    const [hx, hy] = hands.handF;
    if (!(opened > 0.9 && t > crack + 1.2)) Hm.stone(g, hx + 6, hy - 4, 1.4);
    if (opened > 0.9 && t > crack + 1.2) Hm.coconut(g, hx + 4, hy - 2, 1.2, 0, 0.2);
    else Hm.coconut(g, cx + 70, BEACH_Y + 26, 1.3, 0, opened);
    for (const h of hitTimes) Hm.impact(g, cx + 70, BEACH_Y + 20, (t - h) / 0.35, '#fff');
    Hm.word(g, 'BASH!', cx - 170, 380, 44, '#ffd24a', fade(t, b1, 0.2) * (1 - fade(t, crack, 0.2)));
    Hm.word(g, 'CRACK!', cx + 170, 380, 60, '#ff8a4a', fade(t, crack, 0.2));
    if (opened > 0.5) for (let i = 0; i < 6; i++) {           // splash of coconut water
      const a = t - crack, x = cx + 70 + (i - 2.5) * 10 * a * 3, y = BEACH_Y + 10 - 60 * a + 120 * a * a;
      if (a < 0.8) { g.fillStyle = 'rgba(210,235,255,0.9)'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
    }
    void b2;
  },
  tool(g, t, lt) {
    // A clean diagram card: stone + arrow + "tool", and a timeline.
    A.sky(g, '#f7ecd8', '#f1dfc2');
    Hm.stone(g, 330, 300, 4);
    A.title(g, '= TOOL', 640, 320, 80, '#b8452c', fade(t, at('tool', 'tool'), 0.4), '#fff5e6');
    const tk = fade(t, at('tool', 'Humans'), 1.2);
    if (tk > 0) {
      g.strokeStyle = '#6b4e33'; g.lineWidth = 6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(140, 500); g.lineTo(140 + 1000 * tk, 500); g.stroke();
      A.label(g, '3.3 million years ago', 190, 560, { size: 24, alpha: tk });
      A.label(g, 'today', 1120, 560, { size: 24, alpha: fade(tk, 0.9, 0.1) });
      Hm.stone(g, 190, 470, 1.2);
      A.clawd(g, 1090, 490, 5, t, { talking: talkingAt(t) });
      A.label(g, 'oldest stone tools found (Kenya)', 640, 440, { size: 22, alpha: fade(t, at('tool', 'three million'), 0.4) });
    }
  },
  share(g, t, lt) {
    beach(g, t);
    Hm.palm(g, t, 2);
    const arrive = clamp(lt / 1.8, 0, 1);
    Hm.human(g, 560, BEACH_Y + 40, KOA, P.cheer(t * 6), 1);
    const hk = Hm.human(g, lerp(1300, 720, ease(arrive)), BEACH_Y + 44, MIRA, arrive < 1 ? P.run(t * 12) : P.drink(), -1);
    Hm.human(g, lerp(1400, 820, ease(arrive)), BEACH_Y + 48, TIKI, arrive < 1 ? P.run(t * 13) : P.cheer(t * 7 + 1), -1);
    if (arrive >= 1) Hm.coconut(g, hk.handF[0] - 4, hk.handF[1] - 2, 1.1, 0, 0.2);
    A.title(g, 'try, fail, try again!', 640, 150, 52, '#b8452c', fade(t, at('share', 'try'), 0.4), '#fff5e6');
  },
  bye(g, t, lt) {
    beach(g, t);
    Hm.palm(g, t, 2);
    A.title(g, 'See you in the next story!', 640, 200, 56, '#b8452c', fade(lt, 0.3), '#fff5e6');
    const q = lt / 0.45, hop = q > 0 && q < 1 ? Math.sin(q * Math.PI) * 30 : 0;
    A.clawd(g, 400 - 5.5 * 13, BEACH_Y + 30, 13, t, { talking: talkingAt(t), hop, wave: true });
    Hm.human(g, 620, BEACH_Y + 40, KOA, P.cheer(t * 6), 1);
  },
};

const ORDER = LINES.map((l) => l.id);
const START = ORDER.map((id, i) => (i === 0 ? 0 : L[id].t0 - 0.45));
const XF = 0.5;

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
  S[ORDER[i]](g, t, t - START[i]);
  const since = t - START[i];
  if (i > 0 && since < XF) {
    og.clearRect(0, 0, W, H);
    S[ORDER[i - 1]](og, t, t - START[i - 1]);
    g.save(); g.globalAlpha = 1 - since / XF; g.drawImage(off, 0, 0); g.restore();
  }
  if (!['hook', 'bye', 'tool'].includes(ORDER[i])) A.clawd(g, 26, H - 24, 7, t, { talking: talkingAt(t) });
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
