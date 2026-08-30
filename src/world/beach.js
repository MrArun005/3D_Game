import * as THREE from 'three';
import { M4, mergeGeos } from '../core/geometry.js';
import { FigureFleet, FOOT_DROP } from './figure.js';

/**
 * Halstead Sands, and the people on it.
 *
 * The bay polygon's landward edge is the coastline; the beach is a three-row
 * ribbon laid along it -- dry sand above the land plate, wet sand crossing the
 * waterline, and a submerged toe that the water hides. Nothing needs to be cut
 * out of anything: the rows simply pass through the water plane.
 *
 * The crowd is one instanced mesh whose matrices are rewritten each frame.
 * A few hundred people is nothing to the GPU, and a beach without them reads
 * as a sandpit.
 */

const DRY = 58;                    // metres of dry sand behind the waterline
const WET = 34;                    // and submerged toe in front of it
const CROWD = 240;

const WATER_TOP = -2.54;           // a hair above water.js's WATER_Y of -2.6

/** Height of the sand at `across` metres seaward of the coastline. */
function sandY(across) {
  return across >= 0 ? 0.06 + (across / DRY) * 0.12
                     : 0.06 + (across / WET) * 3.26;
}
/** Where the sand crosses the water plane -- the visible edge of the sea. */
const WATERLINE = ((-2.6 - 0.06) / 3.26) * WET;

