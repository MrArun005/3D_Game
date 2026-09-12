import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';
import { boxM, quadM, paint } from './artKit.js';

/**
 * Phase 6 landmarks: the big forms that terminate a view.
 *
 * The brief's rule (docs/VISUAL-BRIEF.md) is that every district needs a form
 * you can read from >= 400 m that stands at the end of a street. Seven
 * districts had none. These are those forms -- a dock crane cluster, a grain
 * elevator, a gas holder, a flare stack, a cinema fly tower, a market hall, a
 * neon arcade gantry, a church, a clock tower, a water tower, a bandstand and
 * a glasshouse -- authored in code like world/tokyo.js and world/buildings/*,
 * because no free kit carries any of them.
 *
 * This file is PURE GEOMETRY, like world/buildings/*: no materials, no scene,
 * so it runs (and is tested) in node. `world/landmarks.js` merges each build
 * into one mesh, binds it to tokyoMaterial() (vertex colour + the `emit`
 * attribute, so the lit parts follow the city's own night curve) and puts it
 * on the plan. One draw per landmark; SHADOW_FAR_LAYER so it casts in the far
 * cascades, which is the only cascade that ever sees it.
 *
 * Local frame, as artKit: origin on the ground at the footprint centre,
 * **+X is the face that looks back down the street at the driver**, Y up.
 * The caller turns it with yaw = atan2(-dz, dx) toward the viewer.
 *
 * Contract:
 *   buildLandmark(kind, seed) -> {
 *     geo,      one merged BufferGeometry (position, normal, uv, color, emit, flick)
 *     lights,   [{ x, y, z, colour, range }] local-frame hero-light positions
 *     solids,   [{ x, z, hw, hd, height, angle }] local-frame collision boxes
 *     height,   metres to the top (for the caller's log and for shadow gating)
 *     tris }
 * Budget: <= 12,000 triangles each (test/skyline.test.js asserts it).
 */

/* ---------- small geometry helpers on top of artKit ---------------------- */

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _e = new THREE.Euler();
const _one = new THREE.Vector3(1, 1, 1);
/* Rotate X (tilt across), then Z (tilt along), then Y (swing), then move --
   Euler order 'YZX' is R = Ry*Rz*Rx, so rx is applied to the part first.
   Conventions worth keeping straight, because every mis-placed part in this
   file was one of them: a +X box turned by rz points at (cos rz, sin rz); a
   +Z quad turned by ry = +PI/2 faces +X; a torus is drawn in the XY plane, so
   a ring that must lie FLAT takes rx = PI/2, and a ring standing across the
   building takes ry; a half-cylinder vault's axis is already along X. */
function mat(x, y, z, ry = 0, rz = 0, rx = 0) {
  return _m4.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YZX')), _one);
}
/** Place one geometry (rotate then translate, in place). */
const put = (geo, x, y, z, ry = 0, rz = 0, rx = 0) => geo.applyMatrix4(mat(x, y, z, ry, rz, rx));
/** Place a whole set that was built about the origin (a lattice, say). */
function putAll(geos, x, y, z, ry = 0, rz = 0, rx = 0) {
  const m = mat(x, y, z, ry, rz, rx).clone();
  for (const g of geos) g.applyMatrix4(m);
  return geos;
}
const cyl = (r, h, hex, seg = 12, emit = null, k = 1) => paint(new THREE.CylinderGeometry(r, r, h, seg), hex, emit, k);
const tube = (r, h, hex, seg = 12) => paint(new THREE.CylinderGeometry(r, r, h, seg, 1, true), hex);
const cone = (r, h, hex, seg = 8, emit = null, k = 1) => paint(new THREE.ConeGeometry(r, h, seg), hex, emit, k);
const ring = (r, t, hex, seg = 16, arc = Math.PI * 2) => paint(new THREE.TorusGeometry(r, t, 3, seg, arc), hex);
const disc = (r, hex, seg = 14, arc = Math.PI * 2, emit = null, k = 1) => paint(new THREE.CircleGeometry(r, seg, 0, arc), hex, emit, k);
const dome = (r, hex, seg = 14, emit = null, k = 1) => paint(new THREE.SphereGeometry(r, seg, Math.ceil(seg / 2), 0, Math.PI * 2, 0, Math.PI / 2), hex, emit, k);
/** A half-cylinder shell whose axis runs along local X, dome up: the barrel roof. */
function vault(r, len, hex, seg = 18, emit = null, k = 1) {
  const g = paint(new THREE.CylinderGeometry(r, r, len, seg, 1, true, 0, Math.PI), hex, emit, k);
  return put(g, 0, 0, 0, 0, Math.PI / 2);
}
/** A triangle in the XZ-facing plane (gables, pediments): points are [x, y] pairs. */
function tri(a, b, c, hex, emit = null, k = 1) {
  const s = new THREE.Shape([new THREE.Vector2(...a), new THREE.Vector2(...b), new THREE.Vector2(...c)]);
  return paint(new THREE.ShapeGeometry(s), hex, emit, k);
}

/**
 * A lattice member along +X from the origin: four chords in a w x h section
 * with posts, X-bracing and lacing. Cranes, the flare gantry and the arcade
 * posts are all this one thing at different sizes and angles; it returns the
 * pieces so the caller can rotate the whole member.
 */
function lattice(len, w, h, hex, bay = 5, chord = 0.3) {
  const out = [], n = Math.max(1, Math.round(len / bay)), b = len / n, d = Math.hypot(b, h), a = Math.atan2(h, b);
  for (const sz of [-w / 2, w / 2]) for (const sy of [0, h]) out.push(put(boxM(len, chord, chord, hex), len / 2, sy, sz));
  for (let i = 0; i < n; i++) {
    for (const sz of [-w / 2, w / 2]) out.push(put(boxM(d, chord * 0.75, chord * 0.75, hex), b * (i + 0.5), h / 2, sz, 0, (i % 2 ? -a : a)));
    for (const sz of [-w / 2, w / 2]) out.push(put(boxM(chord, h, chord, hex), b * i, h / 2, sz));
    out.push(put(boxM(chord, chord, w, hex), b * (i + 0.5), h, 0));
  }
  return out;
}

