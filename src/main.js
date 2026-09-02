import * as THREE from 'three';
import './style.css';

import { autoResolution, createRenderer, createScene, createLights, DAY_SUN } from './core/renderer.js';
import { createSky } from './core/sky.js';
import { createGrade } from './core/grade.js';
import { setAnisotropy } from './world/textures.js';
import { createAssets } from './world/assets.js';
import { loadVendorCars, loadHeroSkin } from './world/vendorCars.js';
import { LightPool } from './game/lighting.js';
import { Jobs, onPavementAtSpeed } from './game/jobs.js';
import { Catalogue, dressCarMaterials } from './world/catalogue.js';
import { City } from './world/city.js';
import { DistrictWorld } from './world/districtWorld.js';
import { loadDistrict } from './world/district.js';
import { buildSurrounds } from './world/surrounds.js';
import { buildWater } from './world/water.js';
import { buildPlaces } from './world/places.js';
import { buildBeach } from './world/beach.js';
import { useDistrict } from './world/metrics.js';
import { buildCar } from './vehicle/model.js';
import { createCarState, resetCar, stepVehicle } from './vehicle/dynamics.js';
import { groundHeightAt } from './world/metrics.js';
import { CG_X, WHEEL_R } from './vehicle/config.js';
import { ChaseCamera } from './game/camera.js';
import { createInput, padConnected } from './game/input.js';
import { Traffic } from './game/traffic.js';
import { Crowd } from './game/crowd.js';
import { Helicopter } from './game/helicopter.js';
import { OnFoot, makeSolver } from './game/onfoot.js';
import { CHARACTERS } from './game/character.js';
import { Mission } from './game/mission.js';
import { Multiplayer, roomFromUrl, createRoom } from './game/multiplayer.js';
import { Weapon } from './game/weapon.js';
import { SkidMarks } from './world/skidmarks.js';
import { Damage } from './game/damage.js';
import { signalState } from './world/signals.js';
import { Hud } from './ui/hud.js';
import { Stats } from './ui/stats.js';
import { Photo } from './game/photo.js';
import { buildRoute, Autopilot, useGraphForRoutes } from './game/autopilot.js';
import { Cinematic } from './game/cinematic.js';
import { Recorder } from './game/recorder.js';
import { createAudio } from './game/audio.js';
import { createWeather } from './world/weather.js';
import { buildHuman } from './world/human.js';
import { Debris } from './world/breakables.js';

/* Day first. Night is still fully built -- ?night in the URL brings it back --
   but daylight is the honest view: nothing hides behind a lamp glow. */
const DAY = !new URLSearchParams(location.search).has('night');

const canvas = document.getElementById('gl');
/* The boot overlay is static HTML in index.html so it paints before this
   module even parses; from here we narrate the slow phases into it and
   frame() removes it on the first rendered frame. */
let boot = document.getElementById('boot');
const bootMsg = document.getElementById('bootmsg');
const bootSay = (m) => { if (bootMsg) bootMsg.textContent = m; };
bootSay('waking the GPU…');
const renderer = createRenderer(canvas);
/* WebGPU acquires its adapter and device asynchronously, and nothing that
   touches the backend -- PMREM for the sky's environment map, the first
   render, a render target -- may run before that resolves. Top-level await is
   the honest expression of it: the module simply does not finish evaluating
   until the GPU is ready. Vite is on an es2022 target, so this ships. */
await renderer.init();
bootSay('building the city & compiling shaders — the first load is the slow one…');
const resolution = autoResolution(renderer);
/* WebGPURenderer exposes no capabilities.getMaxAnisotropy(); 16 is the
   guaranteed WebGPU maximum and the value the WebGL path was returning here
   anyway. */
setAnisotropy(renderer.capabilities?.getMaxAnisotropy?.() ?? 16);

const scene = createScene(DAY);
/* 900m of far plane was enough for a fogged night grid. Daylight sees the
   mountain ring 5km out, so the frustum has to reach it -- 24-bit depth over
   0.5..14000 still resolves the kerb the car is sitting on. */
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.5, 14000);
const { sun } = createLights(scene, DAY);
const { dome } = createSky(scene, renderer, DAY);
/* Tier 1.1: the grade is now the whole post stack — scene MRT pass, GTAO,
   emissive-fed bloom, tone map, then the vignette/grain/rain folded into the
   same node graph (see core/grade.js). ?noao / ?nobloom drop a stage for an
   A/B against the stats overlay. */
const grade = createGrade(renderer, scene, camera, {
  ao: !new URLSearchParams(location.search).has('noao'),
  bloom: !new URLSearchParams(location.search).has('nobloom'),
  aa: !new URLSearchParams(location.search).has('noaa'),
  post: !new URLSearchParams(location.search).has('nopost'),
});

const assets = createAssets();
/* Kenney Car Kit (CC0) over the lofted fleet -- world/vendorCars.js. Awaited
   here so traffic and the streamer never see a half-swapped kit; a missing
   file leaves that style on the loft and logs once. */
await loadVendorCars(assets).catch((e) => console.warn('vendor cars:', e.message));
grade.resize(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio());
/* Bloom needs no day/night switch: it reads the emissive MRT channel, and
   daylightAssets() below dims facade emissive to 0.04 — under the bloom
   threshold — so at noon only signal lenses and brake lights carry a halo
   while at night the baked-emissive windows and lamps bleed as designed. */
if (DAY) {
  daylightAssets(assets);
  grade.vignette.uniforms.uStrength.value = 0.26;   // noon is not a film noir
  grade.grain.uniforms.uAmount.value = 0.012;
} else {
  /* Night ran genuinely too dark away from lit facades — silhouettes on a
     horizon glow. A nudged exposure lifts the mid-tones without touching the
     look of the emissive windows (they are already past the bloom knee). */
  renderer.toneMappingExposure = 1.15;
}
/* `world` is whatever is currently building geometry. It starts as the old
   procedural grid so the game runs immediately, and is swapped for Halstead
   Bay the moment the district file arrives. Both answer update(x,z). */
/* Every facade bakes its lit windows into an emissive map. At night that IS
   the lighting; at noon a glowing window is the single loudest tell that a
   scene is a night scene with the sun turned up, so it goes away. */
