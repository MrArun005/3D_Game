import * as THREE from 'three';
import { toTex } from './textures.js';

/**
 * Halstead International Raceway — Dedicated Closed-Circuit Racing Facility.
 *
 * Sited in the bay east of Harbour Point (x: 3420-4180, z: 2420-3000), connected to
 * the mainland at Dock Road via a grand access causeway.
 *
 * 2.34 km FIA-grade circuit:
 *   - 500 m high-speed Front Straight (pit/start gantry)
 *   - Turn 1 & 2: Ocean Chicane (flick right then left)
 *   - Turn 3 & 4: Infield Technical Esses
 *   - Turn 5: South Coastal Sweeper
 *   - Turn 6 & 7: The Lighthouse Hairpin
 *   - Waterfront Backstretch
 *   - Turn 8 & 9: The Parabolica back onto the Main Straight
 *
 * Complete 3D infrastructure:
 *   - 18m wide dark high-grip racing asphalt with tire wear and boundary lines
 *   - Alternating red/white 3D rumble kerbs on all corner apexes
 *   - Armco safety barriers & tire barrier stacks along outer perimeters
 *   - Overhead Start/Finish Gantry with dynamic start LED lights
 *   - Pit Lane with pit garages and pit wall
 *   - 8 stadium floodlight towers with night lighting
 *   - Spectator Grandstand along the main straight
 *   - Solid island foundation & sea wall sitting at Y = 1.2m
 */

export const TRACK_WIDTH = 18;
export const TRACK_HALF = TRACK_WIDTH / 2;
export const RACEWAY_ELEVATION = 1.2;
export const WATER_Y = -2.6;

// Mainland connection point (Dock Road endpoint)
export const DOCK_ROAD_END = { x: 3420, z: 2420 };
export const CAUSEWAY_PADDOCK = { x: 3500, z: 2460 };

/** Circuit control points for Catmull-Rom spline interpolation. */
export const TRACK_CONTROL_POINTS = [
  // 1. Front Straight (West to East) — 500m high speed drag
  { x: 3560, z: 2460, curb: null, name: 'Start/Finish' },
  { x: 3720, z: 2460, curb: null, name: 'Pit Straight' },
  { x: 3880, z: 2460, curb: null, name: 'Speed Trap' },
  { x: 4040, z: 2460, curb: 'right', name: 'Turn 1 Braking' },

  // 2. Turn 1 & 2: Ocean Chicane
  { x: 4130, z: 2510, curb: 'right', name: 'Turn 1 Apex' },
  { x: 4160, z: 2590, curb: 'left',  name: 'Turn 2 Apex' },
  { x: 4130, z: 2680, curb: null,   name: 'Chicane Exit' },

  // 3. Turn 3 & 4: Infield Technical S-Curves
  { x: 4010, z: 2720, curb: 'right', name: 'Infield Entry' },
  { x: 3900, z: 2720, curb: 'left',  name: 'Infield Apex' },
  { x: 3820, z: 2780, curb: 'right', name: 'Infield Exit' },

  // 4. Turn 5: South Coastal Sweeper
  { x: 3860, z: 2880, curb: 'left',  name: 'South Sweeper Entry' },
  { x: 3940, z: 2930, curb: null,   name: 'South Sweeper Mid' },
  { x: 3900, z: 2980, curb: 'right', name: 'The Anchorage' },

  // 5. Turn 6 & 7: The Lighthouse Hairpin
  { x: 3780, z: 2990, curb: null,   name: 'Hairpin Braking' },
  { x: 3660, z: 2970, curb: 'left',  name: 'Hairpin Entry' },
  { x: 3580, z: 2900, curb: 'left',  name: 'Hairpin Apex' },
  { x: 3600, z: 2810, curb: 'right', name: 'Hairpin Exit' },

  // 6. Waterfront Backstretch (heading North-West)
  { x: 3640, z: 2700, curb: null,   name: 'West Straight' },
  { x: 3620, z: 2600, curb: 'right', name: 'Kink' },

  // 7. Turn 8 & 9: The Parabolica
  { x: 3540, z: 2540, curb: 'left',  name: 'Parabolica Entry' },
  { x: 3480, z: 2500, curb: 'left',  name: 'Parabolica Apex' },
  { x: 3500, z: 2460, curb: 'right', name: 'Parabolica Exit' },
];