/* Palettes. The brief's district colours; emit triples are linear RGB. */
const WARM = [1.0, 0.78, 0.42], COOL = [0.72, 0.85, 1.0], RED = [1.0, 0.16, 0.08];
const MAGENTA = [1.0, 0.22, 0.72], CYAN = [0.25, 0.92, 1.0], FLAME = [1.0, 0.42, 0.10];

/* ---------- HARBOUR POINT ------------------------------------------------ */

/**
 * Four ship-to-shore cranes on a common rail. Rails run along local Z, so the
 * street view down +X sees the row broadside; booms are raised at different
 * angles (a working terminal never parks them level) which is what makes the
 * silhouette read from a kilometre away.
 */
function craneCluster(seed) {
  const rnd = mulberry32(seed), P = [], lights = [], solids = [];
  const ORANGE = 0xc9502a, DARK = 0x2b3038, GREY = 0xa8adb4;
  const GAUGE = 13, PORTAL = 30, LEGX = 13.5, BOOM = 36;
  const N = 4, SPAN = 96, y0 = 26;
  let top = 0;
  for (const sx of [-LEGX, LEGX]) P.push(put(boxM(1.5, 0.9, SPAN + 16, DARK), sx, 0.45, 0));   // the two rails
  for (let i = 0; i < N; i++) {
    const cz = -SPAN / 2 + (SPAN / (N - 1)) * i;
    const boom = 0.30 + rnd() * 0.42;                       // 17-41 degrees, parked at different angles
    const mastY = y0 + 15;
    for (const sx of [-LEGX, LEGX]) for (const sz of [-GAUGE / 2, GAUGE / 2]) {
      P.push(put(boxM(1.7, y0, 1.7, ORANGE), sx, y0 / 2, cz + sz));
      P.push(put(boxM(3.2, 2.0, 3.2, DARK), sx, 1.0, cz + sz));            // bogie
      solids.push({ x: sx, z: cz + sz, hw: 1.2, hd: 1.2, height: y0, angle: 0 });
    }
    for (const sx of [-LEGX, LEGX]) P.push(put(boxM(2.2, 1.6, GAUGE + 2, ORANGE), sx, y0 - 1, cz));   // sill beams
    P.push(put(boxM(PORTAL, 2.4, 3.4, ORANGE), 0, y0 + 1.4, cz));                                     // portal girder
    P.push(put(boxM(9, 5, 7, GREY), 8.5, y0 + 5.2, cz));                                              // machinery house
    P.push(put(boxM(7, 4.5, 6.4, DARK), 13.5, y0 + 4.6, cz));                                         // counterweight
    for (const s of [-1, 1]) {                                                    // A-frame legs, both converging on the mast head
      const x0 = s * 8, dx = -0.4 - x0, dy = mastY - (y0 + 2.6), ln = Math.hypot(dx, dy);
      P.push(put(boxM(ln, 0.9, 0.9, ORANGE), x0 + dx / 2, y0 + 2.6 + dy / 2, cz, 0, Math.atan2(dy, dx)));
    }
    P.push(put(boxM(2.0, 1.0, 5.2, ORANGE), -0.4, mastY, cz));                                         // mast head
    // the boom: a lattice member hinged at the seaward leg, raised
    P.push(...putAll(lattice(BOOM, 3.4, 2.8, ORANGE, 6), -LEGX, y0 + 2.6, cz, Math.PI, boom));   // raised (rz lifts, then ry swings it seaward)
    const tipX = -LEGX - Math.cos(boom) * BOOM, tipY = y0 + 2.6 + Math.sin(boom) * BOOM;
    top = Math.max(top, tipY + 2);
    P.push(put(boxM(3.0, 0.6, 3.0, DARK), tipX, tipY, cz));
    P.push(put(boxM(1.0, 1.0, 1.0, 0xff2a18, RED, 2.4), tipX, tipY + 1.2, cz));                        // aviation beacon
    // stays, mast head to boom and back to the counterweight
    const sl = Math.hypot(tipX + 0.4, tipY - mastY);
    P.push(put(boxM(sl, 0.3, 0.3, DARK), (tipX - 0.4) / 2, (tipY + mastY) / 2, cz, 0, Math.atan2(tipY - mastY, tipX + 0.4)));
    P.push(put(boxM(16, 0.34, 0.34, DARK), 6.8, (mastY + y0 + 5) / 2, cz, 0, -0.62));
    // spreader slung under the portal + the trolley
    P.push(put(boxM(4.4, 0.7, 11, GREY), -6, y0 - 6, cz));
    P.push(put(boxM(3.0, 1.4, 4.4, DARK), -6, y0 + 0.2, cz));
    for (const s of [-1, 1]) P.push(put(boxM(1.4, 0.5, 1.4, 0xfff3d6, WARM, 2.0), 2, y0 + 0.4, cz + s * (GAUGE / 2 + 1)));   // floodlights
    lights.push({ x: 2, y: y0, z: cz, colour: 0xffe7bc, range: 46 });
  }
  return { parts: P, lights, solids, height: Math.max(top, y0 + 15) };
}