function daylightAssets(A) {
  for (const k of Object.keys(A.facades)) {
    for (const m of A.facades[k]) { m.emissiveIntensity = 0.04; m.envMapIntensity = 0.85; }
  }
  for (const m of A.base.materials) m.emissiveIntensity = 0.05;
  A.mat.pool.opacity = 0;                 // sodium pools on sunlit tarmac: no
  A.mat.lampGlow.emissiveIntensity = 0.15;
  A.mat.sign.emissiveIntensity = 0.06;
  A.mat.windowQuad.emissiveIntensity = 0.0;   // daylight: glass, not lamps
  A.mat.beacon.emissiveIntensity = 0.6;    // a shop sign at noon is a painted board, not a light
  A.mat.road.envMapIntensity = 0.35;
  A.mat.parked.emissiveIntensity = 0;
  A.mat.parked.roughness = 0.42;
  A.mat.parked.envMapIntensity = 0.5;
  // block ground: night navy on a sunlit lot reads as a hole in the world
  A.mat.kerb.color.setHex(0x8d8c83);
  A.mat.walk.color.setHex(0xb9b7ad);
  A.mat.leaf.color.setHex(0x4e6b3a);
  A.mat.bark.color.setHex(0x5b4a3a);
  // the asphalt was painted for sodium light; at noon it reads as tar
  A.mat.tarmac.color.setHex(0xb4b8bd);
  /* Dry asphalt at noon is matte. At 0.42 roughness with envMapIntensity 0.8
     the carriageway mirrored the sky, which is what flattened it: the sheen
     washed straight over the albedo AND the new normal map. Wet tarmac under
     sodium is the NIGHT look and keeps its gloss. */
  A.mat.tarmac.roughness = 0.82;
  A.mat.tarmac.metalness = 0.0;
  A.mat.tarmac.envMapIntensity = 0.25;
}

let world = new City(scene, assets);
/* Destructible street furniture (world/breakables.js). Inert until the
   catalogue resolves and DistrictWorld starts reporting breakable chunks. */
const debris = new Debris(scene);
/* ?debug: expose the live car state for the browser-automation harness —
   closed-loop test drivers need to read position and yaw. Dev-only surface,
   not a save-game: nothing in the game reads it back. */
if (new URLSearchParams(location.search).has('debug')) {
  window.__car = () => car;
  window.__breakNear = (x, z, r = 3) => debris.breakNear(x, z, r, car, 12);
  // frame-time distribution + worst chunk-build slice, for the perf harness
  window.__perf = () => ({ frames: [...stats.samples], chunk: stats.worstChunkMs });
}
let beach = null, water = null, crowd = null, heli = null, districtRef = null, drowning = 0;
let lightPool = null;
let jobs = null;                            // the GTA loop: jobs, cash, heat (game/jobs.js)                       // night: real lights on the nearest lamp heads (game/lighting.js)
const person = buildHuman();
scene.add(person.root);
let muted = false;
let firing = false;
let mission = null;
let net = null;
let bustFlash = 0;
let health = 1;

/**
 * Join or create a room. The URL is the invite: whoever opens it lands in the
 * same city, on the same course, and can see you drive.
 */
async function joinRoom(id) {
  if (net) { net.leave(); net = null; }
  const room = id || createRoom();
  try {
    net = new Multiplayer(scene, room);
  } catch (e) {
    hud.setRoom(`ROOM FAILED — ${e.message}`);
    return;
  }
  net.onRace = (msg) => {
    if (!mission) return;
    // both ends lay the same course from the room's own seed
    if (msg.k === 'start') mission.start(car, msg.seed);
    if (msg.k === 'stop') {
      mission.stop(`BEATEN · ${(msg.t ?? 0).toFixed(1)}s`);
    }
  };
  const url = new URL(location.href);
  url.searchParams.set('room', room);
  hud.setRoom(url.toString());
}
let damage = 0;
/* The middle of Kingsway, the downtown grid. The spawn already used this point
   and death now returns you to it, so it is a constant rather than the same
   pair of magic numbers written out twice. */
const CITY_CENTRE = { x: 2350, z: 1350 };
let dying = 0;

/* Being shot at, and being nicked. Damage is deliberately cosmetic for now --
   a shot rocks the car and marks it; there is no health bar to lose. */
function onShot(gap) {
  audio.gunshot();
  const hit = Math.max(0, 1 - gap / 18);
  if (onFoot.active) {
    // on foot there is no bodywork to absorb it
    health = Math.max(0, health - hit * 0.16);
    hud.setHealth(health);
    grade.setDrops(0.9);
    if (health <= 0) onDeath();
    return;
  }
  car.impact = Math.max(car.impact || 0, 1.6 + hit * 2.2);
  car.yawRate += (Math.random() - 0.5) * hit * 0.9;
  damageModel.hit(2 + hit * 5);
}

/**
 * Put the car somewhere real.
 *
 * resetCar() only resets STATE -- its x/z are the origin of the procedural
 * grid this game stopped using, so pressing R dropped you in an empty corner
 * of the map. Everywhere that resets the car has to say where, and the
 * drowning recovery was the only place that did.
 */
function respawnCar(nearX = car.x, nearZ = car.z, kinds = null) {
  const nodes = districtRef?.graph?.nodes;
  resetCar(car);
  if (nodes) {
    let best = null, bestD = Infinity;
    for (const n of nodes) {
      if (kinds && !kinds.includes(n.kind)) continue;
      const d = Math.hypot(n.x - nearX, n.y - nearZ);
      if (d < bestD) { bestD = d; best = n; }
    }
    if (best) { car.x = best.x; car.z = best.y; }
  }
  car.y = groundHeightAt(car.x, car.z) + 0.62;
  damageModel.repair();
}

/**
 * Killed. Distinct from being arrested: the police take you to a station,
 * a fireball takes you to a hospital.
 */
function onDeath() {
  bustFlash = 2.8;
  jobs?.fail('WASTED · JOB LOST');
  hud.setDead(true);
  traffic.standDown();
  if (mission && mission.active) mission.stop('WASTED');
  health = 1; hud.setHealth(1);
  /* Back to the middle of the city. It used to be the nearest hospital, which
     meant dying in the hills put you back in the hills with the same problem
     waiting for you; downtown is somewhere you can always drive out of. */
  respawnCar(CITY_CENTRE.x, CITY_CENTRE.z);
  if (onFoot.active) onFoot.enter();
  hero.visible = true;
  chase.shake = 0;
}