/** Checkpoint gates placed around the circuit for lap progression & anti-cut tests. */
export const TRACK_CHECKPOINTS = TRACK_CONTROL_POINTS.map((pt, i) => ({
  id: i,
  x: pt.x,
  z: pt.y ?? pt.z,
  name: pt.name,
  radius: 26, // metres
}));

/** Staggered 2x2 grid slots on the main straight behind the start/finish line. */
export const GRID_SLOTS = [
  { x: 3560, z: 2457, yaw: 0, pole: true },   // P1 (Player)
  { x: 3546, z: 2463, yaw: 0 },               // P2
  { x: 3532, z: 2457, yaw: 0 },               // P3
  { x: 3518, z: 2463, yaw: 0 },               // P4
  { x: 3504, z: 2457, yaw: 0 },               // P5
  { x: 3490, z: 2463, yaw: 0 },               // P6
];

export const START_FINISH = GRID_SLOTS[0];

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const v0 = (p2.x - p0.x) * 0.5, v1 = (p3.x - p1.x) * 0.5;
  const x = (2 * p1.x - 2 * p2.x + v0 + v1) * t3 + (-3 * p1.x + 3 * p2.x - 2 * v0 - v1) * t2 + v0 * t + p1.x;
  const w0 = (p2.z - p0.z) * 0.5, w1 = (p3.z - p1.z) * 0.5;
  const z = (2 * p1.z - 2 * p2.z + w0 + w1) * t3 + (-3 * p1.z + 3 * p2.z - 2 * w0 - w1) * t2 + w0 * t + p1.z;
  return { x, z };
}

/** Samples the closed circuit into dense, evenly spaced centerline points with tangents & normals. */
export function getSampledTrack(samplesPerSeg = 10) {
  const N = TRACK_CONTROL_POINTS.length;
  const raw = [];
  for (let i = 0; i < N; i++) {
    const p0 = TRACK_CONTROL_POINTS[(i - 1 + N) % N];
    const p1 = TRACK_CONTROL_POINTS[i];
    const p2 = TRACK_CONTROL_POINTS[(i + 1) % N];
    const p3 = TRACK_CONTROL_POINTS[(i + 2) % N];
    const curb = p1.curb;
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg;
      const pt = catmullRom(p0, p1, p2, p3, t);
      raw.push({ x: pt.x, z: pt.z, curb: s < 6 ? curb : null });
    }
  }

  // Compute tangent & 2D normal for each sample
  const points = [];
  const M = raw.length;
  for (let i = 0; i < M; i++) {
    const curr = raw[i];
    const prev = raw[(i - 1 + M) % M];
    const next = raw[(i + 1) % M];
    const tx = next.x - prev.x, tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    const ux = tx / len, uz = tz / len;
    // normal perpendicular to tangent (facing left): (-uz, ux)
    const nx = -uz, nz = ux;
    points.push({
      x: curr.x,
      z: curr.z,
      tx: ux,
      tz: uz,
      nx,
      nz,
      curb: curr.curb,
    });
  }
  return points;
}

/** Procedural asphalt canvas texture for high-performance circuit tarmac. */
function createTrackTexture() {
  if (typeof document === 'undefined') return null;
  const w = 512, h = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  // Dark charcoal racing tarmac
  ctx.fillStyle = '#22252a';
  ctx.fillRect(0, 0, w, h);

  // Fine asphalt aggregate speckle
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const s = 1 + Math.random() * 2;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.18)';
    ctx.fillRect(x, y, s, s);
  }

  // Dark rubbered racing line grooves down middle
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0.0, 'rgba(10,10,12,0.0)');
  grad.addColorStop(0.25, 'rgba(12,12,15,0.4)');
  grad.addColorStop(0.5, 'rgba(20,20,24,0.15)');
  grad.addColorStop(0.75, 'rgba(12,12,15,0.4)');
  grad.addColorStop(1.0, 'rgba(10,10,12,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Crisp white outer edge boundary lines
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(0, 0, 18, h);
  ctx.fillRect(w - 18, 0, 18, h);

  // Dashed yellow center dividing line
  ctx.fillStyle = 'rgba(245, 190, 40, 0.85)';
  for (let y = 0; y < h; y += 64) {
    ctx.fillRect(w / 2 - 4, y, 8, 36);
  }

  return toTex(c, true);
}

