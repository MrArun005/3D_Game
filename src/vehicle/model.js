import * as THREE from 'three';
import { M4, mergeGeos, loft, seamRing } from '../core/geometry.js';
import {
  HERO_SPEC, SHUTLINES, hullClassify, stuntClassify, buildStations,
  BODY_TYPES, BODY_KEYS, TRACK, WHEEL_R, AXLE_F, AXLE_R, CG_X,
} from './config.js';

export const HERO_STATIONS = buildStations(HERO_SPEC);

/**
 * Half-width of the hull at a given station. Bumpers and valances sized by hand
 * poked straight through the tapered nose and tail once the hull became
 * parametric, so they are measured off the body instead.
 */
export function hullHalfWidth(x) {
  let i = 0;
  while (i < HERO_STATIONS.length - 2 && HERO_STATIONS[i + 1][0] < x) i++;
  const a = HERO_STATIONS[i], b = HERO_STATIONS[i + 1];
  const t = Math.max(0, Math.min(1, (x - a[0]) / Math.max(1e-4, b[0] - a[0])));
  return a[4] + (b[4] - a[4]) * t;
}

/**
 * Lathed tyre with a real sidewall profile, capped at the bead so the wheel is
 * never see-through. The lathe spins around Y, so it is rotated onto Z.
 */
export function buildTyre(radius = WHEEL_R, width = 0.118, radial = 26) {
  const r = radius, w = width;
  const profile = [
    [r * 0.43, -w], [r * 0.60, -w], [r * 0.74, -w], [r * 0.87, -w * 0.92],
    [r * 0.957, -w * 0.73], [r * 0.994, -w * 0.47], [r, 0],
    [r * 0.994, w * 0.47], [r * 0.957, w * 0.73], [r * 0.87, w * 0.92],
    [r * 0.74, w], [r * 0.60, w], [r * 0.43, w],
  ].map(([a, b]) => new THREE.Vector2(a, b));
  const g = new THREE.LatheGeometry(profile, radial);
  g.rotateX(Math.PI / 2);
  return g;
}

export function buildRim(radius = 0.205) {
  const parts = [];
  const barrel = new THREE.CylinderGeometry(radius, radius, 0.2, 24, 1, true);
  barrel.rotateX(Math.PI / 2);
  parts.push(barrel);

  const face = new THREE.CylinderGeometry(radius * 0.99, radius * 0.99, 0.022, 24);
  face.rotateX(Math.PI / 2);
  face.translate(0, 0, 0.086);
  parts.push(face);

  const lip = new THREE.TorusGeometry(radius, 0.016, 6, 24);
  lip.translate(0, 0, 0.098);
  parts.push(lip);

  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI * 2) / 5;
    const spoke = new THREE.BoxGeometry(radius * 0.72, 0.05, 0.028);
    spoke.translate(radius * 0.43, 0, 0);
    spoke.applyMatrix4(M4(0, 0, 0.098, 0, 0, a));
    parts.push(spoke);
    const nut = new THREE.CylinderGeometry(0.017, 0.017, 0.026, 6);
    nut.rotateX(Math.PI / 2);
    nut.applyMatrix4(M4(Math.cos(a) * 0.062, Math.sin(a) * 0.062, 0.112));
    parts.push(nut);
  }
  const hub = new THREE.CylinderGeometry(0.055, 0.055, 0.05, 14);
  hub.rotateX(Math.PI / 2);
  hub.translate(0, 0, 0.1);
  parts.push(hub);
  return mergeGeos(parts);
}

