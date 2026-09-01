/**
 * Parametric humanoid body.
 *
 * Built the way the car is: cross-sections lofted into a surface. A limb is a
 * chain of rings; the torso is a chain whose width, depth and section shape
 * change with the parameters. Every parameter is continuous because the mesh is
 * rebuilt from the numbers — there is no morph-target library.
 *
 * Three things separate this from the first pass, and all three were driven by
 * what the deformation test showed:
 *
 * 1. **Superelliptical sections.** A torso is not an ellipse in plan — it is
 *    flatter at the front and back than a circle. One exponent per station.
 * 2. **Rings clustered at the joints.** Linear blend skinning creases wherever
 *    a bend has no geometry to distribute across. The shoulder, elbow, hip and
 *    knee each get three rings instead of one.
 * 3. **A face.** Displacement over (angle, height) on the head rings — brow,
 *    nose, eye sockets, cheeks, mouth, chin, jaw, occiput — plus ears. It is
 *    not a portrait, but it reads as a face rather than a blank ovoid.
 *
 * Rest pose is a T-pose so Mixamo clips retarget straight onto the rig.
 */
import { Mesh } from './mesh.mjs';
import { Rig } from './rig.mjs';

export const DEFAULTS = {
  height: 1.75,       // metres, 1.45 – 2.05
  build: 0.5,         // slight ← → heavy
  muscle: 0.5,        // soft ← → defined
  shoulders: 0.5,
  hips: 0.5,
  belly: 0.35,
  chest: 0.5,
  neck: 0.5,
  headSize: 0.5,
  legLength: 0.5,
  armLength: 0.5,
  footSize: 0.5,
  handSize: 0.5,
  hair: 0.6,          // 0 = bald, 1 = full
  sleeve: 0.62,
  trouser: 0.94,
  posture: 0.5,
  // face
  brow: 0.5,          // shallow ← → heavy
  nose: 0.5,          // small ← → prominent
  jaw: 0.5,           // narrow ← → square
  cheek: 0.5,
  chin: 0.5,
  ears: 0.5,
};

const SEG = 20;                       // segments around a body ring
// The head needs far more resolution than a limb: an eye socket is ~0.07 of the
// head's height and ~0.3 rad wide, and a feature that falls between two rings
// simply does not exist. This was the actual reason the first face did not
// read — not the displacement, the sampling.
const SEG_HEAD = 32;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
/** Smooth bump, 1 at `c`, 0 beyond `w`. The shaping primitive for the face. */
const bump = (x, c, w) => {
  const t = Math.abs(x - c) / w;
  return t >= 1 ? 0 : Math.pow(Math.cos(t * Math.PI / 2), 2);
};
/** Angular distance on a circle, so a feature at the front wraps correctly. */
const angDist = (a, b) => {
  let d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
};

/**
 * Superelliptical section. n = 2 is an ellipse; higher is squarer. A human
 * torso sits around 2.6 — noticeably flatter front and back than a tube.
 */
function sect(t, a, b, n = 2) {
  const c = Math.cos(t), s = Math.sin(t);
  const e = 2 / n;
  return [
    a * Math.sign(c) * Math.pow(Math.abs(c), e),
    b * Math.sign(s) * Math.pow(Math.abs(s), e),
  ];
}

/** Ring in the XZ plane at height y, optionally displaced per-vertex. */
function ringY(y, a, b, n, { z0 = 0, disp = null, seg = SEG } = {}) {
  const out = [];
  for (let k = 0; k < seg; k++) {
    const t = (k / seg) * Math.PI * 2;
    let [x, z] = sect(t, a, b, n);
    if (disp) { const d = disp(t, x, z); x = d[0]; z = d[1]; }
    out.push({ p: [x, y, z + z0], n: [Math.cos(t), 0, Math.sin(t)] });
  }
  return out;
}

