import * as THREE from 'three';
import { M4, mergeGeos, loft, section } from '../core/geometry.js';
import { buildStations } from './config.js';
import { buildTyre, buildRim } from './model.js';

/**
 * Waymo Jaguar I-Pace — the 5th-generation Waymo Driver on Jaguar's electric
 * SUV, modelled entirely from memory (no reference assets, no vendor files:
 * everything here is lofted or primitive, so it ships free per the repo rule).
 *
 * The I-Pace read, in order of loudness:
 *   - cab-forward: the windscreen base sits almost over the front axle, the
 *     bonnet is a stub, and the wheels are pushed to the corners (2.99 m
 *     wheelbase in a 4.68 m car — compare the hero's 2.72 in 4.64);
 *   - a coupe roof that peaks over the B-pillar and falls to an abrupt,
 *     squared-off tail with a roof spoiler;
 *   - black cladding round the sills and arches under white paint.
 * The Waymo read, on top of that:
 *   - the roof "top hat": a white plinth spanning the roof with the spinning
 *     360° lidar dome on it, dark sensor glass round the dome's waist;
 *   - perimeter pods over each front wing and rear quarter (lidar + camera);
 *   - a radar slab in the front bumper and B-pillar camera pucks.
 *
 * Contract matches the vendor "whole group" bodies (vendorCars.js 's' path):
 * one THREE.Group, nose along +X, centred on its footprint in X/Z, tyre
 * contact plane at y = 0. Wheels are static, like every vendor body.
 */
/**
 * The roofline, as hand-placed landmarks. It is DENSIFIED before it reaches
 * buildStations: every point in `top` becomes a loft station, and the glazing
 * boundary is decided per quad, so on the sparse key polyline the raked
 * A- and D-pillars came out as a visible staircase of body-coloured steps
 * across the side glass. Interpolating the same shape at 0.16 m puts a station
 * close enough to every pillar crossing that the edge reads as a line.
 * The shape is unchanged: these are points ON the original polyline.
 */
const IPACE_TOP_KEY = [
  [0, 0.70], [0.22, 0.88], [0.60, 1.00], [1.05, 1.06], [1.28, 1.14],
  [2.05, 1.52], [2.55, 1.565], [3.10, 1.545], [3.65, 1.46], [4.15, 1.34],
  [4.45, 1.24], [4.68, 0.98],
];

/** Insert points along a polyline so no span exceeds `step`. Shape unchanged. */
export function densify(pts, step = 0.16) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const n = Math.max(1, Math.ceil((x1 - x0) / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
  }
  return out;
}

export const IPACE_SPEC = {
  L: 4.68, axleF: 0.86, axleR: 3.85, wheelR: 0.36, ride: 0.175, wMax: 0.95,
  bonnetY: 1.02, roofY: 1.56, beltY: 0.92, tumble: 0.72, detail: 1,
  top: densify(IPACE_TOP_KEY),
};

export const IPACE_TRACK = 1.62;

/**
 * Glazing layout in absolute metres off THIS hull (hullClassify's numbers
 * describe the hero's three-box saloon and put the I-Pace's screen on its
 * bonnet). The A-pillar starts at 1.30 and rakes hard (+0.72 m over the glass
 * height); the D-pillar rakes forward off the near-vertical tail.
 */
export function ipaceClassify(xm, hf, wf) {
  if (hf < 0.16) return 'body';
  const aPillar = 1.30 + hf * 0.72;
  const dPillar = 3.98 - hf * 0.50;
  const bPillar = xm > 2.50 && xm < 2.70;
  /* The greenhouse is cut on HEIGHT alone, never on width.
     The hero's classifier gates glass on `wf` (|z| as a fraction of the
     section's widest half-width) as well, and on this body that produced
     ragged white shards stabbing into the screens: `wf` and `hf` vary
     independently per quad, so their two boundaries cross at a different place
     on every station and the intersection is jagged rather than a line. A pure
     `hf` band gives the cabin one clean waistline and one clean roof edge, and
     the pillars come from `xm` — which is what actually shapes a greenhouse.
     `wf` is kept in the signature to match hullClassify/stuntClassify. */
  /* Order matters: the screens come FIRST. Over the windscreen the section's
     TOP surface is the glass, so hf runs up to ~1 there — cutting the roof off
     before this rule painted the whole windscreen white. */
  if (hf > 0.28 && xm > 1.32 && xm < 2.28) return 'glass';               // windscreen
  if (hf > 0.42 && xm > 3.98 && xm < 4.42) return 'glass';               // backlight
  if (hf > 0.86) return 'body';                                          // roof panel
  if (!bPillar && xm > aPillar && xm < dPillar) return 'glass';          // side glass
  return 'body';
}