/** Seats, dash and wheel. Only ever seen through glass, so it stays coarse. */
function buildInterior() {
  const parts = [];
  const box = (w, h, d, x, y, z, rz = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.applyMatrix4(M4(x, y, z, 0, 0, rz));
    return g;
  };
  parts.push(box(0.46, 0.18, 1.42, 1.88, 0.92, 0));          // dashboard
  parts.push(box(0.90, 0.16, 0.26, 2.34, 0.76, 0));          // console
  parts.push(box(0.10, 0.30, 1.50, 1.62, 0.86, 0));          // bulkhead
  for (const s of [-1, 1]) {
    parts.push(box(0.50, 0.12, 0.42, 2.38, 0.72, s * 0.34));            // squab
    parts.push(box(0.15, 0.46, 0.42, 2.64, 0.96, s * 0.34, -0.16));     // backrest
    parts.push(box(0.14, 0.15, 0.19, 2.70, 1.22, s * 0.34));            // headrest
  }
  parts.push(box(0.55, 0.12, 1.18, 3.18, 0.72, 0));          // rear bench
  parts.push(box(0.16, 0.44, 1.18, 3.44, 0.94, 0, -0.14));
  parts.push(box(0.52, 0.05, 1.22, 3.84, 0.99, 0));          // parcel shelf

  const wheel = new THREE.TorusGeometry(0.155, 0.021, 8, 20);
  wheel.rotateY(Math.PI / 2);
  wheel.rotateZ(0.32);
  wheel.translate(2.06, 1.03, 0.36);
  parts.push(wheel);
  const column = new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8);
  column.rotateZ(Math.PI / 2 + 0.32);
  column.translate(1.94, 0.98, 0.36);
  parts.push(column);
  return mergeGeos(parts);
}

/**
 * A driver, seated. Modelled rather than sprited because you see them through
 * the screen from the chase camera every second of play, and an empty cabin is
 * the loudest tell that a car is a prop. Anyone can be in this seat -- the
 * skin and shirt are per-car, so a stolen car keeps whoever is in it.
 */
export function buildDriver() {
  const parts = [];
  const box = (w, h, d, x, y, z, rz = 0, ry = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.applyMatrix4(M4(x, y, z, 0, ry, rz));
    return g;
  };
  const Z = 0.36;                       // right-hand drive, same side as the wheel
  /* Sized down and sat lower than a standing figure: the hero's roofline is
     1.36m and the first pass put the head at 1.44, so the driver's skull came
     out through the roof. */
  parts.push(box(0.42, 0.13, 0.28, 2.48, 0.74, Z));                  // thighs
  parts.push(box(0.15, 0.28, 0.26, 2.70, 0.86, Z, 0.14));            // hips into torso
  parts.push(box(0.20, 0.34, 0.33, 2.67, 1.00, Z, 0.12));            // chest
  for (const side of [-1, 1]) {
    parts.push(box(0.42, 0.08, 0.08, 2.40, 0.99, Z + side * 0.14, 0.28));
  }
  const head = new THREE.SphereGeometry(0.098, 10, 8);
  head.applyMatrix4(M4(2.68, 1.21, Z, 0, 0, 0, 1, 1.12, 0.94));
  parts.push(head);
  return mergeGeos(parts);
}