function onBust() {
  jobs?.fail('BUSTED · JOB LOST');
  bustFlash = 2.6;
  traffic.standDown();
  if (heli) heli.update(car, traffic, 0);
  if (mission && mission.active) mission.stop('BUSTED');
  damageModel.repair();
  health = 1; hud.setHealth(1);
  // wake up outside the nearest station the map knows about
  const stations = (districtRef?.places || []).filter((p) => p.type === 'police');
  const at = stations.reduce((best, p) => {
    const d = Math.hypot(p.x - car.x, p.y - car.z);
    return d < best.d ? { d, p } : best;
  }, { d: Infinity, p: null }).p;
  respawnCar(at ? at.x : car.x, at ? at.y + 14 : car.z);
  if (onFoot.active) onFoot.enter();
  hero.visible = true;
}
const onFoot = new OnFoot(scene);
const weapon = new Weapon(scene);
const skids = new SkidMarks(scene);
const damageModel = new Damage(scene);

/**
 * Pull the trigger. On foot you shoot where you are looking; in the car it is
 * a drive-by along the same sightline, which is why free look and the gun were
 * always going to be the same feature.
 */
function pullTrigger() {
  if (!started || !weapon.ready) return;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const ox = onFoot.active ? onFoot.x : car.x;
  const oz = onFoot.active ? onFoot.z : car.z;
  const oy = onFoot.active ? 1.35 : 1.0;

  const targets = [];
  if (crowd) {
    for (const p of crowd.people) {
      if (p.live && !p.down) targets.push({ x: p.x, z: p.z, y: 0.95, r: 0.55, kind: 'person', ref: p });
    }
  }
  for (const v of traffic.cars) if (v.live) targets.push({ x: v.x, z: v.z, y: 0.8, r: 1.25, kind: 'car', ref: v });
  for (const v of traffic.police) if (v.live) targets.push({ x: v.x, z: v.z, y: 0.8, r: 1.35, kind: 'police', ref: v });

  const hit = weapon.fire(ox, oy, oz, dir.x, dir.y, dir.z, targets);
  crowd?.panic(ox, oz, 24);                     // gunfire scatters the street
  audio.gunshot();
  // firing at all is a crime; hitting something is a worse one
  traffic.reportCrime(hit ? (hit.kind === 'person' ? 'person' : hit.kind === 'police' ? 'police' : 'traffic') : 'traffic',
                      hit ? 9 : 1);
  if (hit && hit.kind === 'person') hit.ref.down = 0.001;
  if (hit && hit.kind !== 'person') {
    hit.ref.speed *= 0.55;
    hit.ref.mesh.material.color.offsetHSL(0, -0.05, -0.04);
  }
}
const walkSolid = makeSolver(
  (x, z) => (world.nearbyBuildings ? world.nearbyBuildings(x, z) : null),
  (x, z) => (world.nearbyParked ? world.nearbyParked(x, z) : []).concat(traffic.bodies()),
);

/**
 * Get out, or get in.
 *
 * Getting in is the whole point: whatever you walk up to becomes the car you
 * are driving. The hero mesh is the only fully-detailed vehicle in the game,
 * so a jack moves the PLAYER into the target's place and repaints the hero to
 * match, rather than promoting a traffic car's simpler body to hero status.
 */
/**
 * Flying. Deliberately arcade: collective on Space/Shift, cyclic on W/S, yaw
 * on A/D. A real helicopter model would be a project of its own and would
 * make the one machine in the city nobody can fly.
 */
let flying = null;          // the helicopter you are in, or null
function flightUpdate(c, dt) {
  const h = flying;
  h.yawA = (h.yawA ?? 0) + ((c.steer || 0) * 1.5 - (h.yawA ?? 0)) * Math.min(1, dt * 3);
  h.heading = (h.heading ?? 0) + h.yawA * dt;

  const push = (c.throttle || 0) - (c.brake || 0);
  const climb = (c.handbrake ? 1 : 0) - (c.hold ? 1 : 0);
  h.vel.y += (climb * 9 - 2.2 - h.vel.y * 0.9) * dt;
  const want = 34 * push;
  h.vel.x += (Math.cos(h.heading) * want - h.vel.x) * Math.min(1, dt * 1.1);
  h.vel.z += (-Math.sin(h.heading) * want - h.vel.z) * Math.min(1, dt * 1.1);

  h.pos.x += h.vel.x * dt;
  h.pos.y = Math.max(1.15, h.pos.y + h.vel.y * dt);
  h.pos.z += h.vel.z * dt;
  if (h.pos.y <= 1.16) h.vel.y = Math.max(0, h.vel.y);

  h.group.position.copy(h.pos);
  h.group.rotation.set(0, h.heading, 0);
  h.group.rotateZ(-h.yawA * 0.3);
  h.group.rotateX(-Math.min(0.3, Math.abs(push) * 0.28) * Math.sign(push || 1));
  h.rotor.rotation.y += dt * 34;
  h.tail.rotation.x += dt * 52;

  // the car rides along underneath so the world keeps streaming around us
  car.x = h.pos.x; car.z = h.pos.z; car.vx = 0; car.vz = 0;

  const back = 15, up = 5.5;
  camera.position.set(
    h.pos.x - Math.cos(h.heading) * back,
    h.pos.y + up,
    h.pos.z + Math.sin(h.heading) * back,
  );
  camera.lookAt(h.pos.x + Math.cos(h.heading) * 12, h.pos.y - 1, h.pos.z - Math.sin(h.heading) * 12);
}

let controlsLockedUntil = 0;

/**
 * The carjack, as beats.
 *
 * Phase 1 of the plan: one interaction built all the way, then copied. Until
 * the Mixamo clips land (docs/MIXAMO-CLIPS.md) the bodies are stand-ins, but
 * the TIMING is the interaction -- door, driver out, you in, door shut, pedals
 * live -- and it is the timing that stops this being a teleport.
 *
 *   0.0s  door swings open
 *   0.5s  the driver is hauled out and hits the tarmac running; the car is yours
 *   1.2s  you are in the seat
 *   2.0s  door shuts
 *   2.6s  pedals live
 */