export function buildWaymoMaterials() {
  return {
    // Waymo fleet white — a cool pearl, not printer-paper
    paint: new THREE.MeshPhysicalMaterial({
      color: 0xe9ecee, metalness: 0.35, roughness: 0.28,
      clearcoat: 1.0, clearcoatRoughness: 0.06, envMapIntensity: 1.5,
      side: THREE.DoubleSide,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x1d2a36, metalness: 0.0, roughness: 0.06,
      opacity: 0.82, transparent: true, envMapIntensity: 2.4,
      clearcoat: 1.0, clearcoatRoughness: 0.02, side: THREE.FrontSide,
    }),
    cladding: new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.85, metalness: 0.05 }),
    sensor: new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.35, metalness: 0.55, envMapIntensity: 1.4 }),
    sensorGlass: new THREE.MeshStandardMaterial({ color: 0x0c1116, roughness: 0.12, metalness: 0.3, envMapIntensity: 2.2 }),
    housing: new THREE.MeshStandardMaterial({ color: 0xe4e7e9, roughness: 0.4, metalness: 0.2 }),
    // the teal-green Waymo accent ring on the dome
    accent: new THREE.MeshStandardMaterial({ color: 0x00a29a, roughness: 0.45, metalness: 0.1 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.95 }),
    alloy: new THREE.MeshStandardMaterial({ color: 0x565b61, roughness: 0.35, metalness: 0.9, envMapIntensity: 1.4 }),
    head: new THREE.MeshStandardMaterial({ color: 0xe6ecf6, emissive: 0xcfe0ff, emissiveIntensity: 2.2, roughness: 0.08 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x4a0f12, emissive: 0xc41d20, emissiveIntensity: 0.6, roughness: 0.22 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xc9c9c3, roughness: 0.6 }),
  };
}

/** Half-width of the I-Pace hull at station x (for kerbside trim placement). */
function halfWidth(stations, x) {
  let i = 0;
  while (i < stations.length - 2 && stations[i + 1][0] < x) i++;
  const a = stations[i], b = stations[i + 1];
  const t = Math.max(0, Math.min(1, (x - a[0]) / Math.max(1e-4, b[0] - a[0])));
  return a[4] + (b[4] - a[4]) * t;
}

/**
 * Close an open end of the loft.
 *
 * `loft()` DOES close its ends, but it winds those caps inward: on a
 * DoubleSide paint the nose and tail came out as flat, washed-out grey slabs
 * that did not even change colour with the paint, because all that reached
 * them was the clearcoat's environment term (measured by raycasting the nose
 * plane: two surfaces at x = 2.34, the paint cap and this one). So this fan is
 * not closing a hole — it is a panel that has to WIN the depth test against a
 * coplanar face, which is why it stands `PROUD` of the station rather than on
 * it. A fan over the ring's own section fits the opening exactly, with no gap
 * to line up by hand.
 *
 * `dir` is the outward normal along x: -1 at the nose (station 0), +1 at the
 * tail. Winding is chosen per triangle from the sign it produces, so the cap
 * is lit as an outside face whichever way the section happens to wind.
 */
function capGeo(st, dir) {
  const ring = section(st);                       // [z, y] pairs, closed
  const n = ring.length;
  let cy = 0, cz = 0;
  for (const [z, y] of ring) { cy += y; cz += z; }
  cy /= n; cz /= n;
  /* 12 mm proud of the station plane. Coplanar with the loft's own cap it
     z-fought and lost, which is the whole reason the first pass looked
     unchanged. Small enough to read as a panel let into the bodywork. */
  const PROUD = 0.012;
  const x = st[0] + dir * PROUD;
  const P = [], N = [], U = [];
  // UVs off the ring's own bounding box, so a cap can take a decal later (rule 4)
  let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [z, y] of ring) {
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  const uv = (z, y) => [(z - z0) / Math.max(1e-4, z1 - z0), (y - y0) / Math.max(1e-4, y1 - y0)];
  for (let k = 0; k < n; k++) {
    const a = ring[k], b = ring[(k + 1) % n];
    // x-component of cross(a - c, b - c) for points in the y/z plane
    const sign = (a[1] - cy) * (b[0] - cz) - (a[0] - cz) * (b[1] - cy);
    const [p, q] = Math.sign(sign) === Math.sign(dir) ? [a, b] : [b, a];
    P.push(x, cy, cz, x, p[1], p[0], x, q[1], q[0]);
    for (let i = 0; i < 3; i++) N.push(dir, 0, 0);
    U.push(...uv(cz, cy), ...uv(p[0], p[1]), ...uv(q[0], q[1]));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(U), 2));
  return g;
}

