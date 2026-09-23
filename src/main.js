import * as THREE from 'three';
import { additive } from './core/additive.js';
import './style.css';

import { autoResolution, createRenderer, createScene, createLights, DAY_SUN, renderScale } from './core/renderer.js';
import { detectGpuInfo, resolveQualityMode } from './core/gpu.js';
import { createSky } from './core/sky.js';
import { createGrade } from './core/grade.js';
import { resolveQuality, describeQuality, nextLower, limitTraffic, limitFarTraffic, DENSITY_STEPS, QUALITY_NAMES, STORAGE_KEY as QUALITY_KEY } from './core/quality.js';
import { setAnisotropy, wetTarmacLook } from './world/textures.js';
import { createAssets } from './world/assets.js';
import { loadVendorCars, loadHeroSkin, KENNEY_CARS, DEFAULT_BODY } from './world/vendorCars.js';
import { loadTreeModels } from './world/treeModels.js';
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
import { isTouchDevice } from './core/device.js';
import { createTouch } from './game/touch.js';
import { mergeDrive } from './game/input.js';
import { City, releaseCell } from './world/city.js';
import { DistrictWorld } from './world/districtWorld.js';
import { loadDistrict } from './world/district.js';
import { buildSurrounds } from './world/surrounds.js';
import { buildWater } from './world/water.js';
import { buildPlaces } from './world/places.js';
import { buildBeach } from './world/beach.js';
import { buildRiverside } from './world/riverside.js';
import { useDistrict } from './world/metrics.js';
import { buildCar } from './vehicle/model.js';
import { createCarState, resetCar, stepVehicle } from './vehicle/dynamics.js';
import { Vehicle, CarVehicle } from './game/vehicle.js';
import { HelicopterVehicle } from './game/flight.js';
import { TankVehicle } from './game/tank.js';
import { buildTankModel } from './world/tankModel.js';
import { pickDifficulty, DIFFICULTY_KEY } from './game/difficulty.js';
import { buildHeliModel } from './world/heliModel.js';
import { DispatchService } from './game/dispatch.js';
import { groundHeightAt } from './world/metrics.js';
import { CG_X, WHEEL_R, getVehicleProfile } from './vehicle/config.js';
import { ChaseCamera } from './game/camera.js';
import { createInput, padConnected, rumble } from './game/input.js';
import { createPadNav } from './ui/padnav.js';
import { Traffic, policeMaterials } from './game/traffic.js';
import { decalMaterial as wearDecalMaterial, decalGeometry as wearDecalGeometry } from './world/decals.js';
import { Crowd } from './game/crowd.js';
import { Helicopter } from './game/helicopter.js';
import { OnFoot, makeSolver } from './game/onfoot.js';
import { CHARACTERS, NAMED_CHARACTERS } from './game/character.js';
import { Navigation } from './game/navigation.js';
import { GameClock } from './game/clock.js';
import { Mission } from './game/mission.js';
import { HALSTEAD_MILE, DEFAULT_HOUR, startYaw, missionPoints, drivingLine } from './game/scenicRoute.js';
import { buildRaceTrack, registerRaceTrackPhysics, isRacewayArea } from './world/raceTrack.js';
import { RaceCircuit } from './game/raceCircuit.js';
import { Multiplayer, roomFromUrl, createRoom } from './game/multiplayer.js';
import { Weapon } from './game/weapon.js';
import { ARSENAL, WEAPON_KINDS, buildWeaponMesh, weaponMaterial } from './game/weapons.js';
import { officerMaterial } from './world/officer.js';
import { officerPool } from './world/officerSkinned.js';
import { Modes } from './game/modes.js';
import { Grenades, BLAST_R, KILL_R, HURT_R, blastFalloff } from './game/grenade.js';
import { Crosshair, DecalPool, ADS, ADS_BLEND_S, spreadToPixels, spreadFor, recoilFor, firstBuildingHit, swayFor, swayPhaseStep, reloadPose, movementSpread, aimAssist } from './game/shooting.js';
import { Tracers } from './game/tracers.js';
import { Puffs } from './world/puffs.js';
import { tokyoMaterial, tokyoFacadeMaterial, tokyoWarmGeometry, setTokyoNight } from './world/tokyo.js';
import { tokyoBoardMesh } from './world/tokyoSigns.js';
import { setGlareNight } from './world/glare.js';
import { setWindowNight, setSignNight } from './world/signs.js';
import { FarTraffic } from './world/farTraffic.js';
import { HeadlightStreaks, setStreakNight } from './world/streaks.js';
let streaks = null;   // anamorphic headlight streak pool, built on the first frame that needs it
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
import { VideoMode } from './game/video.js';
import { FeatureTour } from './game/featureTour.js';
import { createAudio } from './game/audio.js';
import { createWeather, rainSpell } from './world/weather.js';
import { buildHuman } from './world/human.js';
import { Debris } from './world/breakables.js';

/* Day first. Night is still fully built -- ?night in the URL brings it back --
   but daylight is the honest view: nothing hides behind a lamp glow. */
const DAY = !new URLSearchParams(location.search).has('night');
/* ?mode=race -- the raceway as its OWN run. Only the chunks under the circuit
   are built, no far-city LOD, no civilian traffic, no crowd, no landmarks, no
   beach or riverside dressing, and the race stages itself on the grid at
   boot. The city is still the same District (roads, collision, elevation),
   there is just nothing in it that is not the track. See DistrictWorld's
   `only` option for the mechanism. */
const RACE_MODE = new URLSearchParams(location.search).get('mode') === 'race';
/* Frame-phase marks are ?perf ONLY (2026-09-22). frameBody() called
   performance.mark() eight times a frame and nothing in src/ ever read them;
   the User Timing buffer for marks is unbounded, so they piled up forever.
   Measured in node: 1.9 us/frame of CPU and 144,000 entries / +11.8 MB of heap
   after five minutes at 60 fps. Now: 0 us and 0 entries unless ?perf is set,
   and under ?perf the buffer is cleared at each frame start so it holds one
   frame at most. */
const PERF_MARKS = new URLSearchParams(location.search).has('perf');
const mark = PERF_MARKS ? (name) => performance.mark(name) : () => {};

const canvas = document.getElementById('gl');
/* The boot overlay is static HTML in index.html so it paints before this
   module even parses; from here we narrate the slow phases into it and
   frame() removes it on the first rendered frame. */
let boot = document.getElementById('boot');
const bootMsg = document.getElementById('bootmsg');
const bootProgress = document.getElementById('bootprogress');
const bootPercent = document.getElementById('bootpercent');
/* The stuck-boot guard. It used to be a flat 12 s from module parse, which is
   not what it is for: measured on this machine a healthy boot clears at ~16.5 s
   with the catalogue pre-warm and ~17.1 s without, so the flat cap fired on
   EVERY boot and tore the loading screen away while the city was still
   building. The point is to catch a boot that has STOPPED, so the timer resets
   on every reported phase and only fires after 12 s of no progress at all. */
let bootStall = null;
const armBootStall = () => {
  clearTimeout(bootStall);
  bootStall = setTimeout(() => {
    if (boot) { console.warn('boot: no progress for 12 s, dropping the loading screen'); boot.remove(); boot = null; }
  }, 12000);
};
armBootStall();
let bootPhaseName = '';        // the lag logger names the phase a boot-time spike fell in
let catalogueRef = null;       // set once the catalogue resolves; the lag logger reads pendingLoads
const setBootProgress = (pct, m) => {
  bootPhaseName = m;
  if (bootMsg) bootMsg.textContent = m;
  if (bootProgress) bootProgress.style.width = `${pct}%`;
  if (bootPercent) bootPercent.textContent = `${pct}%`;
  armBootStall();
};
setBootProgress(10, 'Waking the GPU…');
const renderer = createRenderer(canvas);
setBootProgress(25, 'Starting the renderer…');
await renderer.init();

setBootProgress(35, 'Analyzing GPU architecture…');
const gpuInfo = await detectGpuInfo(renderer);
const qualityChoice = resolveQualityMode(gpuInfo);
const isLite = qualityChoice.isLite;
const TOUCH = isTouchDevice();   // core/device.js; ?mobile / ?desktop override
if (TOUCH) document.body.classList.add('touch');
window.__gpuInfo = gpuInfo;
window.__isLite = isLite;
/* Quality preset (core/quality.js): ?quality= > localStorage hb.quality > auto
   (medium on the LITE tier, high otherwise). Every knob below reads Q; the
   tier (isLite) still decides the FULL cascades and the light-pool count. */
const quality = resolveQuality({ isLite });
const Q = quality.preset;
window.__quality = quality;
/* Easy by default (2026-09-23, game/difficulty.js): the owner asked for "easy
   game play, no complications". ?hard is the full game. */
const DIFF = pickDifficulty(location.search, (() => { try { return localStorage.getItem(DIFFICULTY_KEY); } catch { return null; } })());
console.info(`difficulty: ${DIFF.name.toUpperCase()} (stars x${DIFF.crimeScale}, max ${DIFF.maxWanted} from crimes, decay x${DIFF.decayScale}, hurt x${DIFF.hurtScale}, crashes x${DIFF.crashScale})`);
const crowdWanted = !new URLSearchParams(location.search).has('nocrowd') && !RACE_MODE;   // on by default again (2026-09-23): two GPU-posed draws now, see world/figure.js
console.info(describeQuality(quality.name, `${quality.source}, tier ${isLite ? 'LITE' : 'FULL'}: ${qualityChoice.reason}, gpu ${gpuInfo.gpuDesc || 'unknown'}`, Q, { traffic: RACE_MODE ? 0 : Q.traffic, crowd: crowdWanted ? Q.crowd : 0 }));

// Apply initial render scale for the preset's pixel budget
renderer.setPixelRatio(renderScale(innerWidth, innerHeight, isLite, Q.pixelBudget));
renderer.setSize(innerWidth, innerHeight, false);

setBootProgress(45, 'Building the scene & lights…');
setAnisotropy(renderer.capabilities?.getMaxAnisotropy?.() ?? 16);

const scene = createScene(DAY);
window.scene = scene;
/* far 14000, not 8000. The sky dome is a radius-9000 sphere recentred on the
   car every frame (sky.js:74, main.js dome.position.set), so EVERY vertex of it
   sits ~9000 m from the camera: any far plane under ~9010 clips the entire dome
   and the sky renders black at noon. Measured 2026-09-16 at Little Tokyo 12:00,
   same viewpoint: far 8000 top-quarter mean RGB (43,51,56) -- black -- against
   (53,65,69) with 14000. Depth precision is bought at the NEAR plane, not here. */
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.5, 14000);
const { sun, hemi } = createLights(scene, DAY, { lite: isLite, shadows: Q.shadows, webgl: !!renderer.backend?.isWebGLBackend });   // boot-time: castShadow never changes after the first frame (WebGPU pipeline trap)
const { dome, stars, sunSprite, sunRaySprite } = createSky(scene, renderer, DAY);

setBootProgress(60, 'Initializing TSL post-processing pipeline…');
const grade = createGrade(renderer, scene, camera, {
  ssr: new URLSearchParams(location.search).has('ssr'),
  ao: new URLSearchParams(location.search).has('ao'),
  // bloom (~12 passes) and SMAA (3) are pipeline topology: the preset decides them at boot, the flags still force them off
  bloom: Q.bloom && !new URLSearchParams(location.search).has('nobloom'),
  aa: Q.aa && !new URLSearchParams(location.search).has('noaa'),
  blur: (new URLSearchParams(location.search).has('blur') || (!new URLSearchParams(location.search).has('noblur') && Q.blur)),   // high-speed radial blur: 7-tap full-screen pass; high preset only (was !isLite)
  post: !new URLSearchParams(location.search).has('nopost'),
});
/* The runtime ladder (renderer.js autoResolution). Density first: a hidden
   car is a draw that never happens and the submit is 74-95% of frame CPU;
   then the pixel ratio as before. traffic/farTraffic/hud are const-declared
   further down; the callbacks only run from the frame loop, after all of it. */