/** Checkered start/finish line texture. */
function createCheckeredTexture() {
  if (typeof document === 'undefined') return null;
  const w = 256, h = 64;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const size = 16;
  for (let x = 0; x < w; x += size) {
    for (let y = 0; y < h; y += size) {
      const isWhite = ((x / size) + (y / size)) % 2 === 0;
      ctx.fillStyle = isWhite ? '#f8f9fa' : '#141416';
      ctx.fillRect(x, y, size, size);
    }
  }
  return toTex(c, true);
}

/**
 * Constructs the complete 3D racing track world:
 * Tarmac ribbon, rumble kerbs, Armco crash barriers, gantry, pit lane,
 * stadium floodlights, grandstand, and island sea wall.
 */
export function buildRaceTrack(scene, district) {
  const group = new THREE.Group();
  group.name = 'halstead-raceway';
  const samples = getSampledTrack(10);
  const M = samples.length;

  // 1. TARMAC SURFACE RIBBON
  const tarmacTex = createTrackTexture();
  const tarmacMat = new THREE.MeshStandardMaterial({
    map: tarmacTex,
    roughness: 0.82,
    metalness: 0.12,
    color: 0x24272c,
  });

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= M; i++) {
    const pt = samples[i % M];
    const lx = pt.x + pt.nx * TRACK_HALF, lz = pt.z + pt.nz * TRACK_HALF;
    const rx = pt.x - pt.nx * TRACK_HALF, rz = pt.z - pt.nz * TRACK_HALF;
    const y = RACEWAY_ELEVATION;

    positions.push(lx, y, lz);
    positions.push(rx, y, rz);

    normals.push(0, 1, 0);
    normals.push(0, 1, 0);

    const v = (i / M) * 28;
    uvs.push(0, v);
    uvs.push(1, v);

    if (i < M) {
      const row1 = i * 2, row2 = (i + 1) * 2;
      indices.push(row1, row1 + 1, row2);
      indices.push(row2, row1 + 1, row2 + 1);
    }
  }

  const trackGeo = new THREE.BufferGeometry();
  trackGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  trackGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  trackGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  trackGeo.setIndex(indices);
  trackGeo.computeVertexNormals();

  const trackMesh = new THREE.Mesh(trackGeo, tarmacMat);
  trackMesh.receiveShadow = true;
  group.add(trackMesh);

  // 2. CHECKERED START/FINISH LINE STRIP
  const chkTex = createCheckeredTexture();
  if (chkTex) {
    chkTex.wrapS = THREE.RepeatWrapping;
    chkTex.repeat.set(4, 1);
    const chkMat = new THREE.MeshStandardMaterial({
      map: chkTex,
      roughness: 0.6,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const chkGeo = new THREE.PlaneGeometry(TRACK_WIDTH, 4);
    chkGeo.rotateX(-Math.PI / 2);
    const chkMesh = new THREE.Mesh(chkGeo, chkMat);
    chkMesh.position.set(START_FINISH.x, RACEWAY_ELEVATION + 0.025, START_FINISH.z);
    chkMesh.rotation.y = Math.PI / 2; // spanning across the straight
    chkMesh.receiveShadow = true;
    group.add(chkMesh);
  }

  // 3. 3D ALTERNATING RED & WHITE APEX RUMBLE KERBS
  const redMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.7 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.7 });
  const kerbW = 1.4, kerbH = 0.18, kerbL = 1.8;
  const kerbGeo = new THREE.BoxGeometry(kerbL, kerbH, kerbW);
  kerbGeo.translate(0, kerbH / 2, 0);

  const kerbInstRed = [];
  const kerbInstWhite = [];

  for (let i = 0; i < M; i++) {
    const pt = samples[i];
    if (!pt.curb) continue;
    const sign = pt.curb === 'left' ? 1 : -1;
    // place just along the track edge
    const dist = TRACK_HALF + kerbW * 0.45;
    const kx = pt.x + pt.nx * sign * dist;
    const kz = pt.z + pt.nz * sign * dist;
    const ky = RACEWAY_ELEVATION;
    const yaw = Math.atan2(pt.tz, pt.tx);

    const m = new THREE.Matrix4();
    m.compose(
      new THREE.Vector3(kx, ky, kz),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw),
      new THREE.Vector3(1, 1, 1)
    );

    if (Math.floor(i / 2) % 2 === 0) kerbInstRed.push(m);
    else kerbInstWhite.push(m);
  }

  function makeInstanced(geo, mat, matrices) {
    if (!matrices.length) return null;
    const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
    matrices.forEach((m, idx) => inst.setMatrixAt(idx, m));
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    inst.receiveShadow = true;
    return inst;
  }

  const redKerbs = makeInstanced(kerbGeo, redMat, kerbInstRed);
  const whiteKerbs = makeInstanced(kerbGeo, whiteMat, kerbInstWhite);
  if (redKerbs) group.add(redKerbs);
  if (whiteKerbs) group.add(whiteKerbs);

  // 4. ARMCO SAFETY CRASH BARRIERS & POSTS
  // Extruded metallic guard rails running on the outer edge
  const barrierMat = new THREE.MeshStandardMaterial({
    color: 0x9aa0a6,
    metalness: 0.75,
    roughness: 0.35,
  });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x5f6368, metalness: 0.6, roughness: 0.5 });
  const postGeo = new THREE.BoxGeometry(0.18, 1.2, 0.18);
  postGeo.translate(0, 0.6, 0);

  const postMatrices = [];
  const railPos = [];
  const railNorms = [];
  const railIdx = [];

  for (let i = 0; i <= M; i += 2) {
    const pt = samples[i % M];
    // Outer perimeter rail
    const bx = pt.x - pt.nx * (TRACK_HALF + 2.2);
    const bz = pt.z - pt.nz * (TRACK_HALF + 2.2);
    const by = RACEWAY_ELEVATION;

    // Post
    const pm = new THREE.Matrix4().setPosition(bx, by, bz);
    postMatrices.push(pm);

    // Guardrail ribbons (two heights: lower and upper corrugation)
    railPos.push(bx, by + 0.45, bz);
    railPos.push(bx, by + 0.95, bz);
    railNorms.push(pt.nx, 0, pt.nz);
    railNorms.push(pt.nx, 0, pt.nz);

    if (i > 0) {
      const p1 = (railPos.length / 3) - 4;
      const p2 = (railPos.length / 3) - 2;
      railIdx.push(p1, p1 + 1, p2);
      railIdx.push(p2, p1 + 1, p2 + 1);
    }
  }

  const posts = makeInstanced(postGeo, postMat, postMatrices);
  if (posts) group.add(posts);

  const railGeo = new THREE.BufferGeometry();
  railGeo.setAttribute('position', new THREE.Float32BufferAttribute(railPos, 3));
  railGeo.setAttribute('normal', new THREE.Float32BufferAttribute(railNorms, 3));
  railGeo.setIndex(railIdx);
  railGeo.computeVertexNormals();
  const railMesh = new THREE.Mesh(railGeo, barrierMat);
  railMesh.castShadow = true;
  group.add(railMesh);

  // 5. OVERHEAD START/FINISH GANTRY WITH DYNAMIC LIGHTS
  const gantryGroup = new THREE.Group();
  gantryGroup.name = 'start-finish-gantry';
  const gantryMat = new THREE.MeshStandardMaterial({ color: 0x3c4043, metalness: 0.6, roughness: 0.4 });
  const beamW = TRACK_WIDTH + 6;

  // Horizontal overhead truss
  const truss = new THREE.Mesh(new THREE.BoxGeometry(beamW, 1.1, 1.4), gantryMat);
  truss.position.set(START_FINISH.x, RACEWAY_ELEVATION + 6.8, START_FINISH.z);
  truss.rotation.y = Math.PI / 2;
  gantryGroup.add(truss);

  // Left & right support pillars
  const pillarGeo = new THREE.BoxGeometry(1.2, 7.0, 1.2);
  pillarGeo.translate(0, 3.5, 0);
  const leftPillar = new THREE.Mesh(pillarGeo, gantryMat);
  leftPillar.position.set(START_FINISH.x, RACEWAY_ELEVATION, START_FINISH.z - beamW / 2 + 1);
  const rightPillar = new THREE.Mesh(pillarGeo, gantryMat);
  rightPillar.position.set(START_FINISH.x, RACEWAY_ELEVATION, START_FINISH.z + beamW / 2 - 1);
  gantryGroup.add(leftPillar, rightPillar);

  // Start light LED clusters (5 red, 5 green)
  const redLampMat = new THREE.MeshStandardMaterial({
    color: 0x220000,
    emissive: 0x000000,
    roughness: 0.3,
  });
  const greenLampMat = new THREE.MeshStandardMaterial({
    color: 0x002200,
    emissive: 0x000000,
    roughness: 0.3,
  });

  const lampGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.2, 16);
  lampGeo.rotateX(Math.PI / 2);
  const redLamps = [];
  const greenLamps = [];

  for (let i = -2; i <= 2; i++) {
    // Facing grid (-X direction)
    const rl = new THREE.Mesh(lampGeo, redLampMat);
    rl.position.set(START_FINISH.x - 0.75, RACEWAY_ELEVATION + 7.1, START_FINISH.z + i * 1.5);
    gantryGroup.add(rl);
    redLamps.push(rl);

    const gl = new THREE.Mesh(lampGeo, greenLampMat);
    gl.position.set(START_FINISH.x - 0.75, RACEWAY_ELEVATION + 6.4, START_FINISH.z + i * 1.5);
    gantryGroup.add(gl);
    greenLamps.push(gl);
  }

  // Gantry Banner
  const bannerGeo = new THREE.PlaneGeometry(16, 1.8);
  bannerGeo.rotateY(Math.PI / 2);
  const bannerMat = new THREE.MeshStandardMaterial({
    color: 0x111625,
    roughness: 0.5,
    metalness: 0.2,
  });
  const bannerMesh = new THREE.Mesh(bannerGeo, bannerMat);
  bannerMesh.position.set(START_FINISH.x - 0.71, RACEWAY_ELEVATION + 8.4, START_FINISH.z);
  gantryGroup.add(bannerMesh);

  group.add(gantryGroup);

  // Store light controls for the race manager
  group.userData.setLights = (count, green = false) => {
    redLampMat.emissive.setHex(count > 0 ? 0xff0022 : 0x000000);
    redLampMat.emissiveIntensity = count > 0 ? 2.5 : 0;
    greenLampMat.emissive.setHex(green ? 0x00ff55 : 0x000000);
    greenLampMat.emissiveIntensity = green ? 3.0 : 0;
  };

  // 6. SPECTATOR GRANDSTAND ALONG FRONT STRAIGHT
  const grandstandGroup = new THREE.Group();
  const standMat = new THREE.MeshStandardMaterial({ color: 0x4a505b, roughness: 0.8 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x1a73e8, roughness: 0.5 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0xd93025, roughness: 0.7 });

  const standLength = 120;
  // Tiered foundation
  for (let tier = 0; tier < 6; tier++) {
    const tierGeo = new THREE.BoxGeometry(standLength, 0.8, 2.2);
    tierGeo.translate(0, 0.4 + tier * 0.8, tier * 2.0);
    const tm = new THREE.Mesh(tierGeo, standMat);
    tm.position.set(START_FINISH.x + 60, RACEWAY_ELEVATION, START_FINISH.z - TRACK_HALF - 7);
    grandstandGroup.add(tm);

    // Row of seats
    const seatGeo = new THREE.BoxGeometry(standLength - 4, 0.35, 0.7);
    seatGeo.translate(0, 0.95 + tier * 0.8, tier * 2.0 + 0.5);
    const sm = new THREE.Mesh(seatGeo, seatMat);
    sm.position.set(START_FINISH.x + 60, RACEWAY_ELEVATION, START_FINISH.z - TRACK_HALF - 7);
    grandstandGroup.add(sm);
  }
  // Canopy Roof
  const canopyGeo = new THREE.BoxGeometry(standLength + 6, 0.4, 16);
  const canopy = new THREE.Mesh(canopyGeo, roofMat);
  canopy.position.set(START_FINISH.x + 60, RACEWAY_ELEVATION + 8.5, START_FINISH.z - TRACK_HALF - 12);
  canopy.rotation.x = 0.12;
  grandstandGroup.add(canopy);
  group.add(grandstandGroup);

  // 7. PIT LANE WITH GARAGES & PIT WALL
  const pitGroup = new THREE.Group();
  const pitWallGeo = new THREE.BoxGeometry(220, 1.1, 0.9);
  pitWallGeo.translate(0, 0.55, 0);
  const pitWall = new THREE.Mesh(pitWallGeo, standMat);
  pitWall.position.set(START_FINISH.x + 80, RACEWAY_ELEVATION, START_FINISH.z + TRACK_HALF + 1.2);
  pitGroup.add(pitWall);

  // Pit building garages
  const garageGeo = new THREE.BoxGeometry(180, 5.0, 14);
  garageGeo.translate(0, 2.5, 0);
  const garageBuilding = new THREE.Mesh(garageGeo, new THREE.MeshStandardMaterial({ color: 0x373b44, roughness: 0.6 }));
  garageBuilding.position.set(START_FINISH.x + 80, RACEWAY_ELEVATION, START_FINISH.z + TRACK_HALF + 14);
  pitGroup.add(garageBuilding);
  group.add(pitGroup);

  // 8. EIGHT STADIUM FLOODLIGHT TOWERS
  const floodlightGroup = new THREE.Group();
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x70757a, metalness: 0.7, roughness: 0.4 });
  const lightHeadMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfff5dd,
    emissiveIntensity: 2.2,
  });

  const towerPositions = [
    { x: 3560, z: 2420 }, // Start/finish
    { x: 3880, z: 2420 }, // End of straight
    { x: 4160, z: 2530 }, // Turn 1/2
    { x: 4120, z: 2750 }, // Coastal esses
    { x: 3950, z: 2950 }, // South curve
    { x: 3620, z: 2980 }, // Hairpin
    { x: 3660, z: 2680 }, // Back straight
    { x: 3460, z: 2520 }, // Parabolica
  ];

  for (const tp of towerPositions) {
    // Lattice pylon
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 1.1, 24, 6), towerMat);
    pylon.position.set(tp.x, RACEWAY_ELEVATION + 12, tp.z);
    floodlightGroup.add(pylon);

    // Cross-arm light bank
    const cross = new THREE.Mesh(new THREE.BoxGeometry(6.5, 1.8, 0.8), towerMat);
    cross.position.set(tp.x, RACEWAY_ELEVATION + 24, tp.z);
    floodlightGroup.add(cross);

    // Glowing halogen bulbs
    const bulbs = new THREE.Mesh(new THREE.BoxGeometry(6.1, 1.4, 0.4), lightHeadMat);
    bulbs.position.set(tp.x, RACEWAY_ELEVATION + 24, tp.z + 0.3);
    floodlightGroup.add(bulbs);

    // High-angle spot illumination pool
    const spot = new THREE.SpotLight(0xfff5e6, 40, 180, Math.PI / 4, 0.5, 1.2);
    spot.position.set(tp.x, RACEWAY_ELEVATION + 24, tp.z);
    spot.target.position.set(tp.x, RACEWAY_ELEVATION, tp.z + (tp.z < 2600 ? 30 : -30));
    floodlightGroup.add(spot);
    floodlightGroup.add(spot.target);
  }
  group.add(floodlightGroup);

  // 9. ISLAND FOUNDATION DECK & CONCRETE SEA WALL
  // Concrete perimeter deck underneath the raceway (sits 8cm below track surface to prevent Z-fighting)
  const islandMat = new THREE.MeshStandardMaterial({ color: 0x1e2229, roughness: 0.9 });
  const islandTopY = RACEWAY_ELEVATION - 0.08;
  const islandH = islandTopY - WATER_Y;
  const islandFloor = new THREE.Mesh(
    new THREE.BoxGeometry(780, islandH, 620),
    islandMat
  );
  islandFloor.position.set(3810, (islandTopY + WATER_Y) / 2, 2720);
  islandFloor.receiveShadow = true;
  group.add(islandFloor);

  // 10. ACCESS CAUSEWAY / BRIDGE FROM DOCK ROAD (3420, 2420) TO RACEWAY (3500, 2460)
  const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x2b2e36, roughness: 0.8 });
  const dx = CAUSEWAY_PADDOCK.x - DOCK_ROAD_END.x, dz = CAUSEWAY_PADDOCK.z - DOCK_ROAD_END.z;
  const bridgeL = Math.hypot(dx, dz);
  const bridgeYaw = Math.atan2(dz, dx);
  const bridgeMesh = new THREE.Mesh(
    new THREE.BoxGeometry(bridgeL, 1.2, 14),
    bridgeMat
  );
  bridgeMesh.position.set(
    (DOCK_ROAD_END.x + CAUSEWAY_PADDOCK.x) / 2,
    RACEWAY_ELEVATION - 0.64,
    (DOCK_ROAD_END.z + CAUSEWAY_PADDOCK.z) / 2
  );
  bridgeMesh.rotation.y = -bridgeYaw;
  group.add(bridgeMesh);

  scene.add(group);
  return group;
}