/** The roof lidar "top hat": plinth, dome, sensor waist, accent ring. */
function buildTopHat(mats, roofY) {
  const hat = new THREE.Group();
  // plinth: a low rounded slab bridging the roof rails
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.40, 0.12, 20), mats.housing);
  plinth.scale.z = 0.82;
  plinth.position.y = roofY + 0.055;
  // dome base: the tapered white can the lidar sits in
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.235, 0.16, 20), mats.housing);
  can.position.y = roofY + 0.19;
  // dark sensor waist — the window the lidar actually spins behind
  const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.175, 0.115, 20), mats.sensorGlass);
  waist.position.y = roofY + 0.325;
  // crown
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.165, 0.075, 20), mats.housing);
  crown.position.y = roofY + 0.42;
  // Waymo accent ring between can and waist
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.012, 8, 24), mats.accent);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = roofY + 0.27;
  // GPS fin trailing the dome
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.055, 0.10), mats.housing);
  fin.position.set(-0.42, roofY + 0.09, 0);
  hat.add(plinth, can, waist, crown, ring, fin);
  return hat;
}

/** A perimeter sensor pod: white housing with a dark lidar puck on top. */
function buildPod(mats, r = 0.075, h = 0.11) {
  const pod = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.15, r * 1.3, h * 0.55, 14), mats.housing);
  base.position.y = h * 0.275;
  const puck = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r, h * 0.5, 14), mats.sensorGlass);
  puck.position.y = h * 0.8;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.9, h * 0.2, 14), mats.housing);
  cap.position.y = h * 1.12;
  pod.add(base, puck, cap);
  return pod;
}

/**
 * Build the whole car. Returns a Group (contract in the header) with
 * userData: { dome, wheels, paint } — dome so a caller can spin the lidar,
 * paint so damage/garage tinting has something to talk to (it stays white).
 */
