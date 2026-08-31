/**
 * Parametric humanoid body.
 *
 * Built the same way the car is: cross-sections lofted into a surface. A limb
 * is a chain of elliptical rings; the torso is a chain of rings whose width,
 * depth and profile change with the shape parameters. That is why every
 * parameter below is continuous — there is no morph-target library, the mesh
 * is rebuilt from the numbers.
 *
 * Rest pose is a T-pose so Mixamo clips retarget straight onto the rig.
 */
import { Mesh } from './mesh.mjs';
import { Rig } from './rig.mjs';

/** Every parameter is 0..1 unless noted. Defaults are the reference figure. */
export const DEFAULTS = {
  height: 1.75,       // metres, 1.45 – 2.05
  build: 0.5,         // slight ← → heavy
  muscle: 0.5,        // soft ← → defined
  shoulders: 0.5,     // narrow ← → broad
  hips: 0.5,
  belly: 0.35,
  chest: 0.5,
  neck: 0.5,
  headSize: 0.5,
  legLength: 0.5,     // shifts the hip height within the same total height
  armLength: 0.5,
  footSize: 0.5,
  handSize: 0.5,
  hair: 0.6,          // 0 = none, 1 = full
  sleeve: 0.62,       // how far down the arm the shirt runs, 0..1
  trouser: 0.94,      // how far down the leg
  posture: 0.5,       // 0 = stooped, 1 = upright
};

const lerp = (a, b, t) => a + (b - a) * t;

/** Elliptical ring in a plane, with outward normals. */
function ring(centre, axis, rx, rz, seg, squash = 1, lean = 0) {
  const out = [];
  for (let k = 0; k < seg; k++) {
    const t = (k / seg) * Math.PI * 2;
    const cx = Math.cos(t), cz = Math.sin(t);
    // squash flattens the back/front; a torso is not a cylinder
    const sx = cx * rx, sz = cz * rz * (cz < 0 ? squash : 1);
    let p, n;
    if (axis === 'y') { p = [centre[0] + sx, centre[1], centre[2] + sz + lean]; n = [cx, 0, cz]; }
    else if (axis === 'x') { p = [centre[0], centre[1] + sx, centre[2] + sz]; n = [0, cx, cz]; }
    else { p = [centre[0] + sx, centre[1] + sz, centre[2]]; n = [cx, cz, 0]; }
    out.push({ p, n });
  }
  return out;
}

/** Mirror a ring chain across X — the body is symmetric, the code should be. */
const mirrorX = (rings) => rings.map((r) => r.map((v) => ({
  p: [-v.p[0], v.p[1], v.p[2]], n: [-v.n[0], v.n[1], v.n[2]],
})).reverse());

