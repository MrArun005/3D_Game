/**
 * Asset viewer (dev only: `npm run dev`, then /viewer.html?asset=people).
 * One asset under a game-like sun, sky fill and environment, on a tarmac disc,
 * no post stack -- fast enough to iterate on a model in a software renderer.
 *
 *   ?asset=people|tank|heli|heli-news   what to show
 *   &yaw=35&pitch=12&dist=9&h=1.2       camera orbit (degrees, metres) and target height
 *   &tx=0&tz=0                          orbit centre in x/z (close-ups)
 *   &layout=faces                       people: styles side by side facing +X
 *   &lod1                               people: force the far mesh
 *   &turret=30                          tank: turret yaw (degrees)
 *   &alt=0                              heli: height above the pad
 *   &sun=38&sunaz=145                   sun elevation / azimuth (degrees)
 *   &t=1.3                              freeze animation time (seconds); omit to run
 *   &webgl                              three's WebGL2 backend
 */
import * as THREE from 'three';
import { FigureFleet } from './world/figure.js';
import { buildTankModel, rollTracks, tankTriangles } from './world/tankModel.js';
import { buildHeliModel, heliTriangles } from './world/heliModel.js';

const q = new URLSearchParams(location.search);
const asset = q.get('asset') || 'people';
const canvas = document.getElementById('c');
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: q.has('webgl') });
await renderer.init();
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = +(q.get('exposure') ?? 1.0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb6cc);
scene.fog = new THREE.Fog(0x9fb6cc, 60, 260);
const camera = new THREE.PerspectiveCamera(+(q.get('fov') ?? 38), innerWidth / innerHeight, 0.05, 2000);

// light: a 38-degree afternoon sun (the game's 15:30), blue sky fill, a dim env
const sun = new THREE.DirectionalLight(0xfff1de, 3.6);
const sunEl = THREE.MathUtils.degToRad(+(q.get('sun') ?? 38)), sunAz = THREE.MathUtils.degToRad(+(q.get('sunaz') ?? 145));
sun.position.set(Math.cos(sunEl) * Math.cos(sunAz) * 60, Math.sin(sunEl) * 60, Math.cos(sunEl) * Math.sin(sunAz) * 60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 160 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xbcd3ee, 0x4a4238, 0.55));
{
  // environment: a gradient sky dome + a warm ground, baked once through PMREM
  const env = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true }));
  const pos = sky.geometry.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 50; c.set(y > 0 ? 0x7fa6d4 : 0x5a5248).lerp(new THREE.Color(0xe8e2d6), 1 - Math.min(1, Math.abs(y) * 2.2)); col.set([c.r, c.g, c.b], i * 3); }
  sky.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  env.add(sky);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env, 0.02).texture;
  scene.environmentIntensity = q.has('noenv') ? 0 : 0.6;
}
// ground: a tarmac disc with a pavement band, so feet and tracks have something to stand on
{
  const g = new THREE.Mesh(new THREE.CircleGeometry(80, 64), new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.92 }));
  g.rotation.x = -Math.PI / 2; g.receiveShadow = true; scene.add(g);
  const band = new THREE.Mesh(new THREE.RingGeometry(9, 11, 64), new THREE.MeshStandardMaterial({ color: 0x8e8b84, roughness: 0.9 }));
  band.rotation.x = -Math.PI / 2; band.position.y = 0.002; band.receiveShadow = true; scene.add(band);
}