export function buildMaterials() {
  return {
    paint: new THREE.MeshPhysicalMaterial({
      color: 0x23282e, metalness: 0.62, roughness: 0.22,
      clearcoat: 1.0, clearcoatRoughness: 0.045, envMapIntensity: 1.6,
    }),
    /* Glazing you can see through. It was a near-black 66% sheet, which read
       as a solid roof and hid the cabin entirely -- fine at night, wrong the
       moment there is a person in there to look at. */
    glass: new THREE.MeshPhysicalMaterial({
      /* Dark enough that the body still reads as bodywork -- hullClassify is
         generous about what counts as glass, and the old near-black tint was
         hiding how far down the flank it went. */
      color: 0x2a3a4c, metalness: 0.0, roughness: 0.05,
      opacity: 0.76, transparent: true, envMapIntensity: 2.6,
      clearcoat: 1.0, clearcoatRoughness: 0.02, side: THREE.FrontSide,
    }),
    skin: new THREE.MeshStandardMaterial({ color: 0xe0b48c, roughness: 0.85 }),
    shirt: new THREE.MeshStandardMaterial({ color: 0x2c3a4e, roughness: 0.8 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.95 }),
    alloy: new THREE.MeshStandardMaterial({
      color: 0x9aa0a7, roughness: 0.30, metalness: 0.95, envMapIntensity: 1.6,
    }),
    disc: new THREE.MeshStandardMaterial({ color: 0x4b4e53, roughness: 0.5, metalness: 0.8 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0x53565c, roughness: 0.55, metalness: 0.7 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.68, metalness: 0.35 }),
    archLiner: new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 1.0, metalness: 0.0 }),
    seam: new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 0.9 }),
    cabin: new THREE.MeshStandardMaterial({ color: 0x3d4046, roughness: 0.82 }),
    chrome: new THREE.MeshStandardMaterial({
      color: 0xbdc2c7, roughness: 0.12, metalness: 1.0, envMapIntensity: 2.0,
    }),
    lampOn: new THREE.MeshStandardMaterial({
      color: 0xe6ecf6, emissive: 0xcfe0ff, emissiveIntensity: 2.6, roughness: 0.06,
    }),
    lampGlass: new THREE.MeshPhysicalMaterial({
      color: 0x8f9aa8, roughness: 0.06, metalness: 0.1,
      transparent: true, opacity: 0.42, envMapIntensity: 2.4,
    }),
    tail: new THREE.MeshStandardMaterial({
      color: 0x4a0f12, emissive: 0xc41d20, emissiveIntensity: 0.6, roughness: 0.22,
    }),
    plate: new THREE.MeshStandardMaterial({ color: 0xc9c9c3, roughness: 0.6 }),
    stunt: new THREE.MeshStandardMaterial({
      color: 0xffffff, metalness: 0.55, roughness: 0.34, envMapIntensity: 1.1,
    }),
    stuntGlass: new THREE.MeshStandardMaterial({
      color: 0x0e141b, metalness: 0.2, roughness: 0.12, envMapIntensity: 1.6,
    }),
  };
}

