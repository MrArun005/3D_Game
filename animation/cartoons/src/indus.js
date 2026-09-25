// "The Unicorn Seal": Mohenjo-daro, 4,500 years ago. Siya, a seal carver's
// daughter, must get her father's seal to a merchant's boat before sunset. A
// monkey steals it; the chase runs through the real city: grid streets, covered
// drains, the bead market, the Great Bath. Rich-cartoon engine in src/indus/;
// every beat time lives in stories/indus.beats.json (the soundtrack reads it too).
import * as C from './indus/core.js';
import * as Wd from './indus/world.js';
import * as Pp from './indus/people.js';
import * as Sl from './indus/seal.js';
import B from '../stories/indus.beats.json' with { type: 'json' };
import timing from '../stories/indus.timing.json' with { type: 'json' };

const { W, H, TAU, lerp, seg, lin, clamp, fade, win, ease, easeOut, setCam, layer, toScreen, rng, cam } = C;
const { person, P, SIYA, BABA, MERCHANT, monkey } = Pp;
const FPS = 30, DURATION = B.duration;
const c = document.getElementById('c'); c.width = W; c.height = H;
const g = c.getContext('2d');
const VO = Object.fromEntries(timing.lines.map((l) => [l.id, l]));
const talking = (id, t) => { const l = VO[id]; return l && t > l.t0 && t < l.t0 + l.dur; };
const mouthFor = (id, t, rest = 'smile') => (talking(id, t) ? (Math.sin(t * 23) > -0.2 ? 'open' : 'o') : rest);
const IMPACTS = [[B.splash, 14], [B.land, 8], [B.mud, 6], [B.aboard, 9], [B.press, 7]];
const sealIn = (g, x, y, s = 1, rot = 0, sp = 0) => Sl.sealSmall(g, x, y, s, rot, sp);

// ---- shared bits ---------------------------------------------------------------------------------------------
function daySky(g, warm = 0) {
  C.sky(g, [[0, C.mix('#4d8fcf', '#5a6fb0', warm)], [0.45, C.mix('#9cc9e8', '#e8a47a', warm)], [0.8, C.mix('#f3e6c8', '#ffd09a', warm)]]);
}
function fact(g, text, t, t0, dur = 3.0) {
  const k = win(t, t0, t0 + dur, 0.35); if (k <= 0) return;
  g.save(); g.globalAlpha = k;
  g.font = `600 36px ${C.FONT}`;
  const w = g.measureText(text).width + 90, x = 70, y = H - 150 + (1 - easeOut(clamp((t - t0) / 0.35, 0, 1))) * 30;
  g.fillStyle = 'rgba(30,16,8,0.78)'; g.beginPath(); g.roundRect(x, y, w, 76, 16); g.fill();
  g.strokeStyle = 'rgba(231,173,60,0.9)'; g.lineWidth = 2.5; g.stroke();
  g.fillStyle = '#e7ad3c'; g.save(); g.translate(x + 34, y + 38); g.rotate(Math.PI / 4); g.fillRect(-8, -8, 16, 16); g.restore();
  g.fillStyle = '#fff4e0'; g.textBaseline = 'middle'; g.fillText(text, x + 62, y + 40);
  g.restore();
}
function subtitle(g, t) {
  const l = timing.lines.find((x) => t > x.t0 - 0.05 && t < x.t0 + x.dur + 0.4);
  if (!l) return;
  C.text(g, l.text, W / 2, H - 60, { size: 40, col: '#ffffff', weight: '700', shadow: 0.9, a: win(t, l.t0 - 0.05, l.t0 + l.dur + 0.4, 0.12), stroke: 'rgba(20,10,5,0.85)', sw: 7 });
}
function word(g, s, x, y, t, t0, size = 90, col = '#ffe07a', dur = 0.8) {
  const u = t - t0; if (u < 0 || u > dur) return;
  const pop = 1 + 0.3 * Math.sin(clamp(u / 0.25, 0, 1) * Math.PI);
  g.save(); g.translate(x, y); g.rotate(-0.06); g.scale(pop, pop);
  C.text(g, s, 0, 0, { size, weight: '900', col, stroke: '#2d1a10', sw: size * 0.16, shadow: 0.4, a: u > dur - 0.15 ? (dur - u) / 0.15 : 1 });
  g.restore();
}
// Houses along a street, deterministic by index.
function streetRow(g, x0, x1, y, seed, o = {}) {
  const r = rng(seed); let x = -2000;
  while (x < x1 + 400) {
    const w = (o.minW ?? 230) + r() * (o.varW ?? 150), h = (o.minH ?? 300) + r() * (o.varH ?? 110), gap = r() < 0.3 ? 110 : 4, sd = Math.floor(r() * 1e6);
    if (x + w > x0 - 400) {
      if (gap > 50) { g.fillStyle = 'rgba(40,20,12,0.85)'; g.fillRect(x + w, y - h * 0.95, gap, h * 0.95); }
      Wd.house(g, x, y, w, h, { sun: o.sun ?? 1, depth: o.depth ?? 70, brick: o.brick ?? 0.85, seed: sd, door: r() < (o.doors ?? 0.25), upper: r() < 0.3, plaster: r() < 0.25 });
    }
    x += w + gap;
  }
}

