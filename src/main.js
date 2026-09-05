import * as THREE from 'three';
import { additive } from './core/additive.js';
import './style.css';

import { autoResolution, createRenderer, createScene, createLights, DAY_SUN } from './core/renderer.js';
import { createSky } from './core/sky.js';
import { createGrade } from './core/grade.js';
import { setAnisotropy } from './world/textures.js';
import { createAssets } from './world/assets.js';
import { loadVendorCars, loadHeroSkin, KENNEY_CARS } from './world/vendorCars.js';
import { LightPool } from './game/lighting.js';
import { Jobs, onPavementAtSpeed } from './game/jobs.js';
import { Garage } from './game/garage.js';
import { StoryManager } from './game/storyMissions.js';
import { ReputationSystem } from './game/reputation.js';
import { IntelScanner } from './game/intel.js';
import { Phone } from './ui/phone.js';
import { VehicleVFX } from './vehicle/vfx.js';
import { PuddleSystem } from './world/puddles.js';
import { People } from './game/people.js';
import { Roadblock } from './game/roadblock.js';
import { Radio } from './game/radio.js';
import { loadKitBuildings } from './world/kitBuildings.js';
import { Metro } from './world/metro.js';
import { Landmarks } from './world/landmarks.js';
import { BillboardSystem } from './world/billboards.js';
import { StreetLife } from './world/streetLife.js';
import { Airspace } from './world/airspace.js';
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
import { Vehicle, CarVehicle } from './game/vehicle.js';
import { HelicopterVehicle } from './game/flight.js';
import { TankVehicle } from './game/tank.js';
import { DispatchService } from './game/dispatch.js';
import { groundHeightAt } from './world/metrics.js';
import { CG_X, WHEEL_R } from './vehicle/config.js';
import { ChaseCamera } from './game/camera.js';
import { createInput, padConnected, rumble } from './game/input.js';
import { Traffic, policeMaterials } from './game/traffic.js';
import { Crowd } from './game/crowd.js';
import { Helicopter } from './game/helicopter.js';
import { OnFoot, makeSolver } from './game/onfoot.js';
import { CHARACTERS, NAMED_CHARACTERS } from './game/character.js';
import { Navigation } from './game/navigation.js';
import { GameClock } from './game/clock.js';
import { Mission } from './game/mission.js';
import { Multiplayer, roomFromUrl, createRoom } from './game/multiplayer.js';
import { Weapon } from './game/weapon.js';
import { ARSENAL, WEAPON_KINDS, buildWeaponMesh, weaponMaterial } from './game/weapons.js';
import { officerMaterial } from './world/officer.js';
import { Modes } from './game/modes.js';
import { Grenades, BLAST_R, KILL_R, HURT_R, blastFalloff } from './game/grenade.js';
import { Crosshair, DecalPool, ADS, ADS_BLEND_S, spreadToPixels, spreadFor, recoilFor, firstBuildingHit, swayFor, swayPhaseStep, reloadPose, movementSpread, aimAssist } from './game/shooting.js';
import { Tracers } from './game/tracers.js';
import { Puffs } from './world/puffs.js';
import { tokyoMaterial, setTokyoNight } from './world/tokyo.js';
import { glow } from './core/additive.js';
import { absorb } from './game/policeAi.js';
import { SkidMarks } from './world/skidmarks.js';
import { Damage } from './game/damage.js';
import { signalState } from './world/signals.js';
import { Hud } from './ui/hud.js';
import { Chat } from './ui/chat.js';
import { CommandEngine } from './game/commands.js';
import { ChatterEngine } from './game/chatter.js';
import { Stats } from './ui/stats.js';
import { Photo } from './game/photo.js';
import { buildRoute, Autopilot, useGraphForRoutes } from './game/autopilot.js';
import { Cinematic } from './game/cinematic.js';
import { Recorder } from './game/recorder.js';
import { createAudio } from './game/audio.js';
import { createWeather, rainSpell } from './world/weather.js';
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
const bootProgress = document.getElementById('bootprogress');
const bootPercent = document.getElementById('bootpercent');
// whatever happens, the loading screen is gone inside 12 s
setTimeout(() => { if (boot) { console.warn('boot: 12 s cap hit, dropping the loading screen'); boot.remove(); boot = null; } }, 12000);
const setBootProgress = (pct, m) => {
  if (bootMsg) bootMsg.textContent = m;
  if (bootProgress) bootProgress.style.width = `${pct}%`;
  if (bootPercent) bootPercent.textContent = `${pct}%`;
};
setBootProgress(10, 'Waking the GPU…');
const renderer = createRenderer(canvas);
setBootProgress(25, 'Starting the renderer…');
await renderer.init();
setBootProgress(45, 'Building the scene & lights…');
const resolution = autoResolution(renderer);
setAnisotropy(renderer.capabilities?.getMaxAnisotropy?.() ?? 16);

const scene = createScene(DAY);
window.scene = scene;
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.5, 14000);
const { sun, hemi } = createLights(scene, DAY);
const { dome, stars } = createSky(scene, renderer, DAY);

setBootProgress(60, 'Initializing TSL post-processing pipeline…');
const isLite = typeof location !== 'undefined' && new URLSearchParams(location.search).has('lite');
const grade = createGrade(renderer, scene, camera, {
  ao: !isLite && !new URLSearchParams(location.search).has('noao'),
  bloom: !new URLSearchParams(location.search).has('nobloom'),
  aa: !new URLSearchParams(location.search).has('noaa'),
  post: !new URLSearchParams(location.search).has('nopost'),
});