/** The hero car: full-detail loft, shutlines, cabin, steerable wheels. */
export function buildCar(mats, paintHex) {
  const group = new THREE.Group();
  // everything hangs off a shell shifted so the CG lands on the group origin
  // The hull is authored with the nose at x=0 and the tail at +L, so its nose
  // points down -X — but the simulation drives along +X. Rotating the shell a
  // half turn puts the nose at the front AND lands the centre of gravity on the
  // group origin. Without this the car drives tail-first.
  // group  -> yaw and world position only
  //   body  -> heave, pitch and roll (the sprung mass)
  //     shell -> the half-turn that puts the nose forward
  //   wheels -> hung off the group, so they stay on the road while the body leans
  const body = new THREE.Group();
  group.add(body);
  const shell = new THREE.Group();
  shell.rotation.y = Math.PI;
  shell.position.x = CG_X;
  body.add(shell);
  const hull = loft(HERO_STATIONS, hullClassify);

  const paint = mats.paint.clone();
  paint.color.setHex(paintHex);
  const bodyMesh = new THREE.Mesh(hull.body, paint);
  bodyMesh.castShadow = true;
  // the loudest daylight tell was a car driving through a tower's shadow
  // fully lit -- nothing outside src/world ever set this
  bodyMesh.receiveShadow = true;
  /* The hero's glazing is cloned because the damage model frosts it as the
     car is wrecked -- shared with traffic, one bad crash would shatter the
     windows of every car in the city. */
  const glassMat = mats.glass.clone();
  const glassMesh = new THREE.Mesh(hull.glass, glassMat);
  shell.add(bodyMesh, glassMesh);

  /* Doors, hinged.
     The loft emits the door skins as their own buckets (config.js:
     hullClassify), so each becomes a mesh under a pivot Group placed on its
     hinge line: front doors on the A-pillar shutline, rear on the B-pillar.
     Geometry is translated so the hinge sits at the pivot's origin and a
     rotation about Y swings the trailing edge outward. Opening is a tween on
     `target` driven from main.js's pose pass. */
  const doors = {};
  const DOOR_HINGE = { doorF: SHUTLINES[0], doorR: SHUTLINES[1] };
  for (const key of ['doorFL', 'doorFR', 'doorRL', 'doorRR']) {
    const g = hull[key];
    if (!g) continue;
    const hingeX = DOOR_HINGE[key.slice(0, 5)];
    const sgn = key.endsWith('L') ? 1 : -1;
    const hingeZ = sgn * hullHalfWidth(hingeX) * 0.98;
    g.translate(-hingeX, 0, -hingeZ);
    const pivot = new THREE.Group();
    pivot.position.set(hingeX, 0, hingeZ);
    const m = new THREE.Mesh(g, paint);
    m.castShadow = true; m.receiveShadow = true;
    pivot.add(m);
    // the window in this door rides the same hinge
    const gg = hull[key + 'g'];
    if (gg) { gg.translate(-hingeX, 0, -hingeZ); pivot.add(new THREE.Mesh(gg, glassMat)); }
    shell.add(pivot);
    // outward is away from the centreline: +z doors swing to negative yaw
    doors[key] = { pivot, mesh: m, target: 0, open: -sgn * 1.15, speed: 5.5 };
  }

  // panel shutlines — a car without them reads as one moulded lump
  shell.add(new THREE.Mesh(
    mergeGeos(SHUTLINES.map((x) => seamRing(HERO_STATIONS, x))), mats.seam,
  ));

  const interior = new THREE.Mesh(buildInterior(), mats.cabin);
  shell.add(interior);

  const driver = new THREE.Mesh(buildDriver(), mats.shirt.clone());
  driver.castShadow = true;
  driver.receiveShadow = true;
  shell.add(driver);

  const pan = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.06, 1.5), mats.trim);
  pan.position.set(2.32, 0.235, 0);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 1.66), mats.trim);
  sill.position.set(2.33, 0.26, 0);
  shell.add(pan, sill);

  for (const [bx, bw] of [[0.13, 0.22], [4.53, 0.2]]) {
    const bumper = new THREE.Mesh(
      new THREE.BoxGeometry(bw, 0.3, hullHalfWidth(bx) * 1.95), mats.trim);
    bumper.position.set(bx, 0.46, 0);
    shell.add(bumper);
  }
  const splitter = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.05, hullHalfWidth(0.16) * 1.86), mats.trim);
  splitter.position.set(0.16, 0.31, 0);
  const diffuser = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.09, hullHalfWidth(4.48) * 1.86), mats.trim);
  diffuser.position.set(4.48, 0.33, 0);
  shell.add(splitter, diffuser);

  const grille = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.19, hullHalfWidth(0.2) * 1.30), mats.trim);
  grille.position.set(0.2, 0.70, 0);
  const grilleTrim = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.03, hullHalfWidth(0.23) * 1.34), mats.chrome);
  grilleTrim.position.set(0.23, 0.79, 0);
  const intake = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.10, hullHalfWidth(0.19) * 1.62), mats.trim);
  intake.position.set(0.19, 0.50, 0);
  shell.add(grille, grilleTrim, intake);

  const tailMat = mats.tail.clone();
  const headMat = mats.lampOn.clone();
  const heads = [];
  const lensGeo = new THREE.SphereGeometry(1, 14, 10);

  for (const s of [-1, 1]) {
    // headlamp: recessed dark housing with a lens sitting inside it
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.44), mats.trim);
    housing.position.set(0.29, 0.755, s * 0.50);
    const lens = new THREE.Mesh(lensGeo, headMat);
    lens.scale.set(0.055, 0.062, 0.17);
    lens.position.set(0.33, 0.755, s * 0.50);
    const projector = new THREE.Mesh(
      new THREE.CylinderGeometry(0.036, 0.036, 0.05, 12), mats.chrome,
    );
    projector.rotation.z = Math.PI / 2;
    projector.position.set(0.33, 0.755, s * 0.575);
    shell.add(housing, lens, projector);
    heads.push(lens);

    const tHousing = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.38), mats.trim);
    tHousing.position.set(4.53, 0.845, s * 0.44);
    const tLens = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.32), tailMat);
    tLens.position.set(4.565, 0.845, s * 0.44);
    shell.add(tHousing, tLens);

    // mirror on a stalk, not a block glued to the door
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.14, 8), mats.trim);
    stalk.rotation.x = Math.PI / 2;
    stalk.position.set(1.73, 0.95, s * (hullHalfWidth(1.73) + 0.04));
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.085, 0.05), paint);
    cap.position.set(1.71, 0.985, s * (hullHalfWidth(1.73) + 0.12));
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.012), mats.chrome);
    mirror.position.set(1.71, 0.985, s * (hullHalfWidth(1.73) + 0.098));
    shell.add(stalk, cap, mirror);

    // door handles
    for (const hx of [2.16, 3.34]) {
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.05), mats.chrome);
      handle.position.set(hx, 0.845, s * (hullHalfWidth(hx) + 0.012));
      shell.add(handle);
    }

    const exhaust = new THREE.Mesh(
      new THREE.CylinderGeometry(0.042, 0.048, 0.14, 12), mats.chrome,
    );
    exhaust.rotation.z = Math.PI / 2;
    exhaust.position.set(4.55, 0.36, s * 0.46);
    shell.add(exhaust);

    // wiper parked at the base of the screen
    const wiper = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.014, 0.02), mats.trim);
    wiper.position.set(1.62, 0.955, s * 0.3);
    wiper.rotation.y = s * 0.22;
    shell.add(wiper);
  }

  const tailBar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.045, 0.9), tailMat);
  tailBar.position.set(4.575, 0.845, 0);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.5), mats.plate);
  plate.position.set(4.57, 0.6, 0);
  const antenna = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.06, 0.035), mats.trim);
  antenna.position.set(3.86, 1.07, 0);
  shell.add(tailBar, plate, antenna);

  const tyreG = buildTyre();
  const rimG = buildRim();
  const discG = new THREE.CylinderGeometry(0.155, 0.155, 0.022, 20);
  discG.rotateX(Math.PI / 2);
  const caliperG = new THREE.TorusGeometry(0.165, 0.028, 6, 10, Math.PI * 0.7);
  // A flat blanking plate inboard of each wheel. A cylindrical liner wrapped
  // around the tyre always fights the arch cut and pokes through the wing; this
  // just stops you seeing straight through the car, which is all it is for.
  const archLinerG = new THREE.BoxGeometry(WHEEL_R * 2.5, WHEEL_R * 2.1, 0.03);

  const wheels = [];
  for (const [wx, front] of [[AXLE_F, true], [AXLE_R, false]]) {
    for (const s of [-1, 1]) {
      const steer = new THREE.Group();
      steer.position.set(CG_X - wx, WHEEL_R, (-s * TRACK) / 2);

      const liner = new THREE.Mesh(archLinerG, mats.archLiner);
      liner.position.set(0, WHEEL_R * 0.18, s * 0.16);   // inboard of the tyre
      steer.add(liner);

      const caliper = new THREE.Mesh(caliperG, mats.caliper);
      caliper.rotation.z = 1.9;
      caliper.position.z = s * 0.03;
      steer.add(caliper);                       // stays put while the wheel spins

      const spin = new THREE.Group();
      const tyre = new THREE.Mesh(tyreG, mats.rubber);
      tyre.castShadow = true;
      const rim = new THREE.Mesh(rimG, mats.alloy);
      rim.scale.z = -s;                 // dish faces outboard
      spin.add(tyre, rim, new THREE.Mesh(discG, mats.disc));
      steer.add(spin);
      group.add(steer);                 // unsprung: never leans with the body
      // `tyre` is exposed so damage can deflate the rubber without
      // shrinking the rim inside it
      wheels.push({ steer, spin, tyre, front, side: s, flat: 0 });
    }
  }

  group.userData = {
    heads, headMat, tailMat, wheels, paint, interior, body, driver,
    hull: bodyMesh, glass: glassMesh, shell, doors,
  };
  return group;
}