const hash = (x, z) => {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

export function buildBeach(scene, district, day = true) {
  const group = new THREE.Group();
  const bay = district.data.water.bay;

  // the coast is every bay edge that is not the map boundary
  const cx = bay.reduce((s, p) => s + p[0], 0) / bay.length;
  const cz = bay.reduce((s, p) => s + p[1], 0) / bay.length;
  const coast = [];
  for (let i = 0; i < bay.length - 1; i++) {
    const a = bay[i], b = bay[i + 1];
    // the two edges that run along the map border are not shoreline
    if (Math.abs(a[0] - b[0]) < 1 || Math.abs(a[1] - b[1]) < 1) continue;
    coast.push([a, b]);
  }

  const pos = [], uv = [], nor = [];
  const surf = { pos: [], uv: [] };
  const strip = [];                // dry-sand band, for scattering people on
  for (const [a, b] of coast) {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz);
    let nx = -dz / L, nz = dx / L;
    // point the normal AWAY from the water
    if (nx * (cx - (a[0] + b[0]) / 2) + nz * (cz - (a[1] + b[1]) / 2) > 0) { nx = -nx; nz = -nz; }

    // three rows: dry (above the land), waterline, submerged toe
    /* Every row landward of the coastline must stay ABOVE the land plate at
       -0.06, and only drop once it is over the hole cut for the bay. Sloping
       down from the dune meant 50 of the beach's 58 dry metres were under the
       grass, leaving a tan stripe stranded inland of the sea. */
    /* Kept low on purpose. The car's ground plane is y=0 everywhere, so every
       centimetre the sand stands proud is a centimetre the wheels sink into
       it; 18cm at the dune and 6cm at the water is under the noise, while
       still clearing the land plate at -0.06 cleanly. */
    const rows = [[DRY, 0.18], [0, 0.06], [-WET, -3.2]];
    const P = rows.map(([o, y]) => [
      [a[0] + nx * o, y, a[1] + nz * o], [b[0] + nx * o, y, b[1] + nz * o],
    ]);
    for (let r = 0; r < 2; r++) {
      const [p0, p1] = P[r], [q0, q1] = P[r + 1];
      pos.push(...p0, ...p1, ...q1, ...p0, ...q1, ...q0);
      const v0 = r === 0 ? 0 : DRY / 9, v1 = r === 0 ? DRY / 9 : (DRY + WET) / 9;
      const u = L / 9;
      uv.push(0, v0, u, v0, u, v1, 0, v0, u, v1, 0, v1);
      for (let k = 0; k < 6; k++) nor.push(0, 1, 0);
    }
    // the surf band gets its own strip, from the waterline a little way up
    const sPos = [], sUv = [];
    /* Surf follows the ground, and the ground is what decides where the water
       actually is: the sand crosses the water plane at about 28m seaward, so
       a foam band sitting at +8 to -18 was breaking on dry sand 30m up the
       beach. Three rows -- wet sand, the waterline itself, then out onto the
       open water. */
    const surfRows = [[-11, sandY(-11) + 0.04], [WATERLINE, WATER_TOP], [-46, WATER_TOP]];
    const SP = surfRows.map(([o, y]) => [
      [a[0] + nx * o, y, a[1] + nz * o], [b[0] + nx * o, y, b[1] + nz * o],
    ]);
    for (let r = 0; r < 2; r++) {
      const [p0, p1] = SP[r], [q0, q1] = SP[r + 1];
      sPos.push(...p0, ...p1, ...q1, ...p0, ...q1, ...q0);
      const u = L / 26;
      const v0 = r === 0 ? 0 : 0.55, v1 = r === 0 ? 0.55 : 1;
      sUv.push(0, v0, u, v0, u, v1, 0, v0, u, v1, 0, v1);
    }
    surf.pos.push(...sPos); surf.uv.push(...sUv);

    strip.push({ a, nx, nz, dx: dx / L, dz: dz / L, L });
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  /* DoubleSide because the coast polyline's winding depends on which way the
     bay polygon was authored, and a back-faced beach is an invisible one. */
  const sand = new THREE.Mesh(g, new THREE.MeshLambertMaterial({
    map: sandTexture(), color: day ? 0xffffff : 0x6b6a63, side: THREE.DoubleSide,
  }));
  sand.receiveShadow = true;
  sand.frustumCulled = false;
  group.add(sand);

  /* --- the surf ---
     Waves that break need two things a scrolling texture alone cannot give:
     motion ALONG the shore and a wash that runs up and back. The texture
     handles the first; the mesh's own V offset, driven by a slow sine in
     update(), handles the second. */
  const surfTex = foamTexture();
  const surfMat = new THREE.MeshBasicMaterial({
    map: surfTex, transparent: true, depthWrite: false, opacity: 0.9,
    // DoubleSide for the same reason the sand needs it: the coast polyline's
    // winding follows the bay polygon, and half of it faces down. Opaque
    // magenta rendered as nothing at all until this was set.
    side: THREE.DoubleSide,
  });
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(surf.pos), 3));
  sg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(surf.uv), 2));
  const surfMesh = new THREE.Mesh(sg, surfMat);
  surfMesh.frustumCulled = false;
  surfMesh.renderOrder = 3;
  group.add(surfMesh);

  /* --- parasols and towels, scattered along the dry band --- */
  const total = strip.reduce((s, r) => s + r.L, 0);
  const at = (t, across) => {                 // t along the whole coast, across the sand
    let run = t;
    for (const r of strip) {
      if (run > r.L) { run -= r.L; continue; }
      return [r.a[0] + r.dx * run + r.nx * across, r.a[1] + r.dz * run + r.nz * across];
    }
    const r = strip[strip.length - 1];
    return [r.a[0] + r.dx * r.L + r.nx * across, r.a[1] + r.dz * r.L + r.nz * across];
  };

  const poles = [], shades = [], towels = [], shadeCol = [], towelCol = [];
  const c = new THREE.Color();
  const SHADE = [0xe8503c, 0xf0b429, 0x2f9ed8, 0xe8e2d2, 0x35b57a];
  for (let i = 0; i < 46; i++) {
    const t = hash(i, 7) * total, across = 8 + hash(i, 13) * (DRY - 20);
    const [x, z] = at(t, across);
    const sy = 0.06 + (across / DRY) * 0.12;
    poles.push(M4(x, sy, z, 0, 0, 0, 0.07, 2.4, 0.07));
    shades.push(M4(x, sy + 2.05, z, 0, hash(i, 31) * 6.28, 0, 1, 1, 1));
    shadeCol.push(SHADE[i % SHADE.length]);
  }
  for (let i = 0; i < 90; i++) {
    const t = hash(i, 19) * total, across = 6 + hash(i, 23) * (DRY - 16);
    const [x, z] = at(t, across);
    towels.push(M4(x, 0.09 + (across / DRY) * 0.12, z, -Math.PI / 2, 0, hash(i, 29) * 6.28, 1.9, 0.95, 1));
    towelCol.push(SHADE[(i * 3) % SHADE.length]);
  }

  const inst = (geo, mat, list, colours, shadow) => {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((mm, i) => m.setMatrixAt(i, mm));
    m.instanceMatrix.needsUpdate = true;
    if (colours) {
      colours.forEach((hex, i) => m.setColorAt(i, c.setHex(hex)));
      m.instanceColor.needsUpdate = true;
    }
    m.frustumCulled = false;
    m.castShadow = !!shadow;
    group.add(m);
    return m;
  };

  const parasol = new THREE.ConeGeometry(1.5, 0.55, 10);
  inst(new THREE.CylinderGeometry(1, 1, 1, 6), new THREE.MeshLambertMaterial({ color: 0xd8d2c4 }), poles);
  inst(parasol, new THREE.MeshLambertMaterial({ color: 0xffffff }), shades, shadeCol, true);
  inst(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({
    color: 0xffffff, side: THREE.DoubleSide,
  }), towels, towelCol);

  /* --- the crowd --- */
  const SKIN = [0xf0c8a0, 0xd9a173, 0xa8724a, 0x7a4f33, 0x5a3a26];
  const WEAR = [0x2f6dff, 0xe8503c, 0xf0b429, 0xffffff, 0x35b57a, 0xd63cff, 0x1f2a36];
  const people = [];
  for (let i = 0; i < CROWD; i++) {
    const t = hash(i, 3) * total;
    // most on the dry sand, some paddling in the shallows
    const across = hash(i, 5) < 0.24 ? -4 - hash(i, 11) * 9 : 3 + hash(i, 11) * (DRY - 12);
    const [x, z] = at(t, across);
    people.push({
      x, z, y: across < 0 ? -1.0 : 0,
      home: [x, z], heading: hash(i, 17) * 6.28,
      speed: hash(i, 41) < 0.45 ? 0 : 0.5 + hash(i, 43) * 0.9,
      phase: hash(i, 47) * 6.28,
    });
  }
  const fleet = new FigureFleet(group, CROWD, { shadows: true });
  people.forEach((_, i) => fleet.colour(i, WEAR[i % WEAR.length], SKIN[(i * 7) % SKIN.length]));
  fleet.flush(true);

  scene.add(group);
  let clock = 0;
  return {
    group,
    update(dt) {
      clock += dt;
      // waves run along the beach, and the whole wash breathes up and back
      surfTex.offset.x = clock * 0.028;
      surfTex.offset.y = -0.16 + Math.sin(clock * 0.55) * 0.14;
      surfMat.opacity = 0.78 + Math.sin(clock * 0.55 + 1.1) * 0.2;
      for (let i = 0; i < CROWD; i++) {
        const p = people[i];
        if (p.speed) {
          // wander, but never far from where they set their towel down
          p.heading += Math.sin(clock * 0.4 + p.phase) * dt * 0.9;
          p.x += Math.cos(p.heading) * p.speed * dt;
          p.z += Math.sin(p.heading) * p.speed * dt;
          const dx = p.x - p.home[0], dz = p.z - p.home[1];
          if (dx * dx + dz * dz > 400) p.heading = Math.atan2(-dz, -dx);
        }
        p.phase += (p.speed || 0.55) * dt * 2.6;
        fleet.write(i, p.x, p.y + FOOT_DROP, p.z, p.heading, p.phase, p.speed > 0.15 ? 1 : 0, 1);
      }
      fleet.flush();
    },
  };
}