export function buildWaymoIPace(mats = buildWaymoMaterials()) {
  const spec = IPACE_SPEC;
  const stations = buildStations(spec);
  const group = new THREE.Group();
  // stations run nose x=0 → tail x=L with the nose down -X; a half turn about
  // the footprint centre puts the nose on +X and centres the car (see model.js)
  const shell = new THREE.Group();
  shell.rotation.y = Math.PI;
  shell.position.x = spec.L / 2;
  group.add(shell);

  const hull = loft(stations, ipaceClassify);
  const body = new THREE.Mesh(hull.body, mats.paint);
  body.castShadow = true;
  body.receiveShadow = true;
  const glass = new THREE.Mesh(hull.glass, mats.glass);
  shell.add(body, glass);

  /* Nose and tail caps. The nose one is CLADDING, not paint: on the real car
     that face is the black grille aperture and the bumper below it, and it is
     the cheapest way to stop a 1.1 m washed-out panel staring out of the
     front. The tail takes the same treatment: on the real car that face is the
     dark hatch applique the lamp bar runs across, and the lamp bar and plate
     already sit on it. */
  const noseCap = new THREE.Mesh(capGeo(stations[0], -1), mats.cladding);
  const tailCap = new THREE.Mesh(capGeo(stations[stations.length - 1], 1), mats.cladding);
  noseCap.castShadow = true; tailCap.castShadow = true;
  noseCap.receiveShadow = true; tailCap.receiveShadow = true;
  shell.add(noseCap, tailCap);

  const roofY = spec.roofY + 0.005;

  // ---- Waymo sensor suite ----------------------------------------------
  const hat = buildTopHat(mats, roofY);
  hat.position.x = 2.55;                       // over the B-pillar, the roof peak
  shell.add(hat);
  const dome = hat;

  // perimeter pods: front wings (proud of the bonnet) and rear quarters
  for (const s of [-1, 1]) {
    const front = buildPod(mats);
    front.position.set(0.80, 1.045, s * (halfWidth(stations, 0.80) * 0.62));
    const rear = buildPod(mats, 0.065, 0.10);
    rear.position.set(4.28, 1.28, s * (halfWidth(stations, 4.28) * 0.58));
    shell.add(front, rear);
    // B-pillar camera puck
    const cam = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10), mats.sensor);
    cam.rotation.x = Math.PI / 2;
    cam.position.set(2.60, 1.02, s * (halfWidth(stations, 2.60) * 0.72 + 0.02));
    shell.add(cam);
  }
  // front bumper radar slab + rear bumper radar
  const radarF = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.42), mats.sensor);
  radarF.position.set(0.10, 0.52, 0);
  const radarR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.10, 0.36), mats.sensor);
  radarR.position.set(4.62, 0.60, 0);
  shell.add(radarF, radarR);

  // ---- I-Pace trim ------------------------------------------------------
  const trimParts = [];
  const boxAt = (w, h, d, x, y, z, ry = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.applyMatrix4(M4(x, y, z, 0, ry, 0));
    trimParts.push(g);
  };
  // black sill cladding and under-bumper valances
  boxAt(2.6, 0.14, IPACE_TRACK + 0.16, 2.36, 0.30, 0);
  boxAt(0.24, 0.26, halfWidth(stations, 0.14) * 1.9, 0.14, 0.42, 0);       // front valance
  boxAt(0.24, 0.26, halfWidth(stations, 4.55) * 1.9, 4.55, 0.42, 0);      // rear valance
  boxAt(3.9, 0.06, 1.55, 2.36, 0.24, 0);                                   // flat EV floor pan
  // the I-Pace grille: a low blanked panel (EV) under the bonnet lip
  boxAt(0.07, 0.20, halfWidth(stations, 0.18) * 1.2, 0.18, 0.74, 0);
  // roof spoiler over the near-vertical tail
  boxAt(0.30, 0.05, 1.10, 4.42, 1.30, 0);
  const trim = new THREE.Mesh(mergeGeos(trimParts), mats.cladding);
  trim.castShadow = true;
  shell.add(trim);

  // wheel-arch cladding rings — the loudest black-on-white I-Pace cue
  for (const ax of [spec.axleF, spec.axleR]) {
    for (const s of [-1, 1]) {
      const arch = new THREE.Mesh(
        new THREE.TorusGeometry(spec.wheelR + 0.10, 0.035, 6, 18, Math.PI), mats.cladding);
      arch.position.set(ax, spec.wheelR, s * (halfWidth(stations, ax) - 0.015));
      shell.add(arch);
    }
  }

  // ---- lamps, mirrors, plate -------------------------------------------
  const lensGeo = new THREE.SphereGeometry(1, 12, 8);
  for (const s of [-1, 1]) {
    const head = new THREE.Mesh(lensGeo, mats.head);          // slim, swept-back LED
    head.scale.set(0.05, 0.045, 0.19);
    head.position.set(0.30, 0.86, s * 0.52);
    shell.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.34), mats.tail);
    tail.position.set(4.60, 1.02, s * 0.50);
    shell.add(tail);
    // mirrors (Waymo hangs a small camera under each)
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.06), mats.paint);
    cap.position.set(1.52, 1.02, s * (halfWidth(stations, 1.52) + 0.10));
    const mirCam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 8), mats.sensor);
    mirCam.position.set(1.52, 0.95, s * (halfWidth(stations, 1.52) + 0.10));
    shell.add(cap, mirCam);
  }
  const tailBar = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.04, 1.02), mats.tail);
  tailBar.position.set(4.615, 1.02, 0);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.5), mats.plate);
  plate.position.set(4.60, 0.72, 0);
  shell.add(tailBar, plate);

  // ---- wheels (static, like every vendor whole-group body) --------------
  const tyreG = buildTyre(spec.wheelR, 0.125, 20);
  const rimG = buildRim(0.215);
  const wheels = [];
  for (const ax of [spec.axleF, spec.axleR]) {
    for (const s of [-1, 1]) {
      const w = new THREE.Group();
      w.position.set(ax, spec.wheelR, (s * IPACE_TRACK) / 2);
      const tyre = new THREE.Mesh(tyreG, mats.rubber);
      tyre.castShadow = true;
      const rim = new THREE.Mesh(rimG, mats.alloy);
      rim.scale.z = -s;                        // dish outboard (shell flips z again; sign is per-side either way)
      w.add(tyre, rim);
      shell.add(w);
      wheels.push(w);
    }
  }

  group.userData = { dome, wheels, paint: mats.paint };
  return group;
}