function carjackSequence(best) {
  const d = hero.userData.doors?.doorFR;
  const at = (ms, fn) => setTimeout(fn, ms);
  controlsLockedUntil = performance.now() + 2600;
  if (d) { d.target = d.open; clearTimeout(d.timer); }
  /* One driver in three does not run: he squares up. Same eject, speed zero,
     facing you -- then a hit lands on you at 1.0s and he legs it at 1.6s.
     Police always fight. */
  const fights = best.hunt || Math.random() < 0.3;
  at(500, () => {
    if (crowd) {
      crowd.eject(best.x, best.z, best.yaw);
      if (fights) {
        const p = crowd.people.find((q) => q.live && q.speed === 2.6 && Math.hypot(q.x - best.x, q.z - best.z) < 3);
        if (p) { p.speed = 0; p.yaw = Math.atan2(-(onFoot.z - p.z), onFoot.x - p.x); p.fighting = true; }
      }
    }
    resetCar(car);
    car.x = best.x; car.z = best.z; car.yaw = best.yaw; car.y = 0.62;
    damageModel.setPaint(best.mesh.material.color.getHex());
    best.live = false; best.mesh.visible = false;
    hero.visible = true;
    /* The wanted system only cares if somebody SAW it. A carjack in front of a
       pavement full of people is a crime; the same carjack on an empty street
       at the edge of the docks is just a car changing hands. Police are their
       own witnesses. */
    if (best.hunt || witnesses(best.x, best.z) > 0) traffic.reportCrime(best.hunt ? 'police' : 'traffic', 6);
  });
  if (fights) {
    at(1000, () => {
      health = Math.max(0, health - 0.12);
      hud.setHealth(health);
      chase.shake = 0.7;
      hud.flash(best.hunt ? 'THE OFFICER FOUGHT BACK' : 'THE DRIVER FOUGHT BACK');
      onFoot.character?.act?.('punch', 0.7);      // you answer in kind
      if (health <= 0) onDeath();
    });
    at(1600, () => {
      if (!crowd) return;
      const p = crowd.people.find((q) => q.fighting);
      if (p) { p.fighting = false; p.speed = 2.6; p.yaw += Math.PI; }
    });
  }
  at(1200, () => { onFoot.enter(); });
  at(2000, () => { if (d) d.target = 0; });
}

/**
 * Breaking into a parked car.
 *
 *   0.0s  punch -- the clip the rig has carried since day one and never played
 *   0.45s the window goes: shards, and the parked instance is taken
 *   1.0s  door swings, you are in
 *   1.8s  door shuts, pedals live at 2.4s
 *
 * Witnesses count here too: glass in front of a crowd is a crime, in an empty
 * street it is a Tuesday.
 */
function breakInSequence(bay) {
  const at = (ms, fn) => setTimeout(fn, ms);
  controlsLockedUntil = performance.now() + 2400;
  onFoot.character?.act?.('punch', 0.9);
  at(450, () => {
    const colour = world.takeParked(bay);
    debris.shatter(bay.x, 1.05, bay.z);
    resetCar(car);
    car.x = bay.x; car.z = bay.z; car.yaw = bay.yaw; car.y = 0.62;
    if (colour !== undefined) damageModel.setPaint(colour);
    hero.visible = true;
    if (witnesses(bay.x, bay.z) > 0) traffic.reportCrime('traffic', 3);
  });
  at(1000, () => { driverDoor(0.8); onFoot.enter(); });
}

/** How many people can see this spot. The wanted system only cares if someone did. */
function witnesses(x, z, radius = 26) {
  if (!crowd) return 0;
  let n = 0;
  for (const p of crowd.people) {
    if (!p.live || p.down) continue;
    if (Math.hypot(p.x - x, p.z - z) < radius) n++;
  }
  return n;
}

/** Swing the driver's door: open, then close after `hold` seconds. */
function driverDoor(hold = 0.9) {
  const d = hero.userData.doors?.doorFR;
  if (!d) return;
  d.target = d.open;
  clearTimeout(d.timer);
  d.timer = setTimeout(() => { d.target = 0; }, hold * 1000);
}

function useVehicle() {
  if (!started) { started = true; hud.dismiss(); }
  if (flying) {                      // step out, wherever you happen to be
    flying.landed = flying.pos.y < 2.5;
    const h = flying;
    flying = null;
    h.group.visible = true;
    onFoot.exit({ x: h.pos.x, z: h.pos.z, yaw: h.heading || 0 });
    return;
  }
  if (onFoot.active) {
    // a landed helicopter beats any car within reach
    if (heli && heli.landed && Math.hypot(heli.pos.x - onFoot.x, heli.pos.z - onFoot.z) < 9) {
      onFoot.enter();
      heli.board();
      heli.group.visible = true;
      heli.heading = heli.group.rotation.y;
      heli.vel.set(0, 0, 0);
      flying = heli;
      hud.flash('AIRBORNE — SPACE up, SHIFT down');
      return;
    }
    // nearest vehicle within reach: your own car, or somebody else's
    const reach = 4.2;
    let best = null, bestD = reach;
    const dOwn = Math.hypot(car.x - onFoot.x, car.z - onFoot.z);
    if (dOwn < bestD) { best = 'own'; bestD = dOwn; }
    for (const list of [traffic.cars, traffic.police]) {
      for (const v of list) {
        if (!v.live) continue;
        const d = Math.hypot(v.x - onFoot.x, v.z - onFoot.z);
        if (d < bestD) { best = v; bestD = d; }
      }
    }
    if (performance.now() < controlsLockedUntil) return;   // one beat at a time
    /* No occupied car in reach: a PARKED one will do, but it is locked. You
       break the window to get in -- the Punch clip finally earns its place --
       and the glass goes, and then the car is yours the same way. */
    if (!best && world.nearbyParked) {
      let bay = null, bd = reach;
      for (const s of world.nearbyParked(onFoot.x, onFoot.z)) {
        if (s.tag !== 'parked' || s.index === undefined) continue;
        const d = Math.hypot(s.x - onFoot.x, s.z - onFoot.z);
        if (d < bd) { bd = d; bay = s; }
      }
      if (bay) { breakInSequence(bay); return; }
    }
    if (!best) return;
    if (best !== 'own') { carjackSequence(best); return; }
    // your own car: door, a beat, then you are in
    driverDoor(1.1);
    controlsLockedUntil = performance.now() + 900;
    setTimeout(() => { onFoot.enter(); hero.visible = true; }, 600);
  } else {
    if (Math.abs(car.fwdSpeed) > 4) return;          // not at speed
    driverDoor(1.4);                       // step out; it swings shut behind you
    onFoot.exit(car);
    car.throttle = 0; car.brake = 1; car.hand = 1;
  }
}
const city = world;                       // legacy alias, same object