const resolution = autoResolution(renderer, grade, isLite, {
  pixelBudget: Q.pixelBudget,
  densitySteps: DENSITY_STEPS.length - 1,
  onDensity: (step) => {
    const f = DENSITY_STEPS[step] ?? DENSITY_STEPS.at(-1);
    if (!RACE_MODE) { traffic._n0 ??= traffic.cars.length; limitTraffic(traffic, Math.round(traffic._n0 * f)); }
    if (farTraffic) limitFarTraffic(farTraffic, (farTraffic._n0 ?? farTraffic.n) * f);
    if (step === 1) hud.flash('TRAFFIC THINNED TO HOLD FRAME RATE');
  },
  onSustained: () => {
    const lower = nextLower(quality.name);
    if (!lower) return;
    try { localStorage.setItem(QUALITY_KEY, lower); } catch { /* private mode */ }
    hud.flash(`QUALITY -> ${lower.toUpperCase()} ON NEXT START`);
    console.info(`[drs] sustained >22 ms at MIN_SCALE with density spent: ${QUALITY_KEY}=${lower} for the next boot`);
  },
});

const assets = createAssets();
setBootProgress(75, 'Loading car fleet…');
await loadVendorCars(assets).catch((e) => console.warn('vendor cars:', e.message));
// trees are on every street, so this is AWAITED: a late swap would leave half the city procedural
await loadTreeModels(assets).catch((e) => console.warn('tree models:', e.message));
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
  if (A.mat.lampCone) A.mat.lampCone.opacity = 0; // additive haze cone under lamps: no in daylight
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
  // the asphalt was painted for sodium light; at noon it reads as tar.
  // 0xb4b8bd was a silver sheet — a modest lift keeps grain without going concrete.
  A.mat.tarmac.color.setHex(0x8e9298);
  A.mat.tarmac.metalness = 0.0;
  const dry = wetTarmacLook(0);
  A.mat.tarmac.roughness = dry.roughness;
  A.mat.tarmac.envMapIntensity = dry.envMapIntensity;
  A.mat.tarmac.normalScale.setScalar(dry.normalScale);
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
  window.__camera = camera;
  // the chase rig and the car shell: functions, so this block can run before either is constructed
  window.__chase = () => chase;
  window.__hero = () => hero;
  // shooting-layer state the harness cannot otherwise see or set (pointer lock is refused headless)
  window.__dbg = () => ({ started, aiming, ads, crouch, burst, heat: weapon.heat, ready: weapon.ready, kind: weapon.kind, ammo: weapon.ammo, health });
  window.__aim = (v) => { aiming = !!v; };
  window.__traffic = () => traffic;   // ?debug: squad roles and movement straight off the officers. A FUNCTION, not the value: this block runs long before `const traffic` and touching it here is a TDZ crash at boot
  window.__police = () => traffic.police.filter((c) => c.live).map((c) => ({ deployed: !!c.deployed, state: c.state, gun: c.gunKind, hp: c.hp, down: +c.down.toFixed(1), pose: c.pose, mode: c.mode, hunt: !!c.hunt, chase: !!c.chase, spd: +(c.speed || 0).toFixed(1), cruise: +(c.cruise || 0).toFixed(1), stale: +(c.stale || 0).toFixed(1), lost: +(c.lost || 0).toFixed(1), x: Math.round(c.x), z: Math.round(c.z), d: Math.round(Math.hypot(c.x - (onFoot.active ? onFoot.x : car.x), c.z - (onFoot.active ? onFoot.z : car.z))) }));
  window.__wanted = (n) => { traffic.wanted = n; };
  window.__hurt = (h) => { health = Math.max(0, health - (+h || 1)); hud.setHealth(health); if (health <= 0) onDeath(); };   // the death flow, on demand
  window.__hud = () => hud; window.__dying = () => ({ dying, wastedAnim, drowning, holdFire: traffic.holdFire });
  window.__audio = () => audio;   // ?debug: fire any sound by hand, and check the bank is wired
  window.__time = (h) => { clock.hour = ((+h) % 24 + 24) % 24; };          // the recording harness sets the hour
  window.__cmd = (line) => (commands ? commands.execute(line) : false);   // and runs chat commands ('/time 22', '/tp ...')
  window.__rain = (v) => { rainForce = v; };   // true/false forces the weather on/off; null returns it to the spells
  window.__breakNear = (x, z, r = 3) => debris.breakNear(x, z, r, car, 12);
  // frame-time distribution + worst chunk-build slice, for the perf harness
  window.__perf = () => ({ frames: [...stats.samples], chunk: stats.worstChunkMs });
}
let beach = null, water = null, crowd = null, heli = null, districtRef = null, drowning = 0;
let districtFailed = false;
let spawnSnap = false;        // the frame loop snaps the chase camera on its next update (chase is declared later; see the top-level awaits)   // lets the boot gate drop on the legacy grid if the district never lands
let lightPool = null;
let farTraffic = null;   // distant headlight sprites on the far road graph (world/farTraffic.js)
let jobs = null, garage = null, story = null, phone = null, dispatch = null, reputation = null, intelScanner = null;
let circuit = null, racewayTrackGroup = null;
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
const DEBUG_KEYS = new URLSearchParams(location.search).has('debug');
let muted = false;
try { muted = localStorage.getItem('hb.muted') === '1'; } catch { /* private mode */ }
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
/* A vehicle's engine: vhp starts at 8. Bullets take one each (a shotgun's
   pellets count once), a hard ram from your car one or two. At zero the
   cruise drops to 0 and it rolls to a stop; a cruiser's officers step out, a
   civilian's driver bails. One place, for the trigger and the collision. */
/** The hero's paint as a word for the radio: nearest of a small palette, from whichever mesh carries the paint (Kenney skin body or the loft hull). */
function paintName() {
  const col = hero?.userData?.body?.material?.color ?? hero?.userData?.hull?.material?.color;
  if (!col) return '';
  const NAMES = [['black', 0.05, 0.05, 0.06], ['white', 0.9, 0.9, 0.9], ['silver', 0.6, 0.62, 0.66], ['red', 0.7, 0.08, 0.08], ['blue', 0.1, 0.2, 0.7], ['green', 0.1, 0.5, 0.2], ['yellow', 0.9, 0.75, 0.1], ['orange', 0.9, 0.4, 0.05], ['grey', 0.35, 0.36, 0.38]];
  let best = '', bd = Infinity;
  for (const [n, r, g, b] of NAMES) { const d = (col.r - r) ** 2 + (col.g - g) ** 2 + (col.b - b) ** 2; if (d < bd) { bd = d; best = n; } }
  return best;
}

function damageVehicle(v, amount, isPolice) {
  if (!v || v.vhp === 0) return;
  v.stoppedBy = 'player';   // the vigilante bounty pays only for a fugitive YOU stopped (every player hit, ram and blast comes through here)
  v.vhp = Math.max(0, (v.vhp ?? 8) - amount);
  if (v.vhp === 0) {
    v.cruise = 0; v.baseCruise = 0; v.fleeT = 0; hud.flash(isPolice ? 'CRUISER DISABLED' : 'ENGINE OUT'); audio.thud?.(8);
    if (!isPolice) crowd?.eject(v.x, v.z, v.yaw);
  }
}

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
  if (wastedAnim !== 0 || dying > 0) return;   // already dying: the clip plays out, nothing lands on the body
  if (onFoot.active) {
    // on foot there is no bodywork to absorb it -- unless you bought some
    const a = absorb(armour, hit * 0.16 * DIFF.hurtScale); armour = Math.max(0, armour - a.toArmour);   // easy: a third
    health = Math.max(0, health - a.toHealth);
    hud.setHealth(health);
    grade.setDrops(0.9);
    if (health <= 0) onDeath();
    return;
  }
  car.impact = Math.max(car.impact || 0, 1.6 + hit * 2.2);
  car.yawRate += (Math.random() - 0.5) * hit * 0.9;
  damageModel.hit(2 + hit * 5, null, DIFF.hurtScale);
  // Car hull absorbs bullet impacts without crippling tyre blowouts, preserving thrilling high-speed police chase dynamics
}

/**
 * Put the car somewhere real.
 *
 * resetCar() only resets STATE -- its x/z are the origin of the procedural
 * grid this game stopped using, so pressing R dropped you in an empty corner
 * of the map. Everywhere that resets the car has to say where, and the
 * drowning recovery was the only place that did.
 */
/**
 * Put the car on the Halstead Mile's start line and run the route.
 *
 * Shift+R, or `/mile` in the chat. The route is data in game/scenicRoute.js;
 * this only places the car and hands the waypoints to Mission, which already
 * owns the rings, the beam, the countdown and the arrival tests.
 *
 * The clock is set to 16:20 unless it is already inside golden hour, because
 * the whole ORDER of the route exists to put the sun down the lift bridge deck
 * on leg 4 -- see the header of scenicRoute.js. Starting it at midnight is
 * allowed, it just throws away the reason the waypoints are in that order.
 */
const RIVALS = +(new URLSearchParams(location.search).get('rivals') ?? 5);

function startHalsteadMile() {
  if (!districtRef) { hud.flash('THE HALSTEAD MILE · CITY STILL LOADING'); return; }
  const start = HALSTEAD_MILE[0];
  resetCar(car);
  car.x = start.x;
  car.z = start.z;
  car.y = (districtRef.elevationAt?.(start.x, start.z) ?? 0) + 0.62;
  car.yaw = startYaw();
  if (clock.hour < 16.0 || clock.hour > 18.0) clock.hour = DEFAULT_HOUR;
  const pts = missionPoints();
  mission?.route(pts, 'THE HALSTEAD MILE · 5.7 km');
  navigation?.setWaypoint?.(pts[0].x, pts[0].y);
  if (navigation) navigation.lastTarget = null;
  /* A FIELD, not a time trial. The rivals are ordinary fleet cars driven by
     the same steering that makes a cruiser chase you, following the route
     expanded through the road graph -- see traffic.startRace. */
  const line = drivingLine(navigation);
  const n = traffic.startRace?.(line, RIVALS, car.yaw) ?? 0;
  hud.flash(n ? `THE HALSTEAD MILE · ${n} RIVALS · GOLDEN HOUR` : 'THE HALSTEAD MILE · 8 MARKS · GOLDEN HOUR');
}

function startCircuitRace() {
  if (!districtRef) { hud.flash('HALSTEAD RACEWAY · CITY STILL LOADING'); return; }
  if (onFoot?.active) useVehicle();
  if (!raceCircuit) {
    hud.flash('HALSTEAD RACEWAY · CIRCUIT STILL PREPARING');
    return;
  }
  resetCar(car);
  car.x = 3560;
  car.z = 2457;
  car.yaw = 0;
  car.y = (districtRef.elevationAt?.(3560, 2457) ?? 1.2) + 0.62;
  car.vx = 0;
  car.vz = 0;
  car.speed = 0;
  car.fwdSpeed = 0;
  world?.update?.(car.x, car.z);
  spawnSnap = true;
  raceCircuit.startCircuitRace(car);
}
window._startCircuitRace = () => startCircuitRace();
window.startTrackRace = () => startCircuitRace();

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
    if (best) {
      // Align with connected road segment and place in driving lane rather than dead intersection center
      const edges = districtRef?.graph?.edges?.filter((e) => e.a === best.id || e.b === best.id);
      if (edges && edges.length > 0) {
        const edge = edges[0];
        const otherId = edge.a === best.id ? edge.b : edge.a;
        const otherNode = nodes.find((q) => q.id === otherId);
        if (otherNode) {
          const dx = otherNode.x - best.x, dz = otherNode.y - best.y;
          const len = Math.hypot(dx, dz) || 1;
          const yaw = Math.atan2(-dz, dx);
          const off = Math.min(6.5, (edge.width || 26) * 0.22);
          car.x = best.x + (dx / len) * 8.0 - (dz / len) * off;
          car.z = best.y + (dz / len) * 8.0 + (dx / len) * off;
          car.yaw = yaw;
        } else {
          car.x = best.x; car.z = best.y;
        }
      } else {
        car.x = best.x; car.z = best.y;
      }
    }
  } else {
    car.x = 2351.5; car.z = 1356.0; car.yaw = -Math.PI / 2 - 0.03;
  }
  const gy = groundHeightAt(car.x, car.z);
  car.y = gy + 0.62;
  if (hero) {
    hero.position.set(car.x, gy, car.z);
    hero.rotation.set(0, car.yaw, 0);
  }
  damageModel.repair();
  spawnSnap = true;
  chase.snap(car);
}

/**
 * Killed. Distinct from being arrested: the police take you to a station,
 * a fireball takes you to a hospital.
 */
