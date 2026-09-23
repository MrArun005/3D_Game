// Wiring: renderer, the twelve shots, the text overlay, and a frame API that
// tools/render.mjs drives one frame at a time.
import * as THREE from 'three';
import {
  FPS, DURATION, SHOTS, CAPTIONS, shotAt, planeState, spool, clockText, lerp, smooth, clamp,
  STRIKE_FT, DITCH_FT, GWB_FT, LIFTOFF_FT, RWY_DIR, LAND_Y,
} from './timeline.js';
import { PLACES, ll } from './geo.js';
import { skyTexture, SUN_DIR, softSprite } from './textures.js';
import { buildCity } from './city.js';
import { buildAircraft } from './aircraft.js';
import { Geese, Puffs, Spray, Foam, Flames, Evacuation, Ferries } from './effects.js';

const params = new URLSearchParams(location.search);
const RENDER = params.has('render');
const W = 1280, H = 720;

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: RENDER });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('stage').prepend(renderer.domElement);

const scene = new THREE.Scene();
const sky = skyTexture();
scene.background = sky;
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(sky).texture;
scene.environmentIntensity = 0.9;
scene.fog = new THREE.FogExp2(0xc2ccd4, 0.000052);

const sun = new THREE.DirectionalLight(0xfff0dc, 2.7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 1200 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xbcd3ec, 0x55544f, 0.35));

const camera = new THREE.PerspectiveCamera(40, W / H, 0.3, 90000);

const city = buildCity(scene);
const plane = buildAircraft();
scene.add(plane.root);
const geese = new Geese(scene);
const puffs = new Puffs(scene);
const spray = new Spray(scene);
const foam = new Foam(scene);
const flames = new Flames(plane);
const evac = new Evacuation(plane);
const ferries = new Ferries(scene);

// The path, drawn as a ribbon for the map shot.
const pathPts = [];
for (let ft = LIFTOFF_FT; ft <= DITCH_FT; ft += 0.5) pathPts.push(planeState(ft).pos.clone());
const pathCurve = new THREE.CatmullRomCurve3(pathPts);
const PATH_SEG = 1200;
const pathMesh = new THREE.Mesh(new THREE.TubeGeometry(pathCurve, PATH_SEG, 26, 6), new THREE.MeshBasicMaterial({ color: 0xff4b3a, fog: false }));
scene.add(pathMesh);
const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: softSprite('rgba(255,90,60,1)'), depthTest: false, fog: false }));
marker.scale.setScalar(420);
scene.add(marker);