/** A bank of eight silos with a headhouse, a conveyor gallery and the elevator leg. */
function grainSilo(seed) {
  const rnd = mulberry32(seed), P = [], lights = [], solids = [];
  const CONC = 0xcdc6b6, DIRT = 0xb2a894, MET = 0x8d939a, H = 32, R = 5.2, N = 8;
  const len = (N - 1) * (R * 2) + R * 2;
  for (let i = 0; i < N; i++) {
    const z = -len / 2 + R + i * R * 2;
    P.push(put(cyl(R, H, i % 3 === 1 ? DIRT : CONC, 18), 0, H / 2, z));
    if (i < N - 1) P.push(put(cyl(1.9, H, CONC, 8), 0, H / 2, z + R));      // interstitial bin
    P.push(put(ring(R + 0.15, 0.22, DIRT, 18), 0, 3.4 + rnd() * 2, z, 0, 0, Math.PI / 2));
  }
  P.push(put(boxM(7.5, 8.5, len, MET), 0, H + 4.25, 0));                     // headhouse gallery
  P.push(put(boxM(8.6, 1.0, len + 1.2, 0x6d737a), 0, H + 8.8, 0));           // gallery roof
  for (let z = -len / 2 + 6; z < len / 2; z += 9) P.push(put(quadM(4.6, 1.8, 0x141a20, WARM, 0.5), 3.78, H + 5.6, z, Math.PI / 2));   // gallery windows
  P.push(put(boxM(11, H + 20, 12, CONC), 0, (H + 20) / 2, -len / 2 - 6));    // elevator leg / tower
  P.push(put(boxM(12, 3, 13, MET), 0, H + 21.5, -len / 2 - 6));
  P.push(put(boxM(1.2, 1.2, 1.2, 0xff2a18, RED, 2.4), 0, H + 23.6, -len / 2 - 6));
  P.push(put(boxM(26, 3.0, 3.4, MET), 12, H + 12, -len / 2 - 6, 0, -0.34));  // conveyor gallery out to the quay
  for (const s of [-1, 1]) P.push(put(boxM(4, 7, 4, DIRT), s * (R + 3.6), 3.5, len / 2 - 4));   // truck bays
  P.push(put(boxM(9, 5.5, 14, DIRT), R + 5, 2.75, 2));
  for (const s of [-1, 1]) { P.push(put(boxM(1.3, 0.5, 1.3, 0xfff3d6, WARM, 1.8), 4.2, H + 9.4, s * len * 0.3)); }
  lights.push({ x: 5, y: H + 9, z: 0, colour: 0xffe2b0, range: 40 });
  solids.push({ x: 0, z: 0, hw: R + 0.3, hd: len / 2, height: H, angle: 0 });
  solids.push({ x: 0, z: -len / 2 - 6, hw: 5.5, hd: 6, height: H + 20, angle: 0 });
  solids.push({ x: R + 5, z: 2, hw: 4.5, hd: 7, height: 5.5, angle: 0 });
  return { parts: P, lights, solids, height: H + 23 };
}

/* ---------- STEELGATE ---------------------------------------------------- */

/** A lattice-guided gas holder: the drum inside a cage of twelve guide columns. */
function gasHolder(seed) {
  const P = [], lights = [], solids = [];
  const DRUM = 0x6c7a72, FRAME = 0x555e66, HAZ = 0xc9a938, R = 21, H = 24, N = 12, GR = 23.4, GH = 36;
  P.push(put(cyl(R, H, DRUM, 28), 0, H / 2, 0));
  P.push(put(ring(R + 0.4, 0.5, FRAME, 28), 0, H, 0, 0, 0, Math.PI / 2));         // crown
  P.push(put(cyl(R * 0.55, 1.2, FRAME, 20), 0, H + 0.6, 0));                    // centre dome/vent
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, cx = Math.cos(a) * GR, cz = -Math.sin(a) * GR;
    P.push(put(boxM(1.1, GH, 1.1, FRAME), cx, GH / 2, cz, a));
    P.push(put(boxM(1.7, 1.0, 1.7, HAZ), cx, GH + 0.4, cz, a));
    solids.push({ x: cx, z: cz, hw: 0.8, hd: 0.8, height: GH, angle: 0 });
    // one bay of bracing: two diagonals and a rail at each of three levels
    const a2 = ((i + 1) / N) * Math.PI * 2, mx = Math.cos((a + a2) / 2) * GR, mz = -Math.sin((a + a2) / 2) * GR;
    const chordL = 2 * GR * Math.sin(Math.PI / N);
    const tan = (a + a2) / 2 + Math.PI / 2;     // along the chord, not out along the radius
    for (const [y, hh] of [[6, 11], [19, 11], [30, 9]]) {
      const d = Math.hypot(chordL, hh), t = Math.atan2(hh, chordL);
      for (const s of [-1, 1]) P.push(put(boxM(d, 0.28, 0.28, FRAME), mx, y + hh / 2, mz, tan, s * t));
      P.push(put(boxM(chordL, 0.3, 0.3, FRAME), mx, y, mz, tan));
    }
  }
  P.push(put(ring(GR, 0.34, FRAME, 28), 0, GH - 0.6, 0, 0, 0, Math.PI / 2));
  for (const s of [-1, 1]) {
    P.push(put(boxM(1.1, 1.1, 1.1, 0xff2a18, RED, 2.4), s * GR, GH + 1.6, 0));
    P.push(put(boxM(1.2, 0.5, 1.2, 0xfff3d6, WARM, 1.6), 0, 4, s * (GR + 1)));
  }
  P.push(put(boxM(9, 4.5, 7, 0x8a8d86), GR + 8, 2.25, -6));                     // valve house
  P.push(put(cyl(0.5, 9, HAZ, 8), GR + 4, 4.5, 3));
  lights.push({ x: GR + 6, y: 5, z: -6, colour: 0xffd79a, range: 30 });
  solids.push({ x: 0, z: 0, hw: R * 0.92, hd: R * 0.92, height: H, angle: 0 });
  solids.push({ x: GR + 8, z: -6, hw: 4.5, hd: 3.5, height: 4.5, angle: 0 });
  return { parts: P, lights, solids, height: GH + 2 };
}