/* The authored asset catalogue, loaded alongside the district.
   Failing to load it is survivable -- the city falls back to the procedural
   props -- so this resolves to null rather than rejecting. */
const catalogueReady = new Catalogue().load(renderer)
  .then((c) => {
    console.info(`catalogue: ${c.assets.size} assets, ${c.materials.size} materials`);
    return c;
  })
  .catch((e) => { console.warn('catalogue unavailable:', e.message); return null; });

Promise.all([loadDistrict(), catalogueReady]).then(([district, catalogue]) => {
  useDistrict(district);                  // roadDepth() now answers from the file
  traffic.useGraph(district);
  useGraphForRoutes(district);             // and the fleet drives the real streets
  hud.useDistrict(district);              // minimap draws real streets, not a lattice
  for (const g of city.cells.values()) scene.remove(g);
  city.cells.clear();
  world = new DistrictWorld(scene, assets, district, { day: DAY, catalogue });
  world.camera = camera;                  // chunk-level frustum culling for the render bundles
  if (!DAY) {
    const n = +(new URLSearchParams(location.search).get('lights') ?? 6);
    lightPool = new LightPool(scene, world, { count: n });
    grade.setNight?.(true);
  }
  debris.catalogue = catalogue;
  world.onBreakables = (k, tracked, solids, pools) => debris.registerChunk(k, tracked, solids, pools);
  world.onBreakablesGone = (k) => debris.dropChunk(k);
  /* buildCar CLONES mats.paint so each car keeps its own colour, so dressing
     the shared library material would never reach the car you are driving.
     The hero's own instances have to be handed over by name. */
  if (catalogue) {
    const n = dressCarMaterials(catalogue, {
      ...assets.carMats,
      paint: hero.userData.paint,
      glass: hero.userData.glass?.material,
      shirt: hero.userData.driver?.material,
    });
    console.info(`car materials dressed: ${n}`);
  }
  world.onChunkBuilt = (ms) => stats.reportChunkBuild(ms);
  world.onChunkDone = (ms) => stats.reportChunkTotal(ms);
  water = buildWater(scene, district, DAY);
  buildSurrounds(scene, district.bounds, DAY);
  buildPlaces(scene, district, DAY);
  beach = buildBeach(scene, district, DAY);
  crowd = new Crowd(scene, district);
  heli = new Helicopter(scene, DAY);
  heli.district = district;
  heli.nearbyBuildings = (x, z) => (world.nearbyBuildings ? world.nearbyBuildings(x, z) : []);
  heli.onArrive = () => hud.flash('AIR SUPPORT INBOUND');
  mission = new Mission(scene, district);
  jobs = new Jobs(mission, traffic, hud, district);
  /* The other half of the race handshake: say when YOU finish. Set here
     rather than on join, because the room can be joined before the district
     has loaded and there would be no mission to hang it on. */
  mission.onFinish = (t) => { if (net) net.race({ k: 'stop', t }); };
  traffic.onShot = onShot;
  traffic.onBust = onBust;
  window.district = district;
  districtRef = district;
  // put the car on a real road: the Kingsway node nearest the district centre
  const n = district.graph.nodes.reduce((best, q) =>
    Math.hypot(q.x - CITY_CENTRE.x, q.y - CITY_CENTRE.z)
      < Math.hypot(best.x - CITY_CENTRE.x, best.y - CITY_CENTRE.z) ? q : best);
  resetCar(car);
  car.x = n.x; car.z = n.y; car.y = 0.62;
  world.update(car.x, car.z);
  {
    const rx = Math.sin(car.yaw), rz = Math.cos(car.yaw);
    person.place(car.x + rx * 7.5, car.z + rz * 7.5, car.yaw + Math.PI);
  }
  // now the car is on its spawn node, lay the film route from where it stands
  ROUTE = buildRoute(null, car.x, car.z);
  console.info(`Halstead Bay loaded — spawn at node ${n.id} (${n.x}, ${n.y})`);
}).catch((e) => console.warn('district not loaded, staying on the grid:', e.message));

// ---- the car ----
const car = createCarState();
/* Headlights are automatic: on at night, off at noon. H still overrides —
   the toggle in the input handler flips whatever this set. In daylight the
   two real spotlights were burning cost while being visually invisible. */
car.headlights = !DAY;
const hero = buildCar(assets.carMats, 0x5b636d);
scene.add(hero);
// the damage model marks the real bodywork, so it needs the real meshes
// the hero's visible body is the kit's sports sedan over the lofted physics hull
await loadHeroSkin(assets, hero).catch((e) => console.warn('hero skin:', e.message));
damageModel.attach(hero);

const NOSE_X = CG_X;          // distance from the CG forward to the nose
const headlightBeams = [];
for (const s of [-1, 1]) {
  // three uses physical light units, so a spot needs candela, not the 2.6 that
  // read correctly under the old legacy-lighting model
  // 190cd with a 1.4 falloff put several units of radiance on tarmac ten metres
  // out — far past white once tone-mapped. A dipped beam should light the road,
  // not brand it.
  const spot = new THREE.SpotLight(0xdce8ff, 42, 70, 0.50, 0.85, 1.1);
  // hero space, where +X is forward: the nose sits CG_X ahead of the origin
  spot.position.set(NOSE_X - 0.30, 0.76, s * 0.5);
  // aim the beam far enough down the road that its hot core is not on our own
  // bonnet — the old target met the ground about six metres out and blew white
  spot.target.position.set(NOSE_X + 34, -0.35, s * 2.2);
  hero.add(spot, spot.target);

  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(1.9, 17, 14, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xbcd2ff, transparent: true, opacity: 0.032,
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide, fog: true,
    }),
  );
  cone.rotation.z = Math.PI / 2 + 0.055;
  cone.position.set(NOSE_X + 8.0, 0.62, s * 0.5);
  hero.add(cone);
  headlightBeams.push(spot, cone);
}

const beamPool = new THREE.Mesh(assets.geo.plane, new THREE.MeshBasicMaterial({
  map: assets.poolTexture, transparent: true, blending: THREE.AdditiveBlending,
  depthWrite: false, opacity: 0.20, color: 0xa8c4ff, fog: true,
}));
beamPool.rotation.x = -Math.PI / 2;
beamPool.scale.set(8, 20, 1);
scene.add(beamPool);