/** Determines if (x, z) falls within the Halstead Raceway island or access causeway. */
export function isRacewayArea(x, z) {
  // Access bridge corridor
  if (x >= 3400 && x <= 3520 && z >= 2400 && z <= 2480) return true;
  // Main raceway island bounds
  return x >= 3440 && x <= 4220 && z >= 2420 && z <= 3040;
}

/** Elevation at raceway surface: 1.2m on track, ramp on access causeway. */
export function racewayElevationAt(x, z) {
  if (!isRacewayArea(x, z)) return null;
  // Smooth slope from Dock Road (elevation ~0.1m) up to Raceway deck (1.2m)
  if (x < 3500) {
    const t = Math.max(0, Math.min(1, (x - 3420) / 80));
    return 0.1 + (RACEWAY_ELEVATION - 0.1) * t * t * (3 - 2 * t);
  }
  return RACEWAY_ELEVATION;
}

/**
 * Injects the raceway's sampled road segments into the loaded District instance
 * so roadDepth(), surfaceAt(), and minimap seamlessly recognize the circuit.
 */
export function registerRaceTrackPhysics(district) {
  if (!district) return;
  district.isRacewayLand = isRacewayArea;
  district.racewayElevationAt = racewayElevationAt;

  const samples = getSampledTrack(10);
  const M = samples.length;

  // Circuit road segments
  for (let i = 0; i < M; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % M];
    const seg = {
      ax: a.x,
      az: a.z,
      bx: b.x,
      bz: b.z,
      half: TRACK_HALF,
      cls: 'arterial',
    };
    if (district.addSegment) {
      district.addSegment(seg, TRACK_HALF + 4);
    } else {
      const id = district.segments.push(seg) - 1;
      const x0 = Math.floor((Math.min(seg.ax, seg.bx) - TRACK_HALF - 4) / 96);
      const x1 = Math.floor((Math.max(seg.ax, seg.bx) + TRACK_HALF + 4) / 96);
      const z0 = Math.floor((Math.min(seg.az, seg.bz) - TRACK_HALF - 4) / 96);
      const z1 = Math.floor((Math.max(seg.az, seg.bz) + TRACK_HALF + 4) / 96);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          const k = `${ix},${iz}`;
          (district.grid.get(k) ?? district.grid.set(k, []).get(k)).push(id);
        }
      }
    }
  }

  // Access causeway segment from Dock Road to Raceway
  const causewaySeg = {
    ax: DOCK_ROAD_END.x,
    az: DOCK_ROAD_END.z,
    bx: CAUSEWAY_PADDOCK.x,
    bz: CAUSEWAY_PADDOCK.z,
    half: 7.0,
    cls: 'arterial',
  };
  if (district.addSegment) {
    district.addSegment(causewaySeg, 12);
  } else {
    district.segments.push(causewaySeg);
  }
}