/** A 52 m flare stack with its access gantry, burning. */
function flareStack(seed) {
  const P = [], lights = [], solids = [];
  const GALV = 0xb0b6bc, HAZ = 0xc9a938, DARK = 0x3b4148, H = 52;
  P.push(put(boxM(10, 1.2, 10, 0x8a8d86), 0, 0.6, 0));
  P.push(put(cyl(1.5, H, GALV, 16), 0, H / 2 + 1.2, 0));
  for (let y = 8; y < H; y += 11) P.push(put(cyl(1.56, 2.2, HAZ, 16), 0, y, 0));
  for (const y of [14, 28, 42]) P.push(put(ring(3.2, 0.28, DARK, 14), 0, y, 0, 0, 0, Math.PI / 2));
  P.push(...putAll(lattice(46, 2.8, 2.4, DARK, 5), 6.5, 1.2, 0, 0, Math.PI / 2));    // the gantry, stood on end
  for (const y of [14, 28, 42]) P.push(put(boxM(5, 0.4, 2.0, DARK), 3.4, y, 0));      // walkways across to the stack
  P.push(put(cyl(1.9, 3.4, DARK, 16), 0, H + 2.4, 0));                                 // flare tip
  P.push(put(cone(2.7, 9, 0xff8a3a, 12, FLAME, 2.6), 0, H + 8.2, 0));                  // the flame
  P.push(put(cone(1.3, 5.4, 0xffd8a0, 10, [1.0, 0.72, 0.34], 3.0), 0, H + 6.6, 0));
  P.push(put(cone(1.6, 6, 0xff7a2a, 10, FLAME, 1.6), 0.9, H + 12.5, 0.4, 0, -0.4));    // the wisp off the top
  P.push(put(boxM(1.0, 1.0, 1.0, 0xff2a18, RED, 2.4), 0, H - 1, 1.8));
  for (const [dx, dz, r, h] of [[8, -7, 2.6, 9], [12.5, -6, 2.0, 7], [9.5, 7, 3.2, 6]]) {
    P.push(put(cyl(r, h, 0x9aa0a6, 12), dx, h / 2, dz));                               // the knock-out drums at its feet
    solids.push({ x: dx, z: dz, hw: r, hd: r, height: h, angle: 0 });
  }
  P.push(put(cyl(0.42, 16, GALV, 8), 7, 3, -2, 0, Math.PI / 2));
  lights.push({ x: 0, y: H + 8, z: 0, colour: 0xff9440, range: 60 });
  solids.push({ x: 0, z: 0, hw: 2.2, hd: 2.2, height: H, angle: 0 });
  solids.push({ x: 6.5, z: 0, hw: 1.6, hd: 1.4, height: 46, angle: 0 });
  return { parts: P, lights, solids, height: H + 14 };
}

/* ---------- THE FLATS ---------------------------------------------------- */

/** A 1930s cinema: auditorium, fly tower over the stage, marquee and blade sign. */
function flyTower(seed) {
  const rnd = mulberry32(seed), P = [], lights = [], solids = [];
  const CREAM = 0xe0d5bd, TRIM = 0x8f7f66, DARK = 0x2a2723, W = 34, D = 22, Hh = 14;
  P.push(put(boxM(W, Hh, D, CREAM), 0, Hh / 2, 0));
  P.push(put(boxM(W + 1.4, 1.1, D + 1.4, TRIM), 0, Hh + 0.4, 0));                       // cornice
  P.push(put(boxM(16, 30, 15, CREAM), -9, 15, 0));                                       // fly tower
  P.push(put(boxM(17.4, 1.2, 16.4, TRIM), -9, 30.4, 0));
  P.push(put(boxM(10, 2.4, 9, 0x6e6a63), -9, 32, 0));                                    // grid/winch house
  for (let i = -3; i <= 3; i++) P.push(put(boxM(0.9, Hh - 4, 1.1, TRIM), W / 2 + 0.1, (Hh - 4) / 2 + 3.2, i * 3.0));   // facade fins
  P.push(put(boxM(W - 2, 3.4, 0.5, DARK), 0, 3.6, D / 2 + 0.2, Math.PI / 2 * 0));        // dark shopfront band (street face is +X)
  P.push(put(boxM(0.6, 3.6, D - 3, DARK), W / 2 + 0.15, 3.4, 0));
  for (let i = -2; i <= 2; i++) P.push(put(quadM(2.6, 2.6, 0x101418, WARM, 0.9), W / 2 + 0.5, 3.4, i * 3.6, Math.PI / 2));   // lit foyer doors
  P.push(put(boxM(4.6, 1.5, 17, TRIM), W / 2 + 2.3, 6.4, 0));                            // marquee
  P.push(put(quadM(4.4, 16.8, 0xfff2d8, WARM, 2.2), W / 2 + 2.3, 5.64, 0, 0, 0, Math.PI / 2));   // its lit soffit, facing down
  for (let i = 0; i < 18; i++) P.push(put(boxM(0.34, 0.34, 0.34, 0xfff0c8, WARM, 2.6), W / 2 + 4.5, 5.9, -8 + i * 0.94));   // bulb run
  const bx = W / 2 + 1.6, bh = 19, by = Hh + 1;
  P.push(put(boxM(0.9, bh, 4.2, DARK), bx, by + bh / 2, -6));                            // blade sign, read down the street
  for (const s of [-1, 1]) P.push(put(quadM(3.8, bh - 1.2, 0x18040e, MAGENTA, 2.4), bx + s * 0.46, by + bh / 2, -6, s * Math.PI / 2));
  for (let i = 0; i < 14; i++) for (const s of [-1, 1]) P.push(put(boxM(0.3, 0.3, 0.3, 0xfff0c8, WARM, 2.6), bx + s * 0.56, by + 1 + i * 1.3, -8.1));
  P.push(put(boxM(2.6, 2.6, 5.4, DARK), bx, by + bh + 1.2, -6));
  P.push(put(boxM(2.0, 1.0, 2.0, 0xff2a18, RED, 2.0), -9, 33.4, 0));
  for (let i = 0; i < 4; i++) P.push(put(boxM(2.4 + rnd() * 2, 1.8, 2.2, 0x6e6a63), 4 + i * 5, Hh + 1.4, -4 + rnd() * 8));   // roof plant
  lights.push({ x: W / 2 + 4, y: 5.2, z: 0, colour: 0xffdca6, range: 26 });
  lights.push({ x: bx + 2, y: by + 8, z: -6, colour: 0xff58b0, range: 22 });
  solids.push({ x: 0, z: 0, hw: W / 2, hd: D / 2, height: Hh, angle: 0 });
  solids.push({ x: -9, z: 0, hw: 8, hd: 7.5, height: 30, angle: 0 });
  return { parts: P, lights, solids, height: 33 };
}