export function buildBody(paramsIn = {}) {
  const P = { ...DEFAULTS, ...paramsIn };
  const S = P.height / 1.75;                    // uniform scale from the reference
  const fat = lerp(0.86, 1.34, P.build);        // girth multiplier
  const mus = lerp(0.92, 1.14, P.muscle);
  const SEG = 12;

  /* ----- rest pose, moved by the shape parameters ------------------------ */
  const hipY = lerp(0.94, 1.02, P.legLength);
  const armR = lerp(0.94, 1.08, P.armLength);
  const headS = lerp(0.88, 1.12, P.headSize);
  const neckL = lerp(0.94, 1.08, P.neck);
  const shoulderW = lerp(0.86, 1.18, P.shoulders);
  const hipW = lerp(0.88, 1.16, P.hips);

  const place = (name, [x, y, z]) => {
    let nx = x, ny = y, nz = z;
    if (name.includes('Leg') || name.includes('Foot') || name.includes('Toe')) {
      ny *= hipY / 0.98;
      nx *= hipW;
    } else if (name === 'Hips') { ny = hipY; }
    else if (name.includes('Arm') || name.includes('Hand') || name.includes('Shoulder')) {
      nx *= shoulderW * armR;
      ny = lerp(y, 1.415, 1) + (hipY - 0.98) * 0.55;
    } else if (name === 'Neck' || name === 'Head' || name === 'HeadTop_End') {
      ny = 1.455 + (y - 1.455) * headS + (neckL - 1) * 0.09 + (hipY - 0.98) * 0.55;
    } else { ny = y + (hipY - 0.98) * 0.55; }
    // posture: a slight forward lean through the spine
    const stoop = (1 - P.posture) * 0.055;
    if (ny > hipY) nz += stoop * ((ny - hipY) / 0.6) ** 2;
    return [nx * S, ny * S, nz * S];
  };

  const rig = new Rig(place);
  const J = rig.world;
  const m = new Mesh();

  /* ----- torso ----------------------------------------------------------- */
  // stations from crotch to neck: width, depth, squash
  const torso = [
    [J.Hips[1] - 0.10 * S, 0.145 * hipW, 0.105, 1.0],
    [J.Hips[1] + 0.01 * S, 0.152 * hipW, 0.112 * lerp(0.9, 1.35, P.belly), 0.95],
    [J.Spine[1],           0.148,        0.108 * lerp(0.9, 1.4, P.belly),  0.92],
    [J.Spine1[1],          0.152,        0.112 * lerp(0.95, 1.25, P.chest), 0.9],
    [J.Spine2[1],          0.168 * shoulderW, 0.116 * lerp(0.95, 1.3, P.chest), 0.9],
    [J.LeftArm[1] + 0.02 * S, 0.205 * shoulderW, 0.108, 0.92],
    [J.Neck[1] - 0.02 * S, 0.115,        0.092, 0.95],
  ];
  const torsoRings = torso.map(([y, rx, rz, sq]) =>
    ring([0, y, torsoLean(y)], 'y', rx * fat * S, rz * fat * S, SEG, sq));
  function torsoLean(y) {
    const stoop = (1 - P.posture) * 0.055 * S;
    return y > J.Hips[1] ? stoop * ((y - J.Hips[1]) / (0.6 * S)) ** 2 : 0;
  }
  m.loftRings('cloth_shirt', torsoRings, { capStart: false, capEnd: false });

  // hips block, so the trousers meet the torso rather than floating
  m.loftRings('cloth_trouser', [
    ring([0, J.Hips[1] - 0.16 * S, 0], 'y', 0.150 * hipW * fat * S, 0.108 * fat * S, SEG, 1),
    ring([0, J.Hips[1] - 0.02 * S, torsoLean(J.Hips[1])], 'y', 0.152 * hipW * fat * S, 0.112 * fat * S, SEG, 0.95),
  ], { capStart: false, capEnd: false });

  /* ----- neck and head --------------------------------------------------- */
  m.loftRings('skin', [
    ring([0, J.Neck[1] - 0.05 * S, torsoLean(J.Neck[1])], 'y', 0.062 * S, 0.058 * S, SEG),
    ring([0, J.Head[1] - 0.02 * S, torsoLean(J.Head[1])], 'y', 0.058 * S, 0.056 * S, SEG),
  ], { capStart: false, capEnd: false });

  const hz = torsoLean(J.Head[1]);
  const headTop = J.HeadTop_End[1];
  const headRings = [
    [J.Head[1] - 0.02 * S, 0.058, 0.056],
    [J.Head[1] + 0.03 * S, 0.078, 0.086],
    [lerp(J.Head[1], headTop, 0.34), 0.090, 0.104],
    [lerp(J.Head[1], headTop, 0.62), 0.089, 0.100],
    [lerp(J.Head[1], headTop, 0.86), 0.070, 0.078],
    [headTop, 0.028, 0.030],
  ].map(([y, rx, rz]) => ring([0, y, hz + 0.008 * S], 'y', rx * headS * S, rz * headS * S, SEG));
  m.loftRings('skin', headRings, { capStart: false, capEnd: true });

  if (P.hair > 0.05) {
    const cut = lerp(0.25, 0.72, P.hair);
    const hairRings = headRings
      .map((r, i) => ({ r, t: i / (headRings.length - 1) }))
      .filter(({ t }) => t > 1 - cut - 0.25)
      .map(({ r }) => r.map((v) => ({
        p: [v.p[0] * 1.055, v.p[1] + 0.004 * S, v.p[2] * 1.055 - 0.004 * S], n: v.n,
      })));
    if (hairRings.length > 1) m.loftRings('hair', hairRings, { capStart: false, capEnd: true });
  }

  /* ----- limbs ----------------------------------------------------------- */
  const limb = (a, b, c, d, r0, r1, r2, r3, matA, matB, split) => {
    // a..d are joints; r* are radii. `split` is where matA becomes matB.
    const chain = [
      [a, r0], [lerpV(a, b, 0.5), r1 * mus], [b, r1 * 0.92],
      [lerpV(b, c, 0.5), r2 * mus], [c, r2 * 0.9], [d, r3],
    ];
    const rings = chain.map(([p, r]) => ring(p, axisOf(a, d), r * fat * S, r * fat * S * 0.94, SEG));
    const cutAt = Math.max(1, Math.round(split * (rings.length - 1)));
    m.loftRings(matA, rings.slice(0, cutAt + 1), { capStart: false, capEnd: false });
    m.loftRings(matB, rings.slice(cutAt), { capStart: false, capEnd: false });
    return rings;
  };
  const lerpV = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const axisOf = (a, b) => (Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) ? 'x' : 'y');

  for (const side of ['Left', 'Right']) {
    limb(J[side + 'Arm'], J[side + 'ForeArm'], J[side + 'Hand'], J[side + 'Hand_End'],
      0.058, 0.048, 0.038, 0.030, 'cloth_shirt', 'skin', P.sleeve);
    limb(J[side + 'UpLeg'], J[side + 'Leg'], J[side + 'Foot'], J[side + 'Foot'],
      0.086, 0.062, 0.044, 0.040, 'cloth_trouser', 'skin', P.trouser);

    // foot: a lofted wedge rather than a box, so it has an instep
    const f = J[side + 'Foot'], t = J[side + 'Toe_End'];
    const fw = lerp(0.040, 0.052, P.footSize) * S, fl = lerp(0.9, 1.12, P.footSize);
    m.loftRings('shoe_leather', [
      ring([f[0], f[1] + 0.005 * S, f[2] - 0.035 * S], 'y', fw * 0.9, 0.030 * S, SEG),
      ring([f[0], f[1] - 0.01 * S, f[2] + 0.02 * S], 'y', fw, 0.055 * S, SEG),
      ring([f[0], f[1] - 0.03 * S, lerp(f[2], t[2], 0.6 * fl)], 'y', fw * 0.96, 0.048 * S, SEG),
      ring([f[0], f[1] - 0.038 * S, lerp(f[2], t[2], 1.0 * fl)], 'y', fw * 0.7, 0.024 * S, SEG),
    ], { capStart: true, capEnd: true });

    // hand: a flattened stub. Fingers are beyond what this technique can do.
    const h = J[side + 'Hand'], he = J[side + 'Hand_End'];
    const hs = lerp(0.9, 1.12, P.handSize) * S;
    m.loftRings('skin', [
      ring(h, 'x', 0.032 * hs, 0.024 * hs, SEG),
      ring(lerpV(h, he, 0.55), 'x', 0.040 * hs, 0.020 * hs, SEG),
      ring(lerpV(h, he, 1.0), 'x', 0.026 * hs, 0.014 * hs, SEG),
    ], { capStart: false, capEnd: true });
  }

  // ring normals ignore taper and squash; let the surface decide
  m.smoothNormals(['skin', 'hair', 'cloth_shirt', 'cloth_trouser', 'shoe_leather']);

  return { mesh: m, rig, params: P };
}