/** Ring in the YZ plane at x — for arms, which run along X in a T-pose. */
function ringX(x, cy, cz, a, b, n = 2, seg = SEG) {
  const out = [];
  for (let k = 0; k < seg; k++) {
    const t = (k / seg) * Math.PI * 2;
    const [u, v] = sect(t, a, b, n);
    out.push({ p: [x, cy + u, cz + v], n: [0, Math.cos(t), Math.sin(t)] });
  }
  return out;
}

export function buildBody(paramsIn = {}) {
  const P = { ...DEFAULTS, ...paramsIn };
  const S = P.height / 1.75;
  const fat = lerp(0.86, 1.34, P.build);
  const mus = lerp(0.9, 1.16, P.muscle);

  const hipY = lerp(0.94, 1.02, P.legLength);
  const armR = lerp(0.94, 1.08, P.armLength);
  const headS = lerp(0.88, 1.12, P.headSize);
  const neckL = lerp(0.94, 1.08, P.neck);
  const shoulderW = lerp(0.86, 1.18, P.shoulders);
  const hipW = lerp(0.88, 1.16, P.hips);
  const stoop = (1 - P.posture) * 0.055;

  const place = (name, [x, y, z]) => {
    let nx = x, ny = y, nz = z;
    if (name.includes('Leg') || name.includes('Foot') || name.includes('Toe')) {
      ny *= hipY / 0.98; nx *= hipW;
    } else if (name === 'Hips') { ny = hipY; }
    else if (name.includes('Arm') || name.includes('Hand') || name.includes('Shoulder') || name.includes('Thumb')) {
      nx *= shoulderW * armR;
      ny = y + (hipY - 0.98) * 0.55;
    } else if (name === 'Neck' || name === 'Head' || name === 'HeadTop_End') {
      ny = 1.455 + (y - 1.455) * headS + (neckL - 1) * 0.09 + (hipY - 0.98) * 0.55;
    } else { ny = y + (hipY - 0.98) * 0.55; }
    if (ny > hipY) nz += stoop * ((ny - hipY) / 0.6) ** 2;
    return [nx * S, ny * S, nz * S];
  };

  const rig = new Rig(place);
  const J = rig.world;
  const m = new Mesh();

  // Record every ring chain as it is lofted. The triangulated Mesh is what the
  // JS preview draws; the chains are the QUAD CAGE that the Blender pipeline
  // subdivides. One source of truth for the body shape, two consumers.
  const chains = [];
  const rawLoft = m.loftRings.bind(m);
  m.loftRings = (mat, rings, opts = {}) => {
    chains.push({ mat, rings: rings.map((r) => r.map((v) => v.p)), ...opts });
    return rawLoft(mat, rings, opts);
  };
  const leanAt = (y) => (y > J.Hips[1] ? stoop * S * ((y - J.Hips[1]) / (0.6 * S)) ** 2 : 0);

  /* ------------------------------------------------------------- torso --- */
  // [y (unscaled), halfWidth, halfDepth, exponent]. Rings bunch at the shoulder
  // because that is where the mesh has to survive the largest rotation.
  const shoulderY = 1.415;
  const T = [
    [0.86, 0.150 * hipW, 0.112, 2.5],
    [0.94, 0.152 * hipW, 0.116 * lerp(0.92, 1.3, P.belly), 2.5],
    [1.02, 0.150, 0.116 * lerp(0.92, 1.4, P.belly), 2.5],
    [1.10, 0.140, 0.108 * lerp(0.92, 1.35, P.belly), 2.6],   // waist
    [1.19, 0.148, 0.110 * lerp(0.95, 1.2, P.chest), 2.7],
    [1.27, 0.162, 0.118 * lerp(0.95, 1.3, P.chest), 2.8],    // chest
    [1.34, 0.176 * shoulderW, 0.116, 2.8],
    [1.385, 0.196 * shoulderW, 0.110, 2.7],                  // deltoid shelf
    [shoulderY, 0.206 * shoulderW, 0.105, 2.6],
    [1.44, 0.176 * shoulderW, 0.098, 2.4],                   // trapezius
    [1.47, 0.118, 0.088, 2.2],
  ];
  const torsoRings = T.map(([y, a, b, n]) =>
    ringY(y * S, a * fat * S, b * fat * S, n, { z0: leanAt(y * S) }));
  m.loftRings('cloth_shirt', torsoRings, { capStart: false, capEnd: false });

  m.loftRings('cloth_trouser', [
    ringY((hipY - 0.18) * S, 0.152 * hipW * fat * S, 0.112 * fat * S, 2.4),
    ringY(0.86 * S, 0.150 * hipW * fat * S, 0.112 * fat * S, 2.5, { z0: leanAt(0.86 * S) }),
  ], { capStart: false, capEnd: false });

  /* -------------------------------------------------------------- head --- */
  const chinY = J.Head[1] + 0.012 * S;
  const crown = J.HeadTop_End[1];
  const hz = leanAt(J.Head[1]) + 0.006 * S;
  const HR = 0.093 * headS * S;                 // head half-width reference

  // face displacement over (angle, heightFrac). Front is +Z, i.e. t = PI/2.
  const FRONT = Math.PI / 2;
  // Subdivision pulls each vertex toward its neighbours, so a feature authored
  // at its finished depth comes out roughly half as deep. Author it oversized
  // and let the subdivision bring it back.
  const SUB = 2.1;
  const face = (hv) => (t, x, z) => {
    const fd = angDist(t, FRONT);               // 0 at the face, PI at the back
    const front = bump(fd, 0, 1.5);             // how "facing forward" we are
    let k = 1;

    // jaw: narrow the whole head below the cheekbones
    k *= 1 - 0.30 * bump(hv, 0.02, 0.34) * lerp(1.15, 0.8, P.jaw);   // jaw taper is a scale, not a push
    // cranium: widen slightly above the ears
    k *= 1 + 0.05 * bump(hv, 0.60, 0.30);

    let out = [x * k, z * k];
    const push = (amt, dirZ = 1) => { out[1] += amt * SUB * dirZ; };

    // Feature heights are measured from the chin (hv 0) to the crown (hv 1) on a
    // real head, and the first pass had them all too high — everything sat up in
    // the cranium, which is why the brow protruded further than the nose.
    //   chin .06 | mouth .155 | nose tip .29 | bridge .40 | eyes .42 | brow .46
    // The nose tip must be the furthest-forward point on the whole head.

    // brow ridge — a shelf, not a beak
    push(HR * 0.055 * lerp(0.4, 1.3, P.brow) * bump(hv, 0.46, 0.07) * bump(fd, 0, 0.80));
    // eye sockets, either side of the midline, recessed under the brow
    const eye = bump(fd, 0.40, 0.26) * bump(hv, 0.415, 0.055);
    push(-HR * 0.10 * eye);
    // nose: bridge rising to the tip, which is the head's forward extreme
    push(HR * 0.10 * lerp(0.6, 1.4, P.nose) * bump(fd, 0, 0.20) * bump(hv, 0.395, 0.075));
    push(HR * 0.20 * lerp(0.6, 1.5, P.nose) * bump(fd, 0, 0.155) * bump(hv, 0.295, 0.065));
    // nostril wings, a touch wider than the bridge
    push(HR * 0.07 * lerp(0.6, 1.4, P.nose) * bump(fd, 0.17, 0.13) * bump(hv, 0.275, 0.035));
    // cheekbones
    push(HR * 0.06 * lerp(0.5, 1.4, P.cheek) * bump(fd, 0.62, 0.34) * bump(hv, 0.345, 0.10));
    // philtrum, upper lip, lower lip
    push(-HR * 0.035 * bump(fd, 0, 0.40) * bump(hv, 0.215, 0.035));
    push(HR * 0.045 * bump(fd, 0, 0.34) * bump(hv, 0.170, 0.028));
    push(HR * 0.035 * bump(fd, 0, 0.34) * bump(hv, 0.128, 0.028));
    // the crease under the lower lip, then the chin
    push(-HR * 0.030 * bump(fd, 0, 0.36) * bump(hv, 0.100, 0.024));
    push(HR * 0.075 * lerp(0.5, 1.4, P.chin) * bump(fd, 0, 0.38) * bump(hv, 0.055, 0.055));
    // occiput — the back of a skull is not a hemisphere
    push(-HR * 0.09 * bump(fd, Math.PI, 0.9) * bump(hv, 0.55, 0.30), -1);
    // temples
    out[0] *= 1 - 0.06 * bump(fd, 1.35, 0.5) * bump(hv, 0.62, 0.18);
    return out;
  };

  // 24 stations, clustered where the features are. Below hv 0.7 the spacing is
  // ~0.03 so a 0.06-wide feature lands on two rings; above it, the cranium is
  // smooth and needs almost none.
  const headStations = [
    [0.000, 0.42, 0.44], [0.045, 0.56, 0.60], [0.090, 0.66, 0.72],
    [0.135, 0.74, 0.80], [0.180, 0.80, 0.86], [0.225, 0.85, 0.90],
    [0.270, 0.88, 0.93], [0.310, 0.905, 0.955], [0.350, 0.925, 0.975],
    [0.390, 0.94, 0.99], [0.430, 0.955, 1.00], [0.470, 0.965, 1.005],
    [0.510, 0.975, 1.01], [0.550, 0.985, 1.015], [0.590, 0.995, 1.02],
    [0.630, 1.00, 1.02], [0.670, 0.995, 1.015], [0.720, 0.98, 1.00],
    [0.780, 0.945, 0.96], [0.840, 0.885, 0.90], [0.895, 0.79, 0.81],
    [0.940, 0.66, 0.68], [0.975, 0.47, 0.49], [1.000, 0.20, 0.22],
  ];
  const headRings = headStations.map(([hv, wa, wb]) =>
    ringY(lerp(chinY, crown, hv), HR * wa, HR * 1.09 * wb, 2.3,
      { z0: hz, disp: face(hv), seg: SEG_HEAD }));

  // neck, blended into the jaw
  m.loftRings('skin', [
    ringY((1.455 - 0.05) * S + (hipY - 0.98) * 0.55 * S, 0.070 * neckL * S, 0.066 * S, 2.2,
      { z0: leanAt(J.Neck[1]), seg: SEG_HEAD }),
    ringY(J.Neck[1] + 0.01 * S, 0.063 * neckL * S, 0.061 * S, 2.2, { z0: hz, seg: SEG_HEAD }),
    ringY(J.Neck[1] + 0.05 * S, 0.058 * neckL * S, 0.058 * S, 2.2, { z0: hz, seg: SEG_HEAD }),
    headRings[0],
  ], { capStart: false, capEnd: false });
  // the head gets its own material and a normalized UV rectangle, so the face
  // can be painted rather than sculpted
  m.loftRings('face_skin', headRings, { capStart: false, capEnd: true, uv: 'normalized' });

  // ears
  if (P.ears > 0.05) {
    const er = HR * lerp(0.20, 0.30, P.ears);
    for (const sx of [-1, 1]) {
      const ey = lerp(chinY, crown, 0.52);
      m.loftRings('skin', [
        ringX(sx * HR * 0.80, ey, hz - HR * 0.10, er * 0.72, er * 0.44, 2.4, 14),
        ringX(sx * HR * 1.02, ey + er * 0.06, hz - HR * 0.14, er, er * 0.6, 2.4, 14),
        ringX(sx * HR * 1.10, ey + er * 0.04, hz - HR * 0.16, er * 0.72, er * 0.42, 2.4, 14),
      ], { capStart: false, capEnd: true });
    }
  }

  if (P.hair > 0.05) {
    // Hair is a shell over the skull, offset along each vertex's own outward
    // direction rather than scaled about the head centre — scaling pushed it
    // forward over the brow and read as a visor.
    const lowest = lerp(0.74, 0.50, P.hair);       // how far down the skull it comes
    const hairRings = headStations
      .map(([hv], i) => ({ hv, i }))
      .filter(({ hv }) => hv >= lowest)
      .map(({ hv, i }) => headRings[i].map((v) => {
        const dx = v.p[0], dz = v.p[2] - hz;
        const len = Math.hypot(dx, dz) || 1;
        const t = Math.atan2(dz, dx);
        const back = 0.5 + 0.5 * Math.cos(t - FRONT + Math.PI);
        // thin at the hairline, thicker over the crown and occiput
        const thick = HR * (0.02 + 0.05 * back) * clamp((hv - lowest) / 0.2);
        return { p: [dx + (dx / len) * thick, v.p[1] + thick * 0.35, hz + dz + (dz / len) * thick], n: v.n };
      }));
    if (hairRings.length > 1) m.loftRings('hair', hairRings, { capStart: false, capEnd: true });
  }

  /* ------------------------------------------------------------- limbs --- */
  const lerpV = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  /** An arm runs along X, so its rings live in YZ. Stations bunch at the elbow. */
  const arm = (side) => {
    const sx = side === 'Left' ? 1 : -1;
    const A = J[side + 'Arm'], F = J[side + 'ForeArm'], H = J[side + 'Hand'];
    const st = [
      [-0.10, 0.070, 2.3], [0.06, 0.062, 2.2], [0.30, 0.055 * mus, 2.1],
      [0.62, 0.049, 2.1], [0.88, 0.044, 2.1], [1.00, 0.042, 2.1],   // elbow
      [1.12, 0.043, 2.1], [1.40, 0.041 * mus, 2.2], [1.75, 0.034, 2.3],
      [2.00, 0.029, 2.4],
    ];
    const rings = st.map(([u, r, n]) => {
      const p = u <= 1 ? lerpV(A, F, u) : lerpV(F, H, u - 1);
      return ringX(p[0], p[1], p[2], r * fat * S, r * fat * S * 0.92, n);
    });
    const cut = Math.max(1, Math.round(P.sleeve * (rings.length - 1)));
    m.loftRings('cloth_shirt', rings.slice(0, cut + 1), { capStart: false, capEnd: false });
    m.loftRings('skin', rings.slice(cut), { capStart: false, capEnd: false });

    /* hand: palm, four fingers, a thumb */
    const hs = lerp(0.9, 1.12, P.handSize) * S;
    const HE = J[side + 'Hand_End'];
    const palmL = Math.abs(HE[0] - H[0]) * 0.52;
    m.loftRings('skin', [
      ringX(H[0], H[1], H[2], 0.030 * hs, 0.024 * hs, 2.4),
      ringX(H[0] + sx * palmL * 0.5, H[1], H[2], 0.042 * hs, 0.019 * hs, 2.8),
      ringX(H[0] + sx * palmL, H[1], H[2], 0.040 * hs, 0.017 * hs, 2.8),
    ], { capStart: false, capEnd: false });

    const fx = H[0] + sx * palmL;
    for (let i = 0; i < 4; i++) {
      const off = (i - 1.5) * 0.019 * hs;
      const len = (i === 0 ? 0.052 : i === 1 ? 0.060 : i === 2 ? 0.057 : 0.046) * hs;
      const rad = 0.0082 * hs;
      m.loftRings('skin', [
        ringX(fx, H[1] + off, H[2], rad, rad * 0.92, 2.2),
        ringX(fx + sx * len * 0.55, H[1] + off, H[2] + 0.004 * hs, rad * 0.94, rad * 0.86, 2.2),
        ringX(fx + sx * len, H[1] + off, H[2] + 0.010 * hs, rad * 0.6, rad * 0.56, 2.2),
      ], { capStart: false, capEnd: true });
    }
    const T1 = J[side + 'HandThumb1'], T2 = J[side + 'HandThumb2'];
    m.loftRings('skin', [
      ringX(T1[0], T1[1], T1[2], 0.011 * hs, 0.010 * hs, 2.2),
      ringX(lerp(T1[0], T2[0], 0.6), lerp(T1[1], T2[1], 0.6), lerp(T1[2], T2[2], 0.6), 0.0098 * hs, 0.0092 * hs, 2.2),
      ringX(T2[0] + sx * 0.016 * hs, T2[1] - 0.003 * hs, T2[2] + 0.008 * hs, 0.0062 * hs, 0.0058 * hs, 2.2),
    ], { capStart: false, capEnd: true });
  };

  /** A leg runs along Y. Stations bunch at the knee for the same reason. */
  const leg = (side) => {
    const U = J[side + 'UpLeg'], K = J[side + 'Leg'], F = J[side + 'Foot'];
    const st = [
      [-0.06, 0.098, 2.3], [0.10, 0.092, 2.3], [0.34, 0.082 * mus, 2.2],
      [0.66, 0.070, 2.2], [0.90, 0.062, 2.2], [1.00, 0.059, 2.2],   // knee
      [1.10, 0.060, 2.2], [1.28, 0.064 * mus, 2.2], [1.58, 0.050, 2.3],
      [1.85, 0.038, 2.4], [2.00, 0.034, 2.5],
    ];
    const rings = st.map(([u, r, n]) => {
      const p = u <= 1 ? lerpV(U, K, u) : lerpV(K, F, u - 1);
      return ringY(p[1], r * fat * S, r * fat * S * 0.94, n, { z0: p[2] });
    }).map((ring, i) => ring.map((v) => ({ p: [v.p[0] + (st[i][0] <= 1
      ? lerp(U[0], K[0], st[i][0]) : lerp(K[0], F[0], st[i][0] - 1)), v.p[1], v.p[2]], n: v.n })));
    const cut = Math.max(1, Math.round(P.trouser * (rings.length - 1)));
    m.loftRings('cloth_trouser', rings.slice(0, cut + 1), { capStart: false, capEnd: false });
    m.loftRings('skin', rings.slice(cut), { capStart: false, capEnd: false });

    const f = J[side + 'Foot'], t = J[side + 'Toe_End'];
    const fw = lerp(0.042, 0.054, P.footSize) * S, fl = lerp(0.92, 1.12, P.footSize);
    m.loftRings('shoe_leather', [
      ringY(f[1] + 0.020 * S, fw * 0.88, 0.030 * S, 2.4, { z0: f[2] - 0.038 * S })
        .map((v) => ({ p: [v.p[0] + f[0], v.p[1], v.p[2]], n: v.n })),
      ringY(f[1] - 0.006 * S, fw, 0.052 * S, 2.6, { z0: f[2] + 0.016 * S })
        .map((v) => ({ p: [v.p[0] + f[0], v.p[1], v.p[2]], n: v.n })),
      ringY(f[1] - 0.030 * S, fw * 0.97, 0.050 * S, 3.0, { z0: lerp(f[2], t[2], 0.62 * fl) })
        .map((v) => ({ p: [v.p[0] + f[0], v.p[1], v.p[2]], n: v.n })),
      ringY(f[1] - 0.040 * S, fw * 0.66, 0.024 * S, 3.0, { z0: lerp(f[2], t[2], 1.02 * fl) })
        .map((v) => ({ p: [v.p[0] + f[0], v.p[1], v.p[2]], n: v.n })),
    ], { capStart: true, capEnd: true });
  };

  for (const side of ['Left', 'Right']) { arm(side); leg(side); }

  m.smoothNormals(['skin', 'hair', 'cloth_shirt', 'cloth_trouser', 'shoe_leather']);
  return {
    mesh: m, rig, params: P,
    // the cage, for tools/blender/build.py
    cage: {
      chains,
      joints: rig.order.map((n) => ({ name: n, parent: rig.parent[n], world: rig.world[n] })),
    },
  };
}