const assets = createAssets();
setBootProgress(75, 'Loading car fleet…');
await loadVendorCars(assets).catch((e) => console.warn('vendor cars:', e.message));
setBootProgress(90, 'Reading the city plan…');
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
  // shooting-layer state the harness cannot otherwise see or set (pointer lock is refused headless)
  window.__dbg = () => ({ started, aiming, ads, crouch, burst, heat: weapon.heat, ready: weapon.ready, kind: weapon.kind, ammo: weapon.ammo, health });
  window.__aim = (v) => { aiming = !!v; };
  window.__police = () => traffic.police.filter((c) => c.live).map((c) => ({ deployed: !!c.deployed, state: c.state, gun: c.gunKind, hp: c.hp, down: +c.down.toFixed(1), pose: c.pose, d: Math.round(Math.hypot(c.x - (onFoot.active ? onFoot.x : car.x), c.z - (onFoot.active ? onFoot.z : car.z))) }));
  window.__wanted = (n) => { traffic.wanted = n; };
  window.__breakNear = (x, z, r = 3) => debris.breakNear(x, z, r, car, 12);
  // frame-time distribution + worst chunk-build slice, for the perf harness
  window.__perf = () => ({ frames: [...stats.samples], chunk: stats.worstChunkMs });
}
let beach = null, water = null, crowd = null, heli = null, districtRef = null, drowning = 0;
let districtFailed = false;
let spawnSnap = false;        // the frame loop snaps the chase camera on its next update (chase is declared later; see the top-level awaits)   // lets the boot gate drop on the legacy grid if the district never lands
let lightPool = null;
let jobs = null, garage = null, story = null, phone = null, dispatch = null, reputation = null, intelScanner = null;
let activeVehicle = null;
let chat = null, chatter = null, commands = null;
let vehicleVFX = null, puddles = null;
let people = null;
let hornCooldown = 0;
let warming = false;
let roadblock = null, metro = null, landmarks = null;
let billboards = null, streetLife = null, airspace = null;
let photo = null;
let radio = null;                           // generative car radio (game/radio.js), built once audio exists
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
  net.onChatMessage = (text, author, channel) => {
    chat?.post(channel || 'PEER', text, author);
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
function onShot(gap, landed = null, damage = 26, from = null, kind = 'pistol') {
  audio.gunshot(Math.max(0.12, 1 - gap / 70), kind);   // quieter and duller with distance, in the weapon's voice
  // a landed round tells you which way it came from, as a wedge on the screen edge
  if (from) {
    const px = onFoot.active ? onFoot.x : car.x, pz = onFoot.active ? onFoot.z : car.z; const look = onFoot.active ? onFoot.camYaw : car.yaw;
    const bearing = Math.atan2(-(from.z - pz), from.x - px) - look;
    if (landed) hud.hitFrom?.(bearing);
    else if (gap < 32 && Math.random() < 0.6) { audio.whiz?.(-Math.sin(bearing)); if (onFoot.active) onFoot.camYaw += (Math.random() - 0.5) * 0.012; }   // and you flinch a hair   // a near miss you hear go past, on the side it came from (if it sounds mirrored, the sign here is the fix)
  }
  /* Aimed fire (game/policeAi.js): `landed` says whether THIS shot connected,
     and `damage` is the weapon's. The old distance-only field is kept as the
     fallback for any caller that has not been given a line of sight. */
  const hit = landed === null ? Math.max(0, 1 - gap / 18) : (landed ? damage / 26 : 0);
  if (hit > 0) { lastHurtAt = performance.now(); hurtPulse = Math.min(1, 0.45 + hit * 0.5); }
  if (landed === false) return;                    // a miss: the shot is heard, nothing else
  if (landed && from) {
    // where it landed, you see it: blood off you on foot, sparks off the bodywork in the car
    const px = onFoot.active ? onFoot.x : car.x, pz = onFoot.active ? onFoot.z : car.z;
    const dl = Math.hypot(px - from.x, pz - from.z) || 1, ddx = (px - from.x) / dl, ddz = (pz - from.z) / dl;
    if (onFoot.active) weapon.bloodAt?.(px - ddx * 0.2, (onFoot.y || 0) + 1.1, pz - ddz * 0.2, ddx, ddz);
    else weapon.sparksAt?.(px - ddx * 1.2 + (Math.random() - 0.5) * 1.4, 0.9 + Math.random() * 0.5, pz - ddz * 1.2 + (Math.random() - 0.5) * 1.4, ddx, ddz);
  }
  if (onFoot.active && landed) {
    onFoot.character?.flinch?.();   // the body reacts before the number does
    // and so does the camera: a pitch kick scaled by the round, recovering with the usual look damping
    onFoot.camPitch = Math.min(0.9, onFoot.camPitch + 0.035 * Math.min(2, damage / 26));
    onFoot.camYaw += (Math.random() - 0.5) * 0.05;
  }
  if (onFoot.active) {
    // on foot there is no bodywork to absorb it -- unless you bought some
    const a = absorb(armour, hit * 0.16); armour = Math.max(0, armour - a.toArmour);
    health = Math.max(0, health - a.toHealth);
    hud.setHealth(health);
    grade.setDrops(0.9);
    if (health <= 0) onDeath();
    return;
  }
  car.impact = Math.max(car.impact || 0, 1.6 + hit * 2.2);
  car.yawRate += (Math.random() - 0.5) * hit * 0.9;
  damageModel.hit(2 + hit * 5);
  // from three stars they shoot for the tyres: one landed round in eight takes one out, and it stays out until the garage
  if (traffic.wanted >= 3 && Math.random() < 0.125) {
    const ws = (hero.userData.wheels || []).filter((w) => !w.shot);
    if (ws.length) { ws[Math.floor(Math.random() * ws.length)].shot = 1; hud.flash('TYRE SHOT OUT'); audio.thud?.(10); }
  }
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
  spawnSnap = true;
}

/**
 * Killed. Distinct from being arrested: the police take you to a station,
 * a fireball takes you to a hospital.
 */
function onDeath() {
  /* On foot, the body falls first and the fade follows: the Death clip runs,
     input is dead, then the respawn. In a car it is the old instant fade. */
  if (onFoot.active && wastedAnim === 0 && onFoot.character?.ready) {
    const ms = onFoot.character.die();
    if (ms > 0) { wastedAnim = 1; controlsLockedUntil = performance.now() + ms + 300; setTimeout(() => { wastedAnim = 2; onDeath(); }, ms + 300); return; }
  }
  if (wastedAnim === 1) return;        // the clip is still playing; the timer will call us back
  wastedAnim = 0;                      // 2 -> 0: the animation ran, now the real WASTED path
  bustFlash = 2.8;
  /* The hospital bills you: GTA's rule, and the reason a death costs something
     when the ammo comes back with you. Never more than you have. */
  if (garage && garage.cash > 0) { const fee = Math.min(garage.cash, 500); garage.addCash(-fee, 'HOSPITAL'); hud.flash(`HOSPITAL FEE · -$${fee}`); }
  jobs?.fail('WASTED · JOB LOST');
  hud.setDead(true);
  traffic.standDown();
  if (mission && mission.active) mission.stop('WASTED');
  health = 1; hud.setHealth(1);
  // Wake up outside the nearest hospital
  const hospitals = (districtRef?.places || []).filter((p) => p.type === 'hosp');
  const at = hospitals.reduce((best, p) => {
    const d = Math.hypot(p.x - car.x, p.y - car.z);
    return d < best.d ? { d, p } : best;
  }, { d: Infinity, p: null }).p;
  respawnCar(at ? at.x : CITY_CENTRE.x, at ? at.y + 12 : CITY_CENTRE.z);
  if (onFoot.active) onFoot.enter();
  hero.visible = true;
  chase.shake = 0;
}

function onBust() {
  /* The station takes your guns (GTA's classic): reserves to zero, grenades
     gone, armour off; you walk out with the pistol and one magazine. Cash
     stays -- the fine is the confiscation. */
  for (const k of WEAPON_KINDS) { weapon.reserve[k] = 0; if (k !== 'pistol') weapon.mags[k] = 0; }
  weapon.mags.pistol = ARSENAL.pistol.mag; weapon.switchTo('pistol'); held = 'gun';
  grenades.count = 0; armour = 0; refreshHeldGun(); saveArsenal();
  hud.flash('BUSTED · WEAPONS CONFISCATED');
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
window.onFoot = onFoot;   // the phone's range card reads where you stand
const weapon = new Weapon(scene);
/* The feel layer (game/shooting.js). aiming is the right mouse button held;
   ads blends 0..1 over ADS_BLEND_S so the sights come UP rather than snap.
   burst counts shots since you last let go, which is what indexes the recoil
   pattern; it resets after 0.4 s of not firing. */
const crosshair = new Crosshair();
const decals = new DecalPool(scene);
const tracers = new Tracers(scene);        // every round in the air, one draw
weapon.tracers = tracers;                  // yours too: the one-frame line in weapon.js is the fallback
const puffs = new Puffs(scene);            // smoke and dust: muzzles, blasts, dead engines
const bloodDecals = new DecalPool(scene, { color: 0x4a0709, radius: 0.32, roughness: 0.55 });   // pools under the fallen
/* Slot 5. In grenade mode E throws instead of firing; any digit 1-4 puts a gun
   back in your hand. The blast goes through the same debris system as the car
   and the tank, so a bin flies the same way whoever broke it. */
const grenades = new Grenades(scene, weapon.light);   // shares the muzzle-flash light
/* What is in your hands: 'fists' | 'gun' | 'grenade'. One value, so the
   three cannot disagree the way two booleans could after a pickup or a buy. */
let held = 'gun', punchCool = 0;
let wasReloading = false;
let lastArsKey = '';
let wastedAnim = 0;   // 0 idle, 1 Death clip playing, 2 clip done -> run the WASTED path once   // slot 0: bare hands. E swings at whoever is in front of you
grenades.onBlast = (bx, by, bz) => {
  for (let i = 0; i < 10; i++) { const a = Math.random() * Math.PI * 2, rr = Math.random() * 1.6; puffs.puff(bx + Math.cos(a) * rr, by + 0.5 + Math.random(), bz + Math.sin(a) * rr, { r: 0.14, g: 0.13, b: 0.12, life: 2.4 + Math.random() * 1.5, vy: 1.4 + Math.random(), vx: Math.cos(a) * 1.2, vz: Math.sin(a) * 1.2 }); }
  debris.breakNear(bx, bz, BLAST_R, car, 30);
  decals.stamp(bx, groundHeightAt(bx, bz) + 0.02, bz, 0, 1, 0, 34);   // the scorch: the bullet-hole disc at ~2 m
  // vehicles in the blast: shoved, and four rounds' worth off the engine (small damage, no fireballs -- Arun's rule)
  for (const v of [...traffic.cars, ...traffic.police]) {
    if (!v.live) continue;
    const d = Math.hypot(v.x - bx, v.z - bz);
    if (d >= BLAST_R) continue;
    const k = blastFalloff(d, BLAST_R);
    v.speed = (v.speed || 0) * (1 - 0.6 * k);
    v.vhp = (v.vhp ?? 8) - Math.round(4 * k + 1);
    if (v.vhp <= 0 && v.cruise !== 0) { v.vhp = 0; v.cruise = 0; v.baseCruise = 0; v.fleeT = 0; if (v.hunt === undefined || !v.hunt) crowd?.eject(v.x, v.z, v.yaw); }
    v.mesh?.material?.color?.offsetHSL(0, -0.1, -0.12 * k);
  }
  for (const c of traffic.police) {
    if (!c.live || !c.deployed || c.down > 0) continue;
    if (Math.hypot(c.officer.position.x - bx, c.officer.position.z - bz) < KILL_R) traffic.officerHit?.(c, 100);
  }
  for (const m of traffic.marks ?? []) if (Math.hypot(m.group.position.x - bx, m.group.position.z - bz) < KILL_R && Math.abs(m.group.position.y - by) < 6) traffic.hitMark?.(m, 100);
  for (const p of roadblock?.posts ?? []) if (roadblock.block && p.down <= 0 && Math.hypot(p.group.position.x - bx, p.group.position.z - bz) < KILL_R) roadblock.hitPost?.(p, 100);
  const px = onFoot.active ? onFoot.x : car.x, pz = onFoot.active ? onFoot.z : car.z;
  const dp = Math.hypot(px - bx, pz - bz);
  if (dp < HURT_R) onShot(dp, true, 26 * 3.5 * blastFalloff(dp, HURT_R), { x: bx, z: bz });
  if (onFoot.active) onFoot.camPitch = Math.min(0.9, onFoot.camPitch + 0.08 * blastFalloff(dp, 14)); else chase.shake += 0.8 * blastFalloff(dp, 20);
  crowd?.panic(bx, bz, 34);
  const dc = Math.hypot(car.x - bx, car.z - bz);
  if (dc < 9) damageModel?.hit?.(4 + 14 * blastFalloff(dc, 9), { x: bx, z: bz });   // your own car takes the blast, dents included
  for (const v of traffic.cars) {   // drivers near a blast floor it
    if (!v.live || Math.hypot(v.x - bx, v.z - bz) > 30) continue;
    v.baseCruise ??= v.cruise; v.cruise = Math.max(v.cruise, v.baseCruise * 1.7); v.fleeT = 10;
  }
  traffic.reportCrime('traffic', 6);
  chatter?.radioPool?.('blast');
  audio.thud?.(40); audio.gunshot();
  weapon.bloodAt?.(bx, by + 0.3, bz, 0, 0);   // reuse the pool for a dark puff of debris
};
let modes = null;   // range / hold-out, built once the HUD and traffic exist
let aiming = false, ads = 0, burst = 0, sinceShot = 9, swayPhase = 0, crouch = false;
let lastFiredAt = -1e9;   // officers advance when you have been quiet for a while
let lastHurtAt = -1e9;    // health regenerates to half once this is six seconds old
let healTick = 0;
let skidT = 0;            // tyre-smoke cadence
let farShotT = 25;        // distant gunfire cadence (ambient, night)
let farSirenT = 70;       // distant siren cadence (ambient, any hour)
let rainHeard = null;     // last rain amount handed to the audio
let tokyoAmbT = 0;        // district-ambience poll cadence
let clockRestored = false;
let lastDistrict = null, distT = 0;  // for the area toast and the dispatch call-out on a district change (polled twice a second)
let vigilante = null;     // { f: fugitive car, t: seconds left } while a patrol chase near you is yours to finish
let hurtPulse = 0;        // the red edge on the frame, decays each frame (grade.setHurt)
let armour = 0;           // body armour 0..1, bought at Ammu-Nation, soaks 60% of a hit until gone
/* The arsenal survives a reload of the page like cash and the garage do. */
try { const d = JSON.parse(localStorage.getItem('hb.arsenal') || 'null'); if (d) { weapon.restore(d); grenades.count = d.grenades ?? grenades.count; armour = d.armour ?? 0; } } catch { /* private mode */ }
let arsenalSaveT = 0;
addEventListener('pagehide', () => { saveArsenal(); try { localStorage.setItem('hb.clock', clock.hour.toFixed(3)); } catch { /* private mode */ } });
let lastArsenalJson = '';
function saveArsenal() { try { const j = JSON.stringify({ ...weapon.serialize(), grenades: grenades.count, armour }); if (j !== lastArsenalJson) { lastArsenalJson = j; localStorage.setItem('hb.arsenal', j); } } catch { /* private mode */ } }
const _rayHit = new THREE.Vector3();
const _hand = new THREE.Vector3();   // the skinned hero's palm, when the rig is up
/* The gun you are actually holding.
   NOT parented to onFoot.group: that group is the blocky stand-in body, and
   onfoot.js hides it the moment the skinned character finishes loading, which
   would take the weapon with it. Scene-level and placed each frame from the
   player's own position and look direction instead, so it survives whichever
   body is on screen. Rebuilt only when the weapon changes -- four meshes over
   a session, not one a frame. */
let heldGun = null;
function refreshHeldGun() {
  if (heldGun) { scene.remove(heldGun); heldGun = null; }
  heldGun = buildWeaponMesh(weapon.kind);
  heldGun.visible = false;
  scene.add(heldGun);
}
function placeHeldGun() {
  if (!heldGun) return;
  if (!onFoot?.active) { heldGun.visible = false; return; }
  /* onFoot.yaw is the BODY's facing (atan2 of its velocity, onfoot.js:109) and
     camYaw is where you are looking. Using camYaw put the weapon at world +X
     whenever you stood still, which is nowhere near the hand. */
  const yaw = onFoot.yaw ?? 0;
  const fx = Math.cos(yaw), fz = -Math.sin(yaw);
  const sx = Math.cos(yaw + Math.PI / 2), sz = -Math.sin(yaw + Math.PI / 2);
  // right hand: forward of the chest and out to the side, same convention as
  // the officer's stance in traffic.js
  const sw = swayFor(onFoot.speed ?? 0, swayPhase, ads > 0.5);
  const rl = weapon.reloading ? reloadPose(1 - weapon.reloadT / weapon.spec.reload) : { dy: 0, tilt: 0 };
  const lift = 0.22 * ads, inward = 0.12 * ads, drop = crouch ? 0.30 : 0;   // sights to the eye line, down when crouched
  /* Prefer the animated hand: when the skinned hero is up, the palm bone's
     world position is where the gun goes, so it walks, runs and jumps with the
     arm. The offsets below are the fallback for the blocky stand-in body. */
  if (onFoot.character?.ready && onFoot.character.handWorldPosition(_hand)) {
    heldGun.position.set(_hand.x + fx * 0.06 + sw.dx * 0.5, _hand.y + 0.02 + lift * 0.4 + sw.dy * 0.5 + rl.dy, _hand.z + fz * 0.06);
  } else {
    heldGun.position.set(
      onFoot.x + fx * (0.26 + 0.06 * ads) + sx * (0.20 - inward + sw.dx), (onFoot.y || 0) + 1.14 + lift + sw.dy + rl.dy - drop,
      onFoot.z + fz * (0.26 + 0.06 * ads) + sz * (0.20 - inward + sw.dx));
  }
  heldGun.rotation.set(sw.roll, yaw, -rl.tilt);
  heldGun.visible = held === 'gun';   // the one place that decides it
  heldGun.visible = true;
}
refreshHeldGun();                   // the pistol you start the game holding
const skids = new SkidMarks(scene);
const damageModel = new Damage(scene);

/**
 * Pull the trigger. On foot you shoot where you are looking; in the car it is
 * a drive-by along the same sightline, which is why free look and the gun were
 * always going to be the same feature.
 */
const _triggerDir = new THREE.Vector3();
const _triggerTargets = [];
function pullTrigger() {
  if (!started) return;
  if (held === 'fists' && onFoot.active) {
    /* A swing: anyone within 1.7 m and 60 degrees of your facing takes 18. A
       pedestrian goes down, an officer staggers or drops, a car gets a dent
       and a very cross driver (a crime, quietly). */
    if (punchCool > 0) return;
    punchCool = 0.45;
    onFoot.character?.punch?.();
    const fx = Math.cos(onFoot.camYaw), fz = -Math.sin(onFoot.camYaw);
    let best = null, bd = 1.7;
    const consider = (x, z, kind, ref) => { const dx = x - onFoot.x, dz = z - onFoot.z, d = Math.hypot(dx, dz); if (d < bd && (dx * fx + dz * fz) / (d || 1) > 0.5) { bd = d; best = { kind, ref, x, z }; } };
    if (crowd) for (const p of crowd.people) if (p.live && !p.down) consider(p.x, p.z, 'person', p);
    for (const v of traffic.police) if (v.live && v.deployed && !v.down) consider(v.officer.position.x, v.officer.position.z, 'officer', v);
    for (const v of traffic.cars) if (v.live) consider(v.x, v.z, 'car', v);
    if (!best) return;
    audio.thud?.(6);
    if (best.kind === 'person') { best.ref.down = 0.001; crowd?.panic(onFoot.x, onFoot.z, 14); traffic.reportCrime('person', 3); }
    else if (best.kind === 'officer') { if (traffic.officerHit?.(best.ref, 18)) hud.flash('OFFICER DOWN'); traffic.reportCrime('police', 4); }
    else { traffic.reportCrime('traffic', 1); }
    weapon.bloodAt?.(best.x, 1.2, best.z, fx, fz);
    return;
  }
  if (held === 'grenade') {
    if (!grenades.ready) { hud.flash(grenades.count ? 'ARM IN THE AIR' : 'NO GRENADES'); return; }
    camera.getWorldDirection(_triggerDir);
    const gx = onFoot.active ? onFoot.x : car.x, gz = onFoot.active ? onFoot.z : car.z, gy = (onFoot.active ? (onFoot.y || 0) + 1.5 : 1.2);
    grenades.throw(gx + _triggerDir.x * 0.6, gy, gz + _triggerDir.z * 0.6, _triggerDir.x, _triggerDir.y, _triggerDir.z);
    if (onFoot.active) onFoot.character?.flinch?.();   // the throw clip we do not have, borrowed from the hit
    return;
  }
  if (!weapon.ready) return;
  camera.getWorldDirection(_triggerDir);
  const ox = onFoot.active ? onFoot.x : car.x;
  const oz = onFoot.active ? onFoot.z : car.z;
  const oy = onFoot.active ? ((onFoot.y || 0) + 1.35) : 1.0;

  _triggerTargets.length = 0;
  if (crowd) {
    for (const p of crowd.people) {
      if (p.live && !p.down) _triggerTargets.push({ x: p.x, z: p.z, y: 0.95, r: 0.55, kind: 'person', ref: p });
    }
  }
  for (const v of traffic.cars) if (v.live) _triggerTargets.push({ x: v.x, z: v.z, y: 0.8, r: 1.25, kind: 'car', ref: v });
  for (const v of traffic.police) {
    if (!v.live) continue;
    _triggerTargets.push({ x: v.x, z: v.z, y: 0.8, r: 1.35, kind: 'police', ref: v });
    // an officer out of the car is his own target: chest height, crouched is lower and smaller
    if (v.deployed && v.officer?.visible && !v.down) {
      const crouched = v.pose === 'crouch';
      _triggerTargets.push({ x: v.officer.position.x, z: v.officer.position.z, y: v.officer.position.y + (crouched ? 0.75 : 1.15), r: crouched ? 0.34 : 0.42, kind: 'officer', ref: v });
      // the head is its own, smaller target: three times the damage, so a marksman's shot is a marksman's shot
      _triggerTargets.push({ x: v.officer.position.x, z: v.officer.position.z, y: v.officer.position.y + (crouched ? 1.22 : 1.62), r: 0.13, kind: 'officer', head: true, ref: v });
    }
  }

  /* A tower stops a bullet. Find the first building face along the sightline
     and drop every target beyond it, then let the weapon pick among the rest.
     The miss lands a decal on that face, or on the ground if the shot dips. */
  const dx = _triggerDir.x, dy = _triggerDir.y, dz = _triggerDir.z;
  const wall = districtRef && world.nearbyBuildings
    ? firstBuildingHit(ox, oy, oz, dx, dy, dz, world.nearbyBuildings(ox, oz), weapon.spec.range)
    : Infinity;
  // a parked car in the way is a wall too: nearest sphere along the ray
  let carT = Infinity;
  if (world.nearbyParked) {
    for (const s of world.nearbyParked(ox, oz)) {
      if (s.tag !== 'parked') continue;
      const px = s.x - ox, py = 0.8 - oy, pz = s.z - oz, along = px * dx + py * dy + pz * dz;
      if (along < 1 || along > carT) continue;
      const cx = px - dx * along, cy = py - dy * along, cz = pz - dz * along;
      if (Math.hypot(cx, cy, cz) < (s.radius ?? 1) + 0.25) carT = along;
    }
  }
  const wall2 = Math.min(wall, carT);
  if (carT < wall && carT < 60) { const look = onFoot.active ? onFoot.camYaw : car.yaw; audio.alarm?.(-Math.sin(Math.atan2(-dz, dx) - look), carT / 60); }   // a round into a parked car sets its alarm off
  if (wall2 < Infinity) {
    for (let i = _triggerTargets.length - 1; i >= 0; i--) {
      const t = _triggerTargets[i];
      const along = (t.x - ox) * dx + ((t.y ?? 0.9) - oy) * dy + (t.z - oz) * dz;
      if (along > wall2) _triggerTargets.splice(i, 1);
    }
  }
  modes?.targets(_triggerTargets);
  roadblock?.targets?.(_triggerTargets);
  traffic.markTargets?.(_triggerTargets);
  // a pad gets GTA's soft lock; a mouse does not need it and would resent it
  if (padConnected()) aimAssist(_triggerDir, ox, oy, oz, _triggerTargets, ads > 0.5 ? 0.05 : 0.08, 0.55);   // padConnected is a function (input.js)
  weapon.spreadMul = (1 - ads * (1 - (ADS[weapon.kind]?.spread ?? 0.4))) * (onFoot.active ? movementSpread(onFoot.speed ?? 0, crouch) : 1.3);   // sights, feet and crouch shape THIS shot's cone; heat is untouched
  const hit = weapon.fire(ox, oy, oz, dx, dy, dz, _triggerTargets);
  if (hit === null && !weapon.ready && weapon.ammo === 0) return;   // dry: reload started, no shot
  // recoil: a learnable path, indexed by shots in this burst; gentler on the sights
  const rc = recoilFor(weapon.kind, burst++);
  sinceShot = 0;
  lastFiredAt = performance.now();
  if (onFoot.active) { onFoot.camPitch = Math.min(0.9, onFoot.camPitch + rc.pitch * (1 - ads * 0.4)); onFoot.camYaw -= rc.yaw * (1 - ads * 0.4); }
  else chase.shake += weapon.spec.shake * 0.02;
  modes?.onShot(hit, hit ? oy + dy * ((hit.x - ox) * dx + (hit.z - oz) * dz) : 0);
  if (hit && (hit.kind === 'person' || hit.kind === 'officer')) {
    // where the round met the body, along the ray
    const along = (hit.x - ox) * dx + ((hit.y ?? 0.9) - oy) * dy + (hit.z - oz) * dz;
    weapon.bloodAt(ox + dx * along, oy + dy * along, oz + dz * along, dx, dz);
  }
  if (hit) { crosshair.hit(hit.kind === 'person'); if (hit.kind !== 'target' && hit.kind !== 'car') audio.hitmark?.(!!hit.head); }   // the marker you hear
  else {
    let t = wall2;
    if (t === Infinity && dy < -1e-4) t = Math.min(weapon.spec.range, (oy - groundHeightAt(ox, oz)) / -dy);
    if (t < Infinity) {
      _rayHit.set(ox + dx * t, oy + dy * t, oz + dz * t);
      const onGround = wall2 === Infinity;
      decals.stamp(_rayHit.x, _rayHit.y, _rayHit.z, onGround ? 0 : -dx, onGround ? 1 : 0, onGround ? 0 : -dz, weapon.kind === 'shotgun' ? 1.8 : 1);
      // a round into a bin, a cone or a meter knocks it over: Debris.breakNear was written as the bullet hook
      debris?.breakNear?.(_rayHit.x, _rayHit.z, weapon.kind === 'shotgun' ? 1.1 : 0.6, car, 9);
    }
  }
  crowd?.panic(ox, oz, 24);                     // gunfire scatters the street
  for (const v of traffic.cars) {              // and drivers put their foot down
    if (!v.live || Math.hypot(v.x - ox, v.z - oz) > 45) continue;
    v.baseCruise ??= v.cruise; v.cruise = Math.max(v.cruise, v.baseCruise * 1.6); v.fleeT = 8;
  }
  audio.gunshot(1, weapon.kind);
  puffs.puff(weapon.flash.position.x, weapon.flash.position.y, weapon.flash.position.z, { r: 0.22, g: 0.21, b: 0.20, life: 0.55, vy: 0.5, vx: dx * 1.5, vz: dz * 1.5 });   // a wisp off the muzzle
  // firing at all is a crime; hitting something is a worse one
  if (hit?.kind !== 'target' && modes?.active !== 'range') traffic.reportCrime(hit ? (hit.kind === 'person' ? 'person' : (hit.kind === 'police' || hit.kind === 'officer') ? 'police' : 'traffic') : 'traffic',
                      hit ? 9 : 1);
  if (hit && hit.kind === 'officer') { const dmg = weapon.spec.damage * (hit.head ? 3 : 1); if (hit.head) hud.flash('HEADSHOT'); const downed = traffic.hitAny?.(hit.ref, dmg) || roadblock?.hitPost?.(hit.ref, dmg); if (downed) { modes?.onOfficerDown(); story?.onOfficerDown?.(); hud.flash(modes?.active === 'holdout' ? 'OFFICER DOWN · +50' : 'OFFICER DOWN'); } crosshair.hit(hit.ref.down > 0); }
  if (hit && hit.kind === 'person') { hit.ref.down = 0.001; bloodDecals.stamp(hit.ref.x, groundHeightAt(hit.ref.x, hit.ref.z) + 0.01, hit.ref.z, 0, 1, 0, 0.8 + Math.random() * 0.5); }
  if (hit && (hit.kind === 'car' || hit.kind === 'police')) {   // vehicles only: boards, marksmen and posts have no .mesh
    hit.ref.speed *= 0.55;
    hit.ref.mesh?.material?.color?.offsetHSL(0, -0.05, -0.04);
    /* A vehicle takes eight rounds (a shotgun's pellets count once). Then the
       engine is done: cruise 0, so a cruiser rolls to a stop where it is and
       its officers have to come out on foot. spawnGraph resets it on respawn. */
    hit.ref.vhp = (hit.ref.vhp ?? 8) - 1;
    if (hit.ref.vhp === 0) {
      hit.ref.cruise = 0; hit.ref.baseCruise = 0; hit.ref.fleeT = 0; hud.flash(hit.kind === 'police' ? 'CRUISER DISABLED' : 'ENGINE OUT'); audio.thud?.(8);
      if (hit.kind === 'car') crowd?.eject(hit.ref.x, hit.ref.z, hit.ref.yaw);   // the driver bails and runs
    }
  }
}
const _obsBuffer = [];
function getObstacles(x, z) {
  _obsBuffer.length = 0;
  if (world.nearbyParked) world.nearbyParked(x, z, _obsBuffer);
  if (traffic.bodies) traffic.bodies(_obsBuffer);
  return _obsBuffer;
}
const walkSolid = makeSolver(
  (x, z) => (world.nearbyBuildings ? world.nearbyBuildings(x, z) : null),
  getObstacles,
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
    // you drive what you took: the victim's body goes on over the hull
    /* Geometry matching only worked for single-mesh kits; a Sketchfab group
       kit has no .geometry on its root, so those cars handed you the loft.
       Traffic now records its style, and the geometry match is the fallback. */
    const style = best.style ?? Object.keys(assets.geo.stunt).find((k) => assets.geo.stunt[k].body === best.mesh.geometry);
    if (style && KENNEY_CARS[style]) garage?.wear(KENNEY_CARS[style]);
    else console.warn('carjack: no body for style', style);
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
    if (bay.body && KENNEY_CARS[bay.body]) garage?.wear(KENNEY_CARS[bay.body]);   // the parked car is now your car
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
  if (activeVehicle && activeVehicle !== carVehicle) {
    if (activeVehicle.type === 'helicopter' && activeVehicle.altitudeAboveGround > 3.5 && !activeVehicle.landed) {
      hud.flash('TOO HIGH TO EXIT — DESCEND WITH SHIFT OR S TO LAND SAFELY');
      return;
    }
    // Step out of helicopter or tank
    const prev = activeVehicle;
    prev.exit();
    activeVehicle = carVehicle;
    window._activeVehicle = activeVehicle;
    car.type = 'car';
    hero.visible = false;
    const exitOffset = prev.type === 'helicopter' ? 2.6 : 3.2;
    const cy = Math.cos(prev.yaw || 0), sy = Math.sin(prev.yaw || 0);
    onFoot.exit({
      x: prev.x - sy * exitOffset,
      z: prev.z - cy * exitOffset,
      yaw: prev.yaw || 0,
    }, (x, z) => Math.max(world.district?.elevationAt?.(x, z) ?? 0, groundHeightAt(x, z)));
    hud.flash('EXITED VEHICLE');
    return;
  }
  if (onFoot.active) {
    // 1. Check nearby dispatched vehicles (heli, tank)
    if (dispatch?.dispatchedVehicles?.length) {
      for (const v of dispatch.dispatchedVehicles) {
        const reach = v.type === 'helicopter' ? 8.5 : 5.5;
        const d = Math.hypot(v.x - onFoot.x, v.z - onFoot.z);
        if (d < reach) {
          onFoot.enter();
          v.enter(hero);
          activeVehicle = v;
          window._activeVehicle = activeVehicle;
          car.type = v.type;
          hero.visible = false;
          car.throttle = 0; car.brake = 1; car.hand = 1; car.vx = 0; car.vz = 0;
          if (v.type === 'helicopter') {
            hud.flash('AIRBORNE — W/SPACE climb, S/SHIFT descend, A/D turn, F exit');
          } else if (v.type === 'tank') {
            hud.flash('HEAVY ARMOR — W/S drive, A/D pivot steer, MOUSE AIM cannon');
          }
          return;
        }
      }
    }
    // 2. Check landed police air support helicopter
    if (heli && heli.landed && Math.hypot(heli.pos.x - onFoot.x, heli.pos.z - onFoot.z) < 9) {
      onFoot.enter();
      heli.board();
      const playerHeli = new HelicopterVehicle(scene, world, {
        x: heli.pos.x,
        y: heli.pos.y,
        z: heli.pos.z,
        yaw: heli.group.rotation.y,
        running: true,
      });
      dispatch?.dispatchedVehicles.push(playerHeli);
      playerHeli.enter(hero);
      activeVehicle = playerHeli;
      window._activeVehicle = activeVehicle;
      car.type = 'helicopter';
      hero.visible = false;
      car.throttle = 0; car.brake = 1; car.hand = 1; car.vx = 0; car.vz = 0;
      hud.flash('AIRBORNE — W/SPACE climb, S/SHIFT descend, A/D turn, F exit');
      return;
    }
    // 3. Nearest vehicle within reach: your own car, or somebody else's
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
    // Check if parked right next to a dispatched helicopter or tank
    if (dispatch?.dispatchedVehicles?.length) {
      for (const v of dispatch.dispatchedVehicles) {
        const reach = v.type === 'helicopter' ? 9.0 : 6.5;
        const d = Math.hypot(v.x - car.x, v.z - car.z);
        if (d < reach) {
          activeVehicle = v;
          window._activeVehicle = activeVehicle;
          car.type = v.type;
          v.enter(hero);
          hero.visible = false;
          car.throttle = 0; car.brake = 1; car.hand = 1; car.vx = 0; car.vz = 0;
          if (v.type === 'helicopter') {
            hud.flash('AIRBORNE — W/SPACE climb, S/SHIFT descend, A/D turn, F exit');
          } else if (v.type === 'tank') {
            hud.flash('HEAVY ARMOR — W/S drive, A/D pivot steer, MOUSE AIM cannon');
          }
          return;
        }
      }
    }
    driverDoor(1.4);                       // step out; it swings shut behind you
    onFoot.exit(car, (x, z) => Math.max(world.district?.elevationAt?.(x, z) ?? 0, groundHeightAt(x, z)));
    hero.visible = true;
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

Promise.all([loadDistrict(), catalogueReady, new URLSearchParams(location.search).has('nokit') ? null : loadKitBuildings(assets).catch((e) => console.warn('kit buildings:', e.message))]).then(([district, catalogue]) => {
  useDistrict(district);                  // roadDepth() now answers from the file
  traffic.useGraph(district);
  useGraphForRoutes(district);             // and the fleet drives the real streets
  hud.useDistrict(district);              // minimap draws real streets, not a lattice
  navigation = new Navigation(district);
  hud.useNavigation(navigation);
  for (const g of city.cells.values()) scene.remove(g);
  city.cells.clear();
  setBootProgress(70, 'Building the streets…');
  world = new DistrictWorld(scene, assets, district, { day: DAY, catalogue });
  window._world = world;
  world.camera = camera;                  // chunk-level frustum culling for the render bundles
  if (!DAY) {
    const n = +(new URLSearchParams(location.search).get('lights') ?? (isLite ? 4 : 6));
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
  crowd = new Crowd(scene, district, isLite ? 160 : 320);
  people = new People(scene, +(new URLSearchParams(location.search).get('people') ?? (isLite ? 8 : 16)));
  heli = new Helicopter(scene, DAY);
  heli.district = district;
  heli.nearbyBuildings = (x, z) => (world.nearbyBuildings ? world.nearbyBuildings(x, z) : []);
  heli.onArrive = () => hud.flash('AIR SUPPORT INBOUND');
  mission = new Mission(scene, district);
  mission.useHud(hud);
  mission.useAudio(audio);
  jobs = new Jobs(mission, traffic, hud, district, audio, navigation);
  garage = new Garage(jobs, assets, hero, damageModel, hud);
  traffic.hud = hud;
  roadblock = new Roadblock(scene, assets, district, world, traffic, hero);
  metro = new Metro(scene, district, assets);   // two elevated lines and their trains (world/metro.js)
  landmarks = new Landmarks(scene, district);   // gun shop, supermarket, street set on their lots (world/landmarks.js)
  garage.restore();
  story = new StoryManager(mission, traffic, hud, garage, audio, navigation);
  dispatch = new DispatchService(scene, world, garage, traffic, debris, hud, audio, navigation);
  window._dispatch = dispatch;
  if (new URLSearchParams(location.search).has('debug')) window.addCash = (amount = 50000) => {
    garage.addCash(amount, 'TEST FUNDS');
  };
  reputation = new ReputationSystem(garage, audio, hud, scene);
  window._reputation = reputation;
  intelScanner = new IntelScanner(audio, hud);
  window._intel = intelScanner;
  phone = new Phone(story, garage, hero, traffic, dispatch, car, reputation, intelScanner, navigation);
  vehicleVFX = new VehicleVFX(scene, hero);
  window.vehicleVFX = vehicleVFX;
  puddles = new PuddleSystem(scene, district);

  const params = new URLSearchParams(location.search);
  if (!params.has('nobillboards')) billboards = new BillboardSystem(scene, district, CITY_CENTRE);
  if (!params.has('nostreetlife')) streetLife = new StreetLife(scene, district);
  if (!params.has('noairspace')) airspace = new Airspace(scene);
  /* The other half of the race handshake: say when YOU finish. Set here
     rather than on join, because the room can be joined before the district
     has loaded and there would be no mission to hang it on. */
  mission.addListener('finish', (t) => { if (net) net.race({ k: 'stop', t }); });
  traffic.onShot = onShot;
  traffic.onBust = onBust;
  window.district = district;
  districtRef = district;
  // put the car on a real road: the Kingsway node nearest the district centre
  // ...next to the metro platform nearest downtown, so the viaduct and a
  // train are in the first frame (Arun, 2026-09-03)
  const anchor = metro?.nearestStation(CITY_CENTRE.x, CITY_CENTRE.z) ?? { x: CITY_CENTRE.x, z: CITY_CENTRE.z };
  const n = district.graph.nodes.reduce((best, q) =>
    Math.hypot(q.x - anchor.x, q.y - anchor.z)
      < Math.hypot(best.x - anchor.x, best.y - anchor.z) ? q : best);
  resetCar(car);
  car.x = n.x; car.z = n.y; car.y = 0.62;
  world.update(car.x, car.z);
  spawnSnap = true;
  {
    const rx = Math.sin(car.yaw), rz = Math.cos(car.yaw);
    person.place(car.x + rx * 7.5, car.z + rz * 7.5, car.yaw + Math.PI);
  }
  // now the car is on its spawn node, lay the film route from where it stands
  ROUTE = buildRoute(null, car.x, car.z);
  console.info(`Halstead Bay loaded — spawn at node ${n.id} (${n.x}, ${n.y})`);
}).catch((e) => { districtFailed = true; console.warn('district not loaded, staying on the grid:', e.message); });

// ---- the car ----
const car = createCarState();
car.type = 'car';
/* Headlights are active by default from spawn (crisp modern LED low beam).
   H toggles High-Beam Rally Projectors. */
car.headlights = true;
car.headlightMode = 'low';
const hero = buildCar(assets.carMats, 0x5b636d);
scene.add(hero);
// the damage model marks the real bodywork, so it needs the real meshes
// the hero's visible body is the kit's sports sedan over the lofted physics hull
await loadHeroSkin(assets, hero).catch((e) => console.warn('hero skin:', e.message));
damageModel.attach(hero);
const carVehicle = new CarVehicle(car, stepVehicle, hero);
activeVehicle = carVehicle;
window._activeVehicle = activeVehicle;

// --- Modern High-Performance Headlight System ---
const NOSE_X = CG_X;

// 1. Dual-projector road decal texture (photorealistic road beam footprint)
const headlightDecalTex = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 512);

  const drawLobe = (cx, cy, rx, ry) => {
    const grad = ctx.createRadialGradient(cx, cy, 15, cx, cy, ry);
    grad.addColorStop(0, 'rgba(245, 252, 255, 0.92)');
    grad.addColorStop(0.28, 'rgba(220, 240, 255, 0.60)');
    grad.addColorStop(0.62, 'rgba(170, 210, 255, 0.22)');
    grad.addColorStop(1, 'rgba(140, 190, 255, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  };

  // Left and right beam footprints thrown forward
  drawLobe(215, 256, 75, 190);
  drawLobe(297, 256, 75, 190);

  // Central intense hotspot merge
  const centerGrad = ctx.createRadialGradient(256, 270, 10, 256, 270, 120);
  centerGrad.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
  centerGrad.addColorStop(0.45, 'rgba(225, 245, 255, 0.40)');
  centerGrad.addColorStop(1, 'rgba(180, 220, 255, 0)');
  ctx.fillStyle = centerGrad;
  ctx.beginPath();
  ctx.ellipse(256, 270, 85, 140, 0, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();

// Lens flare glow sprite texture for dazzling headlights when viewed from front
const lensGlowTex = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 60);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.22, 'rgba(225, 242, 255, 0.85)');
  grad.addColorStop(0.55, 'rgba(160, 210, 255, 0.32)');
  grad.addColorStop(1, 'rgba(120, 180, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
})();

const headlightBeams = [];
const lensSprites = [];

for (const s of [-1, 1]) {
  // Physical SpotLight illuminating the 3D world (walls, cars, props)
  /* Candela, since three's lights went physical: 120 cd is a bicycle lamp
     and threw nothing readable on the tarmac. A projector headlamp is a few
     thousand; 1800 with decay 1.2 reads at 40 m without whiting the crossing. */
  const spot = new THREE.SpotLight(0xf2f8ff, 1800, 110, 0.50, 0.65, 1.2);
  spot.position.set(NOSE_X - 0.25, 0.76, s * 0.55);
  spot.target.position.set(NOSE_X + 45, -0.30, s * 1.5);
  hero.add(spot, spot.target);
  headlightBeams.push(spot);

  // Front projector lens glare sprite
  const spriteMat = additive(new THREE.SpriteMaterial({
    map: lensGlowTex,
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(0.9, 0.9, 1);
  sprite.position.set(NOSE_X - 0.05, 0.74, s * 0.55);
  hero.add(sprite);
  lensSprites.push(sprite);
}

// Photorealistic asphalt road projection decal
const beamPool = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  additive(new THREE.MeshBasicMaterial({
    map: headlightDecalTex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.58,
    side: THREE.DoubleSide,
  }))
);
/* No mrtNode override here: on a quad (unlike the weather's point sprites) a
   zero normal reads as full occlusion to GTAO and the whole decal goes black. */
beamPool.material.opacity = 0.72;
/* A child of the hero group, so it rides the car's yaw and ground height for
   free. Euler XYZ applies Z first: spin the texture's long axis onto local +X
   (the car's nose), then lay the quad flat. Centred 17 m ahead, 44 m long, so
   the footprint starts under the bumper and fades out past the crossing. */
beamPool.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
beamPool.scale.set(14, 44, 1);
beamPool.position.set(NOSE_X + 17, 0.05, 0);
beamPool.renderOrder = 2;
hero.add(beamPool);

const traffic = new Traffic(scene, assets, DAY ? 36 : 40, !DAY);   // Phase 5: denser, and lit at night
const chase = new ChaseCamera(camera);
const weather = createWeather(scene, { hemi, dome: () => dome, onStrike: (delay) => audio.thunder?.(delay) });   // always built: rain comes in night spells (rainSpell) on the day cycle, and all night with ?night
const hud = new Hud();
let navigation = null;
const clock = new GameClock({ startHour: +(new URLSearchParams(location.search).get('time') ?? (DAY ? 12.0 : 19.5)) });
hud.useClock(clock);
const stats = new Stats();
window.stats = stats;
window.renderer = renderer;
window.scene = scene;
photo = new Photo(camera, stats);
window.photo = photo;

const audio = createAudio();
radio = new Radio(audio, hud);

chat = new Chat();
hud.useChat(chat);
chatter = new ChatterEngine(audio, chat);
modes = new Modes(scene, hud, traffic);
if (new URLSearchParams(location.search).has('range')) setTimeout(() => { if (onFoot.active) modes.startRange(onFoot.x, onFoot.z, onFoot.camYaw); else hud.flash('?range: press F to get out, then Range from the phone'); }, 8000);
window.__modes = modes;   // phone cards call startRange / startHoldout
/* The phone's gun counter. Cash is the garage's; the weapon is the player's. */
window.__buyGrenades = (price = 600) => {
  if ((garage?.cash ?? 0) < price) { hud.flash('NOT ENOUGH CASH'); return false; }
  garage.addCash(-price, 'GRENADES x3'); grenades.count += 3; hud.flash(`GRENADES · ${grenades.count}`); return true;
};
window.__buyArmour = (price = 800) => {
  if ((garage?.cash ?? 0) < price) { hud.flash('NOT ENOUGH CASH'); return false; }
  garage.addCash(-price, 'BODY ARMOUR'); armour = 1; hud.flash('BODY ARMOUR · 100%'); return true;
};
window.__buyWeapon = (kind, price) => {
  if (!ARSENAL[kind]) return false;
  if ((garage?.cash ?? 0) < price) { hud.flash('NOT ENOUGH CASH'); return false; }
  garage.addCash(-price, `BOUGHT ${ARSENAL[kind].name}`);
  held = 'gun';
  weapon.addMag(kind); weapon.addMag(kind); weapon.switchTo(kind); refreshHeldGun();   // two magazines with a purchase
  hud.flash(`${ARSENAL[kind].name} · ${weapon.ammo} / ${weapon.reserveNow}`);
  return true;
};
window.__warp = (x, z, yaw = 0) => {
  resetCar(car);
  car.x = x;
  car.z = z;
  car.yaw = yaw;
  car.y = (world.district?.elevationAt?.(x, z) ?? groundHeightAt(x, z)) + 0.62;
  if (hero) {
    const gy = world.district?.elevationAt?.(x, z) ?? groundHeightAt(x, z);
    hero.position.set(x, gy, z);
    hero.rotation.set(0, yaw, 0);
  }
  chase.snap(car);
  spawnSnap = true;
};

commands = new CommandEngine({
  car,
  traffic,
  get garage() { return garage; },
  clock,
  damageModel,
  grade,
  chat,
  hud,
  setWanted: (lvl) => {
    traffic.wanted = lvl;
    if (lvl === 0 && traffic.police) {
      traffic.police.forEach((p) => { p.hunt = false; });
    }
  },
  setHealth: (hp) => {
    health = hp;
    hud.setHealth(hp);
  },
  setTime: (h) => {
    clock.hour = h;
    hud.flash(`TIME · ${clock.formattedTime}`);
  },
  teleport: (x, z, yaw = 0) => {
    car.x = x;
    car.z = z;
    car.vx = 0;
    car.vz = 0;
    car.yaw = yaw;
    world.update(x, z);
    spawnSnap = true;
  },
  switchCar: (carId) => {
    if (garage) {
      garage.wear(carId);
      return true;
    }
    return false;
  }
});

chat.onSend((line) => {
  if (commands.execute(line)) return;
  chat.post('PEER', line, 'YOU');
  if (net) net.sendChat(line);
});
let started = false;
const start = () => {
  if (!started) { started = true; hud.dismiss(); }
  audio.resume();
};
hud.overlay.addEventListener('click', start);
canvas.addEventListener('click', start);
if (boot) boot.addEventListener('click', start);
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

function applyPerk(persona) {
  window._activePersona = persona;
  if (!persona) return;
  if (persona.id === 'valerie') {
    car.steerBoost = 1.15;
    car.ramForce = 1.1;
    car.cashMult = 1.15;
  } else if (persona.id === 'maya') {
    car.steerBoost = 1.25;
    car.ramForce = 1.0;
    car.cashMult = 1.1;
  } else if (persona.id === 'leo') {
    car.steerBoost = 1.35;
    car.ramForce = 1.0;
    car.cashMult = 1.0;
  } else if (persona.id === 'marcus') {
    car.steerBoost = 1.0;
    car.ramForce = 1.0;
    car.cashMult = 1.2;
  } else if (persona.id === 'jax') {
    car.steerBoost = 1.0;
    car.ramForce = 1.6;
    car.cashMult = 1.0;
  }
}
applyPerk(NAMED_CHARACTERS[0]);

const input = createInput((action) => {
  if (action === 'lights') {
    if (!car.headlights || car.headlightMode === 'low') {
      car.headlights = true;
      car.headlightMode = 'high';
      hud.flash('HEADLIGHTS · HIGH BEAM 🔆');
    } else {
      car.headlights = true;
      car.headlightMode = 'low';
      hud.flash('HEADLIGHTS · LOW BEAM 💡');
    }
  }
  if (action === 'photo') photo.toggle();
  if (action === 'phone') phone?.toggle();
  if (action === 'intel') intelScanner?.toggle();
  if (action === 'garage') garage?.browse();
  if (action === 'buy') garage?.act();
  if (action === 'map') hud.toggleMap();
  if (action === 'radio') radio?.cycle();
  if (action === 'reset') respawnCar();
  if (action === 'time') { clock.hour = (clock.hour + 3) % 24; hud.flash(`TIME · ${clock.formattedTime}`); }
  if (action === 'horn' && !onFoot.active) {
    // your horn: heard, and answered -- pedestrians ahead break for the kerb, the car in front picks up for three seconds
    audio.horn?.(0, 0);
    const fx = Math.cos(car.yaw), fz = -Math.sin(car.yaw);
    crowd?.panic(car.x + fx * 7, car.z + fz * 7, 7);
    if (crowd && Math.abs(car.fwdSpeed || 0) > 3 && crowd.people.some((p) => p.live && !p.down && Math.hypot(p.x - car.x - fx * 7, p.z - car.z - fz * 7) < 7)) chatter?.civilian?.('horn');   // somebody ahead answers
    for (const v of traffic.cars) {
      if (!v.live) continue;
      const dx = v.x - car.x, dz = v.z - car.z, along = dx * fx + dz * fz, side = Math.abs(-dx * fz + dz * fx);
      if (along > 2 && along < 16 && side < 3) { v.baseCruise ??= v.cruise; v.cruise = Math.max(v.cruise, v.baseCruise * 1.3); v.fleeT = 3; }
    }
  }
  if (action === 'weapon0') { held = 'fists'; hud.flash('FISTS'); if (heldGun) heldGun.visible = false; }
  else if (action === 'weapon5') { held = 'grenade'; hud.flash(`GRENADES · ${grenades.count}`); if (heldGun) heldGun.visible = false; }
  else if (action.startsWith('weapon')) {
    held = 'gun';
    const kind = WEAPON_KINDS[+action.slice(6) - 1];
    if (kind && weapon.switchTo(kind)) { refreshHeldGun(); audio.click?.(); hud.flash(`${ARSENAL[kind].name} · ${weapon.ammo}/${ARSENAL[kind].mag}`); }
  }
  if (action === 'reload' && weapon.reload()) { hud.flash('RELOADING…'); audio.reload?.(weapon.spec.reload); }
  if (action === 'avatar' && onFoot.character) {
    window._charIdx = ((window._charIdx || 0) + 1) % NAMED_CHARACTERS.length;
    const persona = NAMED_CHARACTERS[window._charIdx];
    onFoot.character.swap(persona.index);
    applyPerk(persona);
    hud.flash(`${persona.name} (${persona.role}) · ${persona.perk}`);
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
  if (action === 'chat') {
    if (document.pointerLockElement) document.exitPointerLock();
    chat?.toggle();
  }
  if (action === 'chatClose') {
    chat?.close();
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
addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; if (e.button === 2) aiming = false; });
addEventListener('mousedown', (e) => {
  if (document.pointerLockElement === canvas && e.button === 2) {
    aiming = true;
    if (onFoot.active && held === 'gun') { crowd?.panic(onFoot.x, onFoot.z, 9); if (crowd?.people.some((p) => p.live && !p.down && Math.hypot(p.x - onFoot.x, p.z - onFoot.z) < 9)) chatter?.civilian?.('gun'); }   // raising a gun clears the pavement around you, GTA-style
  }
});
addEventListener('contextmenu', (e) => { if (document.pointerLockElement === canvas) e.preventDefault(); });

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
car.obstacles = getObstacles;
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
  try { frameBody(); } catch (e) {
    if (!frame.failed) {
      frame.failed = true;
      console.error('frame error (game continues):', e);
      // a stuck loading screen used to be the only symptom: say what broke, then let the game in
      if (bootMsg) bootMsg.textContent = 'frame error: ' + String(e && e.message || e).slice(0, 120);
      setTimeout(() => { if (boot) { boot.remove(); boot = null; } }, 2500);
      try { hud?.flash?.('FRAME ERROR · ' + String(e && e.message || e).slice(0, 60)); } catch { /* the HUD may be what broke */ }
    }
    /* The render sits at the END of frameBody, so a throw anywhere before it
       used to mean no render at all: a black screen every frame while the
       counters kept counting. Draw the last good state anyway; the game is
       hurt, not gone. Six of today's bugs presented as 'the screen is black'. */
    try { grade.render(renderer, performance.now() / 1000); } catch { /* the renderer itself is what broke */ }
  }
}

function frameBody() {
  performance.mark('frame-start');
  const now = performance.now();
  let dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  if (wastedAnim === 1) dt *= 0.35;   // wasted: the fall plays at a third speed, GTA's beat

  // ---- controls ----
  let c = null;   // this frame's input snapshot; null in film mode (the camera block below reads it)
  if (film) {
    film.pilot.update(car, dt);
    car.holdGear = false;
  } else {
  c = input.read();
  if (garage) {
    garage.setNos(c.nos);
    garage.update(dt, car);
  }
  if (vehicleVFX) vehicleVFX.update(dt, car, garage);
  if (puddles) puddles.update(dt, car, weather ? (weather.amount ?? 1) : 0);   // dry day: only the puddles themselves spray
  if (billboards) billboards.update(worldTime);
  if (streetLife) streetLife.update(dt, car);
  if (airspace) airspace.update(dt, worldTime);
  if (!started && (c.throttle > 0.08 || c.brake > 0.25 || Math.abs(c.steer) > 0.3)) start();
  if (activeVehicle && activeVehicle.type === 'helicopter') {
    activeVehicle.update(c, dt, { keys: input.keys });
    car.throttle = 0; car.brake = 1; car.steerTarget = 0; car.vx = 0; car.vz = 0;
  } else if (activeVehicle && activeVehicle.type === 'tank') {
    activeVehicle.update(c, dt, { firing, chase });
    car.throttle = 0; car.brake = 1; car.steerTarget = 0; car.vx = 0; car.vz = 0;
  } else if (onFoot.active) {
    onFoot.update(c, dt, camera, walkSolid, (x, z) => Math.max(world.district?.elevationAt?.(x, z) ?? 0, groundHeightAt(x, z)));
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
  const tuneMult = 1 + ((garage?.stage || 1) - 1) * 0.15;
  const throttleIn = (inReverse ? revKey : fwdKey) * tuneMult;
  const brakeIn = inReverse ? fwdKey : revKey;
  const lag = c.analogue ? 16 : 11;
  car.throttle += (throttleIn - car.throttle) * Math.min(1, dt * lag);
  car.brake += (brakeIn - car.brake) * Math.min(1, dt * (c.analogue ? 20 : 15));
  car.hand += ((started ? c.handbrake : 0) - car.hand) * Math.min(1, dt * 18);
  car.steerTarget = c.steer;
  }
  }

  dispatch?.update(dt, activeVehicle, chase);
  flying = activeVehicle?.type === 'helicopter' ? activeVehicle : null;

  /* Breakables go BEFORE the physics step: a lamp post the car is about to
     fell must lose its collision solid before the tyre model resolves against
     it, or the car eats a dead stop on the frame it breaks through. */
  debris.update(car, dt, traffic.cars, traffic.police);

  // fixed-step physics keeps the tyre model stable; clamp accumulator to prevent death spirals on dt spikes
  performance.mark('physics-start');
  const tPhys0 = performance.now();
  if (dt > 0.05) physicsAccumulator = Math.min(physicsAccumulator, STEP * 4);
  physicsAccumulator += dt;
  let guard = 0;
  if (!activeVehicle || activeVehicle === carVehicle) {
    while (physicsAccumulator >= STEP && guard++ < 4) {
      stepVehicle(car, STEP);
      physicsAccumulator -= STEP;
    }
  } else {
    physicsAccumulator = 0;
  }
  const physMs = performance.now() - tPhys0;
  performance.mark('physics-end');

  // ---- pose ----
  // group carries x/y/z and yaw; the body carries the sprung motion; the wheels ride the road
  if (!activeVehicle || activeVehicle === carVehicle) {
    hero.visible = !onFoot.active;
    const gy = (world.district?.elevationAt?.(car.x, car.z) ?? groundHeightAt(car.x, car.z));
    hero.position.set(car.x, gy, car.z);
    hero.rotation.set(0, car.yaw, 0);
  } else {
    hero.visible = false;
  }
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
    if (car.flat) car.flat[idx] = w.flat || 0;
    const localWheelY = (car.wheelGround ? car.wheelGround[idx] - gy : 0);
    w.steer.position.y = localWheelY + WHEEL_R * (1 - (w.flat || 0) * 0.3);
    w.spin.rotation.z += car.wheelW[idx] * dt;
  }

  hero.userData.tailMat.emissiveIntensity =
    0.5 + car.brake * 3.0 + (car.hand > 0.3 ? 1.2 : 0);
  // gear 0 is reverse (the HUD prints it as R)
  if (hero.userData.reverseMat) hero.userData.reverseMat.emissiveIntensity = car.gear === 0 ? 2.4 : 0;
  const isHighBeam = car.headlights && car.headlightMode === 'high';
  const headMat = hero.userData.headMat;
  if (headMat) {
    headMat.emissiveIntensity = car.headlights ? (isHighBeam ? 8.8 : 4.8) : 0;
    headMat.emissive.setHex(car.headlights ? (isHighBeam ? 0xffffff : 0xeef6ff) : 0x000000);
  }
  for (const b of headlightBeams) {
    b.intensity = car.headlights ? (isHighBeam ? 3600 : 1800) : 0;
    b.distance = isHighBeam ? 150 : 95;
  }
  for (const sp of lensSprites) {
    sp.visible = car.headlights;
    const scl = isHighBeam ? 1.35 : 0.95;
    sp.scale.set(scl, scl, 1);
  }

  beamPool.visible = car.headlights;
  if (car.headlights) {
    beamPool.scale.set(isHighBeam ? 19 : 15, isHighBeam ? 70 : 46, 1);
    beamPool.material.opacity = isHighBeam ? 0.92 : 0.72;
  }

  worldTime += dt;
  /* Who the police are actually after.
     traffic.update always got the car, so on foot they surrounded and
     arrested an empty parked vehicle while you walked away -- and the
     on-foot control path pins car.brake = 1, which satisfied the "has
     stopped" precondition for the arrest every single frame. */
  const currentVehicle = (activeVehicle && activeVehicle !== carVehicle) ? activeVehicle : car;
  const quarry = onFoot.active
    ? { x: onFoot.x, y: onFoot.y, z: onFoot.z, vx: onFoot.vx, vz: onFoot.vz,
        speed: Math.hypot(onFoot.vx, onFoot.vz), onFoot: true, crouch, firedAt: lastFiredAt }
    : currentVehicle;
  traffic.world = world; traffic.chatter = chatter; traffic.decals = decals; traffic.tracers = tracers; traffic.flashLight = weapon.light; traffic.puffs = puffs; traffic.blood = bloodDecals; traffic.brass = (x, y, z, dx, dz) => weapon.eject?.(x, y, z, dx, dz);
if (crowd) crowd.onNear = () => chatter?.civilian?.('near');   // a pedestrian you nearly hit shouts (chatter throttles to one per 6 s)
traffic.honk = (x, z) => {   // a stuck driver's horn, panned and faded from wherever you are
  const px = onFoot.active ? onFoot.x : car.x, pz = onFoot.active ? onFoot.z : car.z, d = Math.hypot(x - px, z - pz);
  if (d > 90) return;
  const look = onFoot.active ? onFoot.camYaw : car.yaw;
  audio.horn?.(-Math.sin(Math.atan2(-(z - pz), x - px) - look), d / 90);
}; traffic.crowd = crowd; traffic.heli = heli; traffic.grenadeLook = grenades;
  if (!onFoot.active) quarry.firedAt = lastFiredAt;   // the car object is the quarry in a car; officers read this for 'quiet'   // buildings for line of sight, the radio, the marks their misses leave, the street that scatters
  traffic.update(quarry, dt, worldTime);
  if (chatter) chatter.updateWanted(traffic.wanted);
  if (world.updateSignals) world.updateSignals(worldTime);
  if (heli && !flying) { heli.update(quarry, traffic, dt); traffic.eyesOn = heli.eyesOn; }
  const playerTarget = onFoot.active ? quarry : currentVehicle;
  if (mission) mission.update(playerTarget, dt);
  if (jobs) jobs.update(playerTarget, dt);
  if (story) story.update(playerTarget, dt);
  if (crowd && !onFoot.active && onPavementAtSpeed(car)) crowd.panic(car.x, car.z, 14);
  if (net) net.update(car, dt);
  if (weapon.reloading && !wasReloading) audio.reload?.(weapon.spec.reload);   // catches the automatic reload on an empty magazine
  wasReloading = weapon.reloading;
  weapon.update(dt);
  grenades.update(dt, groundHeightAt);
  tracers.update(dt);
  puffs.update(dt);
  /* Vigilante: a patrol chase starting within 150 m of you is an offer. Stop
     the fleeing car -- shoot its engine out or pin it until it stops -- before
     the patrol does and the city pays $400. GTA's vigilante missions, sized to
     the chase the patrol already runs (traffic.js c.chase). */
  {
    const chaser = traffic.police.find((c) => c.live && c.chase);
    const f = chaser?.chase ?? null;
    const px = onFoot.active ? onFoot.x : car.x, pz = onFoot.active ? onFoot.z : car.z;
    if (f && !vigilante && traffic.wanted < 1 && Math.hypot(f.x - px, f.z - pz) < 150) { vigilante = { f, t: 30 }; hud.flash('VIGILANTE · STOP THE FLEEING CAR · $400'); hud.setJob?.('VIGILANTE · stop the fleeing car'); }
    if (vigilante) {
      vigilante.t -= dt;
      const v = vigilante.f, near = Math.hypot(v.x - px, v.z - pz) < 16;
      const stopped = v.vhp === 0 || (near && (v.speed || 0) < 1 && v.fleeT > 0);
      if (stopped && near) { garage?.addCash(400, 'VIGILANTE'); audio.cash?.(); hud.flash('SUSPECT STOPPED · +$400'); vigilante = null; hud.setJob?.(null); }
      else if (vigilante.t <= 0 || !v.live || v.fleeT <= 0 || traffic.wanted >= 1) { vigilante = null; hud.setJob?.(null); }
    }
  }
  // distant gunfire: somewhere across the city, every 35-110 s at night, faint and dull -- the city has other trouble
  if (!DAY || (clock.hour >= 21 || clock.hour < 5)) {
    farShotT -= dt;
    if (farShotT <= 0) { farShotT = 35 + Math.random() * 75; const n = 1 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) setTimeout(() => audio.gunshot(0.10 + Math.random() * 0.06, Math.random() < 0.5 ? 'pistol' : 'smg'), i * (120 + Math.random() * 160)); }
  }
  // a siren somewhere across the city every 60-180 s, when none is actually after you
  farSirenT -= dt; if (farSirenT <= 0) { farSirenT = 60 + Math.random() * 120; if (traffic.wanted < 1) audio.farSiren?.(Math.random() < 0.5 ? -0.8 : 0.8); }
  // tyre smoke: a sliding rear axle puts up pale puffs behind each wheel (car.slip is the dynamics' slip measure)
  if (!onFoot.active && (car.slip || 0) > 0.3 && Math.abs(car.fwdSpeed || 0) > 4) {
    skidT -= dt;
    if (skidT <= 0) {
      skidT = 0.07;
      const fx = Math.cos(car.yaw), fz = -Math.sin(car.yaw), sx = Math.sin(car.yaw), sz = Math.cos(car.yaw);
      for (const side of [-1, 1]) { const wx = car.x - fx * 1.3 + sx * side * 0.8, wz = car.z - fz * 1.3 + sz * side * 0.8; puffs.puff(wx, groundHeightAt(wx, wz) + 0.15, wz, { r: 0.30, g: 0.30, b: 0.31, life: 0.9, vy: 0.5, vx: -fx * 1.5, vz: -fz * 1.5 }); }
    }
  }
  if (punchCool > 0) punchCool -= dt;
  arsenalSaveT += dt; if (arsenalSaveT > 5) { arsenalSaveT = 0; saveArsenal(); try { localStorage.setItem('hb.clock', clock.hour.toFixed(3)); } catch { /* private mode */ } }
  /* The time of day persists (GTA does not reset to noon when you come back).
     Restored once, on the first frame, unless the URL pins a time (?night,
     ?dusk) -- those are for looking at something in particular. */
  if (!clockRestored) {
    clockRestored = true;
    try { const q = new URLSearchParams(location.search); const h = localStorage.getItem('hb.clock'); if (h !== null && !q.has('night') && !q.has('dusk') && !q.has('hour')) clock.hour = ((+h) % 24 + 24) % 24; } catch { /* private mode */ }
  }
  /* Hospitals heal: stand within 6 m of one on foot and health climbs at 15%/s. Free, like GTA's. */
  healTick += dt;
  if (healTick > 0.5) {
    healTick = 0;
    if (onFoot.active && health < 1 && districtRef?.places) {
      for (const p of districtRef.places) { if (p.type === 'hosp' && Math.hypot(p.x - onFoot.x, p.y - onFoot.z) < 6) { health = Math.min(1, health + 0.075); hud.setHealth(health); if (health >= 1) hud.flash('PATCHED UP'); break; } }
    }
  }
  /* GTA V's rule: health creeps back to half on its own once you have not been
     hit for six seconds. Above half you need a doctor (the garage repair, or a
     respawn). It turns a lost firefight into a retreat instead of a reload. */
  if (health < 0.5 && performance.now() - lastHurtAt > 6000) { health = Math.min(0.5, health + dt * 0.03); hud.setHealth(health); }
  modes?.update(dt);
  // walk over a downed officer's weapon and it is yours, magazine full
  if (onFoot.active) { const k = traffic.pickupAt?.(onFoot.x, onFoot.z); if (k === 'grenade') { grenades.count++; hud.flash(`PICKED UP GRENADE · ${grenades.count}`); } else if (k === 'armour') { armour = Math.min(1, armour + 0.5); hud.flash(`BODY ARMOUR · ${Math.round(armour * 100)}%`); } else if (k) { held = 'gun'; weapon.addMag(k); weapon.switchTo(k); refreshHeldGun(); hud.flash(`PICKED UP ${ARSENAL[k].name} · +${ARSENAL[k].mag}`); } }
  if (modes?.active && !jobs?.job) hud.setJob?.(modes.line());
  const adsTarget = aiming && onFoot.active ? 1 : 0;
  ads += (adsTarget - ads) * Math.min(1, dt / ADS_BLEND_S);
  if (Math.abs(ads - adsTarget) < 0.01) ads = adsTarget;
  sinceShot += dt; if (sinceShot > 0.4) burst = 0;
  const adsCfg = ADS[weapon.kind] ?? ADS.pistol;
  onFoot.ads = ads; onFoot.adsFov = adsCfg.fov; onFoot.adsBack = adsCfg.back; onFoot.adsSpeed = adsCfg.speed;
  crosshair.show(started && !flying && !photo.on);
  if (!onFoot.active) crosshair.update(spreadToPixels(spreadFor(weapon.kind, weapon.heat) * 1.3, camera.fov ?? 60, innerHeight), weapon.reloading ? 1 - weapon.reloadT / weapon.spec.reload : -1, dt);
  if (onFoot.active) {
    const cone = spreadFor(weapon.kind, weapon.heat) * (1 - ads * (1 - adsCfg.spread));
    crosshair.update(spreadToPixels(cone, camera.fov ?? 60, innerHeight), weapon.reloading ? 1 - weapon.reloadT / weapon.spec.reload : -1, dt);
    swayPhase += swayPhaseStep(onFoot.speed ?? 0, dt);
  }
  placeHeldGun();
  if (held === 'fists') hud.setAmmo('FISTS', '', '', false, armour); else if (held === 'grenade') hud.setAmmo('GRENADE', grenades.count, '-', false, armour); else hud.setAmmo(weapon.spec.name, weapon.ammo, weapon.reserveNow, weapon.reloading, armour, weapon.magSize);
  const arsKey = onFoot.active ? `${held}|${weapon.kind}|${weapon.ammo}|${weapon.reserveNow}|${grenades.count}` : 'car';
  if (arsKey !== lastArsKey && onFoot.active) hud.setArsenal?.([
    { key: 0, name: 'FISTS', mag: '', reserve: '', current: held === 'fists' },
    ...WEAPON_KINDS.map((k, i) => ({ key: i + 1, name: ARSENAL[k].name, mag: k === weapon.kind ? weapon.ammo : weapon.mags[k], reserve: weapon.reserve[k], current: held === 'gun' && k === weapon.kind })),
    { key: 5, name: 'NADE', mag: grenades.count, reserve: '', current: held === 'grenade' },
  ]);
  else if (arsKey !== lastArsKey && hud.arsEl) { hud.arsEl.innerHTML = ''; hud._arsKey = ''; }
  lastArsKey = arsKey;
  skids.update(car, car.wheelGround ? car.wheelGround[2] : 0);
  if (firing) pullTrigger();
  if (crowd) crowd.update(car, dt, (speed, p) => {
    traffic.reportCrime('person', speed);
    if (p && speed > 3) {   // a pedestrian under the car: blood where they fell, a scuff of dust, and it hurts to watch
      const gy = groundHeightAt(p.x, p.z);
      bloodDecals.stamp(p.x, gy + 0.01, p.z, 0, 1, 0, 0.7 + Math.min(1, speed / 25));
      weapon.bloodAt?.(p.x, gy + 0.9, p.z, Math.cos(car.yaw), -Math.sin(car.yaw));
      puffs.puff(p.x, gy + 0.3, p.z, { r: 0.22, g: 0.20, b: 0.18, life: 0.9, vy: 0.7 });
    }
  });
  people?.update(dt, crowd, car, (x, z) => districtRef?.elevationAt?.(x, z) ?? 0, camera);
  /* Traffic reacts: a car you cut within 6 m of at speed blows its horn,
     panned to where it is, no more than once a second and a half. */
  roadblock?.update(dt, car);
  metro?.update(dt, camera?.position || car);
  hornCooldown -= dt;
  if (hornCooldown <= 0 && Math.abs(car.fwdSpeed) > 7) {
    for (const t of traffic.cars) {
      if (!t.live || !t.mesh.visible) continue;
      const dx = t.x - car.x, dz = t.z - car.z, d = Math.hypot(dx, dz);
      if (d > 6.5) continue;
      const side = -Math.sin(car.yaw) * dx - Math.cos(car.yaw) * dz;   // left/right of the hero's heading
      audio.horn(Math.max(-1, Math.min(1, side / 6)), 0);
      hornCooldown = 1.5;
      if (chatter) chatter.triggerPedReaction();
      break;
    }
  }
  if (beach) beach.update(dt);
  if (water) water.update(dt);

  dome.position.set(currentVehicle.x, 0, currentVehicle.z);

  if (film) {
    film.shots.update(car, camera, dt);
    if (film.shots.finished || film.pilot.done) stopFilm();
  } else if (photo.on) {
    photo.update(dt);          // the chase camera is frozen while photo mode owns the view
  } else {
    if (!onFoot.active) {
      const targetVehicle = currentVehicle;
      // ease the free look back behind the car once you are driving again
      if (chase.looking && Math.abs(targetVehicle.fwdSpeed || 0) > 6) {
        const d = 1 - Math.pow(0.35, dt);
        chase.lookYaw -= chase.lookYaw * d;
        chase.lookPitch -= chase.lookPitch * d;
        if (Math.abs(chase.lookYaw) < 0.01 && Math.abs(chase.lookPitch) < 0.01) chase.recentre();
      }
      chase.setLookBack(!!c?.lookBack);
      if ((targetVehicle.impact || 0) > 6.0) rumble(Math.min(1.0, targetVehicle.impact / 18.0), 120);
      if (spawnSnap) { spawnSnap = false; chase.snap(targetVehicle); }
      targetVehicle.camera ? targetVehicle.camera(chase, dt) : chase.update(targetVehicle, dt);
    }
  }
  clock.update(dt, { sun, hemi, scene, grade, lightPool, heroLights: beamPool, weatherSystem: weather, assets, player: currentVehicle, dome, stars });
  // the rain audio follows the weather's breathing, and rain is grip: the physics reads car.wet
  // crossing into a district: the area name, GTA-style, and dispatch tracks you if you are wanted
  distT -= dt;
  if (districtRef?.districtAt && distT <= 0) {
    distT = 0.5;
    const here = districtRef.districtAt(onFoot.active ? onFoot.x : car.x, onFoot.active ? onFoot.z : car.z);
    if (here && here !== lastDistrict) {
      if (lastDistrict !== null) { hud.flash(here); if (traffic.wanted >= 1) chatter?.radio?.(`Suspect heading into ${here.charAt(0) + here.slice(1).toLowerCase()}. Units in the area respond.`); }
      lastDistrict = here;
    }
  }
  // Little Tokyo's sound follows you in and out of the district
  if (audio.tokyo && districtRef?.districtAt) { tokyoAmbT = (tokyoAmbT ?? 0) - dt; if (tokyoAmbT <= 0) { tokyoAmbT = 0.5; audio.tokyo(districtRef.districtAt(onFoot.active ? onFoot.x : car.x, onFoot.active ? onFoot.z : car.z) === 'LITTLE TOKYO'); } }
  // Little Tokyo's windows, neon and kanban come up with the night (tokyo.js emissive attribute)
  { const hr = clock.hour; setTokyoNight(hr >= 20.5 || hr < 5.2 ? 1 : hr >= 18 ? (hr - 18) / 2.5 : hr < 7.2 ? (7.2 - hr) / 2 : 0); }
  if (weather) {
    // rain only at night (the clock's thresholds), in spells on the normal cycle, all night with ?night
    const nightNow = clock.hour >= 20.5 || clock.hour < 5.2;
    weather.setEnabled(nightNow && (!DAY || rainSpell(now / 1000)));
    weather.update(camera, currentVehicle, dt); car.wet = weather.amount ?? 1; traffic.wet = car.wet; if (crowd) crowd.rain = car.wet;
    if (Math.abs((weather.amount ?? 1) - (rainHeard ?? -1)) > 0.05) { rainHeard = weather.amount; audio.setRain(rainHeard); }
    // the road LOOKS wet: tarmac roughness drops and its reflection rises with the rain (uniforms only, no recompile; bundles carry uniform changes)
    const tm = assets?.mat?.tarmac; if (tm) { tm.roughness = 0.48 - 0.30 * car.wet; tm.envMapIntensity = 1.1 + 0.9 * car.wet; }
    if (scene.fog) scene.fog.density *= 1 + 0.9 * car.wet;   // rain thickens the air; multiplies the clock's per-frame value, so it never accumulates
    if (stars && car.wet > 0.05) stars.visible = false;   // no stars through cloud (the clock re-decides every frame)
  }
  lightPool?.update(dt, currentVehicle.x, currentVehicle.z, traffic);
  reputation?.update(dt, playerTarget.x, playerTarget.z, traffic, car, damageModel);
  intelScanner?.update(dt, camera, playerTarget, traffic, reputation?.safehouses);
  grade.setDrops(DAY ? 0 : chase.mode >= 2 ? 1.2 : 0.68);
  const speedRatio = Math.min(1, (Math.abs(car.fwdSpeed || 0) / 42)) * (car.nosActive ? 1.35 : 0.85);
  grade.setSpeed?.(speedRatio);
  const streamX = photo?.on ? camera.position.x : currentVehicle.x;
  const streamZ = photo?.on ? camera.position.z : currentVehicle.z;
  const streamVx = photo?.on ? 0 : (currentVehicle.vx || 0);
  const streamVz = photo?.on ? 0 : (currentVehicle.vz || 0);
  performance.mark('stream-start');
  world.update(streamX, streamZ, streamVx, streamVz);
  performance.mark('stream-end');
  resolution(dt);
  /* One render: the pipeline owns the frame (scene MRT pass, GTAO, bloom,
     tone map, grade — core/grade.js). renderer.info accumulates across a
     frame's internal passes and resets once per rAF by the renderer's own
     animation pump, so sampling after the pipeline reads the whole frame —
     scene + shadow passes + ~15 fullscreen post quads. */
  performance.mark('render-start');
  const tRender0 = performance.now();
  hurtPulse = Math.max(0, hurtPulse - dt * 2.2);
  grade.setHurt?.(Math.max(hurtPulse, onFoot.active && health < 0.4 ? (0.4 - health) * 1.6 : 0));   // a hit flashes it; under 40% it stays
  grade.render(renderer, now / 1000);
  const renderMs = performance.now() - tRender0;
  performance.mark('render-end');
  performance.mark('frame-end');
  // the first real frame is on screen: drop the boot overlay
  /* The loading screen comes down only once the first ring of chunks is
     built AND every pipeline is compiled -- including the hidden collision
     effects -- so the first thing you see is a frame that already runs at
     speed, not one that stalls on its first crash. */
  /* Hold the boot screen until the DISTRICT has landed too. `world` starts as
     the legacy grid (no `primed`, so the gate read true) and the district
     arrives later: the player saw the car at the grid origin, then it jumped
     to Kingsway when the district resolved. Wait for districtRef unless the
     district load failed, in which case the grid is all there is. */
  if (boot && !warming && (world.primed ?? true) && (districtRef || districtFailed)) {
    warming = true;
    setBootProgress(95, 'Warming shaders…');
    const dummyGroup = new THREE.Group();
    const testBox = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const compileMats = new Set();
    if (assets?.mat) {
      for (const m of Object.values(assets.mat)) if (m?.isMaterial) compileMats.add(m);
    }
    if (assets?.facades) {
      for (const g of Object.values(assets.facades)) {
        if (Array.isArray(g)) for (const m of g) if (m?.isMaterial) compileMats.add(m);
      }
    }
    if (world?.catalogue?.materials) {
      for (const m of world.catalogue.materials.values()) if (m?.isMaterial) compileMats.add(m);
    }
    if (assets?.kitBuildings) {
      for (const kb of Object.values(assets.kitBuildings)) if (kb?.mat?.isMaterial) compileMats.add(kb.mat);
    }
    /* The shooting layer's materials too. A firefight is exactly when materials
       first meet the lights -- officer, weapon, muzzle flash, tracer, sparks --
       and each first meeting is a 30-80 ms pipeline compile. Meet them here. */
    compileMats.add(officerMaterial());
    compileMats.add(weaponMaterial());
    if (weapon?.flash?.material) { if (!weapon.flash.material.mrtNode) glow(weapon.flash.material, 2.5); compileMats.add(weapon.flash.material); }   // glow it NOW, or the glowed variant compiles on the first shot
    if (weapon?.tracer?.material) compileMats.add(weapon.tracer.material);
    compileMats.add(tracers.material);
    if (weapon?.sparks?.material) compileMats.add(weapon.sparks.material);
    if (weapon?.blood?.material) compileMats.add(weapon.blood.material);
    if (weapon?.casings?.material) compileMats.add(weapon.casings.material);
    compileMats.add(puffs.mesh.material);
    compileMats.add(decals.mesh.material);
    compileMats.add(bloodDecals.mesh.material);
    compileMats.add(grenades.ball.material); compileMats.add(grenades.mat);
    for (const m of policeMaterials()) compileMats.add(m);
    compileMats.add(tokyoMaterial());
    /* The pipeline is keyed on the material AND the object kind: a
       PointsMaterial warmed on a Mesh compiles the wrong program, and an
       InstancedMesh's vertex stage differs from a Mesh's. Warm each on what
       will draw it. */
    const pointsGeo = new THREE.BufferGeometry(); pointsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -50, 0, 1, -50, 0]), 3));
    pointsGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(6), 3));
    const instanced = new Set([weapon?.casings?.material, decals.mesh.material, bloodDecals.mesh.material]);
    for (const mat of compileMats) {
      if (mat.isPointsMaterial) dummyGroup.add(new THREE.Points(pointsGeo, mat));
      else if (mat.isLineBasicMaterial) dummyGroup.add(new THREE.LineSegments(pointsGeo, mat));
      else if (instanced.has(mat)) { const im = new THREE.InstancedMesh(testBox, mat, 1); im.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, -50, 0)); dummyGroup.add(im); }
      else dummyGroup.add(new THREE.Mesh(testBox, mat));
    }
    scene.add(dummyGroup);

    const hidden = [];
    scene.traverse((o) => { if ((o.isPoints || o.isMesh) && !o.visible && !o.isInstancedMesh && !o.userData?.shell) { hidden.push(o); o.visible = true; } });
    // never let the warm-up hold the game hostage: 1.5 s, then in you go regardless
    const drop = () => {
      setBootProgress(100, 'Ready!');
      for (const o of hidden) o.visible = false;
      scene.remove(dummyGroup);
      testBox.dispose();
      if (boot) { boot.remove(); boot = null; }
    };
    Promise.race([renderer.compileAsync(scene, camera), new Promise((r) => setTimeout(r, 1500))])
      .catch((e) => console.warn('warm-up:', e.message)).then(drop);
  }
  stats.sample(renderer);
  /* drawCalls, not calls: `render.calls` counts render-pass INVOCATIONS since
     load and is never reset, so the banner's old "907 DRAWS" was a lifetime
     pass counter that happened to look plausible. `drawCalls` is the real
     per-frame number and matches the F3 overlay. */
  stats.update(dt, world, renderer, { physics: physMs, render: renderMs });
  // counted + replayed-from-bundles: renderer.info alone under-reports by ~75% since the chunks became render bundles
  const draws = renderer.info.render.drawCalls + (stats.snapshot.bundledDraws || 0);
  const tris = renderer.info.render.triangles + (stats.snapshot.bundledTris || 0);

  const missionTarget = (story && story.active && story.active.steps[story.stepIdx]?.target)
    ? { x: story.active.steps[story.stepIdx].target.x, z: story.active.steps[story.stepIdx].target.z }
    : (jobs && jobs.job)
      ? {
          x: jobs.job.pickedUp ? jobs.job.b.x : jobs.job.a.x,
          z: jobs.job.pickedUp ? (jobs.job.b.z !== undefined ? jobs.job.b.z : jobs.job.b.y) : (jobs.job.a.z !== undefined ? jobs.job.a.z : jobs.job.a.y),
        }
      : (mission && mission.active && mission.points && mission.points[mission.index])
        ? {
            x: mission.points[mission.index].x,
            z: mission.points[mission.index].z !== undefined ? mission.points[mission.index].z : mission.points[mission.index].y,
          }
        : null;
  navigation?.update(currentVehicle, missionTarget);

  hud.update(currentVehicle, traffic, mission, net, heli);
  if (bustFlash > 0) {
    bustFlash -= dt;
    hud.setBusted(bustFlash);
    if (bustFlash <= 0) hud.setDead(false);
  }
  audio.update(currentVehicle);
  /* The nearest live cruiser's siren: louder as it closes, panned to its
     side, gone when the stars are. traffic._nearest is this frame's distance. */
  if (audio.siren) {
    let sx = 0, sz = 0, sd = Infinity;
    // hunting cruisers, or a patrol answering a call
    for (const c of traffic.police) { if (!c.live || !(traffic.wanted > 0 || c.respondT > 0)) continue; const d = Math.hypot(c.x - car.x, c.z - car.z); if (d < sd) { sd = d; sx = c.x; sz = c.z; } }
    if (sd < 260) { const look = onFoot.active ? onFoot.camYaw : car.yaw; const b = Math.atan2(-(sz - car.z), sx - car.x) - look; audio.siren(-Math.sin(b), Math.min(1, sd / 260)); }
    else audio.siren(0, 1);
  }
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
  if (car.impact > 3.2 && car.hitAt && !onFoot.active) {
    // the crash you see: sparks off the contact point and a burst of dust, scaled by the hit
    const k = Math.min(1, (car.impact - 3) / 12), hx = car.hitAt.x, hz = car.hitAt.z, gy = groundHeightAt(hx, hz);
    const ddx = (hx - car.x), ddz = (hz - car.z), dl = Math.hypot(ddx, ddz) || 1;
    weapon.sparksAt?.(hx, gy + 0.45, hz, ddx / dl, ddz / dl);
    for (let i = 0, n = 2 + Math.round(k * 5); i < n; i++) puffs.puff(hx + (Math.random() - 0.5) * 1.2, gy + 0.3 + Math.random() * 0.6, hz + (Math.random() - 0.5) * 1.2, { r: 0.24, g: 0.22, b: 0.19, life: 1.0 + k, vy: 0.8 + k, vx: -ddx / dl * 1.5, vz: -ddz / dl * 1.5 });
  }
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
