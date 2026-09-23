// Film 1: the twelve shots and their text overlay, on the shared world.
// tools/render.mjs drives window.renderFrame(i) one frame at a time.
import {
  FPS, DURATION, SHOTS, CAPTIONS, shotAt, planeState, clockText, clamp,
  STRIKE_FT, DITCH_FT, GWB_FT,
} from './timeline.js';
import { PLACES, ll } from './geo.js';
import { createWorld, preview } from './world.js';
import { CAMS, V } from './cams.js';

const params = new URLSearchParams(location.search);
const RENDER = params.has('render');
const { renderer, camera, draw } = createWorld({ preserve: RENDER });
document.getElementById('stage').prepend(renderer.domElement);

// ---- overlay --------------------------------------------------------------------------
const el = (id) => document.getElementById(id);
const capEls = CAPTIONS.map((c) => {
  const d = document.createElement('div');
  d.className = `cap ${c.kind}`;
  if (c.kind === 'radio') d.innerHTML = `<div class="who"><span class="dot"></span>${c.who}</div><div class="txt"></div>`;
  else if (c.kind === 'title' || c.kind === 'end') d.innerHTML = `<div class="big">${c.text}</div><div class="sub">${c.sub}</div>`;
  else d.textContent = c.text;
  el(c.kind === 'radio' ? 'radio' : c.kind === 'caption' ? 'captions' : 'center').appendChild(d);
  return d;
});
const LABELS = [
  ['LaGuardia', PLACES.lga], ['Teterboro', PLACES.teterboro], ['George Washington Bridge', PLACES.gwbNY],
  ['Hudson River', ll(40.8050, -73.9800)], ['Manhattan', ll(40.7750, -73.9650)], ['Bird strike', null],
].map(([name, p]) => {
  const d = document.createElement('div'); d.className = 'label'; d.textContent = name; el('labels').appendChild(d);
  return { d, p };
});
const strikePos = planeState(STRIKE_FT).pos;

function overlay(v, shot, ft, S) {
  CAPTIONS.forEach((c, i) => {
    const e = capEls[i];
    const o = clamp(Math.min((v - c.t0) / 0.45, (c.t1 - v) / 0.45), 0, 1);
    e.style.opacity = o;
    e.style.display = o > 0 ? '' : 'none';
    if (c.kind === 'radio' && o > 0) {
      const k = clamp((v - c.t0) / ((c.t1 - c.t0) * 0.62), 0, 1);
      e.querySelector('.txt').textContent = c.text.slice(0, Math.ceil(c.text.length * k));
    }
  });
  const flying = !['title', 'evac', 'end'].includes(shot.name);
  el('clock').style.opacity = flying ? 1 : 0;
  el('clock').textContent = clockText(ft);
  const showLabels = shot.name === 'turn';
  for (const L of LABELS) {
    const p = L.p ? V(L.p.x, 60, L.p.z) : strikePos;
    const q = p.clone().project(camera);
    const on = showLabels && q.z < 1 && Math.abs(q.x) < 1.1 && Math.abs(q.y) < 1.1;
    L.d.style.display = on ? '' : 'none';
    if (on) { L.d.style.left = `${(q.x * 0.5 + 0.5) * 100}%`; L.d.style.top = `${(-q.y * 0.5 + 0.5) * 100}%`; }
  }
  // Fade through black between some shots, and at both ends.
  let black = 0;
  black = Math.max(black, 1 - clamp(v / 1.0, 0, 1));
  black = Math.max(black, clamp((v - (DURATION - 1.2)) / 1.2, 0, 1));
  const local = v - shot.start;
  if (['takeoff', 'evac'].includes(shot.name)) black = Math.max(black, 1 - clamp(local / 0.5, 0, 1));
  if (['title', 'ditch'].includes(shot.name)) black = Math.max(black, clamp((local - (shot.dur - 0.5)) / 0.5, 0, 1));
  el('fade').style.opacity = black;
}

// ---- a frame -------------------------------------------------------------------------
function frame(v) {
  const { shot, u, ft } = shotAt(v);
  const S = draw(ft, CAMS[shot.name](ft, u, planeState(ft)), { map: shot.name === 'turn' });
  overlay(v, shot, ft, S);
  return { shot: shot.name, ft };
}

window.DURATION = DURATION;
window.FPS = FPS;
window.renderFrame = (i) => frame(i / FPS);
window.seek = (v) => frame(v);
window.shots = SHOTS.map((s) => ({ name: s.name, start: s.start, dur: s.dur }));
window.ready = true;
console.log(`ready: ${DURATION}s, strike ${STRIKE_FT}, GWB ${GWB_FT.toFixed(1)}, ditch ${DITCH_FT}`);

if (!RENDER) preview(frame, DURATION, params);