/** A Victorian market hall: brick base, barrel roof, ridge lantern, arched ends. */
function marketHall(seed) {
  const P = [], lights = [], solids = [];
  const BRICK = 0x8e5a45, STONE = 0xd2c9b4, GLASS = 0x9fb6bb, IRON = 0x39413f;
  const L = 46, R = 13, WALL = 6.5;
  P.push(put(boxM(L, WALL, R * 2, BRICK), 0, WALL / 2, 0));
  P.push(put(boxM(L + 0.8, 0.7, R * 2 + 0.8, STONE), 0, WALL + 0.1, 0));
  for (let i = -3; i <= 3; i++) for (const s of [-1, 1]) P.push(put(boxM(1.4, WALL, 0.6, STONE), i * 6.2, WALL / 2, s * (R + 0.25)));   // pilasters
  for (let i = -3; i <= 3; i++) for (const s of [-1, 1]) P.push(put(quadM(3.0, 3.4, 0x141a1c, WARM, 0.8), i * 6.2 + 3.1, 3.4, s * (R + 0.35), s > 0 ? 0 : Math.PI));
  P.push(put(vault(R, L, GLASS, 20, COOL, 0.35), 0, WALL + 0.4, 0));
  for (let i = 0; i <= 8; i++) P.push(put(ring(R, 0.24, IRON, 14, Math.PI), -L / 2 + i * (L / 8), WALL + 0.4, 0, Math.PI / 2));   // ribs
  P.push(put(boxM(L * 0.62, 2.4, 3.2, IRON), 0, WALL + R + 0.6, 0));                         // ridge lantern
  for (const s of [-1, 1]) P.push(put(quadM(L * 0.6, 1.8, 0x141a1c, WARM, 1.4), 0, WALL + R + 0.6, s * 1.62, s > 0 ? 0 : Math.PI));
  P.push(put(boxM(L * 0.64, 0.6, 4.0, 0x565e5c), 0, WALL + R + 1.9, 0));
  for (const s of [-1, 1]) {                                                                  // the two arched ends
    P.push(put(disc(R, BRICK, 16, Math.PI), s * L / 2, WALL + 0.4, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2));
    P.push(put(disc(R * 0.62, 0x141a1c, 14, Math.PI, WARM, 0.9), s * (L / 2 + 0.1), WALL + 0.5, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2));
    P.push(put(ring(R, 0.4, STONE, 16, Math.PI), s * (L / 2 + 0.2), WALL + 0.4, 0, Math.PI / 2));
  }
  // entrance portico on the street face (+X)
  P.push(put(boxM(3.4, 7.2, 12, STONE), L / 2 + 1.7, 3.6, 0));
  P.push(put(tri([-6, 0], [6, 0], [0, 3.2], STONE), L / 2 + 1.75, 7.2, 0, Math.PI / 2));
  for (let i = -2; i <= 2; i += 2) P.push(put(cyl(0.62, 6.4, STONE, 10), L / 2 + 3.2, 3.2, i * 2.6));
  P.push(put(quadM(9, 1.5, 0x14100c, WARM, 2.0), L / 2 + 3.45, 7.9, 0, Math.PI / 2));          // lit name band
  P.push(put(quadM(6, 4.4, 0x120e0a, WARM, 1.2), L / 2 + 1.9, 2.4, 0, Math.PI / 2));           // open doors
  lights.push({ x: L / 2 + 4, y: 6.4, z: 0, colour: 0xffd9a0, range: 24 });
  lights.push({ x: 0, y: WALL + R, z: 0, colour: 0xffe9c4, range: 34 });
  solids.push({ x: 0, z: 0, hw: L / 2, hd: R, height: WALL + R, angle: 0 });
  solids.push({ x: L / 2 + 2, z: 0, hw: 2.2, hd: 6, height: 7.2, angle: 0 });
  return { parts: P, lights, solids, height: WALL + R + 3 };
}

/* ---------- VELLERY ROW -------------------------------------------------- */

/**
 * The arcade gantry: a steel portal across the street with a lit blade, the
 * nightlife district's answer to Little Tokyo's torii. Posts stand on the
 * pavements at +/- half the span; nothing is solid in the carriageway.
 */
function arcadeSign(seed) {
  const rnd = mulberry32(seed), P = [], lights = [], solids = [];
  /* HGT is the headroom, and it is load-bearing: the hanging fin sits at
     HGT - 7.2 and is 6.4 m tall, so at the first pass's 11.2 m its bottom
     edge was 0.80 m above the carriageway -- a sign board through the
     windscreen of every car that drove under the gantry. 16.4 puts the fin
     at 6.0 m, clear of anything on the road, and a Shibuya-scale portal
     reads better than a 13 m one down 900 m of street anyway. */
  const STEEL = 0x2b3038, SPAN = 22, HGT = 16.4;
  for (const s of [-1, 1]) {
    P.push(put(boxM(2.6, 0.8, 2.6, 0x4a4f55), 0, 0.4, s * SPAN / 2));
    P.push(...putAll(lattice(HGT, 1.7, 1.5, STEEL, 3.7), 0, 0.8, s * SPAN / 2, 0, Math.PI / 2));
    solids.push({ x: 0, z: s * SPAN / 2, hw: 1.1, hd: 1.1, height: HGT, angle: 0 });
  }
  P.push(...putAll(lattice(SPAN, 1.7, 1.9, STEEL, 4.4), 0, HGT + 0.6, -SPAN / 2, -Math.PI / 2));   // the cross truss (ry = -90 lays +X along +Z)
  // the blade: a double-sided lit board slung under the truss, with a vertical fin under it
  P.push(put(boxM(1.0, 4.8, 16, 0x14161c), 0, HGT - 2.0, 0));
  for (const s of [-1, 1]) P.push(put(quadM(15.2, 4.2, 0x1a0512, MAGENTA, 2.6), s * 0.51, HGT - 2.0, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2));
  P.push(put(boxM(0.8, 6.4, 4.6, 0x14161c), 0, HGT - 7.2, 0));
  for (const s of [-1, 1]) P.push(put(quadM(4.2, 5.8, 0x03131a, CYAN, 2.6), s * 0.41, HGT - 7.2, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2));
  for (let i = 0; i < 16; i++) {                                                    // bulb rim round the board
    const z = -7.4 + i * 0.98;
    for (const y of [HGT - 4.3, HGT + 0.3]) for (const s of [-1, 1]) P.push(put(boxM(0.3, 0.3, 0.3, 0xfff0c8, WARM, 2.8), s * 0.56, y, z));
  }
  for (let i = 0; i < 10; i++) {                                                    // festoon along the truss
    const z = -SPAN / 2 + 1.5 + i * ((SPAN - 3) / 9), warm = rnd() < 0.5;
    P.push(put(boxM(0.26, 0.26, 0.26, warm ? 0xffd9a0 : 0x9fe9ff, warm ? WARM : CYAN, 2.2), 0, HGT + 0.3 - 0.6 - (i % 2) * 0.3, z));
  }
  lights.push({ x: 0, y: HGT - 2, z: 0, colour: 0xff3fa0, range: 30 });
  lights.push({ x: 0, y: HGT - 7, z: 0, colour: 0x49d6ff, range: 22 });
  return { parts: P, lights, solids, height: HGT + 2 };
}