const traffic = new Traffic(scene, assets, DAY ? 24 : 30, !DAY);   // Phase 5: denser, and lit at night
const chase = new ChaseCamera(camera);
const weather = DAY ? null : createWeather(scene);
const hud = new Hud();
const stats = new Stats();
const photo = new Photo(camera, stats);

const audio = createAudio();
let started = false;
const start = () => {
  if (!started) { started = true; hud.dismiss(); }
  audio.resume();
};
hud.overlay.addEventListener('click', start);
canvas.addEventListener('click', start);
addEventListener('keydown', start, { once: true });

// ---- cinematic capture ----
let ROUTE = buildRoute([
  { go: 2, turn: 'R' }, { go: 2, turn: 'L' }, { go: 3, turn: 'L' },
  { go: 2, turn: 'R' }, { go: 3, turn: 'R' }, { go: 3, turn: null },
]);
let film = null;

async function startFilm({ record = true } = {}) {
  if (film) return;
  resetCar(car);
  const start = ROUTE[0], next = ROUTE[Math.min(2, ROUTE.length - 1)];
  car.x = start[0]; car.z = start[1];
  car.yaw = Math.atan2(-(next[1] - start[1]), next[0] - start[0]);
  world.update(car.x, car.z);

  const pilot = new Autopilot(ROUTE, { cruise: 26 });
  const shots = new Cinematic();
  const recorder = record && Recorder.supported() ? new Recorder(canvas, { fps: 30 }) : null;
  document.body.classList.add('filming');
  audio.mute(true);
  if (recorder) recorder.start();
  film = { pilot, shots, recorder };
  return film;
}

async function stopFilm({ download = true } = {}) {
  if (!film) return null;
  const { recorder } = film;
  film = null;
  document.body.classList.remove('filming');
  audio.mute(false);
  camera.fov = 58; camera.updateProjectionMatrix();
  if (!recorder) return null;
  const blob = await recorder.stop();
  if (download && blob) Recorder.download(blob);
  return blob;
}

const input = createInput((action) => {
  if (action === 'camera') chase.cycle();
  if (action === 'lights') car.headlights = !car.headlights;
  if (action === 'photo') photo.toggle();
  if (action === 'reset') respawnCar();
  if (action === 'avatar' && onFoot.character) {
    const i = onFoot.character.swap(onFoot.character.index + 1);
    hud.flash(`CHARACTER ${i + 1}/${CHARACTERS.length}`);
  }
  if (action === 'mute') { muted = !muted; audio.mute(muted); }
  if (action === 'use') useVehicle();
  if (action === 'room') joinRoom(roomFromUrl());
  if (action === 'fire') pullTrigger();
  if (action === 'run' && mission) {
    if (!started) { started = true; hud.dismiss(); }
    if (net) {                                   // a room races; alone you work
      if (mission.active) mission.stop('RUN ABANDONED');
      else { mission.start(car); net.race({ k: 'start', seed: mission.seed }); }
    } else jobs?.toggle(car);
  }
  if (action === 'film') { if (film) stopFilm(); else { started = true; hud.dismiss(); startFilm(); } }
});

/* Mouse look. Pointer lock so the view keeps turning past the screen edge;
   click to grab, Escape to let go, and the rig recentres when you drive on. */
canvas.addEventListener('click', () => {
  if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
});
addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== canvas || e.button !== 0) return;
  firing = true;
});
addEventListener('mouseup', () => { firing = false; });

addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  if (photo.on) return photo.look(e.movementX, e.movementY);
  if (onFoot.active) onFoot.look(e.movementX, e.movementY);
  else chase.look(e.movementX, e.movementY);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  grade.resize(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio());
});

// the physics step asks for solid things near the car each tick
/* Pedestrians are deliberately NOT in here. Making a person a solid obstacle
   means a 1480kg car bounces off them like a bollard, which is exactly what it
   felt like -- they are knocked down by the crowd system instead. */
car.obstacles = (x, z) => (world.nearbyParked ? world.nearbyParked(x, z) : [])
  .concat(traffic.bodies());
car.buildings = (x, z) => (world.nearbyBuildings ? world.nearbyBuildings(x, z) : null);

resetCar(car);
city.update(car.x, car.z);
traffic.cars.forEach((t) => traffic.spawn(t, car, true));