function onDeath() {
  if (story?.active && wastedAnim !== 1) { story.abandon?.(); hud.flash('MISSION FAILED'); }   // a heist does not continue from the hospital
  /* On foot, the body falls first and the fade follows: the Death clip runs,
     input is dead, then the respawn. In a car it is the old instant fade. */
  if (wastedAnim === 1) return;        // the clip is still playing; the timer will call us back
  if (onFoot.active && wastedAnim === 0 && onFoot.character?.ready) {
    const ms = onFoot.character.die();
    if (ms > 0) {
      wastedAnim = 1; controlsLockedUntil = performance.now() + ms + 300;
      traffic.holdFire = true;         // the officers lower their guns while you fall (the hit handler ignores the rest)
      wastedTimer = setTimeout(() => { wastedTimer = 0; hud.blackout(() => { wastedAnim = 2; onDeath(); }); }, ms + 300);
      return;
    }
  }
  wastedAnim = 0;                      // 2 -> 0: the animation ran, now the real WASTED path
  traffic.holdFire = false;
  bustFlash = 2.8;
  /* The hospital bills you: GTA's rule, and the reason a death costs something
     when the ammo comes back with you. Never more than you have. */
  if (garage && garage.cash > 0) { const fee = Math.min(garage.cash, 500); garage.addCash(-fee, 'HOSPITAL'); hud.flash(`HOSPITAL FEE · -$${fee}`); }
  jobs?.fail('WASTED · JOB LOST');
  hud.setDead(true);
  traffic.standDown();
  if (mission && mission.active) mission.stop('WASTED');
  health = 1; hud.setHealth(1);
  /* Armour is what you were wearing when you went down: gone. Weapons and
     ammo come back with you (GTA V's hospital, not III's). */
  if (armour > 0) { armour = 0; saveArsenal(); }
  // Wake up outside the nearest hospital
  const hospitals = (districtRef?.places || []).filter((p) => p.type === 'hosp');
  const at = hospitals.reduce((best, p) => {
    const d = Math.hypot(p.x - car.x, p.y - car.z);
    return d < best.d ? { d, p } : best;
  }, { d: Infinity, p: null }).p;
  respawnCar(at ? at.x : CITY_CENTRE.x, at ? at.y + 12 : CITY_CENTRE.z);
  /* You wake up ON FOOT at the hospital doors, the car parked at the kerb
     beside you with whatever body it had (a stolen one stays stolen -- the
     chop shop is still the only way to turn it into cash). Getting back in
     is the same F as always. No hospital on the map: the old in-car respawn. */
  if (at) {
    exitCarOnFoot();
    car.throttle = 0; car.brake = 1; car.hand = 1;
  } else if (onFoot.active) onFoot.enter();
  hero.visible = true;
  drowning = 0;
  chase.shake = 0;
}

function onBust() {
  if (wastedAnim !== 0 || dying > 0) return;   // you are dying, not surrendering: the WASTED path owns this respawn
  if (story?.active) { story.abandon?.(); hud.flash('MISSION FAILED'); }
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
let wastedTimer = 0;  // the clip's respawn timer, so a bust or a second death cannot double it
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
    damageVehicle(v, Math.round(4 * k + 1), !!v.hunt || traffic.police.includes(v));   // the same engine rule as bullets and rams
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
let raceCircuit = null; // Halstead International Raceway manager
let aiming = false, ads = 0, burst = 0, sinceShot = 9, swayPhase = 0, crouch = false;
let lastFiredAt = -1e9;   // officers advance when you have been quiet for a while
let lastHurtAt = -1e9;    // health regenerates to half once this is six seconds old
let healTick = 0;
let skidT = 0, exhaustT = 0;   // tyre-smoke and exhaust cadences
let farShotT = 25;        // distant gunfire cadence (ambient, night)
let farSirenT = 70;       // distant siren cadence (ambient, any hour)
let rainHeard = null;     // last rain amount handed to the audio
let rainForce = null;     // ?debug __rain(): force the weather on or off
let tokyoAmbT = 0, tokyoNodes = null, chimeT = 0;   // district-ambience poll cadence; the district's junctions; crossing-chime cadence
let clockRestored = false;
let idleT = 0, idleCam = false, idleCamShown = false;   // seconds since any input; the parked-car orbit camera; whether the HUD is currently faded for it
let lastDistrict = null, distT = 0, wantedWas = 0;   // wantedWas: the first star's dispatch call  // for the area toast and the dispatch call-out on a district change (polled twice a second)
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
  // one path per officer hit: hitAny returns false on a non-downing hit, and the old `hitAny || hitPost` then took the same hp again through hitPost
  if (hit && hit.kind === 'officer') { const dmg = weapon.spec.damage * (hit.head ? 3 : 1); if (hit.head) hud.flash('HEADSHOT'); const downed = (hit.ref.mesh || hit.ref.roof) ? traffic.hitAny?.(hit.ref, dmg) : roadblock?.hitPost?.(hit.ref, dmg); if (downed) { modes?.onOfficerDown(); story?.onOfficerDown?.(); hud.flash(modes?.active === 'holdout' ? 'OFFICER DOWN · +50' : 'OFFICER DOWN'); } crosshair.hit(hit.ref.down > 0); }
  if (hit && hit.kind === 'person') { hit.ref.down = 0.001; hit.ref.dead = true;   /* a shot pedestrian stays down (crowd.js clears the body later) */ bloodDecals.stamp(hit.ref.x, groundHeightAt(hit.ref.x, hit.ref.z) + 0.01, hit.ref.z, 0, 1, 0, 0.8 + Math.random() * 0.5); }
  if (hit && (hit.kind === 'car' || hit.kind === 'police')) {   // vehicles only: boards, marksmen and posts have no .mesh
    hit.ref.speed *= 0.55;
    hit.ref.mesh?.material?.color?.offsetHSL(0, -0.05, -0.04);
    /* A vehicle takes eight rounds (a shotgun's pellets count once). Then the
       engine is done: cruise 0, so a cruiser rolls to a stop where it is and
       its officers have to come out on foot. spawnGraph resets it on respawn. */
    damageVehicle(hit.ref, 1, hit.kind === 'police');
  }
}
const _obsBuffer = [];
/* Distance-to-BAY test for the surf bed. The first cut called
   districtRef.nearShore(), which does not exist on District -- it would have
   returned undefined, gone falsy, and left the beach silent with nothing to
   show for it. Walks the bay polyline, same shape as nearRiver below. */
let _bayPts = null;
function nearBay(x, z, r = 150) {
  if (!_bayPts) {
    _bayPts = districtRef?.data?.water?.bay ?? [];
    if (!_bayPts.length) return false;
  }
  const r2 = r * r;
  for (let i = 1; i < _bayPts.length; i++) {
    const [ax, az] = _bayPts[i - 1], [bx, bz] = _bayPts[i];
    const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
    let t = L ? ((x - ax) * dx + (z - az) * dz) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ox = x - (ax + t * dx), oz = z - (az + t * dz);
    if (ox * ox + oz * oz < r2) return true;
  }
  return false;
}

/* Distance-to-river test for the ambience bed. Cheap: the polyline is 99 points
   and this runs once a frame, so it walks it rather than building a grid. */
let _riverPts = null;
function nearRiver(x, z, r = 130) {
  if (!_riverPts) {
    _riverPts = districtRef?.data?.water?.river?.points ?? [];
    if (!_riverPts.length) return false;
  }
  const r2 = r * r;
  for (let i = 1; i < _riverPts.length; i++) {
    const [ax, az] = _riverPts[i - 1], [bx, bz] = _riverPts[i];
    const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
    let t = L ? ((x - ax) * dx + (z - az) * dz) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ox = x - (ax + t * dx), oz = z - (az + t * dz);
    if (ox * ox + oz * oz < r2) return true;
  }
  return false;
}

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

/** Supply OnFoot's safe-exit chooser with the live collision world. */
function exitCarOnFoot(vehicle = car) {
  return onFoot.exit(
    vehicle,
    (x, z) => Math.max(world.district?.elevationAt?.(x, z) ?? 0, groundHeightAt(x, z)),
    walkSolid,
    (x, z) => !world.district?.inWater?.(x, z),
  );
}

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
    if (traffic.wanted > 0 && !traffic.hot) traffic.coldFor = Math.max(traffic.coldFor || 0, 6);   // new wheels: the description they were working from is stale, the trail goes colder
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
  audio.doorOpen?.();
  clearTimeout(d.timer);
  d.timer = setTimeout(() => {
    d.target = 0;
    audio.doorShut?.();
  }, hold * 1000);
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
            hud.flash('🚁 W fly forward · S brake · SPACE climb · SHIFT descend · A/D turn · F exit');
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
      hud.flash('🚁 W fly forward · S brake · SPACE climb · SHIFT descend · A/D turn · F exit');
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
            hud.flash('🚁 W fly forward · S brake · SPACE climb · SHIFT descend · A/D turn · F exit');
          } else if (v.type === 'tank') {
            hud.flash('HEAVY ARMOR — W/S drive, A/D pivot steer, MOUSE AIM cannon');
          }
          return;
        }
      }
    }
    driverDoor(1.4);                       // step out; it swings shut behind you
    if (!exitCarOnFoot()) {
      hud.flash('NO SAFE PLACE TO EXIT');
      return;
    }
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
    window._catalogue = c;   // F3 'emit slice' reads emitWorstMs
    return c;
  })
  .catch((e) => { console.warn('catalogue unavailable:', e.message); return null; });