/* ---------- OLD QUARTER -------------------------------------------------- */

/** The parish church: nave along +X with the west tower and spire at the front. */
function church(seed) {
  const P = [], lights = [], solids = [];
  const STONE = 0xbcb2a0, SLATE = 0x4a5058, DARKW = 0x3b2f26;
  const NL = 26, NW = 12, NH = 11, TW = 8.4, TH = 25;
  P.push(put(boxM(NL, NH, NW, STONE), -3, NH / 2, 0));
  for (const s of [-1, 1]) {
    P.push(put(boxM(NL, 0.5, Math.hypot(NW / 2, 5.4), SLATE), -3, NH + 2.7, s * (NW / 4 + 0.1), 0, 0, s * Math.atan2(5.4, NW / 2)));   // roof planes
    P.push(put(tri([-NW / 2, 0], [NW / 2, 0], [0, 5.4], SLATE), -3 + s * (NL / 2 + 0.02), NH, 0, s * Math.PI / 2));
    for (let i = 0; i < 4; i++) P.push(put(boxM(1.4, 8.4, 1.6, STONE), -13 + i * 6.4, 4.2, s * (NW / 2 + 0.7)));   // buttresses
    for (let i = 0; i < 4; i++) P.push(put(quadM(1.6, 5.4, 0x120d08, WARM, 1.1), -10 + i * 6.4, 5.4, s * (NW / 2 + 0.12), s > 0 ? 0 : Math.PI));   // lancets
  }
  P.push(put(boxM(NL + 0.6, 0.7, NW + 1.2, STONE), -3, NH - 0.3, 0));
  P.push(put(boxM(2.6, 1.0, NW * 0.9, SLATE), -3, NH + 6.4, 0));                      // ridge
  P.push(put(boxM(TW, TH, TW, STONE), NL / 2 - 3 + TW / 2 - 1, TH / 2, 0));            // west tower
  const tx = NL / 2 - 3 + TW / 2 - 1;
  for (const y of [9, 17]) P.push(put(boxM(TW + 0.7, 0.6, TW + 0.7, STONE), tx, y, 0));
  for (const [ry, dx, dz] of [[0, TW / 2 + 0.1, 0], [Math.PI, -(TW / 2 + 0.1), 0], [Math.PI / 2, 0, TW / 2 + 0.1], [-Math.PI / 2, 0, -(TW / 2 + 0.1)]]) {
    P.push(put(quadM(2.4, 4.6, 0x0d0a07, WARM, 0.6), tx + dx, TH - 4.2, dz, ry));      // belfry louvres
  }
  P.push(put(disc(2.3, 0x120d08, 14, Math.PI * 2, WARM, 1.5), tx + TW / 2 + 0.12, 13.5, 0, Math.PI / 2));   // rose window
  P.push(put(ring(2.5, 0.32, STONE, 14), tx + TW / 2 + 0.1, 13.5, 0, Math.PI / 2));
  P.push(put(boxM(TW + 1.6, 1.2, TW + 1.6, STONE), tx, TH + 0.4, 0));
  P.push(put(cone(TW * 0.72, 17, SLATE, 4), tx, TH + 9.4, 0, Math.PI / 4));             // spire
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.push(put(cone(0.8, 3.4, STONE, 4), tx + sx * (TW / 2 + 0.3), TH + 2.4, sz * (TW / 2 + 0.3)));
  P.push(put(boxM(0.3, 2.6, 0.3, 0xd8c98a), tx, TH + 19.2, 0));
  P.push(put(boxM(0.3, 0.3, 1.5, 0xd8c98a), tx, TH + 19.6, 0));
  P.push(put(boxM(3.4, 4.6, 5.2, STONE), tx + TW / 2 + 1.7, 2.3, 0));                   // porch
  P.push(put(quadM(2.2, 3.6, 0x1a1109, WARM, 1.6), tx + TW / 2 + 3.45, 1.9, 0, Math.PI / 2));
  P.push(put(boxM(5.6, 0.4, 7, 0xa39a8a), tx + TW / 2 + 4.2, 0.2, 0));                  // steps
  lights.push({ x: tx + TW / 2 + 5, y: 3.4, z: 0, colour: 0xffcf94, range: 20 });
  lights.push({ x: tx, y: 20, z: 0, colour: 0xbcd0ff, range: 30 });
  solids.push({ x: -3, z: 0, hw: NL / 2, hd: NW / 2, height: NH, angle: 0 });
  solids.push({ x: tx, z: 0, hw: TW / 2, hd: TW / 2, height: TH, angle: 0 });
  return { parts: P, lights, solids, height: TH + 20 };
}

