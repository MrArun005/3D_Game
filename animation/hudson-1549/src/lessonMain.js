// Film 2 page: the shared world, plus Spark, speech bubbles and diagrams.
import * as THREE from 'three';
import { FPS, planeState, clamp, smooth, lerp } from './timeline.js';
import { PLACES, ll } from './geo.js';
import { createWorld, preview } from './world.js';
import { CAMS, V, W3, world } from './cams.js';
import { LESSON_SHOTS, LESSON_DURATION, lessonShotAt, BUBBLES, PANELS, TYPE_RATE, talkEnd } from './lesson.js';

const params = new URLSearchParams(location.search);
const RENDER = params.has('render');
const { renderer, scene, camera, draw } = createWorld({ preserve: RENDER });
document.getElementById('stage').prepend(renderer.domElement);
const el = (id) => document.getElementById(id);

// ---- extra cameras ------------------------------------------------------------------
const MAP_FT = 165;
const MAP_S = planeState(MAP_FT);
const cams = {
  ...CAMS,
  map(ft, u) {
    const c = ll(40.7250, -73.9150);
    return { pos: V(c.x - 600 * u, 7800 - 300 * u, c.z), look: W3(ll(40.8150, -73.9650), 0), fov: 46 };
  },
  tail(ft, u, S) {
    return { pos: world(S, -34 + 6 * u, 7, -24), look: world(S, -15, 1.5, 0), fov: 40, up: S.u };
  },
};

// ---- the options, drawn on the map ------------------------------------------------------
const TARGETS = [
  { name: 'LaGuardia', p: PLACES.lga, color: 0xff5a4a },
  { name: 'Teterboro', p: PLACES.teterboro, color: 0xffb13b },
  { name: 'The Hudson', p: ll(40.8000, -73.9800), color: 0x5fe08a },
];
const optionLines = TARGETS.map((t) => {
  const g = new THREE.BufferGeometry().setFromPoints([MAP_S.pos.clone(), V(t.p.x, 40, t.p.z)]);
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: t.color, depthTest: false, transparent: true, fog: false }));
  line.renderOrder = 10;
  scene.add(line);
  const km = Math.hypot(t.p.x - MAP_S.pos.x, t.p.z - MAP_S.pos.z) / 1000;
  const d = document.createElement('div');
  d.className = 'label opt';
  d.style.borderColor = `#${t.color.toString(16).padStart(6, '0')}`;
  d.innerHTML = `${t.name}<span>${t.name === 'The Hudson' ? 'right below' : `${km.toFixed(1)} km`}</span>`;
  el('labels').appendChild(d);
  return { line, d, t };
});
const planeLabel = document.createElement('div');
planeLabel.className = 'label'; planeLabel.textContent = 'Flight 1549';
el('labels').appendChild(planeLabel);
const apuLabel = document.createElement('div');
apuLabel.className = 'label callout'; apuLabel.textContent = 'APU';
el('labels').appendChild(apuLabel);

// ---- Spark ----------------------------------------------------------------------------
// Eight rounded rays round a face. Loading: the rays chase round like a spinner.
const NS = 'http://www.w3.org/2000/svg';
const spark = el('spark');
const rays = [];
{
  const g = spark.querySelector('#rays');
  for (let i = 0; i < 8; i++) {
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', -9); r.setAttribute('y', -92); r.setAttribute('width', 18); r.setAttribute('height', 50); r.setAttribute('rx', 9);
    r.setAttribute('fill', '#e07a52');
    const w = document.createElementNS(NS, 'g');
    w.setAttribute('transform', `rotate(${i * 45})`);
    w.appendChild(r); g.appendChild(w);
    rays.push(r);
  }
}
const mouth = spark.querySelector('#mouth'), eyes = spark.querySelector('#eyes');

function sparkPose(v, shot, local) {
  const speaking = BUBBLES.find((c) => v >= c.t0 && v < talkEnd(c));
  const loading = (shot.name === 'intro' && local < 2.4) || (shot.name === 'lessons' && local > 8.6);
  const center = shot.name === 'intro' || shot.name === 'lessons';
  // Placement: big and centred for intro/outro, small bottom-left otherwise.
  const big = center ? 1 : 0;
  const x = lerp(125, 640, big), y = lerp(720 - 175, 372, big), s = lerp(0.9, 1.35, big);
  const bob = Math.sin(v * 2.4) * 6;
  spark.style.transform = `translate(${x}px, ${y + bob}px) scale(${s})`;
  const spin = loading ? v * 300 : Math.sin(v * 0.8) * 8;
  spark.querySelector('#rays').setAttribute('transform', `rotate(${spin})`);
  rays.forEach((r, i) => {
    // Chasing pulse when loading, a gentle breath otherwise.
    const k = loading ? 0.55 + 0.45 * Math.max(0, Math.cos((v * 8 - i * 0.78))) : 0.9 + 0.1 * Math.sin(v * 2 + i);
    r.setAttribute('height', 50 * k); r.setAttribute('y', -42 - 50 * k);
    r.setAttribute('opacity', loading ? 0.45 + 0.55 * k : 1);
  });
  const blink = (v % 3.3) < 0.12 ? 0.1 : 1;
  eyes.setAttribute('transform', `scale(1, ${blink})`);
  const open = speaking ? 0.25 + 0.75 * Math.abs(Math.sin(v * 17)) * (0.6 + 0.4 * Math.sin(v * 5.3)) : 0;
  mouth.setAttribute('d', `M -16 14 Q 0 ${24 + 18 * open} 16 14 Q 0 ${20 + 4 * open} -16 14 Z`);
}