Promise.all([loadDistrict(), catalogueReady, new URLSearchParams(location.search).has('nokit') ? null : loadKitBuildings(assets).catch((e) => console.warn('kit buildings:', e.message))]).then(async ([district, catalogue]) => {
  registerRaceTrackPhysics(district);
  useDistrict(district);                  // roadDepth() now answers from the file
  traffic.useGraph(district);
  useGraphForRoutes(district);             // and the fleet drives the real streets
  hud.useDistrict(district);              // minimap draws real streets, not a lattice
  navigation = new Navigation(district);
  hud.useNavigation(navigation);
  /* PRE-WARM THE CATALOGUE (2026-09-14).
     Every asset is fetched and parsed HERE, behind the boot screen, instead of
     on the frame a chunk first asks for it. The whole library is small -- 141
     assets / 337 GLB files including LODs, 12.99 MB on disk -- and fetchAsset
     already caches per record and de-dupes concurrent callers, so this is a
     cache fill and nothing downstream changes.

     A BOUNDED POOL, not Promise.all over 337 urls. The fetch is cheap; the
     PARSE is not, and it is main-thread: firing all of them at once lands 337
     GLTFLoader parses back to back, which blocks the very frame loop that
     paints the progress bar, so the screen freezes and then jumps. A small
     pool leaves gaps for rAF and keeps the bar moving.

     Deliberately BEFORE `new DistrictWorld`, so the initial 5x5 ring builds
     from a warm cache instead of racing the network. The streaming ring itself
     is untouched -- this removes pop-in, not the 2 ms slicing that holds 60 fps.

     `?nowarm` skips it and restores the old lazy behaviour. */
  catalogueRef = catalogue;
  if (catalogue && !new URLSearchParams(location.search).has('nowarm')) {
    const allNames = [...catalogue.assets.keys()];
    const isSpawnEssential = (k) => /hero|tokyo|pencil|sakura|ginkgo|lamp|signal|barrier|sign|bench|bin|tree|corvette/i.test(k);
    const tier1Names = allNames.filter(isSpawnEssential);
    const tier2Names = allNames.filter(k => !isSpawnEssential(k));

    const t0 = performance.now();
    let done = 0, next = 0;
    const POOL = 16;   // fetch overlaps; the parse is main-thread and serialises anyway
    const worker = async () => {
      while (next < tier1Names.length) {
        const i = next++;
        try { await catalogue.fetchAsset(tier1Names[i]); } catch { /* fetchAsset already warns and caches an empty */ }
        done++;
        if (done % 4 === 0 || done === tier1Names.length) {
          setBootProgress(45 + Math.round((done / tier1Names.length) * 22), `Loading essentials… ${done}/${tier1Names.length}`);
          await new Promise((r) => requestAnimationFrame(r));   // let the bar actually paint
        }
      }
    };
    await Promise.all(Array.from({ length: POOL }, worker));
    console.info(`catalogue tier 1 fast-warm: ${tier1Names.length} assets in ${Math.round(performance.now() - t0)} ms`);

    // Tier 2 background streaming disabled: on-demand chunk loading via InstanceBatch.emit
    // loads props as needed without saturating the main thread with 105+ GLB parses during gameplay.
    window._startBackgroundAssetStream = null;

    /* And the textures. Do not block boot indefinitely on textures: give them up to 1.5s max */
    if (catalogue.texturesReady) {
      setBootProgress(68, 'Preparing graphics…');
      await Promise.race([catalogue.texturesReady, new Promise((r) => setTimeout(r, 1500))]);
    }
  }

  setBootProgress(70, 'Building the streets…');
  /* `lite` in DistrictWorld means exactly "radius 1 + propRadius 1" (districtWorld.js:189-192, its only
     three reads) and it overrides `radius`, so the preset's streamRadius drives it: 1 -> the 3x3 ring LITE
     runs today, 2 -> the 5x5 FULL ring. Boot-time: the ring is built once and streamed, never re-sized. */
  world = new DistrictWorld(scene, assets, district, { day: DAY, catalogue, lite: Q.streamRadius < 2, radius: Q.streamRadius, only: RACE_MODE ? isRacewayArea : null });
  /* Retire the legacy 130 m grid HERE, at the swap, and not a page earlier.
     It used to be cleared before the catalogue pre-warm, whose awaits let the
     frame loop keep ticking world.update() on the City for a few seconds --
     and it rebuilt all 25 cells around the origin, which nothing removed
     again: 683 direct draws / 409k tris / 331k shadow-caster tris a frame in
     BOTH modes, 2.7 km from the car (census 2026-09-22). */
  for (const g of city.cells.values()) { scene.remove(g); releaseCell(g); }
  city.cells.clear();
  window._world = world;
  world.camera = camera;                  // chunk-level frustum culling for the render bundles
  /* Before the LightPool: it decides at construction whether to allocate hero
     lights at all (lighting.js reads world.heroLightsByChunk), and Landmarks is
     what fills that map; it also puts world.extraSolids in place before the
     first chunk builds its box list. */
  landmarks = RACE_MODE ? null : new Landmarks(scene, district, world);   // Phase 6 skyline + gun shop, supermarket, street set (world/landmarks.js); none on the race run
  /* Always, not `if (!DAY)`. The pool was built only for a ?night boot, so a
     normal session -- which boots at 16.85 and runs a full day in 24 real
     minutes -- reached midnight with no pool: 2 lights alive, parked at the
     origin, against 2,077 registered lamp heads. A PointLight cannot be added
     to a live WebGPU scene without recompiling every pipeline (~2 s stall), so
     the slots have to exist from boot; clock.js fades them with nightFactor,
     the same curve that already staggers lamps, signs and windows. */
  {
    const n = +(new URLSearchParams(location.search).get('lights') ?? (isLite ? 4 : 6));
    lightPool = new LightPool(scene, world, { count: n });
  }
  farTraffic = RACE_MODE ? null : new FarTraffic(scene, district, { count: Q.farTraffic });   // preset: 60 / 120 / 220 (was isLite ? 120 : 220); buffers sized here, the ladder only lowers .n   // GTA's distant headlights: phantom cars on the far road graph, one draw, count 0 by day
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
  if (!RACE_MODE) buildPlaces(scene, district, DAY);
  const params = new URLSearchParams(location.search);
  /* The beach is ON (2026-09-14). It was behind `?beach`, so Halstead Sands --
     promenade, palm row, 120 m pier, lifeguard towers, a crowd -- existed in the
     build and in the photo presets but not in anybody's session; the `beach`
     preset framed empty water. Measured cost is +17 draws (docs/CLAUDE.md), which
     against a ~2,000 draw frame is noise. `?nobeach` turns it off.
     The CATALOGUE is passed now too: buildBeach has taken one as its fourth
     argument all along and never received it, so it could not place a single
     authored asset -- which is why the eight Riviera props had nowhere to go. */
  if (!params.has('nobeach') && !RACE_MODE) beach = buildBeach(scene, district, DAY, catalogue);
  /* The river's two banks: wall, coping, plane trees, lamps, benches. Until
     now water.js cut the river out of the ground plate and nothing put an edge
     on it, so THE EMBANKMENT -- 1,281 m of arterial following the river, and
     the spine of the scenic route -- ran through open field beside a blue
     strip. `?noriver` turns it off. */
  if (!params.has('noriver') && !RACE_MODE) buildRiverside(scene, district, DAY, catalogue);
  /* The crowd is ON again (2026-09-23). It went opt-in (`?crowd`) when it was
     six draws of jointed skittles plus 16 Kenney characters with a mixer each;
     it is now one sculpted, GPU-posed person mesh in TWO draws (world/figure.js:
     48 near at 3.4k triangles, the rest at 0.9k). A city with empty pavements
     is not the brief. `?nocrowd` turns it off. The Kenney near-field layer
     (People: 72-triangle blocky characters) is now a downgrade on the near
     mesh, so it only runs when asked for with `?people=N`. */
  if (crowdWanted) {
    crowd = new Crowd(scene, district, Q.crowd);   // preset: 80 / 110 / 160 / 320; the fleet is sized at construction, so boot-time
    crowd.onNear = () => chatter?.civilian?.('near');
    if (params.has('people')) people = new People(scene, +(params.get('people') || 16));
  }
  heli = RACE_MODE ? null : new Helicopter(scene, DAY);
  if (heli) {
    heli.district = district;
    heli.nearbyBuildings = (x, z) => (world.nearbyBuildings ? world.nearbyBuildings(x, z) : []);
    heli.onArrive = () => hud.flash('AIR SUPPORT INBOUND');
  }
  mission = new Mission(scene, district);
  mission.useHud(hud);
  mission.useAudio(audio);
  jobs = new Jobs(mission, traffic, hud, district, audio, navigation);
  garage = new Garage(jobs, assets, hero, damageModel, hud, car);
  garage.heat = () => traffic.wanted;
  garage.onRepair = () => {   // Pay 'n' Spray: a respray below three stars loses the police; at three or more they know the driver, not the car
    if (traffic.wanted > 0 && traffic.wanted < 3) { traffic.standDown(); chatter?.radio?.('Suspect vehicle lost. Cancel the description.'); return true; }
    return false;
  };
  traffic.hud = hud;
  roadblock = new Roadblock(scene, assets, district, world, traffic, hero);
  if (params.has('metro')) metro = new Metro(scene, district, assets);
  garage.restore();
  story = new StoryManager(mission, traffic, hud, garage, audio, navigation);
  dispatch = new DispatchService(scene, world, garage, traffic, debris, hud, audio, navigation);
  window._dispatch = dispatch;
  if (params.has('debug')) window.addCash = (amount = 50000) => {
    garage.addCash(amount, 'TEST FUNDS');
  };
  if (params.has('rpg')) {
    reputation = new ReputationSystem(garage, audio, hud, scene);
    intelScanner = new IntelScanner(audio, hud);
  }
  window._reputation = reputation;
  window._intel = intelScanner;
  phone = new Phone(story, garage, hero, traffic, dispatch, car, reputation, intelScanner, navigation);
  vehicleVFX = new VehicleVFX(scene, hero);
  window.vehicleVFX = vehicleVFX;
  if (params.has('puddles')) puddles = new PuddleSystem(scene, district);

  if (!params.has('nobillboards')) billboards = new BillboardSystem(scene, district, CITY_CENTRE);
  if (!params.has('nostreetlife')) streetLife = new StreetLife(scene, district);
  if (!params.has('noairspace')) airspace = new Airspace(scene);
  /* The other half of the race handshake: say when YOU finish. Set here
     rather than on join, because the room can be joined before the district
     has loaded and there would be no mission to hang it on. */
  mission.addListener('finish', (t) => { if (net) net.race({ k: 'stop', t }); });
  /* The seeded checkpoint course, solo from the phone (CHECKPOINT RUN card). */
  window._mission = mission;
  window.__startRun = () => {
    if (mission.active) { mission.stop('RUN ABANDONED'); return false; }
    if (jobs?.job) jobs.toggle(car);   // one route marker at a time
    mission.start(car);
    return true;
  };
  traffic.onShot = onShot;
  traffic.onBust = onBust;
  window.district = district;
  districtRef = district;

  const racewayGroup = buildRaceTrack(scene, district);
  raceCircuit = new RaceCircuit(scene, hud, traffic, audio, garage);
  raceCircuit.setTrackGroup(racewayGroup);
  hud.useCircuit(raceCircuit);
  window.raceCircuit = raceCircuit;
  // Race run: the car goes straight to the grid and the Tokyo spawn below is
  // skipped -- it used to run AFTER this and drag the car back to (2354, 1408)
  // at the far side of the map, where nothing in the raceway-only ring is built.
  if (RACE_MODE) {
    startCircuitRace();
    chase.snap(car);
  } else {
  // Put the car in Little Tokyo on the northbound lane of Tokyo Street (Road 168)
  // Perfectly aligned with the road heading north directly under the illuminated Grand Torii Arch
  const spawnX = 2354.0;
  const spawnZ = 1408.0;
  const spawnYaw = -Math.PI / 2;
  resetCar(car);
  car.x = spawnX;
  car.z = spawnZ;
  car.yaw = spawnYaw;
  car.y = (world.district?.elevationAt?.(spawnX, spawnZ) ?? groundHeightAt(spawnX, spawnZ)) + 0.62;
  car.vx = 0; car.vz = 0; car.speed = 0; car.yawRate = 0;
  world.update(car.x, car.z);
  if (hero) {
    const gy = world.district?.elevationAt?.(spawnX, spawnZ) ?? groundHeightAt(spawnX, spawnZ);
    hero.position.set(spawnX, gy, spawnZ);
    hero.rotation.set(0, spawnYaw, 0);
  }
  spawnSnap = true;
  chase.snap(car);
  }
  {
    /* Place the person on the pavement beside wherever the car ended up. This
       read spawnX/spawnZ/spawnYaw, which are block-scoped to the Tokyo spawn
       branch above since race mode split it: outside that block they do not
       exist, the ReferenceError landed in this promise's catch, and every
       boot fell back to the legacy grid ('district not loaded, staying on the
       grid: spawnX is not defined', 2026-09-23). The car is the spawn in both
       branches, so read it. */
    person.place(car.x - 7.5, car.z, car.yaw + Math.PI / 2);
  }
  // now the car is on its spawn node, lay the film route from where it stands
  ROUTE = buildRoute(null, car.x, car.z);
  console.info(`Halstead Bay loaded — spawn at Little Tokyo (${car.x}, ${car.z})`);
  /* spawn is the city. No toast. */
}).catch((e) => { districtFailed = true; console.warn('district not loaded, staying on the grid:', e.message); });

// ---- the car ----
const car = createCarState();
car.type = 'car';
/* Headlights are active by default from spawn (crisp modern LED low beam).
   H toggles High-Beam Rally Projectors. */
car.headlights = !DAY;
car.headlightMode = 'low';
car.lightsUser = false;
const hero = buildCar(assets.carMats, 0x5b636d);
scene.add(hero);
// the damage model marks the real bodywork, so it needs the real meshes
// the hero's visible body is the high-poly Corvette C8 ZR1 PBR model
/* The deep blue Camaro is the default car (2026-09-15). Identified by its
   material rather than by eye: of the eight shipped Sketchfab bodies, only
   camaro-350 has a saturated BODY material -- `CarPaint` at #001b8a, a deep
   navy. Every other car's most-saturated material is lights, glass or brake
   calipers (corvette-c6r #ff0000 is `glass_lights`, porsche-gt3r #ff0000 is
   `EXT_CALIPER`), so none of them is actually a blue car.
   A saved choice still wins: if you have ever picked a body in the garage,
   localStorage 'hb.body' holds it and this default never applies. */
const initialBody = localStorage.getItem('hb.body') || DEFAULT_BODY;
await loadHeroSkin(assets, hero, initialBody).catch((e) => console.warn('hero skin:', e.message));
damageModel.attach(hero);
car.profile = getVehicleProfile(initialBody);
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

// ?cars=N overrides the fleet size (0 for a clear road: recording a lap, or a harness run that must not get T-boned)
/* NaN when ?cars= is absent. It used to default to (DAY ? 36 : 40) here, which made the
   Number.isFinite(CARS) fallback on the next line dead code -- the preset count could
   never be reached. ?cars=N still overrides everything. */