let update = () => {};
const info = [];
if (asset === 'people') {
  const n = 12;
  const fleet = new FigureFleet(scene, n, { shadows: true });
  const WEAR = [0xc94a3a, 0x2e7fb8, 0xe0b23a, 0x2b3444, 0xd8d3c8, 0x6a9a4a, 0x8a4a9a, 0x1f1f24, 0xe07a3a, 0x35485e, 0xa8a29a, 0x6a3f38];
  const SKIN = [0xf0c8a0, 0xd9a173, 0xa8724a, 0x7a4f33, 0x5a3a26, 0xe8b890];
  const LEGS = [0x2a3550, 0x1d1f24, 0x6b6045, 0x3b3f47, 0x27303d];
  const PATTERN = [0, 1, 2, 3, 0, 2, 3, 1, 0, 0, 2, 3];
  for (let i = 0; i < n; i++) fleet.colour(i, WEAR[i % WEAR.length], SKIN[i % SKIN.length], LEGS[i % LEGS.length], null, i % 6,
    { pattern: PATTERN[i], shorts: i % 5 === 4 ? 1 : 0, longSleeve: i % 3 === 0 ? 0 : 1, build: (i * 0.37) % 1 });
  const states = q.get('states') ? q.get('states').split(',').map(Number) : [1, 1, 2, 0, 1, 0, 2, 1, 0, 1, 3, 1];
  /* layout=faces: the five hair styles shoulder to shoulder along Z, facing the
     camera (+X), idle -- for head close-ups; the default is two walking rows */
  const faces = q.get('layout') === 'faces';
  update = (t) => {
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 6), col = i % 6;
      const st = faces ? 0 : states[i % states.length];
      if (faces) fleet.write(i, i < 6 ? 0 : -1.4, 0, ((i % 6) - 2.5) * 0.62, 0, t * 5.5 + i * 0.7, 0, 1);
      else fleet.write(i, (col - 2.5) * 1.3, 0, row * 2.2 - 1.1, 0, t * (st === 2 ? 9 : 5.5) + i * 0.7, st, 0.95 + (i % 4) * 0.04);
    }
    fleet.flush();
  };
  if (q.has('norecv')) for (const m of fleet.meshes) m.receiveShadow = false;
  if (q.has('lod1')) fleet.focus = { x: 1e4, z: 1e4 };   // everyone past NEAR_R: the far mesh
  info.push(`people: ${n}`);
}
if (asset === 'tank') {
  const tank = buildTankModel();
  tank.group.position.y = 0.65;                            // TankVehicle keeps y = ground + 0.65
  tank.turretGroup.rotation.y = THREE.MathUtils.degToRad(+(q.get('turret') ?? 0));
  scene.add(tank.group);
  let last = 0;
  update = (t) => { const d = (t - last) * 4; last = t; rollTracks(tank, d, d); };
  info.push(`tank: ${tankTriangles()} tris, 5 draws`);
}
if (asset === 'heli' || asset === 'heli-civil') {
  const livery = asset === 'heli' ? 'police' : 'civil';
  const heli = buildHeliModel({ livery });
  heli.group.position.y = 1.25 + +(q.get('alt') ?? 0);   // skids on the ground (flight.js rests at ground + 1.25)
  scene.add(heli.group);
  update = (t) => { heli.rotor.rotation.y = t * 0.9; heli.tail.rotation.z = t * 3; };
  info.push(`heli ${livery}: ${heliTriangles(livery)} tris`);
}
const t0 = performance.now();
const tFix = q.has('t') ? +q.get('t') : null;
const yaw = THREE.MathUtils.degToRad(+(q.get('yaw') ?? 35)), pitch = THREE.MathUtils.degToRad(+(q.get('pitch') ?? 10));
const dist = +(q.get('dist') ?? 9), th = +(q.get('h') ?? 1.0);
const tx = +(q.get('tx') ?? 0), tz = +(q.get('tz') ?? 0);   // orbit centre, for close-ups of one part
camera.position.set(tx + Math.cos(pitch) * Math.cos(yaw) * dist, th + Math.sin(pitch) * dist, tz + Math.cos(pitch) * Math.sin(yaw) * dist);
camera.lookAt(tx, th, tz);
document.getElementById('info').textContent = `${asset} · ${info.join(' · ')}`;
let frames = 0;
renderer.setAnimationLoop(() => {
  const t = tFix ?? (performance.now() - t0) / 1000;
  update(t);
  renderer.render(scene, camera);
  if (++frames === 3) window.__ready = true;
});