/**
 * One merged geometry per body style for parked and moving traffic.
 * Colour comes from InstancedMesh.setColorAt, so all forty cars on a street are
 * a single draw call per silhouette rather than one per paint colour.
 */
export function buildStuntGeometries() {
  const out = {};
  for (const key of BODY_KEYS) {
    const spec = BODY_TYPES[key];
    const stations = buildStations(spec);
    const hull = loft(stations, stuntClassify(spec), 46);
    const parts = [hull.body];
    const tyre = buildTyre(spec.wheelR, spec.wheelR * 0.34, 12);
    const track = spec.wMax * 1.72;
    for (const wx of [spec.axleF, spec.axleR]) {
      for (const s of [-1, 1]) {
        const t = tyre.clone();
        t.translate(wx, spec.wheelR, (s * track) / 2);
        parts.push(t);
      }
    }
    /* Stations run nose-to-tail from x=0, so after centring the nose sits at
       -x and every traffic car in the city was driving tail-first with its
       brake lights on the bonnet. The hero solves this by turning its shell
       half a turn; the fleet gets the same treatment baked into the geometry
       so nothing downstream has to know. */
    const body = mergeGeos(parts);
    body.translate(-spec.L / 2, 0, 0);
    body.rotateY(Math.PI);
    body.userData = { length: spec.L, width: spec.wMax * 2 };

    const glass = hull.glass;
    glass.translate(-spec.L / 2, 0, 0);
    glass.rotateY(Math.PI);

    /* A real LOD for the kerbside fleet.
       748 parked cars at 2444 triangles each was 1.83M triangles -- 54% of
       everything visible -- for cars you drive past at 200m and never look
       at. The loft's cost is set by its STATION count, not its radial
       count (radial only controls how the cross-sections are swept), so
       every third station gives a 492-triangle hull that keeps the
       silhouette. No wheels: at the distance this is used the tyres were
       1152 of those triangles and about two pixels. */
    const lodStations = stations.filter((_, i) => i % 3 === 0 || i === stations.length - 1);
    const lodBody = loft(lodStations, stuntClassify(spec), 10).body;
    lodBody.translate(-spec.L / 2, 0, 0);
    lodBody.rotateY(Math.PI);

    out[key] = { body, glass, lodBody, occupant: buildOccupant(spec) };
  }
  return out;
}

/**
 * Whoever is behind the wheel of a traffic car. Head and shoulders only: at
 * the distance you ever see one, that silhouette through the screen is the
 * entire read, and legs under a dashboard are invisible geometry.
 */
function buildOccupant(spec) {
  // built directly in the final frame: +x forward, driver ahead of centre
  const parts = [];
  const z = spec.wMax * 0.30;
  const seatX = spec.L * 0.08;
  const shoulders = new THREE.BoxGeometry(0.30, 0.32, 0.42);
  shoulders.applyMatrix4(M4(seatX, spec.bonnetY * 0.90, z));
  parts.push(shoulders);
  const head = new THREE.SphereGeometry(0.108, 9, 7);
  head.applyMatrix4(M4(seatX + 0.02, spec.bonnetY * 1.18, z, 0, 0, 0, 1, 1.1, 0.94));
  parts.push(head);
  return mergeGeos(parts);
}