/** Legs, torso, arms. Roughly 1.7m, roughly 90 triangles, no face. */
export function personGeometry() {
  const parts = [];
  for (const side of [-0.09, 0.09]) {
    const leg = new THREE.CylinderGeometry(0.055, 0.048, 0.82, 5);
    leg.applyMatrix4(M4(0, 0.41, side));
    parts.push(leg);
    const arm = new THREE.CylinderGeometry(0.042, 0.038, 0.62, 5);
    arm.applyMatrix4(M4(0, 1.08, side * 2.2, 0, 0, side * 1.6));
    parts.push(arm);
  }
  const torso = new THREE.CylinderGeometry(0.15, 0.13, 0.62, 7);
  torso.applyMatrix4(M4(0, 1.13, 0));
  parts.push(torso);
  const neck = new THREE.CylinderGeometry(0.05, 0.05, 0.1, 5);
  neck.applyMatrix4(M4(0, 1.47, 0));
  parts.push(neck);
  return mergeGeos(parts);
}

/** Sand: grain, plus the wind ripples that stop it reading as brown paper. */
function sandTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#dcc99a';
  g.fillRect(0, 0, S, S);
  // ripples first, so the grain sits on top of them
  g.globalAlpha = 0.5;
  for (let i = 0; i < 34; i++) {
    g.strokeStyle = i % 2 ? '#c9b184' : '#eadcb4';
    g.lineWidth = 1.6 + Math.random() * 2.4;
    g.beginPath();
    const y = (i / 34) * S + Math.random() * 4;
    g.moveTo(0, y);
    g.bezierCurveTo(S * 0.3, y + (Math.random() - 0.5) * 14,
                    S * 0.7, y + (Math.random() - 0.5) * 14, S, y);
    g.stroke();
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 6000; i++) {
    const v = 150 + Math.random() * 90 | 0;
    g.fillStyle = `rgba(${v + 30},${v + 8},${v - 34},0.42)`;
    g.fillRect(Math.random() * S, Math.random() * S, 1.3, 1.3);
  }
  // scattered shells and pebbles
  for (let i = 0; i < 90; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(245,238,225,0.7)' : 'rgba(140,124,100,0.6)';
    g.beginPath();
    g.ellipse(Math.random() * S, Math.random() * S, 1.4 + Math.random() * 2.2,
              1 + Math.random() * 1.4, Math.random() * 3, 0, 7);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Foam: broken bands of white with a soft seaward edge. */
function foamTexture() {
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  for (let band = 0; band < 3; band++) {
    const cy = H * (0.28 + band * 0.24);
    for (let x = 0; x < W; x += 3) {
      const wob = Math.sin(x * 0.05 + band * 2.1) * 9 + Math.sin(x * 0.017) * 14;
      const th = 6 + Math.sin(x * 0.09 + band) * 4;
      const a = 0.5 - band * 0.13;
      const grad = g.createLinearGradient(0, cy + wob - th, 0, cy + wob + th);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, `rgba(255,255,255,${a})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(x, cy + wob - th, 4, th * 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;      // the wash cycles, so V must repeat
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