/** The market clock tower: a stone shaft, four lit faces, a pyramid roof. */
function clockTower(seed) {
  const P = [], lights = [], solids = [];
  const STONE = 0xc0b5a1, TRIM = 0x8d8271, SLATE = 0x4a5058, W = 8.2, H = 31;
  P.push(put(boxM(W + 3.4, 2.2, W + 3.4, TRIM), 0, 1.1, 0));
  P.push(put(boxM(W + 1.6, 1.0, W + 1.6, STONE), 0, 2.6, 0));
  P.push(put(boxM(W, H, W, STONE), 0, H / 2 + 3, 0));
  for (const y of [12, 21]) P.push(put(boxM(W + 0.8, 0.55, W + 0.8, TRIM), 0, y, 0));
  for (const [ry, dx, dz] of [[0, 1, 0], [Math.PI, -1, 0], [Math.PI / 2, 0, 1], [-Math.PI / 2, 0, -1]]) {
    const px = dx * (W / 2 + 0.12), pz = dz * (W / 2 + 0.12);
    P.push(put(disc(2.5, 0xf2ead6, 16, Math.PI * 2, [1.0, 0.94, 0.78], 1.6), px, 27, pz, ry));   // clock face
    P.push(put(ring(2.7, 0.3, TRIM, 16), px, 27, pz, ry));
    P.push(put(boxM(0.22, 2.0, 0.16, 0x201c18), px + dx * 0.1, 27.8, pz + dz * 0.1, ry));         // hands
    P.push(put(boxM(1.5, 0.2, 0.16, 0x201c18), px + dx * 0.1, 27 + 0.55, pz + dz * 0.1, ry, 1.2));
    P.push(put(quadM(2.4, 3.2, 0x16130f, WARM, 0.5), px, 20.5, pz, ry));                          // belfry opening
  }
  P.push(put(boxM(W + 2.4, 1.4, W + 2.4, TRIM), 0, 31.2, 0));
  P.push(put(cone(W * 0.86, 8.5, SLATE, 4), 0, 36.1, 0, Math.PI / 4));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.push(put(cone(0.85, 3.6, STONE, 4), sx * (W / 2 + 0.9), 33.4, sz * (W / 2 + 0.9)));
  P.push(put(cyl(0.22, 3.2, 0xd8c98a, 6), 0, 41.8, 0));
  P.push(put(boxM(1.6, 0.9, 0.1, 0xd8c98a), 0.6, 43.0, 0));
  lights.push({ x: 0, y: 24, z: 0, colour: 0xffe3b0, range: 26 });
  solids.push({ x: 0, z: 0, hw: W / 2 + 0.8, hd: W / 2 + 0.8, height: H, angle: 0 });
  return { parts: P, lights, solids, height: 44 };
}

/* ---------- MARROW HILL -------------------------------------------------- */

/** The water tower on the hill: a riveted tank on six braced legs. */
function waterTower(seed) {
  const P = [], lights = [], solids = [];
  const TANK = 0xb9bec4, RUST = 0x8b6f5e, LEG = 0x555c63, N = 6, LR = 7.2, LH = 22;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, cx = Math.cos(a) * LR, cz = -Math.sin(a) * LR;
    P.push(put(boxM(0.7, LH, 0.7, LEG), cx, LH / 2, cz, a));
    P.push(put(boxM(1.8, 0.8, 1.8, 0x6b7278), cx, 0.4, cz, a));
    solids.push({ x: cx, z: cz, hw: 0.6, hd: 0.6, height: LH, angle: 0 });
    const a2 = ((i + 1) / N) * Math.PI * 2, mx = Math.cos((a + a2) / 2) * LR, mz = -Math.sin((a + a2) / 2) * LR;
    const chordL = 2 * LR * Math.sin(Math.PI / N);
    const tan = (a + a2) / 2 + Math.PI / 2;
    for (const [y, hh] of [[2.5, 9], [12, 9]]) {
      const d = Math.hypot(chordL, hh), t = Math.atan2(hh, chordL);
      for (const s of [-1, 1]) P.push(put(boxM(d, 0.24, 0.24, LEG), mx, y + hh / 2, mz, tan, s * t));
    }
  }
  for (const y of [11.5, 21]) P.push(put(ring(LR, 0.24, LEG, 14), 0, y, 0, 0, 0, Math.PI / 2));
  P.push(put(cone(6.4, 3.6, TANK, 16), 0, 23.6, 0, 0, Math.PI));                       // conical tank bottom
  P.push(put(cyl(6.4, 10, TANK, 16), 0, 30.4, 0));
  P.push(put(ring(6.55, 0.22, RUST, 16), 0, 27.6, 0, 0, 0, Math.PI / 2));
  P.push(put(ring(7.1, 0.3, LEG, 16), 0, 25.6, 0, 0, 0, Math.PI / 2));                 // catwalk
  P.push(put(cone(6.9, 3.4, RUST, 16), 0, 37.1, 0));
  P.push(put(cyl(0.4, 2.2, LEG, 8), 0, 39.6, 0));
  P.push(put(boxM(0.9, 0.9, 0.9, 0xff2a18, RED, 2.4), 0, 40.9, 0));
  for (let i = 0; i < 12; i++) P.push(put(boxM(1.3, 0.14, 0.14, LEG), LR * 0.72, 2 + i * 1.9, 0));   // ladder
  P.push(put(boxM(0.2, 26, 0.2, LEG), LR * 0.72 + 0.6, 15, 0.55));
  P.push(put(boxM(0.2, 26, 0.2, LEG), LR * 0.72 + 0.6, 15, -0.55));
  P.push(put(quadM(5.4, 2.2, 0x1b2126, COOL, 0.8), 6.5, 31.5, 0, Math.PI / 2));          // name band, faintly lit at night
  lights.push({ x: 0, y: 26, z: 0, colour: 0xbcd0ff, range: 30 });
  return { parts: P, lights, solids, height: 41 };
}

/* ---------- GREENFELL PARK ----------------------------------------------- */