// THREE.Clock is deprecated in 0.185 and this needs two lines, not a class
let lastTime = performance.now();
let worldTime = 0;      // shared by the signals and the cars that obey them
const STEP = 1 / 120;
let physicsAccumulator = 0;
let frames = 0, elapsed = 0;

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  // ---- controls ----
  if (film) {
    film.pilot.update(car, dt);
    car.holdGear = false;
  } else {
  const c = input.read();
  if (!started && (c.throttle > 0.08 || c.brake > 0.25 || Math.abs(c.steer) > 0.3)) start();
  if (flying) {
    flightUpdate(c, dt);
    car.throttle = 0; car.brake = 1; car.steerTarget = 0;
  } else if (onFoot.active) {
    onFoot.update(c, dt, camera, walkSolid);
    car.throttle = 0; car.brake = 1; car.steerTarget = 0;
  } else {
  car.holdGear = c.hold;
  /* While a carjack beat is playing the pedals are dead: you are not in the
     seat yet, so the car cannot answer the throttle. Steering stays live so
     the wheel can be seen turning through the open door. */
  const busy = performance.now() < controlsLockedUntil || photo.on;   // WASD flies the camera in photo mode
  const fwdKey = started && !busy ? c.throttle : 0;
  const revKey = started && !busy ? c.brake : 0;
  // The gearbox needs the raw intent, not the pedal, to know when to leave R.
  car.wantsForward = fwdKey > 0.18;
  car.wantsReverse = revKey > 0.18;
  // In reverse the pedals swap: S drives, W slows you. Without this you can
  // select R and then sit there, because S is only ever wired to the brake.
  const inReverse = car.gear === 0;
  const throttleIn = inReverse ? revKey : fwdKey;
  const brakeIn = inReverse ? fwdKey : revKey;
  const lag = c.analogue ? 16 : 11;
  car.throttle += (throttleIn - car.throttle) * Math.min(1, dt * lag);
  car.brake += (brakeIn - car.brake) * Math.min(1, dt * (c.analogue ? 20 : 15));
  car.hand += ((started ? c.handbrake : 0) - car.hand) * Math.min(1, dt * 18);
  car.steerTarget = c.steer;
  }
  }

  /* Breakables go BEFORE the physics step: a lamp post the car is about to
     fell must lose its collision solid before the tyre model resolves against
     it, or the car eats a dead stop on the frame it breaks through. */
  debris.update(car, dt);

  // fixed-step physics keeps the tyre model stable regardless of frame rate
  physicsAccumulator += dt;
  let guard = 0;
  while (physicsAccumulator >= STEP && guard++ < 8) {
    stepVehicle(car, STEP);
    physicsAccumulator -= STEP;
  }

  // ---- pose ----
  // group carries yaw; the body carries the sprung motion; the wheels ride the road
  hero.position.set(car.x, 0, car.z);
  hero.rotation.set(0, car.yaw, 0);
  const body = hero.userData.body;
  /* A flat tyre drops the CAR, not just the wheel. Lowering the hub alone
     pushed the tyre through the tarmac and left the shell at full ride
     height, so the sag has to land on the sprung mass too. */
  let sag = 0;
  for (const w of hero.userData.wheels) sag += (w.flat || 0);
  body.position.y = car.heave - (sag / 4) * WHEEL_R * 0.3;
  // local x is forward and local z is lateral, so roll goes on x and pitch on z
  body.rotation.set(car.roll, 0, car.pitch);
  // doors ease toward their target; a slam is a fast ease, not a snap
  for (const d of Object.values(hero.userData.doors || {})) {
    d.pivot.rotation.y += (d.target - d.pivot.rotation.y) * Math.min(1, dt * d.speed);
  }
  /* Steering ratio ~2.6: a real car turns the wheel about 2.5 times more
     than the road wheels turn, and the interior is visible through the
     glass every second of play. Sign follows the road wheels so a left
     steer is a left hand-over. */
  if (hero.userData.steering) hero.userData.steering.rotation.z = -car.steer * 2.6;
  for (const w of hero.userData.wheels) {
    if (w.front) w.steer.rotation.y = car.steer;
    const idx = (w.front ? 0 : 2) + (w.side > 0 ? 1 : 0);
    w.steer.position.y = (car.wheelGround ? car.wheelGround[idx] : 0)
      + WHEEL_R * (1 - (w.flat || 0) * 0.3);
    w.spin.rotation.z += car.wheelW[idx] * dt;
  }

  hero.userData.tailMat.emissiveIntensity =
    0.5 + car.brake * 3.0 + (car.hand > 0.3 ? 1.2 : 0);
  // gear 0 is reverse (the HUD prints it as R)
  if (hero.userData.reverseMat) hero.userData.reverseMat.emissiveIntensity = car.gear === 0 ? 2.4 : 0;
  const headMat = hero.userData.headMat;
  headMat.emissiveIntensity = car.headlights ? 2.2 : 0;
  for (const b of headlightBeams) {
    if (b.isSpotLight) b.intensity = car.headlights ? 42 : 0;
    else b.visible = car.headlights;
  }

  const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
  beamPool.position.set(car.x + cy * 11, 0.028, car.z - sy * 11);
  beamPool.rotation.z = -car.yaw;
  beamPool.visible = car.headlights;

  worldTime += dt;
  /* Who the police are actually after.
     traffic.update always got the car, so on foot they surrounded and
     arrested an empty parked vehicle while you walked away -- and the
     on-foot control path pins car.brake = 1, which satisfied the "has
     stopped" precondition for the arrest every single frame. */
  const quarry = onFoot.active
    ? { x: onFoot.x, z: onFoot.z, vx: onFoot.vx, vz: onFoot.vz,
        speed: Math.hypot(onFoot.vx, onFoot.vz) }
    : car;
  traffic.update(quarry, dt, worldTime);
  if (world.updateSignals) world.updateSignals(worldTime);
  if (heli && !flying) { heli.update(quarry, traffic, dt); traffic.eyesOn = heli.eyesOn; }
  if (mission) mission.update(onFoot.active ? quarry : car, dt);
  jobs?.update(car, dt);
  if (crowd && !onFoot.active && onPavementAtSpeed(car)) crowd.panic(car.x, car.z, 14);
  if (net) net.update(car, dt);
  weapon.update(dt);
  skids.update(car, car.wheelGround ? car.wheelGround[2] : 0);
  if (firing) pullTrigger();
  if (crowd) crowd.update(car, dt, (speed) => traffic.reportCrime('person', speed));
  if (beach) beach.update(dt);
  if (water) water.update(dt);

  /* The shadow frustum follows the car -- but the daylight rig is a high sun
     and the night rig is a low raking one, and this line was silently putting
     the noon sun 46m off the deck every frame. */
  // the same direction the sky dome paints its disc from (DAY_SUN), so shadows point away from the drawn sun
  if (DAY) sun.position.set(car.x + DAY_SUN.x, DAY_SUN.y, car.z + DAY_SUN.z);
  else sun.position.set(car.x - 90, 46, car.z + 62);
  sun.target.position.set(car.x, 0, car.z);
  sun.target.updateMatrixWorld();
  dome.position.set(car.x, 0, car.z);

  if (film) {
    film.shots.update(car, camera, dt);
    if (film.shots.finished || film.pilot.done) stopFilm();
  } else if (photo.on) {
    photo.update(dt);          // the chase camera is frozen while photo mode owns the view
  } else {
    if (!onFoot.active && !flying) {
      // ease the free look back behind the car once you are driving again
      if (chase.looking && Math.abs(car.fwdSpeed) > 6) {
        const d = 1 - Math.pow(0.35, dt);
        chase.lookYaw -= chase.lookYaw * d;
        chase.lookPitch -= chase.lookPitch * d;
        if (Math.abs(chase.lookYaw) < 0.01 && Math.abs(chase.lookPitch) < 0.01) chase.recentre();
      }
      chase.update(car, dt);
    }
  }
  if (!DAY) weather.update(camera, car, dt);
  lightPool?.update(dt, car.x, car.z, traffic);
  grade.setDrops(DAY ? 0 : chase.mode >= 2 ? 1.2 : 0.68);
  world.update(car.x, car.z);
  resolution(dt);
  /* One render: the pipeline owns the frame (scene MRT pass, GTAO, bloom,
     tone map, grade — core/grade.js). renderer.info accumulates across a
     frame's internal passes and resets once per rAF by the renderer's own
     animation pump, so sampling after the pipeline reads the whole frame —
     scene + shadow passes + ~15 fullscreen post quads. */
  grade.render(renderer, now / 1000);
  // the first real frame is on screen: drop the boot overlay
  if (boot) { boot.remove(); boot = null; }
  stats.sample(renderer);
  /* drawCalls, not calls: `render.calls` counts render-pass INVOCATIONS since
     load and is never reset, so the banner's old "907 DRAWS" was a lifetime
     pass counter that happened to look plausible. `drawCalls` is the real
     per-frame number and matches the F3 overlay. */
  stats.update(dt, world, renderer);
  // counted + replayed-from-bundles: renderer.info alone under-reports by ~75% since the chunks became render bundles
  const draws = renderer.info.render.drawCalls + (stats.snapshot.bundledDraws || 0);
  const tris = renderer.info.render.triangles + (stats.snapshot.bundledTris || 0);
  hud.update(car, traffic, mission, net, heli);
  if (bustFlash > 0) {
    bustFlash -= dt;
    hud.setBusted(bustFlash);
    if (bustFlash <= 0) hud.setDead(false);
  }
  audio.update(car);
  audio.setRain(DAY ? 0 : 1);
  /* Halstead Bay is a harbour city and the car's ground plane is y=0
     everywhere, so without this you simply drive out to sea. Sink, then put
     the car back on the nearest quay -- the map already tags 79 of them. */
  if (districtRef && !drowning && districtRef.inWater(car.x, car.z)) drowning = 0.001;
  if (drowning) {
    drowning += dt;
    car.throttle = 0; car.brake = 0;
    car.vx *= Math.exp(-dt * 2.2); car.vz *= Math.exp(-dt * 2.2);
    hero.position.y = -Math.min(3.4, drowning * 1.7);
    if (drowning > 2.4) {
      respawnCar(car.x, car.z, ['quay', 'cross']);
      hero.position.y = 0;
      drowning = 0;
      traffic.wanted = Math.max(0, traffic.wanted - 1);   // the sea settles some debts
    }
  }

  if (car.hitTag) {
    traffic.reportCrime(car.hitTag, car.hitForce || 0);
    damageModel.hit(car.hitForce || 0, car.hitAt);
    car.hitTag = null; car.hitForce = 0;
  }
  if (car.impact > 2.4) damageModel.hit(car.impact, car.hitAt);
  car.hitAt = null;

  /* Burning, then gone.
     The car warns you and starts a clock. Get out and you live; the wreck
     still goes up. Stay in and it takes you with it. */
  const wasBurning = damageModel.burning;
  const blew = damageModel.update(car, hero.userData.paint, dt);
  if (damageModel.burning && !wasBurning) hud.flash('ENGINE ON FIRE — F TO GET OUT');
  if (damageModel.burning && !onFoot.active && !flying) {
    const left = damageModel.secondsLeft;
    if (left < 5) hud.flash(`GET OUT — ${left.toFixed(1)}s`);
  }
  if (blew) {
    damageModel.explode(car.x, car.z);
    audio.thud ? audio.thud(9) : audio.gunshot();
    // anything close gets shoved
    for (const v of traffic.cars.concat(traffic.police)) {
      if (!v.live) continue;
      const d = Math.hypot(v.x - car.x, v.z - car.z);
      if (d < 14) { v.speed *= 0.3; v.x += (v.x - car.x) / d * 3; v.z += (v.z - car.z) / d * 3; }
    }
    if (crowd) for (const p of crowd.people) {
      if (p.live && Math.hypot(p.x - car.x, p.z - car.z) < 12) p.down = 0.001;
    }
    if (onFoot.active || flying) {
      // you got out in time
      hud.flash('THE CAR IS GONE');
      chase.shake = 0.9;
      respawnCar(car.x + 30, car.z + 30);
    } else {
      /* You do not blink and reappear downtown. The blast plays, you watch the
         car you were sitting in come apart, and only then does the screen go
         black. Cutting on the same frame as the explosion hid the one piece of
         feedback that explains why you died. */
      dying = 1.15;
      chase.shake = 1.4;
      hero.visible = false;
    }
  }

  if (dying > 0) {
    dying -= dt;
    car.throttle = 0; car.brake = 1;
    if (dying <= 0) { dying = 0; hud.blackout(onDeath); }
  }
  car.impact *= Math.exp(-dt * 8);

  frames++; elapsed += dt;
  if (elapsed > 0.5) {
    const fps = Math.round(frames / elapsed);
    frames = 0; elapsed = 0;
    hud.setStats(
      `${fps} FPS · ${draws} DRAWS · ` +
      `${(tris / 1000).toFixed(0)}K TRIS` +
      (padConnected() ? ' · PAD' : ''),
    );
  }
}
frame();