const CARS = +(new URLSearchParams(location.search).get('cars') ?? NaN);
const traffic = new Traffic(scene, assets, RACE_MODE ? 0 : (Number.isFinite(CARS) ? CARS : (DAY ? Q.traffic : (Q.trafficNight ?? Q.traffic))), !DAY);   // race mode: rivals only, no civilians; preset 14 / 26 / 36 (40 at night on high, the old DAY ? 36 : 40)
traffic.difficulty = DIFF;
officerPool(scene);   // start the rig fetch at boot: acquire() returns null while it is in flight, and the first squad of a session would otherwise be the old boxes   // Phase 5: denser, and lit at night
const chase = new ChaseCamera(camera);
chase.buildings = (x, z) => (world?.nearbyBuildings ? world.nearbyBuildings(x, z) : null);   // the lens pulls in rather than sit inside a facade
const weather = createWeather(scene, { hemi, dome: () => dome, onStrike: (delay) => audio.thunder?.(delay) });   // always built: rain comes in night spells (rainSpell) on the day cycle, and all night with ?night
const hud = new Hud();
let navigation = null;
const clock = new GameClock({ startHour: +(new URLSearchParams(location.search).get('time') ?? (DAY ? 16.85 : 19.5)) });
hud.useClock(clock);
const stats = new Stats();
window.stats = stats;
window.renderer = renderer;
window.scene = scene;
photo = new Photo(camera, stats);
  photo.useClock?.(clock);   // a district preset sets the hour that flatters it (photo.js PRESETS)
window.photo = photo;