// ---- bubbles and panels --------------------------------------------------------------
const bubbleEls = BUBBLES.map((c) => {
  const d = document.createElement('div'); d.className = 'bubble'; el('bubbles').appendChild(d); return d;
});
function fadeIn(v, t0, t1, f = 0.35) { return clamp(Math.min((v - t0) / f, (t1 - v) / f), 0, 1); }

function panels(v, local) {
  for (const p of PANELS) {
    const o = fadeIn(v, p.t0, p.t1);
    const e = el(p.id);
    e.style.opacity = o;
    e.style.display = o > 0 ? '' : 'none';
    const k = clamp((v - p.t0) / 2.2, 0, 1);   // draw-on progress
    e.style.setProperty('--k', k);
    e.querySelectorAll('[data-draw]').forEach((path) => {
      const L = parseFloat(path.dataset.draw);
      path.style.strokeDasharray = L; path.style.strokeDashoffset = L * (1 - k);
    });
    if (p.id === 'd-lessons') {
      e.querySelectorAll('li').forEach((li, i) => { li.style.opacity = clamp((v - p.t0 - 1.2 - i * 2.2) / 0.5, 0, 1); });
    }
  }
}

function project(p) {
  const q = p.clone().project(camera);
  return { on: q.z < 1 && Math.abs(q.x) < 1.05 && Math.abs(q.y) < 1.05, x: (q.x * 0.5 + 0.5) * 100, y: (-q.y * 0.5 + 0.5) * 100 };
}
function place(d, p, show) {
  const q = project(p);
  const on = show && q.on;
  d.style.display = on ? '' : 'none';
  if (on) { d.style.left = `${q.x}%`; d.style.top = `${q.y}%`; }
}

function overlay(v, shot, local, S) {
  sparkPose(v, shot, local);
  BUBBLES.forEach((c, i) => {
    const e = bubbleEls[i];
    const o = fadeIn(v, c.t0, c.t1);
    e.style.opacity = o;
    e.style.display = o > 0 ? '' : 'none';
    if (o > 0) e.textContent = c.text.slice(0, Math.ceil((v - c.t0) * TYPE_RATE));
    e.classList.toggle('center', shot.name === 'intro');
  });
  panels(v, local);
  const map = shot.name === 'options';
  optionLines.forEach((L, i) => {
    const k = optionK(shot, local, i);
    place(L.d, V(L.t.p.x, 60, L.t.p.z), map && k > 0);
    L.d.style.opacity = k;
  });
  place(planeLabel, S.pos, map);
  place(apuLabel, world(S, -18.2, 1.0, 0), shot.name === 'apu' && local > 1.5);
  el('title').style.opacity = shot.name === 'intro' ? fadeIn(v, 0.4, 6.8) : 0;
  el('outro').style.opacity = shot.name === 'lessons' ? fadeIn(v, shot.start + 8.7, LESSON_DURATION + 1) : 0;
  let black = Math.max(1 - clamp(v / 1.0, 0, 1), clamp((v - (LESSON_DURATION - 1.2)) / 1.2, 0, 1));
  if (['glide', 'rescue'].includes(shot.name)) black = Math.max(black, 1 - clamp(local / 0.5, 0, 1));
  if (['intro', 'ditch'].includes(shot.name)) black = Math.max(black, clamp((local - (shot.dur - 0.5)) / 0.5, 0, 1));
  el('fade').style.opacity = black;
  // The intro and outro dim the world behind Spark.
  el('dim').style.opacity = shot.name === 'intro' ? 0.45 : shot.name === 'lessons' ? 0.55 * smooth(0, 1, local) : 0;
}

const optionK = (shot, local, i) => (shot.name === 'options' ? clamp((local - 6.6 - i * 1.4) / 0.8, 0, 1) : 0);

function frame(v) {
  const { shot, u, local, ft } = lessonShotAt(v);
  optionLines.forEach((L, i) => { const k = optionK(shot, local, i); L.line.visible = k > 0; L.line.material.opacity = k; });
  const S = draw(ft, cams[shot.cam](ft, u, planeState(ft)), { map: shot.cam === 'map', pathTo: MAP_FT });
  overlay(v, shot, local, S);
  return { shot: shot.name, ft };
}

window.DURATION = LESSON_DURATION;
window.FPS = FPS;
window.renderFrame = (i) => frame(i / FPS);
window.seek = (v) => frame(v);
window.ready = true;
console.log(`lesson ready: ${LESSON_DURATION}s, ${LESSON_SHOTS.length} shots`);
if (!RENDER) preview(frame, LESSON_DURATION, params);