// Fan rotation needs the integral of spool over flight time.
function fanAngles(ft) {
  const a = [0, 0];
  const dt = 0.05;
  for (let t = 0; t < ft; t += dt) {
    a[0] += (1.5 + 30 * spool(t, -1)) * dt;
    a[1] += (1.5 + 30 * spool(t, 1)) * dt;
  }
  return a;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const FLOAT = planeState(DITCH_FT + 40).pos;
const AWAY = Math.atan2(FLOAT.z - PLACES.midtown.z, FLOAT.x - PLACES.midtown.x); // bearing from Midtown out past the aircraft
const W3 = (p, y) => V(p.x, y, p.z);
const world = (S, x, y, z) => S.pos.clone().addScaledVector(S.f, x).addScaledVector(S.u, y).addScaledVector(S.r, z);
const flat = (S, x, y, z) => S.pos.clone().addScaledVector(S.fh, x).add(V(0, y, 0)).addScaledVector(S.rh, z);

// Each shot returns { pos, look, fov, up? }.
const CAMS = {
  title(ft, u) {
    const a = ll(40.7330, -74.0260), b = ll(40.7420, -74.0230);
    return { pos: V(lerp(a.x, b.x, u), 430 - 40 * u, lerp(a.z, b.z, u)), look: W3(ll(40.7900, -73.9700), 80), fov: 42 };
  },
  takeoff(ft, u, S) {
    const side = V(-RWY_DIR.z, 0, RWY_DIR.x);
    const base = W3(PLACES.lgaRwy4, LAND_Y + 2.2).addScaledVector(RWY_DIR, 1010).addScaledVector(side, 62);
    return { pos: base, look: S.pos.clone().addScaledVector(S.f, 6), fov: lerp(34, 24, smooth(0.45, 1, u)) };
  },
  climb(ft, u, S) {
    return { pos: flat(S, -62 + 10 * u, 7, 30 - 8 * u), look: world(S, 6, 0, 0), fov: 38 };
  },
  geese(ft, u, S) {
    const K = planeState(STRIKE_FT);
    return { pos: flat(K, 150, 3, 20), look: S.pos.clone().lerp(flat(K, 40, 0, 0), 0.25), fov: 34 };
  },
  strike(ft, u, S) {
    return { pos: world(S, 26 - 4 * u, 1.2, -12.5), look: world(S, 1, -1.6, -5), fov: 46, up: S.u };
  },
  mayday(ft, u, S) {
    return { pos: flat(S, -30 + 55 * u, -8, -95), look: world(S, 3, 0, 0), fov: 36 };
  },
  turn(ft, u) {
    const c = ll(40.6950, -73.9300);
    return { pos: V(c.x - 700 * u, 8600 - 500 * u, c.z), look: W3(ll(40.8120, -73.9580), 0), fov: 46 };
  },
  gwb(ft, u, S) {
    // Riding above and behind the left wing, the bridge slides by underneath.
    return { pos: flat(S, -92 + 16 * u, 46, -6), look: world(S, 70, -75, 0), fov: 50 };
  },
  river(ft, u, S) {
    return { pos: flat(S, 60 - 80 * u, 3, 150), look: world(S, 4, 0, 0), fov: 38 };
  },
  ditch(ft, u, S) {
    const K = planeState(DITCH_FT);
    const base = flat(K, 175, 0, 72);
    base.y = 3.2;
    const shake = Math.exp(-Math.max(0, ft - DITCH_FT) * 1.2) * (ft > DITCH_FT ? 0.25 : 0);
    base.x += Math.sin(ft * 57) * shake; base.y += Math.sin(ft * 43) * shake;
    return { pos: base, look: S.pos.clone().add(V(0, 1, 0)), fov: lerp(24, 38, smooth(0.35, 0.85, u)) };
  },
  // Both after-shots stand on the Jersey side, so Midtown is the backdrop.
  evac(ft, u, S) {
    const a = AWAY + lerp(-0.55, 0.25, u);
    const r = 62;
    return { pos: V(S.pos.x + Math.cos(a) * r, 10 - 3 * u, S.pos.z + Math.sin(a) * r), look: S.pos.clone().add(V(0, 0.5, 0)), fov: 42 };
  },
  end(ft, u, S) {
    const e = smooth(0, 1, u);
    const a = AWAY + 0.25 + 0.2 * e;
    const r = lerp(62, 820, e);
    return { pos: V(S.pos.x + Math.cos(a) * r, lerp(7, 300, e), S.pos.z + Math.sin(a) * r), look: S.pos.clone().lerp(W3(PLACES.midtown, 80), 0.35 * e), fov: 42 };
  },
};

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
let lastAngles = null;
function frame(v) {
  const { shot, u, ft } = shotAt(v);
  const S = planeState(ft);
  plane.root.position.copy(S.pos);
  plane.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(S.f, S.u, S.r));
  lastAngles = fanAngles(ft);
  plane.update(ft, lastAngles);
  city.update(ft);
  geese.update(ft);
  puffs.update(ft);
  spray.update(ft);
  foam.update(ft, S);
  flames.update(ft);
  evac.update(ft);
  ferries.update(ft);

  const map = shot.name === 'turn';
  pathMesh.visible = map;
  marker.visible = map;
  if (map) {
    const k = clamp((ft - LIFTOFF_FT) / (DITCH_FT - LIFTOFF_FT), 0, 1);
    pathMesh.geometry.setDrawRange(0, Math.floor(k * PATH_SEG) * 6 * 6);
    marker.position.copy(S.pos);
  }

  const c = CAMS[shot.name](ft, u, S);
  camera.position.copy(c.pos);
  camera.up.copy(c.up || V(0, 1, 0));
  camera.fov = c.fov;
  camera.near = map ? 20 : 0.3;
  camera.updateProjectionMatrix();
  camera.lookAt(c.look);

  // Shadows follow whatever the camera is looking at, near the aircraft.
  const focus = S.pos.distanceTo(camera.position) < 400 ? S.pos : c.look;
  sun.target.position.copy(focus);
  sun.position.copy(focus).addScaledVector(SUN_DIR, 500);
  scene.fog.density = map ? 0.000028 : 0.000052;

  renderer.render(scene, camera);
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

if (!RENDER) {
  // Live preview. ?t=seconds to start elsewhere, space to pause.
  const fit = () => {
    const s = Math.min(innerWidth / W, innerHeight / H);
    el('stage').style.transform = `scale(${s})`;
  };
  addEventListener('resize', fit); fit();
  let t0 = performance.now() - (parseFloat(params.get('t')) || 0) * 1000, paused = false, pv = 0;
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') { paused = !paused; t0 = performance.now() - pv * 1000; }
    if (e.code === 'ArrowRight') t0 -= 5000;
    if (e.code === 'ArrowLeft') t0 += 5000;
  });
  const loop = () => {
    if (!paused) { pv = ((performance.now() - t0) / 1000) % DURATION; frame(pv); }
    requestAnimationFrame(loop);
  };
  loop();
}