// handy for poking at the sim from the console
Object.assign(window, {
  THREE, scene, renderer, camera, car, city, traffic, chase, start,
  startFilm, stopFilm, Recorder, grade, audio, weather, signalState, onFoot,
  weapon, pullTrigger, skids, damageModel, useVehicle, debris, photo,
});
// defineProperty, not Object.assign: assign copies a getter's VALUE once, so
// window.film would be frozen at null for the life of the page
Object.defineProperty(window, 'film', { get: () => film, configurable: true });
Object.defineProperty(window, 'worldTime', { get: () => worldTime, configurable: true });
// same reason: these are all assigned long after this module finishes
// ROUTE is reassigned once the district loads, so it needs a getter too --
// Object.assign would freeze the pre-district lattice route on window forever
for (const k of ['heli', 'crowd', 'beach', 'water', 'world', 'mission', 'net', 'flying', 'ROUTE', 'stats', 'jobs']) {
  Object.defineProperty(window, k, {
    get: () => ({ heli, crowd, beach, water, world, mission, net, flying, ROUTE, stats, jobs })[k],
    configurable: true,
  });
}

/* Not on 'load': this is a deferred module, so by the time it evaluates the
   load event has usually already fired and the listener never runs. */
if (roomFromUrl()) joinRoom(roomFromUrl());

if (new URLSearchParams(location.search).has('film')) {
  addEventListener('load', () => { started = true; hud.dismiss(); startFilm(); });
}