const audio = createAudio();
if (muted) audio.mute(true);   // restored from hb.muted
radio = new Radio(audio, hud);
window.hud = hud;   // phone.js cards flash through window.hud and route GPS through __setWaypoint
window.__setWaypoint = (x, z, label) => { navigation?.setWaypoint?.(x, z); if (label) hud.flash(`GPS · ${label}`); };

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
const warpTo = (x, z, yaw = 0) => {
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
window.__warp = warpTo;
const video = new VideoMode({ car, chase, hero, hud, clock, warpTo });
chase.hero = hero;   // the cockpit rig reads the worn body's driver's-eye from hero.userData.cockpit

commands = new CommandEngine({
  car,
  traffic,
  renderer,
  stats,
  get world() { return world; },
  get isLite() { return isLite; },
  gpuInfo,
  quality,
  setQuality: (mode) => {
    // low | medium | high are presets; lite | full are the GPU-tier override gpu.js reads from the same key
    try {
      if (mode === 'default' || mode === 'auto') {
        localStorage.removeItem(QUALITY_KEY);
      } else {
        localStorage.setItem(QUALITY_KEY, mode);
      }
    } catch (_) {}
    location.reload();
  },
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
  mile: () => startHalsteadMile(),
  startTrackRace: () => startCircuitRace(),
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
/* Title-card quality toggle (index.html #hud .quality). Cycles Auto -> Low ->
   Medium -> High and persists to hb.quality; every knob is boot-time (the
   renderer, lights, post stack and ring are already built by the time the card
   is clickable), so a change that differs from what booted reloads on ENTER
   and the card says so. stopPropagation: the overlay click IS the start button. */
const qualityLine = document.querySelector('#hud .quality');
let qualityChosen = (() => { try { const s = localStorage.getItem(QUALITY_KEY); return QUALITY_NAMES.includes(s) ? s : 'auto'; } catch { return 'auto'; } })();
// ?quality= in the URL outranks the toggle (dev flag), so picking AUTO under it is not pending: it would reload forever
const qualityPending = () => (qualityChosen === 'auto' ? quality.source === 'saved' : qualityChosen !== quality.name);
const drawQualityLine = () => {
  if (!qualityLine) return;
  qualityLine.querySelector('b').textContent = qualityChosen.toUpperCase() + (qualityChosen === 'auto' ? ` (${quality.name})` : '');
  qualityLine.querySelector('small').textContent = qualityPending() ? 'applies on ENTER (reloads)' : 'click to change';
};
qualityLine?.addEventListener('click', (e) => {
  e.stopPropagation();
  qualityChosen = QUALITY_NAMES[(QUALITY_NAMES.indexOf(qualityChosen) + 1) % QUALITY_NAMES.length];
  try { if (qualityChosen === 'auto') localStorage.removeItem(QUALITY_KEY); else localStorage.setItem(QUALITY_KEY, qualityChosen); } catch { /* private mode */ }
  drawQualityLine();
});
drawQualityLine();

/* Title-card mode cards (index.html .mode). A card only selects -- it stops
   its click, which would otherwise reach the overlay and start free roam --
   and ENTER, or any other click or key, starts; the chosen mode fires half a
   second in, once the HUD is up. Every mode already existed; none was findable. */
let menuMode = 'free';
const modeCards = document.querySelectorAll('#hud .mode');
for (const b of modeCards) b.addEventListener('click', (e) => {
  e.stopPropagation();
  menuMode = b.dataset.mode;
  for (const o of modeCards) o.classList.toggle('active', o === b);
});
const MENU_MODES = {
  jobs: () => jobs?.toggle(car),
  story: () => phone?.toggle(true),   // the phone opens on HEISTS
  range: () => { if (!onFoot.active) useVehicle(); if (onFoot.active) modes.startRange(onFoot.x, onFoot.z, onFoot.camYaw); },
  holdout: () => modes.startHoldout(),
};

const start = () => {
  if (!started && qualityPending()) { location.reload(); return; }
  if (!started) { started = true; hud.dismiss(); if (MENU_MODES[menuMode]) setTimeout(MENU_MODES[menuMode], 500); }
  audio.resume();
};
hud.overlay.addEventListener('click', start);
if (TOUCH) hud.overlay.addEventListener('pointerdown', start);   // a tap fires click late or not at all when the finger moves
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

// ---- automated feature tour & video recorder ----
const featureTour = new FeatureTour({
  car,
  chase,
  get onFoot() { return onFoot; },
  get weapon() { return weapon; },
  get hud() { return hud; },
  get phone() { return phone; },
  get activeVehicle() { return activeVehicle; },
  get canvas() { return canvas; },
  warp: (x, z, yaw) => {
    if (onFoot.active) {
      onFoot.enter();
      if (hero) hero.visible = true;
    }
    if (activeVehicle && activeVehicle !== carVehicle) {
      activeVehicle.exit();
      activeVehicle = carVehicle;
      window._activeVehicle = activeVehicle;
      car.type = 'car';
    }
    window.__warp(x, z, yaw);
  },
  stepOutOfVehicle: () => {
    if (activeVehicle && activeVehicle !== carVehicle) {
      activeVehicle.exit();
      activeVehicle = carVehicle;
      window._activeVehicle = activeVehicle;
      car.type = 'car';
      if (hero) hero.visible = false;
      onFoot.exit({
        x: car.x,
        z: car.z,
        yaw: car.yaw || 0,
      }, (x, z) => Math.max(world.district?.elevationAt?.(x, z) ?? 0, groundHeightAt(x, z)));
      if (hero) hero.visible = true;
    } else if (!onFoot.active) {
      exitCarOnFoot();
      if (hero) hero.visible = true;
      car.throttle = 0; car.brake = 1; car.hand = 1;
    }
  },
  equipWeapon: (kind) => {
    held = 'gun';
    weapon.reserve[kind] = Math.max(weapon.reserve[kind] || 0, 120);
    weapon.mags[kind] = ARSENAL[kind]?.mag || 30;
    weapon.switchTo(kind);
    refreshHeldGun();
    if (heldGun) heldGun.visible = true;
  },
  fireWeapon: () => {
    held = 'gun';
    if (heldGun) heldGun.visible = true;
    weapon.ammo = Math.max(weapon.ammo, 1);
    fire();
  },
  throwGrenade: () => {
    held = 'grenade';
    grenades.count = Math.max(grenades.count, 5);
    fire();
  },
  spawnAndEnterTank: () => {
    if (onFoot.active) onFoot.enter();
    if (activeVehicle && activeVehicle !== carVehicle) activeVehicle.exit();
    const px = onFoot.active ? onFoot.x : car.x;
    const pz = onFoot.active ? onFoot.z : car.z;
    const tank = dispatch?.requestTank({ x: px, z: pz, yaw: car.yaw }, 0);
    if (tank) {
      tank.enter(hero);
      activeVehicle = tank;
      window._activeVehicle = activeVehicle;
      car.type = 'tank';
      if (hero) hero.visible = false;
      car.throttle = 0; car.brake = 1; car.hand = 1; car.vx = 0; car.vz = 0;
      chase.snap(tank);
    }
    return tank;
  },
});

window.featureTour = featureTour;
window.startFeatureTour = () => {
  if (!started) start();
  featureTour.start();
};

const tourParam = new URLSearchParams(location.search);
if (tourParam.has('tour') || tourParam.get('record') === 'tour') {
  setTimeout(() => {
    window.startFeatureTour();
  }, 2200);
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

const onInputAction = (action) => {
  idleT = 0;
  // C: cycle the chase camera; on foot it is the crouch toggle. (The handler was lost in a headlight edit; the key still sent 'camera'.)
  if (action === 'camera') {
    if (onFoot.active) { crouch = !crouch; onFoot.crouch = crouch; hud.flash(crouch ? 'CROUCH' : 'STAND'); }
    else {
      chase.cycle();
      /* The cockpit rig puts the eye where the modelled driver's head is, so he
         has to go -- otherwise you are looking at the inside of your own skull.
         `visible = false` drops him from the shadow pass too, which is fine:
         from inside the cabin nobody can see the driver-shaped shadow he was
         casting on his own floor. */
      const d = hero?.userData?.driver;
      if (d) d.visible = !chase.interior;
      if (chase.interior) hud.flash('COCKPIT');
    }
  }
  if (action === 'lights') {
    car.lightsUser = true;
    if (!car.headlights) {
      car.headlights = true;
      car.headlightMode = 'low';
      hud.flash('HEADLIGHTS · ON');
    } else if (car.headlightMode === 'low') {
      car.headlightMode = 'high';
      hud.flash('HEADLIGHTS · HIGH');
    } else {
      car.headlights = false;
      car.headlightMode = 'low';
      hud.flash('HEADLIGHTS · OFF');
    }
  }
  if (action === 'photo') photo.toggle();
  // \ : cinematic HUD -- speed and objective only (style.css body.cinematic)
  if (action === 'cinematic' && started) hud.flash(hud.setCinematic() ? 'CINEMATIC HUD' : 'HUD RESTORED');
  if (action === 'tour' && DEBUG_KEYS) {   // O and T are dev tools: ?debug only
    if (featureTour.active) featureTour.stop();
    else window.startFeatureTour();
  }
  if (action === 'phone') phone?.toggle();
  if (action === 'intel') intelScanner?.toggle();
  if (action === 'garage') garage?.browse();
  if (action === 'buy') garage?.act();
  if (action === 'map') hud.toggleMap();
  if (action === 'radio') radio?.cycle();
  if (action === 'reset') respawnCar();
  if (action === 'mile') startHalsteadMile();
  if (action === 'track') startCircuitRace();
  if (action === 'time' && DEBUG_KEYS) { clock.hour = (clock.hour + 3) % 24; hud.flash(`TIME · ${clock.formattedTime}`); }
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
    const idx = +action.slice(6) - 1;
    const kind = WEAPON_KINDS[idx === 5 ? 4 : idx];   // 1-4 the first four guns, 6 the sniper (5 is grenades)
    if (kind && weapon.switchTo(kind)) { refreshHeldGun(); audio.click?.(); hud.flash(`${ARSENAL[kind].name} · ${weapon.ammo}/${ARSENAL[kind].mag}`); }
  }
  if (action === 'nextgun' || action === 'prevgun') {
    // pad D-pad: step through the slots the digit keys pick, in the HUD's order
    const slots = ['weapon0', 'weapon1', 'weapon2', 'weapon3', 'weapon4', 'weapon6', 'weapon5'];
    const at = held === 'fists' ? 0 : held === 'grenade' ? 6 : 1 + WEAPON_KINDS.indexOf(weapon.kind);
    onInputAction(slots[(at + (action === 'nextgun' ? 1 : 6)) % 7]);
  }
  if (action === 'reload' && weapon.reload()) { hud.flash('RELOADING…'); audio.reload?.(weapon.spec.reload); }
  if (action === 'avatar' && onFoot.character) {
    window._charIdx = ((window._charIdx || 0) + 1) % NAMED_CHARACTERS.length;
    const persona = NAMED_CHARACTERS[window._charIdx];
    onFoot.character.swap(persona.index);
    applyPerk(persona);
    hud.flash(`${persona.name} (${persona.role}) · ${persona.perk}`);
  }
  if (action === 'mute') {
    muted = !muted; audio.mute(muted); hud.flash(muted ? 'MUTED' : 'SOUND ON');
    try { localStorage.setItem('hb.muted', muted ? '1' : '0'); } catch { /* private mode */ }
  }
  if (action === 'use') useVehicle();
  if (action === 'room') joinRoom(roomFromUrl());
  if (action === 'fire') pullTrigger();
  if (action === 'run' && isRacewayArea(car.x, car.z)) { startCircuitRace(); return; }
  if (action === 'run' && mission && !photo.on) {   // photo mode uses G to cycle grade filters (photo.js); the run toggle stays out of it
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
  // V: cinematic angles for recording while Arun drives. Not on foot, not from the helicopter/tank (they own customRig).
  if (action === 'video') { if (!onFoot.active && (!activeVehicle || activeVehicle === carVehicle)) video.cycle(); }
};
const input = createInput(onInputAction, { chatAllowed: () => !photo.on });
/* Touch controls (game/touch.js): read each frame and merged over keyboard+pad
   the way the pad merges over the keyboard; look drags feed the same look()
   the pointer-lock mouse does. */
const touch = TOUCH ? createTouch(onInputAction, {
  onLook: (dx, dy) => { idleT = 0; if (photo.on) photo.look(dx, dy); else if (onFoot.active) onFoot.look(dx, dy); else chase.look(dx, dy); },
  onFire: (down) => { firing = down; },
  onAim: (on) => { aiming = on; },
  onInput: () => { idleT = 0; start(); },
}) : null;

/* The pad on the clickables (ui/padnav.js), topmost layer first. The map's
   clicks are positions, so it gets a crosshair; the touchpad that opened it
   closes it. The phone is not modal: you can still drive with it up. */
const padNav = createPadNav(() =>
  !hud.overlay.classList.contains('gone') ? { root: hud.overlay, modal: true }
  : hud.mapOpen ? { root: hud.mapEl, modal: true, cursor: true, toggle: 17, back: () => hud.toggleMap() }
  : phone?.open ? { root: phone.el, back: () => phone.toggle(false) }
  : null);
// a pad shows itself on its first button press: swap the title card's key legend for its own
addEventListener('gamepadconnected', () => {
  document.querySelector('#hud .keys:not(.pad)')?.setAttribute('hidden', '');
  document.querySelector('#hud .keys.pad')?.removeAttribute('hidden');
});

/* Mouse look. Pointer lock so the view keeps turning past the screen edge;
   click to grab, Escape to let go, and the rig recentres when you drive on. */
canvas.addEventListener('click', () => {
  if (TOUCH) return;   // touch looks by dragging (game/touch.js); a phone has no pointer to lock
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

addEventListener('mousemove', () => { idleT = 0; });   // ANY mouse movement is input to the idle camera, locked pointer or not
addEventListener('keydown', () => { idleT = 0; });
addEventListener('mousedown', () => { idleT = 0; });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  if (photo.on) return photo.look(e.movementX, e.movementY);
  if (onFoot.active) onFoot.look(e.movementX, e.movementY);
  else chase.look(e.movementX, e.movementY);
});

addEventListener('orientationchange', () => setTimeout(() => dispatchEvent(new Event('resize')), 60));   // iOS reports the old size on the event itself
window.visualViewport?.addEventListener('resize', () => dispatchEvent(new Event('resize')));
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(renderScale(innerWidth, innerHeight, isLite, Q.pixelBudget));
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
/* No top-level city.update() here any more (2026-09-22). It built the retired
   130 m legacy grid -- 25 cells at the ORIGIN, 683 direct draws, 409k tris,
   331k of them shadow casters, frustumCulled=false -- and because this module
   has top-level awaits above, it ran AFTER the district loader had already
   cleared those cells (main.js ~1262), so nothing ever removed them again.
   Measured live: 49% of free roam's direct draws and 73% of race mode's, for
   a grid 2.7 km from the car. The frame loop's world.update() streams the
   legacy grid on its own if the district ever fails to load. */
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
  if (PERF_MARKS) performance.clearMarks();
  mark('frame-start');
  const now = performance.now();
  const rawDt = (now - lastTime) / 1000;
  let dt = Math.min(rawDt, 0.05);
  lastTime = now;
  if (wastedAnim === 1) dt *= 0.35;   // wasted: the fall plays at a third speed, GTA's beat

  // ---- controls ----
  let c = null;   // this frame's input snapshot; null in film mode (the camera block below reads it)
  if (film) {
    film.pilot.update(car, dt);
    car.holdGear = false;
  } else {
  c = input.read(onFoot.active, padNav.update(dt));
  if (touch) {
    const t = touch.read();
    if (t.active) c = mergeDrive(c, t);   // a finger down wins over keys, like a live pad
    touch.setMode(onFoot.active ? 'foot' : 'drive');
    touch.setWeapon(held !== 'fists');
  }
  if (c.lookX || c.lookY) {   // right stick: the mouse-look path at a rate, slower with sights up
    idleT = 0;
    const k = dt * (ads > 0.5 ? 0.45 : 1), dx = c.lookX * k, dy = c.lookY * k;
    if (photo.on) photo.look(dx, dy); else if (onFoot.active) onFoot.look(dx, dy); else chase.look(dx, dy);
  }
  if (featureTour?.active) {
    featureTour.applyInput(c, dt);
  }
  if (c && (c.throttle || c.brake || c.steer || c.handbrake || c.lookBack || c.hold || c.fire || c.aim)) idleT = 0; else idleT += dt;
  idleCam = false;   // the car and on-foot branches set it; anything else (heli, tank, film) is never idle-cam
  if (document.pointerLockElement !== canvas) idleT = Math.min(idleT, 0);   // no pointer lock means you are not playing: never orbit, never look 'locked'
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
    activeVehicle.update(c, dt, { firing: firing || c.fire, chase });
    car.throttle = 0; car.brake = 1; car.steerTarget = 0; car.vx = 0; car.vz = 0;
  } else if (onFoot.active) {
    onFoot.update(c, dt, camera, walkSolid, (x, z) => Math.max(world.district?.elevationAt?.(x, z) ?? 0, groundHeightAt(x, z)));
    car.throttle = 0; car.brake = 1; car.steerTarget = 0;
    // on foot too: stand still for twenty seconds and the camera circles you; any input, aiming or firing ends it
    idleCam = idleT > 20 && (onFoot.speed || 0) < 0.2 && !photo.on && !aiming && !firing;
    if (idleCam) {
      const a = (performance.now() / 1000) * 0.11, r = 4.5 + Math.sin(a * 0.7) * 1.0, gy = onFoot.y || 0;
      camera.position.set(onFoot.x + Math.cos(a) * r, gy + 1.7 + Math.sin(a * 0.5) * 0.3, onFoot.z + Math.sin(a) * r);
      camera.lookAt(onFoot.x, gy + 1.1, onFoot.z);
    }
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
  /* Keyboard steering is BINARY: input.js hands over steerTarget = +-1 the
     instant a key goes down (input.js:181), so nothing about a key press is
     progressive on its own -- the dynamics' first-order lag was the whole
     ramp. When that lag was sped up 2.3x, one tap became full lock. Measured
     at 66 km/h, steer angle after a held key (rad):

              @0.1s  @0.2s  @0.5s
       before  0.140  0.219  0.326
       shipped 0.301  0.393  0.450   <- "goes to the left extreme or right"
       now     0.057  0.142  0.319

     A stick is already progressive, so an analogue pad passes straight
     through; only the digital path is ramped, faster when parking than at
     100 km/h, and 2.2x as fast coming back to centre as going out. */
  if (c.analogue) car.steerTarget = c.steer;
  else {
    const rate = 7.0 - 3.6 * Math.min(1, Math.hypot(car.vx, car.vz) / 38);
    const back = c.steer === 0 || Math.sign(c.steer) !== Math.sign(car.steerTarget);
    car.steerTarget += (c.steer - car.steerTarget) * Math.min(1, dt * rate * (back ? 2.2 : 1));
  }
  }
  }

  dispatch?.update(dt, activeVehicle, chase);
  flying = activeVehicle?.type === 'helicopter' ? activeVehicle : null;
  featureTour?.update(dt);

  /* Breakables go BEFORE the physics step: a lamp post the car is about to
     fell must lose its collision solid before the tyre model resolves against
     it, or the car eats a dead stop on the frame it breaks through. */
  debris.update(car, dt, traffic.cars, traffic.police);

  // fixed-step physics keeps the tyre model stable; clamp accumulator to prevent death spirals on dt spikes
  mark('physics-start');
  const tPhys0 = performance.now();
  if (rawDt > 0.05) physicsAccumulator = 0;   // Spike or tab-out: clear backlog to prevent death spiral
  physicsAccumulator += dt;
  let guard = 0;
  if (!activeVehicle || activeVehicle === carVehicle) {
    /* guard 8, not 4. Four steps of 1/120 is 33.3 ms of simulated time, so at
       any frame slower than 30 fps the simulation could not keep up with the
       clock: it fell behind by the difference every frame and the car crawled
       in slow motion while the world did not -- "frame by frame rather than
       racing". Eight covers down to 15 fps. The guard is there to stop a
       death spiral, and stepVehicle costs 1.8 us (measured, 120k steps), so
       eight of them is 14 us a frame -- the spiral it was guarding against
       does not exist. */
    while (physicsAccumulator >= STEP && guard++ < 8) {
      stepVehicle(car, STEP);
      physicsAccumulator -= STEP;
    }
    car.odo = (car.odo || 0) + Math.abs(car.fwdSpeed ?? car.speed ?? 0) * dt;   // trip odometer (metres) for the HUD
  } else {
    physicsAccumulator = 0;
  }
  const physMs = performance.now() - tPhys0;
  mark('physics-end');

  // Sub-step physics visual interpolation (ensures rock-solid 60Hz/120Hz consistency and eliminates judder)
  const alpha = Math.min(1, Math.max(0, physicsAccumulator / STEP));
  const prevX = car.prevX ?? car.x;
  const prevZ = car.prevZ ?? car.z;
  const prevYaw = car.prevYaw ?? car.yaw;
  const renderX = prevX + (car.x - prevX) * alpha;
  const renderZ = prevZ + (car.z - prevZ) * alpha;
  let dYaw = (car.yaw - prevYaw) % (Math.PI * 2);
  if (dYaw > Math.PI) dYaw -= Math.PI * 2;
  if (dYaw < -Math.PI) dYaw += Math.PI * 2;
  const renderYaw = prevYaw + dYaw * alpha;
  const renderRoll = (car.prevRoll ?? car.roll) + (car.roll - (car.prevRoll ?? car.roll)) * alpha;
  const renderPitch = (car.prevPitch ?? car.pitch) + (car.pitch - (car.prevPitch ?? car.pitch)) * alpha;
  const renderHeave = (car.prevHeave ?? car.heave) + (car.heave - (car.prevHeave ?? car.heave)) * alpha;

  car.renderX = renderX;
  car.renderZ = renderZ;
  car.renderYaw = renderYaw;
  car.renderRoll = renderRoll;
  car.renderPitch = renderPitch;
  car.renderHeave = renderHeave;

  // ---- pose ----
  // group carries x/y/z and yaw; the body carries the sprung motion; the wheels ride the road
  if (!activeVehicle || activeVehicle === carVehicle) {
    hero.visible = !onFoot.active;
    const gy = (world.district?.elevationAt?.(renderX, renderZ) ?? groundHeightAt(renderX, renderZ));
    hero.position.set(renderX, gy, renderZ);
    hero.rotation.set(0, renderYaw, 0);
  } else {
    hero.visible = false;
  }
  const body = hero.userData.body;
  /* A flat tyre drops the CAR, not just the wheel. Lowering the hub alone
     pushed the tyre through the tarmac and left the shell at full ride
     height, so the sag has to land on the sprung mass too. */
  let sag = 0;
  for (const w of hero.userData.wheels) sag += (w.flat || 0);
  body.position.y = renderHeave - (sag / 4) * WHEEL_R * 0.3;
  // local x is forward and local z is lateral, so roll goes on x and pitch on z
  body.rotation.set(renderRoll, 0, renderPitch);
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
    const idx = (w.front ? 0 : 2) + (w.side > 0 ? 1 : 0);   // FL FR RL RR, the physics' wheel order (this line was lost in a rewrite: every frame threw, the camera froze)
    if (car.flat) car.flat[idx] = w.flat || 0;
    const localWheelY = (car.wheelGround ? car.wheelGround[idx] - hero.position.y : 0);   // hero.position.y IS gy; gy itself is block-scoped above
    w.steer.position.y = localWheelY + WHEEL_R * (1 - (w.flat || 0) * 0.3);
    w.spin.rotation.z += car.wheelW[idx] * dt;
  }

  hero.userData.tailMat.emissiveIntensity =
    0.5 + car.brake * 3.0 + (car.hand > 0.3 ? 1.2 : 0);
  // gear 0 is reverse (the HUD prints it as R)
  if (hero.userData.reverseMat) hero.userData.reverseMat.emissiveIntensity = car.gear === 0 ? 2.4 : 0;
  if (!car.lightsUser) {
    const night = clock.hour >= 18.2 || clock.hour < 6.4;
    car.headlights = night;
    if (night && car.headlightMode !== 'high') car.headlightMode = 'low';
  }
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
    // a pool, not a floodlit stadium: 0.72 over 15 x 46 m read as one white blob in the recording, day or night
    beamPool.scale.set(isHighBeam ? 12 : 9, isHighBeam ? 42 : 28, 1);
    beamPool.material.opacity = isHighBeam ? 0.34 : 0.22;
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
  /* Your place in the field, while a race is on. It goes in the mission
     drawer rather than the district line at the top, which is already saying
     where you are. Ordinal not raw distance: see traffic.raceStandings. */
  if (traffic.racePath) {
    const st = traffic.racePlace?.(car);
    if (st) {
      const ord = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'][st.place] ?? `${st.place}th`;
      hud.setJob(`THE HALSTEAD MILE · ${ord} of ${st.of}`);
      if (mission && !mission.active) { traffic.endRace(); hud.setJob(''); }
    }
  }
  if (raceCircuit) {
    raceCircuit.update(dt, car);
  }
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
    if (DIFF.vigilante && f && !vigilante && !f.vigOffered && f.fleeT > 0 && traffic.wanted < 1 && Math.hypot(f.x - px, f.z - pz) < 150) { f.vigOffered = true; vigilante = { f, t: 30 }; hud.flash('VIGILANTE · STOP THE FLEEING CAR · $400'); hud.setJob?.('VIGILANTE · stop the fleeing car'); }
    if (vigilante) {
      vigilante.t -= dt;
      const v = vigilante.f, near = Math.hypot(v.x - px, v.z - pz) < 16;
      const stopped = v.vhp === 0 || (near && (v.speed || 0) < 1 && v.fleeT > 0);
      if (stopped && near && v.stoppedBy === 'player') { garage?.addCash(400, 'VIGILANTE'); audio.cash?.(); hud.flash('SUSPECT STOPPED · +$400'); vigilante = null; hud.setJob?.(null); }
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
  // exhaust: a small grey wisp off the tailpipe every 0.22 s while the engine idles or crawls (it thins out with speed)
  if (!onFoot.active && hero.visible) {
    exhaustT -= dt;
    const sp = Math.abs(car.fwdSpeed || 0);
    if (exhaustT <= 0 && sp < 12) {
      exhaustT = 0.22;
      const fx = Math.cos(car.yaw), fz = -Math.sin(car.yaw), sx = Math.sin(car.yaw), sz = Math.cos(car.yaw);
      const ex = car.x - fx * 2.2 + sx * 0.55, ez = car.z - fz * 2.2 + sz * 0.55;
      puffs.puff(ex, hero.position.y + 0.3, ez, { r: 0.10, g: 0.10, b: 0.11, life: 0.7 + (1 - sp / 12) * 0.5, vy: 0.35, vx: -fx * 0.8, vz: -fz * 0.8 });
    }
  }
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
    try {
      const q = new URLSearchParams(location.search);
      const h = localStorage.getItem('hb.clock');
      if (h !== null && !q.has('night') && !q.has('dusk') && !q.has('hour') && !q.has('time')) {
        const val = ((+h) % 24 + 24) % 24;
        // Upgrade previous flat noon hours (10.5 - 15.5) to golden hour (16.85)
        clock.hour = (val >= 10.5 && val <= 15.5) ? 16.85 : val;
      }
    } catch { /* private mode */ }
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
  const adsTarget = (aiming || c?.aim) && onFoot.active ? 1 : 0;   // right mouse, or L2
  ads += (adsTarget - ads) * Math.min(1, dt / ADS_BLEND_S);
  if (Math.abs(ads - adsTarget) < 0.01) ads = adsTarget;
  sinceShot += dt; if (sinceShot > 0.4) burst = 0;
  const adsCfg = ADS[weapon.kind] ?? ADS.pistol;
  onFoot.ads = ads; onFoot.adsFov = adsCfg.fov; onFoot.adsBack = adsCfg.back; onFoot.adsSpeed = adsCfg.speed;
  /* GTA's rule: in a car the gun HUD is not there until you use it. A
     crosshair over the bonnet and PISTOL 12 / 48 in the corner while you drive
     read as clutter in the 2026-09-23 recording. Aim or fire and both come up;
     they go 2.5 s after the last shot. On foot they stay, as before. */
  const gunHud = onFoot.active || aiming || firing || !!c?.fire || !!c?.aim || sinceShot < 2.5;
  crosshair.show(started && !flying && !photo.on && gunHud);
  if (!onFoot.active) crosshair.update(spreadToPixels(spreadFor(weapon.kind, weapon.heat) * 1.3, camera.fov ?? 60, innerHeight), weapon.reloading ? 1 - weapon.reloadT / weapon.spec.reload : -1, dt);
  if (onFoot.active) {
    const cone = spreadFor(weapon.kind, weapon.heat) * (1 - ads * (1 - adsCfg.spread));
    crosshair.update(spreadToPixels(cone, camera.fov ?? 60, innerHeight), weapon.reloading ? 1 - weapon.reloadT / weapon.spec.reload : -1, dt);
    swayPhase += swayPhaseStep(onFoot.speed ?? 0, dt);
  }
  placeHeldGun();
  if (held === 'fists') hud.setAmmo('FISTS', '', '', false, armour, 12, gunHud); else if (held === 'grenade') hud.setAmmo('GRENADE', grenades.count, '-', false, armour, 12, gunHud); else hud.setAmmo(weapon.spec.name, weapon.ammo, weapon.reserveNow, weapon.reloading, armour, weapon.magSize, gunHud);
  const arsKey = onFoot.active ? `${held}|${weapon.kind}|${weapon.ammo}|${weapon.reserveNow}|${grenades.count}` : 'car';
  if (arsKey !== lastArsKey && onFoot.active) hud.setArsenal?.([
    { key: 0, name: 'FISTS', mag: '', reserve: '', current: held === 'fists' },
    ...WEAPON_KINDS.map((k, i) => ({ key: i === 4 ? 6 : i + 1, name: ARSENAL[k].name, mag: k === weapon.kind ? weapon.ammo : weapon.mags[k], reserve: weapon.reserve[k], current: held === 'gun' && k === weapon.kind })),
    { key: 5, name: 'NADE', mag: grenades.count, reserve: '', current: held === 'grenade' },
  ]);
  else if (arsKey !== lastArsKey && hud.arsEl) { hud.arsEl.innerHTML = ''; hud._arsKey = ''; }
  lastArsKey = arsKey;
  skids.update(car, car.wheelGround ? car.wheelGround[2] : 0);
  if (firing || c?.fire) pullTrigger();   // left mouse, or R2 on foot / R1 in the car
  if (crowd) crowd.signalTime = worldTime;   // pedestrians wait for the same lights the cars obey
  /* On foot the crowd lives round YOU, not round the car you left (it spawned,
     despawned and picked its detailed faces 50 m away by the parked car); the
     detailed-mesh set follows the camera, which is what a LOD is for. */
  if (crowd) crowd.focus = camera.position;
  if (crowd) crowd.update(onFoot.active ? quarry : car, dt, (speed, p) => {
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
      /* Parked and idle for twenty seconds: the camera drifts into a slow orbit
         of the car, GTA's idle cinematic. Any input ends it and the chase
         camera picks up from wherever the orbit left it. */
      idleCam = !targetVehicle.camera && !photo.on && idleT > 20 && Math.abs(targetVehicle.fwdSpeed || 0) < 0.5;
      if (idleCam) {
        const a = (performance.now() / 1000) * 0.11, r = 7.5 + Math.sin(a * 0.7) * 1.5, gy = hero.position.y;
        camera.position.set(targetVehicle.x + Math.cos(a) * r, gy + 1.9 + Math.sin(a * 0.5) * 0.5, targetVehicle.z + Math.sin(a) * r);
        camera.lookAt(targetVehicle.x, gy + 0.9, targetVehicle.z);
      }
    }
  }
  // the HUD fades out with an idle orbit (car or foot) and back in with the first input: one injected rule, a body class
  if (idleCam !== idleCamShown) {
    idleCamShown = idleCam;
    if (!document.getElementById('idlecam-style')) { const st = document.createElement('style'); st.id = 'idlecam-style'; st.textContent = '#hud,#cluster,#minimap,#dials,#readout,#wanted,#crosshair,#stats,#gameplay-prompt-bar{transition:opacity .6s}.idlecam #hud,.idlecam #cluster,.idlecam #minimap,.idlecam #dials,.idlecam #readout,.idlecam #wanted,.idlecam #crosshair,.idlecam #stats,.idlecam #gameplay-prompt-bar{opacity:0 !important}'; document.head.appendChild(st); }
    document.body.classList.toggle('idlecam', idleCam);
  }
  clock.update(dt, { sun, hemi, scene, grade, lightPool, heroLights: beamPool, weatherSystem: weather, assets, player: currentVehicle, dome, stars, sunSprite, sunRaySprite });
  // the rain audio follows the weather's breathing, and rain is grip: the physics reads car.wet
  // crossing into a district: the area name, GTA-style, and dispatch tracks you if you are wanted
  distT -= dt;
  if (districtRef?.districtAt && distT <= 0) {
    distT = 0.5;
    const here = districtRef.districtAt(onFoot.active ? onFoot.x : car.x, onFoot.active ? onFoot.z : car.z);
    // the first star: dispatch puts out the description -- on foot or in a vehicle, and where
    if (traffic.wanted >= 1 && wantedWas < 1) chatter?.radio?.(`All units: suspect ${onFoot.active ? 'on foot' : 'in a ' + paintName() + ' vehicle'}${here ? ', ' + here.charAt(0) + here.slice(1).toLowerCase() : ''}. Respond.`);
    // three stars makes the news: the station you are listening to breaks in
    if (traffic.wanted >= 3 && wantedWas < 3) radio?.news?.(`Police are pursuing an armed suspect${here ? ' through ' + here.charAt(0) + here.slice(1).toLowerCase() : ' across the city'}. Residents are asked to stay indoors.`);
    wantedWas = traffic.wanted;
    if (here && here !== lastDistrict) {
      if (lastDistrict !== null) { hud.flash(here); if (traffic.wanted >= 1) chatter?.radio?.(`Suspect heading into ${here.charAt(0) + here.slice(1).toLowerCase()}. Units in the area respond.`); }
      lastDistrict = here;
    }
  }
  // Little Tokyo's sound follows you in and out of the district
  if (audio.tokyo && districtRef?.districtAt) {
    tokyoAmbT = (tokyoAmbT ?? 0) - dt;
    if (tokyoAmbT <= 0) {
      tokyoAmbT = 0.5;
      const px = onFoot.active ? onFoot.x : car.x, pz = onFoot.active ? onFoot.z : car.z;
      const inTokyo = districtRef.districtAt(px, pz) === 'LITTLE TOKYO';
      /* The crossing chime follows the nearest Tokyo junction's lights: it plays
         every 2.5 s while either axis is green (its pedestrians' man is green),
         and stops on the all-red -- the melody you hear at Shibuya, in time. */
      let chime = false;
      if (inTokyo) {
        tokyoNodes ??= (districtRef.graph?.nodes ?? []).filter((n) => (n.kind === 'cross' || n.kind === 'tee') && districtRef.districtAt(n.x, n.y) === 'LITTLE TOKYO');
        let best = null, bd = 45;
        for (const n of tokyoNodes) { const d = Math.hypot(n.x - px, n.y - pz); if (d < bd) { bd = d; best = n; } }
        const green = best && (signalState(best.id, 0, 0, worldTime) === 'green' || signalState(best.id, 0, 1, worldTime) === 'green');
        chimeT -= 0.5;
        if (green && chimeT <= 0) { chimeT = 2.5; chime = true; }
        if (!green) chimeT = 0.4;
      }
      audio.tokyo(inTokyo, chime);
    }
  }
  // Little Tokyo's windows, neon and kanban come up with the night (tokyo.js emissive attribute)
  { const hr = clock.hour; const nk = hr >= 20.5 || hr < 5.2 ? 1 : hr >= 18 ? (hr - 18) / 2.5 : hr < 7.2 ? (7.2 - hr) / 2 : 0; setTokyoNight(nk); setGlareNight(nk); setStreakNight(nk); setWindowNight(nk); setSignNight(nk); farTraffic?.update(dt, currentVehicle.x, currentVehicle.z, (world.radius + 0.5) * 256, nk); }
  if (weather) {
    // rain only at night (the clock's thresholds), in spells on the normal cycle, all night with ?night
    const nightNow = clock.hour >= 20.5 || clock.hour < 5.2;
    weather.setEnabled(rainForce ?? (nightNow && (!DAY || rainSpell(now / 1000))));
    weather.update(camera, currentVehicle, dt); car.wet = weather.amount ?? 1; traffic.wet = car.wet; if (crowd) crowd.rain = car.wet; grade.setWet?.(car.wet);   // ?ssr: wet-street reflections follow the rain
    if (Math.abs((weather.amount ?? 1) - (rainHeard ?? -1)) > 0.05) { rainHeard = weather.amount; audio.setRain(rainHeard); }
    // the road LOOKS wet: uniforms only, no recompile. Dry must stay the day
    // contract (matte, bump 0.28) — writing a half-wet gloss at wet=0 is what
    // turned the asphalt grain into cobbles at noon.
    const tm = assets?.mat?.tarmac;
    if (tm) {
      const nk = (clock.hour >= 20.5 || clock.hour < 5.2) ? 1 : clock.hour >= 18 ? (clock.hour - 18) / 2.5 : clock.hour < 7.2 ? (7.2 - clock.hour) / 2 : 0;
      /* Little Tokyo's street is wet after dark whether or not it is raining --
         the reference still is a wet canyon, and the neon only reaches the road
         as a reflection. Asked of the district, not of a hand-typed rectangle:
         `lastDistrict` is already polled twice a second a few lines above, so
         this costs nothing. Photo mode flies the CAMERA out of the car, so it
         asks for the camera's own district instead. */
      const tokyoHere = photo?.on
        ? districtRef?.districtAt?.(camera.position.x, camera.position.z) === 'LITTLE TOKYO'
        : lastDistrict === 'LITTLE TOKYO';
      const look = wetTarmacLook(Math.max(car.wet, nk > 0.65 && tokyoHere ? 0.7 : 0), nk);
      tm.roughness = look.roughness;
      tm.envMapIntensity = look.envMapIntensity;
      tm.normalScale.setScalar(look.normalScale);
    }
    if (stars && car.wet > 0.05) stars.visible = false;   // no stars through cloud (the clock re-decides every frame)
  }
  lightPool?.update(dt, photo?.on ? camera.position.x : currentVehicle.x, photo?.on ? camera.position.z : currentVehicle.z, traffic);
  (streaks ??= new HeadlightStreaks(scene)).update(camera, traffic, car);   // GTA anamorphic streaks on oncoming headlights (world/streaks.js)
  reputation?.update(dt, playerTarget.x, playerTarget.z, traffic, car, damageModel);
  intelScanner?.update(dt, camera, playerTarget, traffic, reputation?.safehouses);
  grade.setDrops(DAY ? 0 : chase.mode >= 2 ? 1.2 : 0.68);
  const speedRatio = Math.min(1, (Math.abs(car.fwdSpeed || 0) / 42)) * (car.nosActive ? 1.35 : 0.85);
  grade.setSpeed?.(speedRatio);
  const streamX = photo?.on ? camera.position.x : currentVehicle.x;
  const streamZ = photo?.on ? camera.position.z : currentVehicle.z;
  const streamVx = photo?.on ? 0 : (currentVehicle.vx || 0);
  const streamVz = photo?.on ? 0 : (currentVehicle.vz || 0);
  mark('stream-start');
  world.update(streamX, streamZ, streamVx, streamVz);
  mark('stream-end');
  resolution(dt);
  /* One render: the pipeline owns the frame (scene MRT pass, GTAO, bloom,
     tone map, grade — core/grade.js). renderer.info accumulates across a
     frame's internal passes and resets once per rAF by the renderer's own
     animation pump, so sampling after the pipeline reads the whole frame —
     scene + shadow passes + ~15 fullscreen post quads. */
  mark('render-start');
  const tRender0 = performance.now();
  hurtPulse = Math.max(0, hurtPulse - dt * 2.2);
  if (onFoot.active) audio.heartbeat?.(health, dt);   // under 25% you hear your own heart, quickening toward the end
  grade.setHurt?.(Math.max(hurtPulse, onFoot.active && health < 0.4 ? (0.4 - health) * 1.6 : 0));   // a hit flashes it; under 40% it stays
  grade.render(renderer, now / 1000);
  const renderMs = performance.now() - tRender0;
  mark('render-end');
  mark('frame-end');
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
  /* NOT gated on the overlay (2026-09-23): it was `boot && ...`, and the
     stuck-boot guard (12 s without a reported phase) and the frame-error path
     both null `boot` -- so a slow boot skipped the warm-up for the whole
     session and every pipeline compiled mid-game, one hitch at a time. Once
     the world is ready it warms, overlay or not. */
  if (!warming && (world.primed ?? true) && (districtRef || districtFailed)) {
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
    /* The Tokyo buildings' own material reads `surf`, `emit`, `flick` and the
       colour attribute: warmed on the test box it would compile a variant the
       chunk mesh never draws (the road-wear trap below), so it gets a painted
       box that carries all of them. */
    const tokyoWarm = new THREE.Mesh(tokyoWarmGeometry(), tokyoFacadeMaterial());
    tokyoWarm.position.set(0, -50, 0); dummyGroup.add(tokyoWarm);
    /* Road wear (world/decals.js) is warmed by hand below, not through
       compileMats: its colorNode reads aTile/aFade and getAttributes SKIPS an
       attribute the geometry lacks, so warming it on the test box compiles a
       variant the chunk mesh never uses. Calling it here also paints the
       1024^2 atlas at boot instead of inside the first chunk build. */
    wearDecalMaterial();
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
    {
      const dg = wearDecalGeometry();
      dg.setAttribute('aTile', new THREE.InstancedBufferAttribute(new Float32Array(2), 2));
      dg.setAttribute('aFade', new THREE.InstancedBufferAttribute(new Float32Array(1), 1));
      const dwm = new THREE.InstancedMesh(dg, wearDecalMaterial(), 1);
      dwm.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, -50, 0));
      dummyGroup.add(dwm);
    }
    // Little Tokyo's boards, the same way: an InstancedMesh carrying aCell. Also paints their atlas now, not in the first Tokyo chunk.
    dummyGroup.add(tokyoBoardMesh([{ m: new THREE.Matrix4().makeTranslation(0, -50, 0), cell: [0, 0, 0.25, 0.0625] }]));
    /* The machines that arrive mid-game (2026-09-23): a dispatched tank and a
       delivered helicopter share their materials with every later one, so one
       model of each here is the whole cost of their pipelines. */
    const warmHeli = buildHeliModel({ livery: 'civil' });
    dummyGroup.add(buildTankModel().group, warmHeli.group);
    scene.add(dummyGroup);

    /* compileAsync runs the RENDER's visibility pass: an invisible group skips
       its whole subtree and every mesh is frustum-tested against the boot
       camera. The dummies sat at the world origin, 2.7 km behind the spawn
       camera, so the list above was culled before it compiled -- every first
       spark, decal, flash and effect was a pipeline compile mid-game. For the
       warm-up nothing is culled: dummies and un-hidden meshes compile with
       frustumCulled off (and get it back), and the police helicopter's hidden
       group is shown, since it only appears at three stars, mid-pursuit. */
    const unculled = [];
    const uncull = (o) => { if (o.frustumCulled) { unculled.push(o); o.frustumCulled = false; } };
    dummyGroup.traverse(uncull);
    const hidden = [];
    scene.traverse((o) => { if ((o.isPoints || o.isMesh) && !o.visible && !o.isInstancedMesh && !o.userData?.shell) { hidden.push(o); o.visible = true; uncull(o); } });
    const hiddenGroups = [heli?.group].filter((g) => g && !g.visible);
    for (const g of hiddenGroups) { g.visible = true; g.traverse(uncull); }
    // never let the warm-up hold the game hostage: 1.5 s, then in you go regardless
    const drop = () => {
      setBootProgress(100, 'Ready!');
      for (const o of hidden) o.visible = false;
      for (const g of hiddenGroups) g.visible = false;
      for (const o of unculled) o.frustumCulled = true;
      for (const m of [warmHeli.disc, warmHeli.beacon, warmHeli.tailStrobe]) { m.geometry.dispose(); m.material.dispose(); }   // its own parts; the rest is the shared kit
      scene.remove(dummyGroup);
      testBox.dispose();
      tokyoWarm.geometry.dispose();
      if (boot) { boot.remove(); boot = null; }
      if (window._startBackgroundAssetStream) window._startBackgroundAssetStream();
    };
    Promise.race([renderer.compileAsync(scene, camera), new Promise((r) => setTimeout(r, 1500))])
      .catch((e) => console.warn('warm-up:', e.message)).then(drop);
  }
  stats.sample(renderer);
  /* drawCalls, not calls: `render.calls` counts render-pass INVOCATIONS since
     load and is never reset, so the banner's old "907 DRAWS" was a lifetime
     pass counter that happened to look plausible. `drawCalls` is the real
     per-frame number and matches the F3 overlay. */
  stats.update(dt, world, renderer, { physics: physMs, render: renderMs }, {
    pendingLoads: catalogueRef?.pendingLoads ?? 0,
    texturesLoading: !!catalogueRef?.texturesLoading,
    bootPhase: boot ? bootPhaseName : null,
  });
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
  /* Where you are, as a mix. The beach, the promenade, the riverside and the
     harbour were all built this week and every one of them is silent; this is
     the bed under them. Cross-faded inside sfx.place(), never switched, or the
     bed pops as you cross a boundary. `elevated` uses the deck height the
     physics already knows, so a bridge gets its own wind without a new test. */
  {
    const vx = currentVehicle.x, vz = currentVehicle.z;
    const deck = districtRef?.elevationAt?.(vx, vz) ?? 0;
    audio.place?.(lastDistrict, {
      onBeach: !!beach && nearBay(vx, vz),
      onWater: (districtRef?.data?.water?.river && nearRiver(vx, vz)) || false,
      elevated: deck > 3.5,
      crowd: crowd ? 0.6 : 0,
      dt,
    });
  }
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
  if (districtRef && !drowning && !onFoot.active && !dying && districtRef.inWater(car.x, car.z)) drowning = 0.001;
  if (drowning) {
    drowning += dt;
    car.throttle = 0; car.brake = 0;
    car.vx *= Math.exp(-dt * 2.2); car.vz *= Math.exp(-dt * 2.2);
    hero.position.y = -Math.min(3.4, drowning * 1.7);
    if (drowning > 2.4 && !dying) {
      /* The sea is a death like any other (2026-09-11): the same blackout,
         hospital fee, lost job and kept stars as a fireball. It used to hand
         the car back on the nearest quay and forgive a star, which made the
         harbour the safest place in the city to be wanted in. */
      hero.position.y = 0;
      dying = 0.01;        // next frame the dying block runs hud.blackout(onDeath)
    }
  }

  if (car.hitTag) {
    /* Impact BANDS, not one thud scaled (2026-09-15). A glancing scrape and a
       head-on are different events, not the same one played louder: the scrape
       is long and bright, the heavy hit is short and low. audio.thud still
       covers the middle; these are its ends. Thresholds match the ones damage
       already uses -- 4.5 is "hurt the other car", 9 is "hurt it badly". */
    {
      const f = car.hitForce || 0;
      if (f > 9) audio.crunch?.(1);
      else if (f > 4.5) audio.crunch?.(0.45);
      else if (f > 1.2) audio.scrape?.(Math.min(1, f / 4.5));
      if (f > 9) audio.glass?.();
    }
    traffic.reportCrime(car.hitTag, car.hitForce || 0);
    damageModel.hit(car.hitForce || 0, car.hitAt, DIFF.crashScale);
    // ramming a car or a cruiser hurts ITS engine too: a hard hit is one or two of its eight points (PIT them back)
    if (car.hitRef && (car.hitForce || 0) > 4.5) damageVehicle(car.hitRef, (car.hitForce || 0) > 9 ? 2 : 1, car.hitTag === 'police');
    car.hitTag = null; car.hitForce = 0; car.hitRef = null;
  }
  if (car.hitAt && car.impact > 2.4) damageModel.hit(car.impact, car.hitAt, DIFF.crashScale);   // once per contact event: collision.js sets hitAt only on a new-max hit this frame and it is cleared below -- un-gated, a 54 km/h wall wrote the car off over ~14 frames and every police round was charged twice
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