// ---- scenes ------------------------------------------------------------------------------------------------------------
const S = {
  open(g, t) {
    const k = seg(t, 0, 8.6);
    setCam(lerp(-80, 40, k), lerp(70, -40, k), lerp(1.0, 1.1, k));
    C.sky(g, [[0, '#1d2552'], [0.3, '#5e4577'], [0.55, '#d9796a'], [0.7, '#ffc58c'], [0.78, '#ffe2b0']]);
    const [sx, sy] = toScreen(420, 60, 0.05);
    C.sunDisc(g, sx, sy - k * 60, 34); C.rays(g, sx, sy - k * 60, t, 0.06);
    layer(g, 0.12, () => {
      C.cloud(g, -620, -360, 900, 1, '#ffc9a0', '#6a4a7a', 0.9); C.cloud(g, 260, -430, 760, 2, '#ffc0a0', '#5e4577', 0.75);
      C.cloud(g, 900, -300, 980, 3, '#ffd2a8', '#7a5080', 0.85); C.cloud(g, -80, -250, 560, 4, '#ffb890', '#8a5a80', 0.6);
    });
    const city = Wd.cityPanorama(1, 'dawn'), cs = 0.6, cx = -1150, gy = 150;
    layer(g, 0.55, () => {
      g.drawImage(city, cx, gy - Wd.CITY_GROUND * cs, Wd.CITY_W * cs, Wd.CITY_H * cs);
      Wd.smoke(g, cx + 1900 * cs, gy - 90 * cs, t, 170, 0.18, 1); Wd.smoke(g, cx + 2600 * cs, gy - 70 * cs, t + 3, 150, 0.15, 2); Wd.smoke(g, cx + 2200 * cs, gy - 100 * cs, t + 5, 190, 0.14, 3);
    });
    const [cityLeft, cityGround] = toScreen(cx, gy, 0.55), [cityRight] = toScreen(cx + Wd.CITY_W * cs, gy, 0.55);
    C.haze(g, cityGround - 260, cityGround + 4, '#ffcf9a', 0.35);
    const bank = cityGround + 14;
    g.fillStyle = '#7a5a3c'; g.fillRect(0, cityGround - 2, W, 18);
    Wd.river(g, bank, H, t, { top: '#f6b98a', bottom: '#28475e', sunX: sx });
    Wd.reflect(g, city, cityLeft, 0, cityRight - cityLeft, (cityRight - cityLeft) * Wd.CITY_H / Wd.CITY_W, bank, t, 0.28);
    layer(g, 0.55, () => Wd.reeds(g, -1300, gy + 12, 2600, 40, t, { seed: 3, lw: 2 }));
    layer(g, 0.85, () => { Wd.boat(g, lerp(-480, -300, k), 360, 0.62, t, { dir: 1 }); Wd.boat(g, lerp(700, 560, k), 300, 0.42, t + 2, { dir: -1, sailCol: '#e8c9a0', cargo: false }); });
    C.birds(g, t, 300, 260, 60, -8, 11, 1.1, '#2a1f33');
    C.blurred(g, 5, (bg) => layer(bg, 1.35, () => {
      Wd.reeds(bg, -1100, 640, 560, 320, t, { seed: 5, col: '#2f3a1e', col2: '#5a5a2a', lw: 7, n: 80 });
      Wd.reeds(bg, 640, 640, 680, 280, t, { seed: 6, col: '#2f3a1e', col2: '#5a5a2a', lw: 7, n: 80 });
    }));
    C.motes(g, t, 50, '#ffe0b0', 0.45);
    C.grade(g, t, { warm: 0.12, vignette: 0.5 });
    C.text(g, 'THE UNICORN SEAL', W / 2, 330, { size: 110, font: C.SERIF, weight: '700', col: '#fff3dc', a: win(t, 2.2, 7.8, 0.8), shadow: 0.7, spacing: 8 });
    C.text(g, 'Mohenjo-daro, on the Indus River  ·  4,500 years ago', W / 2, 400, { size: 38, col: '#ffe6c4', a: win(t, 3.0, 7.8, 0.8), shadow: 0.8, weight: '400' });
  },

  // The courtyard of Siya's house: her father carves; she watches.
  courtyard(g, t, zoom, cx, cy, fn) {
    setCam(cx, cy, zoom);
    daySky(g, 0.15);
    layer(g, 0.4, () => { streetRow(g, -1600, 1600, -380, 91, { brick: 0.55, depth: 40, minH: 180, varH: 80, minW: 200, sun: 1 }); });
    layer(g, 1, () => {
      // Back wall of the courtyard with a doorway to the street on the right, stairs to the roof on the left.
      g.fillStyle = C.pattern(g, C.brickTile('#b4643f', '#c8a27a', 2), 1.05, 0, 0); g.fillRect(-1400, -560, 2800, 560);
      const q = g.createLinearGradient(0, -560, 0, 0); q.addColorStop(0, 'rgba(255,190,120,0.12)'); q.addColorStop(1, 'rgba(60,25,10,0.3)'); g.fillStyle = q; g.fillRect(-1400, -560, 2800, 560);
      g.fillStyle = '#d9bc8f'; g.fillRect(-1400, -580, 2800, 24); g.strokeStyle = '#2d1a10'; g.lineWidth = 3; g.strokeRect(-1400, -580, 2800, 24);
      g.fillStyle = '#3a2216'; g.fillRect(560, -330, 190, 330);
      const dq = g.createLinearGradient(560, 0, 750, 0); dq.addColorStop(0, 'rgba(255,220,160,0.55)'); dq.addColorStop(1, 'rgba(255,240,200,0.9)'); g.fillStyle = dq; g.fillRect(575, -318, 160, 318);
      g.fillStyle = '#7a4a2a'; g.fillRect(560, -330, 30, 330); g.strokeStyle = '#2d1a10'; g.strokeRect(560, -330, 190, 330);
      for (let i = 0; i < 9; i++) { g.fillStyle = C.shade('#c9a07a', -i * 0.03); g.fillRect(-1080 + i * 50, -60 - i * 55, 60, 60 + i * 55); g.strokeStyle = 'rgba(45,26,16,0.5)'; g.lineWidth = 2; g.strokeRect(-1080 + i * 50, -60 - i * 55, 60, 60 + i * 55); }
      // Floor.
      g.fillStyle = C.pattern(g, C.brickTile('#c07a52', '#d1ae84', 3), 0.9, 0, 0); g.fillRect(-1400, 0, 2800, 600);
      g.fillStyle = 'rgba(60,30,10,0.2)'; g.fillRect(-1400, 0, 2800, 22);
      Wd.well(g, 330, 40, 1.3);
      Wd.pot(g, 470, 30, 1.2); Wd.pot(g, 420, 60, 0.9, '#b8703f'); Wd.pot(g, -560, 20, 1.3, '#9a4a2a');
      // Dappled light from the neem tree above, and the light spilling from the doorway.
      g.save(); g.globalCompositeOperation = 'lighter';
      const r = rng(6); for (let i = 0; i < 22; i++) { const x = -900 + r() * 1300, y = -520 + r() * 520, rr = 20 + r() * 40; g.fillStyle = `rgba(255,210,140,${0.05 + 0.04 * Math.sin(t * 1.3 + i)})`; g.beginPath(); g.ellipse(x, y, rr, rr * 0.7, 0, 0, TAU); g.fill(); }
      g.restore();
      fn();
    });
    // The neem branch hanging over the top of the frame, soft.
    C.blurred(g, 4, (bg) => layer(bg, 1.25, () => Wd.tree(bg, -700, -520, 520, { seed: 12, leaf: '#3f6f34' })));
  },
  workshop(g, t) {
    const k = seg(t, 8.5, 10.6);
    S.courtyard(g, t, lerp(1.2, 1.45, k), lerp(-40, -110, k), lerp(-250, -225, k), () => {
      bench(g, -60, t, true);
      person(g, -260, 0, BABA, P.sitCarve(t * 16), 1, 1.9, t);
      person(g, 170, 0, SIYA, { ...P.stand({ la: [0.9, 0.9], ra: [1.1, 0.8] }), lean: 0.35, drop: 6, head: 0.2, eyes: 'open', look: [1, 0.6], mouth: 'o' }, -1, 2.0, t);
    });
    C.motes(g, t, 30, '#fff0c8', 0.35);
    C.grade(g, t, { warm: 0.08, vignette: 0.42 });
  },
  sealcu(g, t) {
    // Close on the bench: the unicorn appears under the burin.
    const k = lin(t, 10.6, 12.2);
    const q = g.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, 1100); q.addColorStop(0, '#7a4e30'); q.addColorStop(1, '#2a1a10');
    g.fillStyle = q; g.fillRect(0, 0, W, H);
    g.save(); g.globalAlpha = 0.25; g.fillStyle = C.pattern(g, C.mudTile('#8a5a3a', 9), 3); g.fillRect(0, 0, W, H); g.restore();
    for (let i = 0; i < 9; i++) { C.glow(g, 200 + i * 190, 150 + (i % 3) * 330, 90, '#ffcf8a', 0.08); }
    const size = lerp(560, 600, k);
    g.save(); g.translate(W / 2, H / 2); g.rotate(-0.04); g.translate(-W / 2, -H / 2);
    Sl.sealFace(g, W / 2, H / 2 + 10, size, { mode: 'seal', reveal: lerp(0.3, 1, ease(k)) });
    g.restore();
    // The copper burin working the stone.
    const bx = W / 2 + Math.sin(t * 9) * 90 - 60 + k * 120, by = H / 2 - 40 + Math.cos(t * 7) * 60;
    g.save(); g.translate(bx, by); g.rotate(-0.9);
    g.fillStyle = '#b87333'; g.strokeStyle = '#2d1a10'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(18, -12); g.lineTo(230, -30); g.lineTo(230, 10); g.lineTo(18, 8); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#6a4424'; g.fillRect(230, -34, 200, 48); g.strokeRect(230, -34, 200, 48);
    g.restore();
    const r = rng(Math.floor(t * 12));
    for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(245,235,215,${0.8 * r()})`; g.beginPath(); g.arc(bx + (r() - 0.3) * 60, by - r() * 50, 2 + r() * 3, 0, TAU); g.fill(); }
    fact(g, 'A seal was a stamp: it marked whose goods were whose', t, 10.8, 1.5);
    C.grade(g, t, { warm: 0.1, vignette: 0.55 });
  },
  handover(g, t) {
    const k = seg(t, 12.4, 13.4), out = seg(t, B.turn, B.exit + 0.8);
    S.courtyard(g, t, lerp(1.55, 1.35, k), lerp(-40, 60, out), -230, () => {
      bench(g, -60, t, false);
      const offering = t > B.give - 0.4 && t < B.take + 0.3;
      const bp = offering ? P.offer({ mouth: mouthFor('baba', t) }) : t > B.exit ? P.wave(t * 9, { mouth: 'smile', eyes: 'happy' }) : P.stand({ ra: [1.2, 1.0], mouth: mouthFor('baba', t), eyes: 'open', look: [0.6, 0] });
      const b = person(g, -250, 0, BABA, bp, 1, 1.9, t);
      if (t < B.take) sealIn(g, b.handF[0] + 6, b.handF[1] - 8, 1.6, 0.1, win(t, 12.5, 13.3));
      // Siya: listens, takes it, turns and runs out through the doorway.
      let sp, sx = 150, dir = -1;
      if (t < B.give - 0.4) sp = P.stand({ eyes: 'wide', mouth: 'o', look: [1, 0], la: [0.2, 0.9], ra: [0.3, 1.2] });
      else if (t < B.turn) sp = P.reach({ eyes: 'happy', mouth: 'grin', ra: [1.4, 0.3] });
      else if (t < B.exit) { dir = 1; sp = P.holdUp({ eyes: 'happy', mouth: mouthFor('go', t, 'grin') }); }
      else { dir = 1; sx = lerp(150, 1150, lin(t, B.exit, B.exit + 1.2)); sp = P.run(t * 13, { mouth: mouthFor('go', t, 'grin'), eyes: 'happy' }); }
      const s = person(g, sx, 0, SIYA, sp, dir, 2.0, t);
      if (t > B.take) sealIn(g, s.handF[0], s.handF[1] - 6, 1.5, 0, t > B.turn && t < B.exit ? 0.8 : 0);
    });
    C.motes(g, t, 30, '#fff0c8', 0.35);
    C.grade(g, t, { warm: 0.08, vignette: 0.42 });
  },

  street(g, t) {
    const lt = t - 18.6, sx = lt * 390 - 200;
    setCam(sx + 240, -210, 1.0);
    daySky(g, 0.05);
    layer(g, 0.15, () => { C.cloud(g, -300, -420, 700, 7, '#ffffff', '#b9c9dc', 0.8); C.cloud(g, 700, -470, 560, 8, '#ffffff', '#b9c9dc', 0.7); });
    layer(g, 0.3, () => { g.drawImage(Wd.cityPanorama(1, 'dawn'), -1200, -760, 3400 * 0.8, 900 * 0.8); });
    C.haze(g, 0, 470, '#e8d6b4', 0.5);
    layer(g, 0.6, () => streetRow(g, cam.x * 0.6 - 1800, cam.x * 0.6 + 1800, -210, 55, { brick: 0.6, depth: 50, minH: 240, varH: 90 }));
    layer(g, 1, () => {
      Wd.ground(g, cam.x - 1400, cam.x + 1400, -60, 900);
      streetRow(g, cam.x - 1300, cam.x + 1300, -60, 23, { brick: 0.9, depth: 80, doors: 0.12 });
      // People along the street.
      const wc = person(g, 900 - lt * 60, 20, { ...Pp.crowdLook(4), braid: true, bun: false, beard: null, top: '#8e3b6e' }, P.walk(t * 7, { ra: [2.9, 0.9], la: [-0.1, 0.3] }), -1, 1.5, t);      // a woman carrying a pot
      Wd.pot(g, wc.top[0] - 4, wc.top[1] + 10, 0.8);
      person(g, 1700, 40, Pp.crowdLook(9), P.stand({ mouth: 'smile' }), -1, 1.4, t);
      Pp.cart(g, 1950 + Math.sin(t * 3) * 6, 70, { s: 0.55, roll: t * 2, load: false }); person(g, 1880, 80, { ...Pp.crowdLook(12), kid: true, R: 27, torso: 44, thigh: 31, shin: 31, foot: 15, ua: 25, fa: 23, limb: 11 }, P.crouch({ ra: [1.4, 0.2] }), 1, 1.2, t);
      const cx0 = 3600 - lt * 150;
      Pp.cart(g, cx0 - 160, 90, { s: 1.0, roll: -lt * 3.6, dir: -1 }); Pp.zebu(g, cx0 - 400, 90, { s: 1.0, dir: -1, ph: t * 6 });
      person(g, cx0 - 260, 96, Pp.crowdLook(17), P.walk(t * 6), -1, 1.5, t);
      Wd.pot(g, 2850, 150, 1.3, '#9a4a2a');
      // Siya, running; she hurdles the pot.
      const hop = win(t, B.hop - 0.15, B.hop + 0.45, 0.01) ? Math.sin(clamp((t - B.hop + 0.15) / 0.6, 0, 1) * Math.PI) * 110 : 0;
      const s = person(g, sx, 150 - hop, SIYA, hop > 5 ? P.leap(0, { mouth: 'grin', eyes: 'happy' }) : P.run(t * 13, { mouth: 'grin', eyes: 'happy' }), 1, 1.75, t);
      sealIn(g, s.handF[0], s.handF[1] - 6, 1.3);
      Wd.drain(g, cam.x - 1400, cam.x + 1400, 262, { holes: [1250, 2700] });
    });
    C.blurred(g, 6, (bg) => layer(bg, 1.4, () => { Wd.pot(bg, 1500, 470, 2.6, '#8a4a2a'); Wd.pot(bg, 3300, 470, 2.2, '#a8552f'); Wd.pot(bg, 4300, 470, 2.4, '#9a4a2a'); }));
    fact(g, 'Streets were laid out in a straight grid', t, B.capGrid, 2.7);
    fact(g, 'Covered brick drains ran along the streets', t, B.capDrain, 2.7);
    fact(g, 'Bricks had the same 4 : 2 : 1 shape, all over the land', t, B.capBrick, 2.4);
    C.motes(g, t, 30, '#fff0c8', 0.3);
    C.grade(g, t, { warm: 0.06, vignette: 0.38 });
  },

  snatch(g, t) {
    const k = seg(t, 28, 29.2);
    setCam(lerp(-40, 40, k), lerp(-300, -330, k), lerp(1.2, 1.35, k));
    daySky(g, 0.1);
    layer(g, 0.4, () => streetRow(g, -1600, 1600, -300, 77, { brick: 0.5, depth: 40, minH: 200, varH: 60 }));
    let mk = { x: 170, y: -392, pose: 'sit', reach: false, carry: null, mouth: 'closed', tilt: 0, dir: -1 };
    layer(g, 1, () => {
      Wd.ground(g, -1400, 1400, 0, 700);
      Wd.house(g, -900, 0, 1260, 400, { sun: 1, depth: 90, brick: 1.0, seed: 3, door: false, upper: false, cloth: false, plaster: false });
      Wd.drain(g, -1400, 1400, 170, { holes: [] });
      // Siya walks in, stops, holds the seal up to the light.
      const walkIn = lin(t, 28, 28.8);
      let sp, sx = lerp(-420, 0, ease(walkIn));
      const grabbed = t > B.grab;
      if (t < 28.8) sp = P.walk(t * 10, { mouth: 'smile' });
      else if (!grabbed) sp = P.holdUp({ eyes: 'happy', mouth: 'grin' });
      else if (t < VO.hey.t0) sp = P.holdUp({ eyes: 'wide', mouth: 'o', ra: [2.0, 0.4] });
      else sp = P.point({ ra: [2.0, 0.2], eyes: 'angry', mouth: mouthFor('hey', t, 'frown'), look: [0.8, -0.8], head: -0.25 });
      const s = person(g, sx, 20, SIYA, sp, 1, 2.1, t);
      if (!grabbed) sealIn(g, s.handF[0], s.handF[1] - 8, 1.7, 0, t > 28.9 ? 0.9 : 0);
      // The monkey on the parapet: peeks, hangs down, snatches, teases, bolts.
      if (t > B.peek) {
        const hang = seg(t, 29.9, B.grab - 0.05), up = seg(t, B.grab + 0.1, B.grab + 0.5);
        mk = { x: lerp(170, 120, hang), y: -392 + hang * 40 * (1 - up), pose: 'sit', reach: hang > 0.3 && t < B.grab + 0.3, carry: grabbed ? (gg, x, y) => sealIn(gg, x, y, 1.3) : null, mouth: grabbed ? (t > 31.6 ? 'tongue' : 'open') : 'closed', tilt: hang * 0.6 * (1 - up), dir: -1 };
        if (t > B.flee) { const f = seg(t, B.flee, B.flee + 0.7); mk.x = lerp(120, 900, f); mk.y = -392 - Math.sin(f * Math.PI) * 160; mk.pose = 'leap'; mk.dir = 1; }
      }
      if (t > B.peek) { const [ox, oy] = [mk.x, mk.y]; monkey(g, ox, oy, { s: 1.5, t, pose: mk.pose, reach: mk.reach, carry: mk.carry, mouth: mk.mouth, tilt: mk.tilt, dir: mk.dir }); }
      // Parapet lip over the monkey's feet.
      g.fillStyle = '#d9bc8f'; g.fillRect(-900, -404, 1260, 14);
      if (t > B.grab && t < B.grab + 0.3) { g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 5; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(90 + i * 12, -260 - i * 20); g.lineTo(140 + i * 12, -350 - i * 20); g.stroke(); } }
    });
    word(g, 'SNATCH!', W * 0.62, H * 0.3, t, B.grab, 96, '#ffe07a', 0.7);
    C.motes(g, t, 30, '#fff0c8', 0.3);
    C.grade(g, t, { warm: 0.06, vignette: 0.4 });
  },

  roofs(g, t) {
    const lt = t - 34;
    // Siya: up the ladder, along the roofs, a leap over the street gap.
    let sx, sy = 0, sp;
    if (t < B.onRoof) { const k = lin(t, B.ladder, B.onRoof); sx = -120; sy = lerp(260, 0, k); sp = P.climb(t * 14, { mouth: 'frown', eyes: 'angry' }); }
    else if (t < B.leap) { sx = lerp(-80, 860, lin(t, B.onRoof, B.leap)); sp = P.run(t * 14, { eyes: 'angry', mouth: 'teeth' }); }
    else if (t < B.land) { const k = lin(t, B.leap, B.land); sx = lerp(860, 1300, k); sy = -Math.sin(k * Math.PI) * 170; sp = P.leap(k, { eyes: 'wide', mouth: 'open' }); }
    else { sx = lerp(1300, 1900, lin(t, B.land, 39)); sp = t < B.land + 0.2 ? P.crouch({ eyes: 'angry' }) : P.run(t * 14, { eyes: 'angry', mouth: 'teeth' }); }
    const leapK = win(t, B.leap - 0.1, B.land + 0.2, 0.2);
    setCam(sx + 260, -280 + sy * 0.3, 1.0 + leapK * 0.18);
    daySky(g, 0.12);
    layer(g, 0.1, () => { C.cloud(g, -500, -380, 900, 9, '#ffffff', '#b9c9dc', 0.85); C.cloud(g, 600, -330, 700, 10, '#fff8ee', '#c9c9dc', 0.8); });
    layer(g, 0.25, () => g.drawImage(Wd.cityPanorama(1, 'dawn'), -900, -700, 3400 * 0.75, 900 * 0.75));
    C.haze(g, 100, 640, '#efe0c4', 0.45);
    layer(g, 0.55, () => { for (let i = -3; i < 12; i++) Wd.house(g, i * 260 - 400, -80, 240, 150 + (i % 3) * 40, { sun: 1, depth: 60, brick: 0.5, seed: 200 + i }); });
    layer(g, 0.8, () => { for (let i = -4; i < 14; i++) Wd.house(g, i * 300 - 700 + (i % 2) * 40, 90, 290, 170 + (i % 3) * 25, { sun: 1, depth: 70, brick: 0.7, seed: 400 + i }); });
    layer(g, 1, () => {
      // The near roofs: flat plaster tops; the gap is a street far below.
      const roof = (x0, x1) => {
        g.fillStyle = '#d9bc8f'; g.fillRect(x0, 0, x1 - x0, 40);
        g.fillStyle = C.pattern(g, C.brickTile('#b4643f', '#c8a27a', 1), 0.9, 0, 0); g.fillRect(x0, 40, x1 - x0, 900);
        g.fillStyle = 'rgba(40,20,10,0.25)'; g.fillRect(x0, 40, x1 - x0, 20);
        g.fillStyle = C.shade('#d9bc8f', -0.12); g.fillRect(x0, -14, x1 - x0, 14); g.strokeStyle = '#2d1a10'; g.lineWidth = 3; g.strokeRect(x0, -14, x1 - x0, 54);
      };
      g.fillStyle = '#2a1a12'; g.fillRect(900, 0, 360, 1000);
      g.fillStyle = 'rgba(255,220,170,0.08)'; g.fillRect(900, 300, 360, 700);
      roof(-1400, 900); roof(1260, 3200);
      Wd.ladder(g, -140, 330, 360, 1.3);
      // Roof life: a line of drying cloth, pots, a woman at her grindstone.
      g.strokeStyle = '#5a3a22'; g.lineWidth = 3; g.beginPath(); g.moveTo(300, -200); g.quadraticCurveTo(480, -170, 660, -200); g.stroke();
      [['#c0392b', 330], ['#e6b33d', 420], ['#3a6fa0', 520], ['#efe3c8', 600]].forEach(([col, x]) => { g.fillStyle = col; g.beginPath(); g.moveTo(x, -190); g.lineTo(x + 60, -188); g.lineTo(x + 58 + Math.sin(t * 3 + x) * 6, -80); g.lineTo(x + 2 + Math.sin(t * 3 + x) * 6, -82); g.closePath(); g.fill(); g.strokeStyle = '#2d1a10'; g.lineWidth = 2; g.stroke(); });
      g.strokeStyle = '#4a2e1a'; g.lineWidth = 6; g.beginPath(); g.moveTo(300, -230); g.lineTo(300, -14); g.moveTo(660, -230); g.lineTo(660, -14); g.stroke();
      Wd.pot(g, 120, -10, 1.1); Wd.pot(g, 1500, -10, 1.3, '#9a4a2a'); Wd.pot(g, 1560, -10, 0.9);
      person(g, 1750, -10, Pp.crowdLook(3), { ...P.crouch({ ra: [1.4, 0.2], la: [1.3, 0.3] }), eyes: t > B.land ? 'wide' : 'open', mouth: t > B.land ? 'o' : 'smile', look: [-0.8, 0] }, -1, 1.5, t);
      // The monkey ahead, bounding.
      const mx = lerp(700, 2600, lin(t, 34, 39)) + Math.sin(t * 3) * 20;
      monkey(g, mx, -12 - Math.abs(Math.sin(t * 7)) * 50, { s: 1.4, t, pose: Math.sin(t * 7) > 0.2 ? 'leap' : 'run', ph: t * 14, carry: (gg, x, y) => sealIn(gg, x, y, 1.2), mouth: 'open' });
      person(g, sx, sy - 12, SIYA, sp, 1, 1.8, t);
    });
    C.motes(g, t, 25, '#fff0c8', 0.3);
    C.grade(g, t, { warm: 0.07, vignette: 0.38 + leapK * 0.15 });
    void lt;
  },

  beads(g, t) {
    // The bead market: the monkey drops in, a basket tips, Siya surfs the spill.
    const slideK = lin(t, B.slip, B.slideEnd);
    let sx, sp;
    if (t < B.slip) { sx = lerp(-900, -380, lin(t, 40.3, B.slip)); sp = P.run(t * 14, { eyes: 'angry', mouth: 'teeth' }); }
    else if (t < B.slideEnd) { sx = lerp(-380, 700, easeOut(slideK)); sp = P.slide({ la: [2.4 + Math.sin(t * 16) * 0.4, 0.2], ra: [1.6 - Math.sin(t * 16) * 0.4, 0.3], lean: -0.25 + Math.sin(t * 9) * 0.12 }); }
    else { sx = lerp(700, 1300, lin(t, 43.5, 44.5)); sp = t < 43.5 ? P.stand({ eyes: 'wide', mouth: 'o', la: [-1.2, 0.3], ra: [1.4, 0.4] }) : P.run(t * 14, { eyes: 'angry', mouth: 'teeth' }); }
    setCam(lerp(-60, 420, seg(t, 40.6, 43.6)), -300, 1.0);
    daySky(g, 0.12);
    layer(g, 0.4, () => streetRow(g, -1800, 2400, -330, 131, { brick: 0.5, depth: 40, minH: 200, varH: 80 }));
    C.haze(g, 200, 700, '#efe0c4', 0.3);
    layer(g, 1, () => {
      Wd.ground(g, -1600, 2400, -40, 900, '#c49c70');
      streetRow(g, -1600, 2400, -40, 61, { brick: 0.9, depth: 80, doors: 0.3, minH: 330 });
      // Stalls.
      Wd.stall(g, -1100, 100, 300, '#2f6f7a', '#efe3c8', t); Wd.beadBasket(g, -1050, 10, 1.1); Wd.beadBasket(g, -920, 10, 1.0);
      Wd.stall(g, -140, 100, 330, '#c0452c', '#efe3c8', t);
      Wd.stall(g, 1100, 100, 300, '#d9a13a', '#8a4a2a', t); Wd.pot(g, 1180, 10, 0.9); Wd.pot(g, 1280, 10, 0.8, '#9a4a2a');
      // The bead maker with a bow drill, then shock.
      const shocked = t > B.tip;
      person(g, 330, 110, { ...Pp.crowdLook(21), top: '#3f6f5a', skirt: '#efe3c8', braid: true, bun: false, beard: null, bangles: 5 }, shocked ? P.shock({ mouth: mouthFor('beads', t, 'shout') }) : P.stand({ ra: [1.3, 0.4 + Math.sin(t * 20) * 0.3], la: [1.2, 0.6], eyes: 'look', look: [0.8, 0.8] }), -1, 1.7, t);
      // The tipping basket and the spill.
      const tipK = seg(t, B.tip, B.tip + 0.3);
      Wd.beadBasket(g, 40, 10, 1.3, -tipK * 1.6, 1 - tipK * 0.8);
      if (t > B.tip) {
        const r = rng(77);
        for (let i = 0; i < 180; i++) {
          const v = 200 + r() * 700, u = clamp(t - B.tip - r() * 0.3, 0, 2.2), damp = 1 - Math.exp(-u * 2.2);
          const x = 30 - v * damp * (0.7 + r() * 0.5) + (r() - 0.5) * 140, y = u < 0.35 ? 0 + (u / 0.35) * 110 + (r() - 0.5) * 20 : 100 + r() * 190;
          if (u > 0) Wd.bead(g, x, y, 5 + r() * 2.5);
        }
      }
      // The monkey: down onto the awning, onto the table, off to the right.
      let mx, my, mp = 'run';
      if (t < B.mDrop) { mx = -80; my = lerp(-700, -250, lin(t, 39, B.mDrop)); mp = 'leap'; }
      else if (t < B.tip) { const k = lin(t, B.mDrop, B.tip); mx = lerp(-60, 60, k); my = lerp(-250, -80, k) - Math.sin(k * Math.PI) * 90; mp = 'leap'; }
      else { mx = lerp(60, 1700, lin(t, B.tip, 41.6)); my = 110; }
      monkey(g, mx, my, { s: 1.4, t, pose: mp, ph: t * 14, carry: (gg, x, y) => sealIn(gg, x, y, 1.2), mouth: 'open' });
      const s = person(g, sx, 170, SIYA, sp, 1, 1.85, t);
      if (t > B.slip && t < B.slideEnd) { for (let i = 0; i < 6; i++) Wd.bead(g, s.hip[0] - 60 - i * 26 + Math.sin(t * 30 + i) * 8, 176 + Math.sin(i * 2) * 6, 5.5); }
    });
    C.blurred(g, 6, (bg) => layer(bg, 1.4, () => { Wd.beadBasket(bg, -300, 720, 2.6); Wd.pot(bg, 1400, 720, 2.4, '#a8552f'); }));
    fact(g, 'Carnelian beads from the Indus were traded as far as Mesopotamia', t, B.capBeads, 2.8);
    word(g, 'WHOOSH!', W * 0.55, H * 0.28, t, B.slip + 0.2, 84, '#ffe07a', 0.8);
    C.motes(g, t, 30, '#fff0c8', 0.3);
    C.grade(g, t, { warm: 0.07, vignette: 0.4 });
  },

  bath(g, t) {
    const X0 = -360, X1 = 360, DEPTH = 380, WY = 60;
    setCam(lerp(-80, 120, seg(t, 44.5, 51.8)), -60, lerp(0.92, 1.0, seg(t, 44.5, 51.8)));
    C.sky(g, [[0, '#4f7fc0'], [0.5, '#a9c9e2'], [1, '#f1dfbf']]);
    layer(g, 0.2, () => g.drawImage(Wd.cityPanorama(1, 'dawn'), -1300, -660, 3400 * 0.7, 900 * 0.7));
    C.haze(g, 0, 560, '#efe0c4', 0.4);
    let splashAt = null;
    layer(g, 1, () => {
      Wd.greatBath(g, X0, X1, 0, t, { depth: DEPTH });
      // Pavement blocks either side of the pool.
      g.fillStyle = C.pattern(g, C.brickTile('#b4643f', '#c8a27a', 1), 0.7, 0, 0); g.fillRect(-1600, 0, 1600 + X0, 800); g.fillRect(X1, 0, 1600, 800);
      g.fillStyle = '#d9b98c'; g.fillRect(-1600, -6, 1600 + X0, 14); g.fillRect(X1, -6, 1600, 14);
      g.strokeStyle = '#2d1a10'; g.lineWidth = 3; g.strokeRect(-1600, -6, 1600 + X0, 14); g.strokeRect(X1, -6, 1600, 14);
      g.fillStyle = C.pattern(g, C.brickTile('#8a4a2e', '#a57e5a', 5), 0.5); g.fillRect(X0, DEPTH, X1 - X0, 700);
      // The drain hole in the pavement, right.
      g.fillStyle = '#1e120c'; g.beginPath(); g.ellipse(640, 4, 34, 9, 0, 0, TAU); g.fill();
      // Bathers standing in the water.
      const bathers = [[-180, 5], [0, 11], [180, 14]];
      const duck = seg(t, B.duck, B.duck + 0.25) * (1 - seg(t, B.surface, B.surface + 0.4));
      g.save(); g.beginPath(); g.rect(X0, -2000, X1 - X0, 2000 + DEPTH); g.rect(-3000, -2000, 3000 + X0, 2000); g.rect(X1, -2000, 3000, 2000); g.clip();
      bathers.forEach(([bx, sd], i) => {
        const dip = i === 0 ? duck * 90 : 0, bop = B.hops[i] && t > B.hops[i] && t < B.hops[i] + 0.25 ? Math.sin((t - B.hops[i]) / 0.25 * Math.PI) * 14 : 0;
        const laugh = t > B.surface + 0.2;
        person(g, bx, 230 + dip + bop, Pp.crowdLook(sd), laugh ? P.cheer(t * 8, { bob: 0 }) : P.stand({ eyes: t > B.hops[0] ? 'wide' : 'open', mouth: t > B.hops[0] ? 'o' : 'smile', look: [-0.5, -0.5] }), i % 2 ? -1 : 1, 1.45, t);
      });
      // Siya falls in, surfaces, climbs out the steps.
      let sx, sy, sp, sdir = 1;
      if (t < B.sLeap) { sx = lerp(-1100, -430, lin(t, 44.5, B.sLeap)); sy = 0; sp = P.run(t * 14, { eyes: 'angry', mouth: 'teeth' }); }
      else if (t < B.splash) { const k = lin(t, B.sLeap, B.splash); sx = lerp(-430, -180, k); sy = -Math.sin(k * Math.PI * 0.8) * 150 + k * k * 120; sp = P.leap(k, { eyes: t > B.duck ? 'wide' : 'angry', mouth: t > B.duck ? 'shout' : 'teeth' }); }
      else if (t < B.surface) { sx = -160; sy = lerp(40, 470, easeOut(lin(t, B.splash, B.splash + 0.3))); sp = P.swim(t * 8, { eyes: 'wide', mouth: 'o' }); }
      else if (t < B.climb) { sx = lerp(-160, 60, lin(t, B.surface, B.climb)); sy = lerp(470, 300, easeOut(lin(t, B.surface, B.surface + 0.35))) + Math.sin(t * 5) * 5; sp = P.stand({ eyes: 'closed', mouth: 'o', la: [-0.4, 0.3], ra: [0.5, 0.4] }); }
      else if (t < B.out) { const k = lin(t, B.climb, B.out); sx = lerp(60, 370, k); sy = lerp(300, -4, ease(k)); sp = P.walk(t * 9, { eyes: 'sad', mouth: 'frown', lean: 0.2 }); }
      else { sx = lerp(360, 560, lin(t, B.out, 52)); sy = -4; sp = P.run(t * 13, { eyes: 'wide', mouth: 'o' }); }
      person(g, sx, sy, SIYA, sp, sdir, 1.75, t);
      g.restore();
      splashAt = [-160, WY];
      // The water over everyone in it: a translucent surface with ripples.
      const wq = g.createLinearGradient(0, WY, 0, DEPTH); wq.addColorStop(0, 'rgba(92,154,160,0.72)'); wq.addColorStop(1, 'rgba(34,80,92,0.96)');
      g.fillStyle = wq; g.fillRect(X0, WY, X1 - X0, DEPTH - WY);
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 3;
      for (let i = 0; i < 10; i++) { const xx = X0 + ((i * 137 + t * 40) % (X1 - X0)); g.beginPath(); g.moveTo(xx, WY + 4); g.quadraticCurveTo(xx + 30, WY, xx + 60, WY + 4); g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(X0, WY - 2, X1 - X0, 4);
      if (t > B.surface + 0.2 && t < B.climb) { g.strokeStyle = 'rgba(210,235,240,0.9)'; g.lineWidth = 4; g.beginPath(); g.moveTo(sx + 40, sy - 230); g.quadraticCurveTo(sx + 90, sy - 330, sx + 150, sy - 250); g.stroke(); }
      Wd.splash(g, splashAt[0], splashAt[1], lin(t, B.splash, B.splash + 1.0), 1.4);
      if (t > B.out) { const r = rng(3); for (let i = 0; i < 8; i++) { const u = (t * 2 + r()) % 1; g.fillStyle = 'rgba(160,210,230,0.8)'; g.beginPath(); g.arc(sx - 20 + r() * 40, sy - 200 + u * 200, 3.5, 0, TAU); g.fill(); } }
      // The monkey: hops across on the bathers' heads, laughs on the far side, drops the seal.
      let mx, my, mp = 'run', mouth = 'open', carry = true;
      const HK = [[44.5, -1000, -4], [B.hops[0] - 0.35, -560, -4], [B.hops[0], -180, -112], [B.hops[1], 0, -112], [B.hops[2], 180, -112], [B.mLand, 480, -4]];
      if (t < HK[1][0]) { mx = lerp(HK[0][1], HK[1][1], lin(t, HK[0][0], HK[1][0])); my = -4; }
      else if (t < B.mLand) {
        let i = 1; while (i < HK.length - 2 && t > HK[i + 1][0]) i++;
        const k = lin(t, HK[i][0], HK[i + 1][0]); mx = lerp(HK[i][1], HK[i + 1][1], k); my = lerp(HK[i][2], HK[i + 1][2], k) - Math.sin(k * Math.PI) * 90; mp = 'leap';
      } else { mx = 480; my = -4; mp = 'sit'; mouth = t > B.splash + 0.3 ? 'open' : 'tongue'; }
      if (t > B.drop) carry = false;
      monkey(g, mx, my, { s: 1.35, t, pose: mp, ph: t * 14, dir: t > B.mLand && t < 51.4 ? -1 : 1, carry: carry ? (gg, x, y) => sealIn(gg, x, y, 1.2) : null, mouth, tilt: mp === 'sit' ? Math.sin(t * 14) * 0.15 : 0 });
      // The seal: dropped, it bounces along the pavement into the drain hole.
      if (t > B.drop && t < B.plink) {
        const pts = [[470, -60], [520, -4], [575, -4], [615, -4], [640, 4]], ts = [B.drop, ...B.bounces, B.plink];
        let i = 0; while (i < ts.length - 2 && t > ts[i + 1]) i++;
        const k = lin(t, ts[i], ts[i + 1]), p0 = pts[i], p1 = pts[i + 1];
        sealIn(g, lerp(p0[0], p1[0], k), lerp(p0[1], p1[1], k) - Math.sin(k * Math.PI) * (i === 0 ? 20 : 45 / i), 1.3, t * 12);
      }
    });
    fact(g, 'The Great Bath: 12 m long, and still standing today', t, B.capBath, 2.6);
    word(g, 'SPLASH!', W * 0.42, H * 0.3, t, B.splash, 110, '#bff0ff', 0.9);
    word(g, 'plink!', W * 0.72, H * 0.55, t, B.plink, 60, '#ffffff', 0.6);
    C.grade(g, t, { warm: 0.05, vignette: 0.38 });
  },

  drain(g, t) {
    // At the hole; then a cutaway: the seal rides the drain water, Siya follows above; out at the river.
    const cut = seg(t, B.cut, B.cut + 0.8);
    const sealX = t < B.cut ? 0 : lerp(0, 2600, ease(lin(t, B.cut + 0.3, B.outlet)));
    const surf = 0, pipeY = 330;
    const sx = t < B.cut ? -140 : lerp(-140, 2500, lin(t, B.cut + 0.5, B.outlet - 0.1));
    setCam(t < B.cut ? -60 : lerp(-60, sealX + 60, cut), lerp(-260, 90, cut), lerp(1.45, 1.0, cut));
    daySky(g, 0.25);
    layer(g, 0.3, () => streetRow(g, -1600, 5000, -300, 311, { brick: 0.45, depth: 40, minH: 190, varH: 60 }));
    layer(g, 1, () => {
      streetRow(g, -1500, 4200, -80, 409, { brick: 0.9, depth: 80, doors: 0.2 });
      Wd.ground(g, -1600, 4200, -80, 80, '#c49c70');
      // The cross-section of earth, the brick drain, the water in it.
      const soil = g.createLinearGradient(0, 0, 0, 900); soil.addColorStop(0, '#9a7050'); soil.addColorStop(1, '#5a3e2a');
      g.fillStyle = soil; g.fillRect(-1600, surf, 5800, 900);
      g.save(); g.globalAlpha = 0.3; g.fillStyle = C.pattern(g, C.mudTile('#6a4a30', 12), 1.5); g.fillRect(-1600, surf, 5800, 900); g.restore();
      g.fillStyle = C.pattern(g, C.brickTile('#9a5234', '#a88262', 6), 0.8, 0, 0); g.fillRect(-1600, pipeY - 110, 5800, 190);
      g.fillStyle = '#20140e'; g.fillRect(-1600, pipeY - 80, 5800, 130);
      g.fillStyle = 'rgba(255,200,140,0.06)'; g.fillRect(-1600, pipeY - 80, 5800, 20);
      const rr = rng(8); for (let i = 0; i < 70; i++) { g.fillStyle = C.shade('#7a5a40', rr() * 0.3 - 0.15); g.beginPath(); g.ellipse(-1600 + rr() * 5800, 30 + rr() * 170, 8 + rr() * 16, 5 + rr() * 9, rr() * 3, 0, TAU); g.fill(); }
      const wq = g.createLinearGradient(0, pipeY, 0, pipeY + 50); wq.addColorStop(0, '#6a8a88'); wq.addColorStop(1, '#3a5452');
      g.fillStyle = wq; g.fillRect(-1600, pipeY - 5, 5800, 55);
      g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 3;
      for (let i = 0; i < 60; i++) { const xx = -1600 + ((i * 97 + t * 420) % 5800); g.beginPath(); g.moveTo(xx, pipeY - 2 + (i % 3) * 14); g.lineTo(xx + 40, pipeY - 2 + (i % 3) * 14); g.stroke(); }
      // Inspection holes up to the street.
      for (const hx of [0, 1300, 2600 - 1200]) { g.fillStyle = '#20140e'; g.fillRect(hx - 24, surf - 4, 48, pipeY - 80 - surf + 4); }
      Wd.drain(g, -1600, 4200, surf + 2, { holes: [0, 1300, 1400] });
      // The seal riding the flow.
      if (t > B.cut) sealIn(g, sealX, pipeY + 4 + Math.sin(t * 9) * 6, 1.6, t * 5, 0.5);
      // Siya: at the hole, lifting the lid; then running above, following the sound.
      let sp, sy = surf;
      if (t < B.lid) sp = P.shock({ mouth: mouthFor('nono', t, 'shout') });
      else if (t < B.cut + 0.5) sp = P.peer({ eyes: 'wide', mouth: 'o' });
      else sp = P.run(t * 13, { eyes: 'angry', mouth: 'teeth', head: 0.25, look: [0.5, 1] });
      person(g, sx, sy, SIYA, sp, 1, 1.7, t);
      if (t > B.lid - 0.1 && t < B.cut + 0.5) { g.fillStyle = '#9a5a3a'; g.beginPath(); g.roundRect(-110, -60, 18, 60, 3); g.fill(); }
    });
    // Out at the riverbank: the drain mouth, the water pours, the seal lands in the mud.
    if (t > B.outlet - 0.4) {
      const k = fade(t, B.outlet - 0.4, 0.4);
      g.save(); g.globalAlpha = k;
      riverbank(g, t);
      g.restore();
    }
    fact(g, 'Drains like this carried the city’s water away, 4,500 years ago', t, B.capFlow, 3.0);
    C.grade(g, t, { warm: 0.08, vignette: 0.42 });
  },

  quay(g, t) {
    const lt = t - 60;
    let sx, sy = 0, sp;
    if (t < B.jump) { sx = lerp(-1100, 560, lin(t, 60, B.jump)); sp = P.run(t * 14, { eyes: 'wide', mouth: mouthFor('wait', t, 'open'), ...(talking('wait', t) ? { ra: [2.3 + Math.sin(t * 14) * 0.3, 0.4] } : {}) }); }
    else if (t < B.aboard) { const k = lin(t, B.jump, B.aboard); sx = lerp(560, 1080, k); sy = -Math.sin(k * Math.PI) * 190 + k * 20; sp = P.leap(k, { eyes: 'wide', mouth: 'open' }); }
    else { sx = 1080 + (lt - 3.9) * 22; sy = 20; sp = t > B.hand - 0.3 ? P.offer({ eyes: 'happy', mouth: 'grin' }) : P.stand({ eyes: 'happy', mouth: 'grin' }); }
    const leapK = win(t, B.jump - 0.2, B.aboard + 0.4, 0.3);
    setCam(lerp(sx + 200, 900, seg(t, B.aboard, B.aboard + 1)), -260, lerp(0.9, 1.2, leapK * 0.5 + seg(t, B.aboard, 66) * 0.5));
    sunsetSky(g, t);
    const [sunX, sunY] = toScreen(1300, -120, 0.05);
    C.sunDisc(g, sunX, sunY, 46, '#fff0c0', '#ff8a4a'); C.rays(g, sunX, sunY, t, 0.08, '#ffb070');
    layer(g, 0.1, () => { C.cloud(g, 300, -330, 900, 21, '#ffc890', '#8a4a6a', 0.8); C.cloud(g, 1300, -420, 800, 22, '#ffb880', '#7a4070', 0.7); });
    layer(g, 0.45, () => { g.drawImage(Wd.cityFaded(-1, 'dusk'), -2300, -530, 3400 * 0.62, 900 * 0.62); });
    const [, gy] = toScreen(0, 30, 0.45);
    Wd.river(g, gy, H, t, { top: '#ffb070', bottom: '#3a2a4a', sunX, sunCol: '#ffe0a0', glint: 1.3 });
    layer(g, 1, () => {
      // The brick quay and the jetty.
      g.fillStyle = C.pattern(g, C.brickTile('#8a4a2e', '#a57e5a', 3), 0.9, 0, 0); g.fillRect(-2000, 30, 1500, 700);
      g.fillStyle = 'rgba(255,140,80,0.12)'; g.fillRect(-2000, 30, 1500, 700);
      Wd.jetty(g, -520, 640, 44, t);
      // The boat, pulling away; the merchant at the stern.
      const bx = lerp(1180, 1500, lin(t, 60, 66.2)) + (t > B.aboard ? 0 : 0);
      Wd.boat(g, bx, 130, 1.25, t, { dir: 1, sailCol: '#f0dcb0' });
      const turned = t > B.mTurn;
      const m = person(g, bx - 150, 40, MERCHANT, t > B.aboard ? P.offer({ mouth: mouthFor('time', t, 'grin'), eyes: 'happy' }) : turned ? P.reach({ mouth: 'o', eyes: 'wide', ra: [1.8, 0.2] }) : P.stand({ ra: [0.8, 0.9], mouth: 'smile' }), turned ? -1 : 1, 1.7, t);
      const s = person(g, sx, sy + (t > B.aboard ? 20 : 44), SIYA, sp, 1, 1.75, t);
      if (t < B.hand) sealIn(g, s.handF[0], s.handF[1] - 6, 1.3, 0, t > B.aboard ? 0.7 : 0.3);
      else sealIn(g, m.handF[0], m.handF[1] - 6, 1.3, 0, 0.6);
    });
    C.birds(g, t, 200, 250, 50, -6, 7, 1.0, '#3a1f2a', 8);
    C.motes(g, t, 30, '#ffd0a0', 0.35);
    C.grade(g, t, { warm: 0.16, vignette: 0.45, tint: '#ff9050' });
  },

  stamp(g, t) {
    // Close-up: the seal pressed into a lump of wet clay on a cotton bale's cord.
    const k = lin(t, 66.2, 70.2);
    const q = g.createLinearGradient(0, 0, 0, H); q.addColorStop(0, '#f0e6d2'); q.addColorStop(1, '#c9b89a');
    g.fillStyle = q; g.fillRect(0, 0, W, H);
    g.save(); g.globalAlpha = 0.5; g.fillStyle = C.pattern(g, C.noiseTile(21, 256, 0.5), 2); g.globalCompositeOperation = 'multiply'; g.fillRect(0, 0, W, H); g.restore();
    g.strokeStyle = 'rgba(120,100,70,0.35)'; g.lineWidth = 3; for (let i = 0; i < 40; i++) { g.beginPath(); g.moveTo(0, i * 30); g.lineTo(W, i * 30 + 20); g.stroke(); }
    g.strokeStyle = '#8a6a3a'; g.lineWidth = 22; g.beginPath(); g.moveTo(-40, 700); g.quadraticCurveTo(W / 2, 560, W + 40, 690); g.stroke();
    g.strokeStyle = 'rgba(60,40,20,0.5)'; g.lineWidth = 3; for (let i = 0; i < 40; i++) { const x = i * 52; g.beginPath(); g.moveTo(x, 650); g.lineTo(x + 30, 700); g.stroke(); }
    const lifted = t > B.lift, press = seg(t, 66.5, B.press) * (1 - seg(t, B.lift, B.lift + 0.4));
    // The clay tag.
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(W / 2 + 10, 660, 330, 90, 0, 0, TAU); g.fill();
    if (!lifted) { g.fillStyle = '#b9875a'; g.strokeStyle = '#2d1a10'; g.lineWidth = 4; g.beginPath(); g.ellipse(W / 2, 600 + press * 8, 300 + press * 20, 170 - press * 20, 0, 0, TAU); g.fill(); g.stroke(); }
    else {
      const rk = easeOut(lin(t, B.lift, B.lift + 0.6));
      Sl.sealFace(g, W / 2, 560, lerp(420, 470, rk), { mode: 'impression' });
      C.glow(g, W / 2 + 120, 450, 200, '#fff3d0', 0.3 * win(t, B.lift, B.lift + 1.2, 0.3));
    }
    // The seal and the hand pressing it (seen from the side), until it lifts away.
    const sy = lerp(-120, 380, press) - (lifted ? seg(t, B.lift, B.lift + 0.5) * 520 : 0);
    g.save(); g.translate(W / 2, sy);
    g.fillStyle = '#d8cfb8'; g.strokeStyle = '#2d1a10'; g.lineWidth = 5; g.beginPath(); g.roundRect(-230, 0, 460, 110, 16); g.fill(); g.stroke();
    g.beginPath(); g.ellipse(0, -10, 70, 40, 0, Math.PI, 0); g.fill(); g.stroke();
    g.fillStyle = '#2d1a10'; g.beginPath(); g.arc(0, -22, 13, 0, TAU); g.fill();
    g.fillStyle = MERCHANT.skin; g.lineWidth = 5;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.roundRect(-150 + i * 72, -170 + Math.abs(i - 1.5) * 16, 62, 170, 30); g.fill(); g.stroke(); }
    g.beginPath(); g.roundRect(-230, -330, 460, 200, 70); g.fill(); g.stroke();
    g.fillStyle = MERCHANT.armband; g.fillRect(-200, -330, 400, 26);
    g.restore();
    fact(g, 'Sealed with the owner’s mark, for the long trip to Mesopotamia', t, B.capTrade, 2.0);
    C.grade(g, t, { warm: 0.12, vignette: 0.5, tint: '#ff9a50' });
    void k;
  },

  farewell(g, t) {
    const pull = seg(t, 75, 79);
    setCam(lerp(-120, 150, pull), lerp(-260, -200, pull), lerp(1.2, 0.85, pull));
    sunsetSky(g, t, seg(t, 70, 79));
    const [sunX, sunY] = toScreen(420, lerp(-60, 30, seg(t, 70, 79)), 0.05);
    C.sunDisc(g, sunX, sunY, 50, '#fff0c0', '#ff7a3a'); C.rays(g, sunX, sunY, t, 0.09, '#ffa060');
    layer(g, 0.1, () => { C.cloud(g, 300, -330, 900, 21, '#ffb880', '#7a3f66', 0.8); C.cloud(g, 1300, -420, 800, 22, '#ffa870', '#6a3060', 0.7); });
    layer(g, 0.45, () => {
      g.drawImage(Wd.cityFaded(-1, 'dusk'), -2300, -530, 3400 * 0.62, 900 * 0.62);
      const r = rng(5); for (let i = 0; i < 26; i++) { const lx = -2300 + 1400 + r() * 1100, ly = -80 - r() * 150; C.glow(g, lx, ly, 18, '#ffb050', 0.6 * fade(t, 74 + r() * 4, 0.6)); }
    });
    const [, gy] = toScreen(0, 30, 0.45);
    Wd.river(g, gy, H, t, { top: '#ff9a60', bottom: '#2a1a3a', sunX, sunCol: '#ffd090', glint: 1.4 });
    layer(g, 0.7, () => Wd.boat(g, lerp(250, 760, lin(t, 70.2, 79)), 120, lerp(0.8, 0.45, lin(t, 70.2, 79)), t, { dir: 1, sailCol: '#f0c890' }));
    layer(g, 1, () => {
      Wd.jetty(g, -1200, 400, 44, t);
      const sitting = t > B.sitDown;
      const sp = sitting ? { ...P.sitCarve(0), drop: 36, lean: 0, ll: [1.5, 1.4], rl: [1.6, 1.2], la: [0.4, 0.4], ra: t > B.laugh + 1 ? [1.0, 0.8] : [0.4, 0.4], eyes: 'happy', mouth: 'smile', head: -0.1, look: [0.5, -0.3] }
        : t < B.monkeyIn ? P.wave(t * 9, { eyes: 'happy', mouth: 'grin' })
        : t < B.offer ? P.stand({ eyes: 'wide', mouth: 'o', look: [-1, 0.5] })
        : P.cheer(t * 5, { mouth: mouthFor('thief', t, 'grin'), bob: 0, la: [-0.3, 0.3], ra: [1.3, 0.4] });
      person(g, 0, sitting ? 0 : 44, SIYA, sp, 1, 1.75, t);
      if (t > B.monkeyIn) {
        const k = seg(t, B.monkeyIn, B.monkeyIn + 0.8);
        monkey(g, lerp(-700, -130, k), 40, { s: 1.35, t, pose: k < 1 ? 'run' : 'sit', ph: t * 14, reach: t > B.offer && t < B.laugh + 0.6, carry: t > B.offer && t < B.laugh + 0.6 ? (gg, x, y) => Wd.bead(gg, x, y, 8) : null, mouth: t > B.laugh ? 'open' : 'closed', dir: 1 });
      }
    });
    C.birds(g, t, -100, 300, 60, -10, 9, 1.0, '#2a1422', 8);
    C.motes(g, t, 30, '#ffc890', 0.35);
    C.grade(g, t, { warm: 0.18, vignette: 0.5, tint: '#ff8a4a' });
    C.letterbox(g, seg(t, 76, 78.5));
  },

  epilogue(g, t) {
    if (t < B.brush) {
      // Time-lapse: days and nights race over the city, then the sand comes.
      const k = lin(t, 79, B.brush), cyc = k * 5;
      const day = 0.5 + 0.5 * Math.sin(cyc * TAU);
      setCam(0, -40, 1.05);
      C.sky(g, [[0, C.mix('#0a0f2a', '#4f7fc0', day)], [0.6, C.mix('#2a2a50', '#e8c9a0', day)], [0.8, C.mix('#3a3050', '#ffe2b0', day)]]);
      const [sx0] = toScreen(0, 0, 0.05);
      const sa = cyc * TAU, sunX = sx0 + Math.cos(sa + Math.PI) * 800, sunY = 700 - Math.sin(sa) * 520;
      if (Math.sin(sa) > -0.1) C.sunDisc(g, sunX, sunY, 30, '#fff4d6', '#ffb86b', clamp(Math.sin(sa) * 3, 0, 1));
      else { g.fillStyle = '#f4f1dc'; g.beginPath(); g.arc(W - sunX, 700 + Math.sin(sa) * 520, 26, 0, TAU); g.fill(); }
      const city = Wd.cityPanorama(1, 'dawn'), cs = 0.6;
      layer(g, 0.55, () => { g.globalAlpha = 1 - seg(t, 81.8, B.brush - 0.3) * 0.6; g.drawImage(city, -1150, 150 - Wd.CITY_GROUND * cs, Wd.CITY_W * cs, Wd.CITY_H * cs); g.globalAlpha = 1; });
      night(g, (1 - day) * 0.6);
      Wd.dunes(g, 520, seg(t, 81.0, B.brush - 0.2), t * 20);
      C.grade(g, t, { warm: 0.08, vignette: 0.5 });
      C.text(g, '4,500 years later…', W / 2, 250, { size: 64, font: C.SERIF, col: '#fff3dc', a: win(t, B.cap1, B.brush + 0.1, 0.5), shadow: 0.8 });
      return;
    }
    if (t < B.glyphs) {
      // An archaeologist's brush clears the sand from the seal.
      const k = lin(t, B.brush, B.glyphs);
      g.fillStyle = '#c9a26a'; g.fillRect(0, 0, W, H);
      g.save(); g.globalAlpha = 0.6; g.fillStyle = C.pattern(g, C.mudTile('#caa46c', 31), 2); g.fillRect(0, 0, W, H); g.restore();
      Sl.sealFace(g, W / 2, H / 2, 520, { mode: 'seal' });
      sandCover(g, k);
      const bx = W / 2 - 240 + Math.sin(k * 20) * 220, by = H / 2 - 100 + k * 220;
      g.save(); g.translate(bx, by); g.rotate(-0.6 + Math.sin(k * 20) * 0.15);
      g.fillStyle = '#7a4a2a'; g.strokeStyle = '#2d1a10'; g.lineWidth = 4; g.beginPath(); g.roundRect(-20, -380, 40, 300, 12); g.fill(); g.stroke();
      g.fillStyle = '#d8c8a8'; g.beginPath(); g.moveTo(-34, -90); g.lineTo(34, -90); g.lineTo(44, 10); g.lineTo(-44, 10); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#b9794e'; g.beginPath(); g.roundRect(-60, -520, 120, 170, 50); g.fill(); g.stroke();
      g.restore();
      const r = rng(Math.floor(t * 20)); for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(230,200,150,${r()})`; g.beginPath(); g.arc(bx + (r() - 0.5) * 160, by + r() * 60, 2 + r() * 4, 0, TAU); g.fill(); }
      C.grade(g, t, { warm: 0.1, vignette: 0.55 });
      C.text(g, 'Archaeologists have found thousands of Indus seals.', W / 2, 150, { size: 52, col: '#fff3dc', a: win(t, B.cap2, B.glyphs + 0.1, 0.4), shadow: 0.9, weight: '700' });
      return;
    }
    // The signs light up, one by one. Nobody can read them.
    const q = g.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, 1100); q.addColorStop(0, '#3a2818'); q.addColorStop(1, '#0c0806');
    g.fillStyle = q; g.fillRect(0, 0, W, H);
    const k = lin(t, B.glyphs, B.endCard);
    const signGlow = [0, 1, 2, 3, 4].map((i) => fade(t, B.glyphs + 0.25 + i * 0.35, 0.3) * (0.7 + 0.3 * Math.sin(t * 4 + i)));
    const card = seg(t, B.endCard, B.endCard + 0.6);
    Sl.sealFace(g, W / 2, H / 2 + 20 - card * 60, lerp(560, 600, k) * (1 - card * 0.45), { mode: 'seal', signGlow });
    C.glow(g, W / 2, H / 2 - 120, 500, '#ffcf7a', 0.12 * (1 - card));
    C.text(g, 'But no one has ever been able to read their writing.', W / 2, 150, { size: 50, col: '#fff3dc', a: win(t, B.cap3, B.endCard, 0.4), shadow: 0.9 });
    C.text(g, 'Not yet.', W / 2, H - 110, { size: 72, font: C.SERIF, col: '#ffd27a', a: win(t, B.cap4, B.endCard, 0.4), shadow: 0.9 });
    if (card > 0) {
      C.text(g, 'THE UNICORN SEAL', W / 2, H / 2 + 250, { size: 96, font: C.SERIF, col: '#fff3dc', a: card, shadow: 0.8, spacing: 8 });
      C.text(g, 'The Indus Valley Civilisation  ·  more than 1,000 sites across today’s India and Pakistan', W / 2, H / 2 + 320, { size: 32, col: '#e8d2b0', a: card, shadow: 0.8, weight: '400' });
    }
    C.grade(g, t, { warm: 0.06, vignette: 0.6 });
  },
};