/** The bandstand: octagonal, cast iron on a stone plinth, lanterns under the roof. */
function bandstand(seed) {
  const P = [], lights = [], solids = [];
  const STONE = 0xcfc7b4, IRON = 0x2f4a3e, COPPER = 0x5f8f7c, N = 8, R = 6.2;
  P.push(put(cyl(7.8, 0.35, STONE, N), 0, 0.17, 0));
  P.push(put(cyl(7.2, 0.9, STONE, N), 0, 0.6, 0));
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, cx = Math.cos(a) * R, cz = -Math.sin(a) * R;
    P.push(put(cyl(0.17, 4.3, IRON, 8), cx, 3.2, cz));
    P.push(put(cyl(0.28, 0.3, IRON, 8), cx, 5.3, cz));
    const a2 = ((i + 1) / N) * Math.PI * 2, mx = Math.cos((a + a2) / 2) * R, mz = -Math.sin((a + a2) / 2) * R;
    const chordL = 2 * R * Math.sin(Math.PI / N);
    const tan = (a + a2) / 2 + Math.PI / 2;
    P.push(put(boxM(chordL, 0.16, 0.3, IRON), mx, 1.95, mz, tan));                        // balustrade rails
    P.push(put(boxM(chordL, 0.16, 0.3, IRON), mx, 1.05, mz, tan));
    for (let j = 0; j < 4; j++) P.push(put(cyl(0.07, 0.9, IRON, 5), mx + Math.cos(tan) * (chordL * (j / 3 - 0.5)), 1.5, mz - Math.sin(tan) * (chordL * (j / 3 - 0.5))));
    P.push(put(boxM(chordL, 0.55, 0.22, IRON), mx, 5.55, mz, tan));                        // frieze
    if (i % 2 === 0) P.push(put(boxM(0.5, 0.5, 0.5, 0xfff0c8, WARM, 2.2), cx * 0.84, 5.05, cz * 0.84));   // lanterns
  }
  P.push(put(cone(7.6, 2.6, COPPER, N), 0, 7.0, 0));
  P.push(put(cone(4.6, 1.9, COPPER, N), 0, 8.6, 0));
  P.push(put(cyl(0.3, 1.6, COPPER, 8), 0, 9.9, 0));
  P.push(put(paint(new THREE.SphereGeometry(0.55, 8, 6), COPPER), 0, 10.8, 0));
  lights.push({ x: 0, y: 5, z: 0, colour: 0xffd9a0, range: 18 });
  solids.push({ x: 0, z: 0, hw: 6.8, hd: 6.8, height: 2.2, angle: 0 });
  return { parts: P, lights, solids, height: 11.4 };
}

/** The palm house: a glazed barrel with a central dome on a stone base. */
function glasshouse(seed) {
  const P = [], lights = [], solids = [];
  const FRAME = 0xe4e4dd, GLASS = 0xa9c6c9, STONE = 0xcfc7b4, L = 36, R = 8.6, DR = 9.4;
  P.push(put(boxM(L, 1.4, R * 2, STONE), 0, 0.7, 0));
  P.push(put(boxM(L + 0.8, 0.35, R * 2 + 0.8, FRAME), 0, 1.5, 0));
  P.push(put(vault(R, L, GLASS, 18, COOL, 0.3), 0, 1.5, 0));
  for (let i = 0; i <= 9; i++) P.push(put(ring(R, 0.16, FRAME, 12, Math.PI), -L / 2 + i * (L / 9), 1.5, 0, Math.PI / 2));
  for (const s of [-1, 1]) {                                                       // glazed ends
    P.push(put(disc(R, GLASS, 14, Math.PI, COOL, 0.3), s * L / 2, 1.5, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2));
    P.push(put(ring(R, 0.2, FRAME, 14, Math.PI), s * (L / 2 + 0.05), 1.5, 0, Math.PI / 2));
  }
  P.push(put(cyl(DR, 4.2, GLASS, 16, COOL, 0.3), 0, 3.6, 0));                       // the crossing drum
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; P.push(put(boxM(0.18, 4.2, 0.18, FRAME), Math.cos(a) * DR, 3.6, -Math.sin(a) * DR)); }
  P.push(put(ring(DR, 0.2, FRAME, 16), 0, 5.7, 0, 0, 0, Math.PI / 2));
  P.push(put(dome(DR, GLASS, 16, COOL, 0.35), 0, 5.7, 0));
  for (let i = 0; i < 6; i++) P.push(put(ring(DR, 0.16, FRAME, 12, Math.PI), 0, 5.7, 0, (i / 6) * Math.PI));   // half-arch ribs over the dome
  P.push(put(cyl(0.9, 1.6, FRAME, 10), 0, 15.6, 0));
  P.push(put(cone(1.1, 1.4, FRAME, 10), 0, 17.0, 0));
  P.push(put(boxM(3.2, 5.2, 7.4, FRAME), L / 2 + 1.6, 2.6, 0));                      // porch
  P.push(put(tri([-4, 0], [4, 0], [0, 2.2], FRAME), L / 2 + 1.65, 5.2, 0, Math.PI / 2));
  P.push(put(quadM(3.2, 3.6, 0x0f1a18, WARM, 1.2), L / 2 + 3.25, 2.1, 0, Math.PI / 2));
  for (let i = -1; i <= 1; i += 2) P.push(put(cyl(0.45, 4.4, FRAME, 8), L / 2 + 3.0, 2.2, i * 3.0));
  lights.push({ x: 0, y: 6, z: 0, colour: 0xffe0b4, range: 26 });
  lights.push({ x: L / 2 + 4, y: 3, z: 0, colour: 0xffd9a0, range: 14 });
  solids.push({ x: 0, z: 0, hw: L / 2, hd: R, height: 8, angle: 0 });
  return { parts: P, lights, solids, height: 17.7 };
}

/* ------------------------------------------------------------------------ */

export const LANDMARK_KINDS = {
  crane_cluster: craneCluster, grain_silo: grainSilo,
  gas_holder: gasHolder, flare_stack: flareStack,
  fly_tower: flyTower, market_hall: marketHall,
  arcade_sign: arcadeSign,
  church, clock_tower: clockTower,
  water_tower: waterTower,
  bandstand, glasshouse,
};

/** Build one landmark: its parts merged into a single geometry. */
export function buildLandmark(kind, seed = 1) {
  const fn = LANDMARK_KINDS[kind];
  if (!fn) throw new Error(`skyline: unknown landmark ${kind}`);
  const r = fn(seed);
  const geo = mergeGeometries(r.parts, false);
  if (!geo) throw new Error(`skyline: ${kind} failed to merge`);
  for (const g of r.parts) g.dispose();
  geo.computeBoundingSphere();
  geo.userData.owned = true;
  const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
  return { geo, lights: r.lights, solids: r.solids, height: r.height, tris };
}