// ---- helpers that need the scene state ----------------------------------------------------------------------------------
function bench(g, x, t, working) {
  // A low wooden work table with tools and a row of finished seals.
  g.fillStyle = '#7a4a2a'; g.strokeStyle = '#2d1a10'; g.lineWidth = 3;
  g.beginPath(); g.roundRect(x - 120, -110, 260, 22, 4); g.fill(); g.stroke();
  g.fillRect(x - 108, -88, 16, 88); g.strokeRect(x - 108, -88, 16, 88); g.fillRect(x + 112, -88, 16, 88); g.strokeRect(x + 112, -88, 16, 88);
  for (let i = 0; i < 4; i++) Sl.sealSmall(g, x + 40 + i * 24, -120, 0.9);
  g.fillStyle = '#b87333'; g.fillRect(x - 90, -118, 50, 5); g.fillStyle = '#6a4424'; g.fillRect(x - 60, -119, 30, 7);
  if (working) { const r = rng(Math.floor(t * 10)); for (let i = 0; i < 5; i++) { g.fillStyle = `rgba(245,235,215,${r()})`; g.beginPath(); g.arc(x - 20 + (r() - 0.5) * 50, -140 - r() * 40, 2 + r() * 2, 0, TAU); g.fill(); } }
  // A low stool for Baba.
  g.fillStyle = '#6a4424'; g.fillRect(x - 250, -70, 110, 16); g.strokeRect(x - 250, -70, 110, 16); g.fillRect(x - 240, -54, 12, 54); g.fillRect(x - 158, -54, 12, 54);
}
function sunsetSky(g, t, late = 0) {
  C.sky(g, [[0, C.mix('#3a2a6a', '#1e1840', late)], [0.35, C.mix('#b0507a', '#7a3a6a', late)], [0.6, C.mix('#ff8a50', '#e0603a', late)], [0.75, C.mix('#ffc070', '#ff9050', late)]]);
}
function night(g, a) { if (a > 0) { g.fillStyle = `rgba(8,10,30,${a})`; g.fillRect(0, 0, W, H); } }
function riverbank(g, t) {
  // The drain's mouth in the riverbank, water pouring out, the seal in the mud.
  daySky(g, 0.35);
  g.fillStyle = '#9ac0c8'; g.fillRect(0, 520, W, 560);
  Wd.river(g, 560, H, t, { top: '#e9c9a0', bottom: '#4a7078', sunX: 1500, glint: 0.8 });
  g.fillStyle = '#7a5a3c'; g.beginPath(); g.moveTo(0, 380); g.quadraticCurveTo(700, 420, 1100, 620); g.lineTo(1300, H); g.lineTo(0, H); g.closePath(); g.fill();
  g.fillStyle = C.pattern(g, C.brickTile('#9a5234', '#a88262', 6), 1.0); g.fillRect(0, 260, 520, 220);
  g.fillStyle = '#20140e'; g.beginPath(); g.moveTo(380, 470); g.lineTo(380, 340); g.lineTo(460, 300); g.lineTo(540, 340); g.lineTo(540, 470); g.closePath(); g.fill();
  const flow = 0.6 + 0.4 * Math.sin(t * 6);
  g.fillStyle = `rgba(120,160,165,${0.8 * flow})`; g.beginPath(); g.moveTo(390, 440); g.quadraticCurveTo(620, 450, 700, 700); g.lineTo(760, 700); g.quadraticCurveTo(680, 440, 530, 430); g.closePath(); g.fill();
  Wd.reeds(g, 900, 640, 700, 180, t, { seed: 44 });
  // Seal: flies out, lands, glints; Siya slides down and grabs it.
  const k = lin(t, B.outlet, B.mud);
  const sx = t < B.mud ? lerp(470, 820, k) : 820, sy = t < B.mud ? lerp(430, 640, k) - Math.sin(k * Math.PI) * 120 : 640;
  if (t < B.grabSeal) sealIn(g, sx, sy, 2.2, t < B.mud ? t * 10 : 0.2, t > B.mud ? 0.9 : 0);
  if (t > B.mud) { g.fillStyle = 'rgba(90,60,35,0.7)'; g.beginPath(); g.ellipse(820, 652, 60, 12, 0, 0, TAU); g.fill(); }
  const pk = seg(t, B.mud + 0.2, B.grabSeal);
  const s = person(g, lerp(200, 740, pk), lerp(420, 640, pk), SIYA, t < B.grabSeal ? P.slide({ eyes: 'wide', mouth: 'open' }) : P.holdUp({ eyes: 'happy', mouth: 'grin' }), 1, 1.9, t);
  if (t > B.grabSeal) sealIn(g, s.handF[0], s.handF[1] - 8, 1.9, 0, 1);
  word(g, 'SPLAT!', 980, 520, t, B.mud, 70, '#ffe07a', 0.6);
}
function sandCover(g, k) {
  // Sand over the seal, brushed away along a zig-zag path as k goes 0 -> 1.
  const sc = cached2();
  const sg = sc.getContext('2d');
  sg.globalCompositeOperation = 'source-over'; sg.clearRect(0, 0, W, H);
  sg.fillStyle = '#c9a26a'; sg.beginPath(); sg.ellipse(W / 2, H / 2, 420, 380, 0, 0, TAU); sg.fill();
  sg.fillStyle = C.pattern(sg, C.mudTile('#caa46c', 31), 2); sg.globalAlpha = 0.8; sg.fill(); sg.globalAlpha = 1;
  sg.globalCompositeOperation = 'destination-out'; sg.lineCap = 'round'; sg.lineWidth = 150;
  sg.beginPath(); const steps = Math.floor(k * 60);
  for (let i = 0; i <= steps; i++) { const u = i / 60, x = W / 2 - 240 + Math.sin(u * 20) * 220, y = H / 2 - 100 + u * 220; if (i === 0) sg.moveTo(x, y); else sg.lineTo(x, y); }
  sg.stroke();
  g.drawImage(sc, 0, 0);
}
let SAND = null;
function cached2() { if (!SAND) SAND = C.canvas(W, H); return SAND; }

const ORDER = B.scenes.map(([id]) => id), START = B.scenes.map(([, t]) => t);
function frame(t) {
  let i = 0; while (i + 1 < ORDER.length && t >= START[i + 1]) i++;
  C.setShake(C.shakeFrom(t, IMPACTS));
  g.save(); S[ORDER[i]](g, t); g.restore();
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
  subtitle(g, t);
  // Quick dips to black between some scenes, and the fade in / out.
  const dips = [8.5, 18.6, 60, 79, 84];
  let f = Math.max(1 - clamp(t / 0.8, 0, 1), clamp((t - (DURATION - 1.0)) / 1.0, 0, 1));
  for (const d of dips) f = Math.max(f, 1 - clamp(Math.abs(t - d) / 0.22, 0, 1));
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
