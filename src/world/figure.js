import * as THREE from 'three';
import {
  Fn, attribute, instancedBufferAttribute, positionGeometry, normalGeometry, normalLocal, positionWorld, normalWorld,
  vec3, vec4, float, sin, cos, abs, max, mix, select, step, smoothstep, fract, floor, exp2, dot, clamp,
} from 'three/tsl';

/**
 * People, rebuilt (2026-09-23).
 *
 * The previous crowd was six instanced body parts per person (six draw calls),
 * each part a handful of 6-sided cylinders and boxes posed on the CPU: from the
 * driver's seat it read as a crowd of jointed skittles. This is ONE smooth,
 * properly proportioned human mesh -- a lathed torso and hips, tapered limbs
 * with elbows and knees, hands, shoes, a sculpted head with a nose, ears, eyes
 * and brows, and six hair styles that sit ON the skull (each is the skull
 * pushed out and cut at a hairline) -- the crowd in TWO instanced draws.
 *
 * The walk is done on the GPU. Every vertex carries the bone it belongs to
 * (`aBone`), and the vertex stage rebuilds the pose from each person's phase
 * and state: shins bend at the knee, thighs swing at the hip, forearms at the
 * elbow, arms at the shoulder counter to the legs, the spine leans and twists,
 * the head nods, the pelvis bobs. The CPU writes 8 floats per person per frame
 * instead of six 4x4 matrices, and the shadow pass reuses the same position
 * node, so the shadows walk too.
 *
 * Model space: forward +X, up +Y, left +Z (the project convention: people and
 * vehicles face +X). Soles at y = 0, so FOOT_DROP is 0; it stays exported for
 * the callers that add it.
 *
 * Per person (instanced attributes, all written by `write()` / `colour()`):
 *   aRoot  x, y, z, yaw      yaw maps +X to (cos yaw, 0, -sin yaw), the way
 *                            crowd.js walks (x += cos yaw, z -= sin yaw)
 *   aAnim  phase, state, scale, look    state 0 idle, 1 walk, 2 run, 3 down;
 *                            scale 0 hides; look packs hair style, top
 *                            pattern, shorts, sleeves and build (colour())
 *   aTop, aBottom, aSkin, aHair         colours (linear)
 */

export const FOOT_DROP = 0;
export const PARTS = ['body'];   // one mesh now; kept for anything that counted them

/* Joints, metres, model space (height ~1.76 at scale 1). */
const J = {
  hipY: 0.93, hipZ: 0.095,
  kneeY: 0.51,
  ankleY: 0.085,
  waistY: 1.02,
  shoulderY: 1.43, shoulderZ: 0.195,
  elbowY: 1.12,
  wristY: 0.86,
  neckY: 1.50,
  headY: 1.645,
};

/* Bones. Side is part of the id so the shader can pick pivots without a table. */
const B = { root: 0, spine: 1, head: 2, uArmL: 3, fArmL: 4, uArmR: 5, fArmR: 6, thighL: 7, shinL: 8, thighR: 9, shinR: 10 };
/* Regions (what colour a vertex takes). */
const R = { skin: 0, top: 1, bottom: 2, shoe: 3, hair: 4, sleeve: 5, belt: 6, eye: 7, brow: 8, lip: 9, bag: 10 };
/* Hair styles, per person: 0 short, 1 long, 2 cropped, 3 cap, 4 bun, 5 short + beard. */
const HAIR_STYLES = 6;
/* Which styles wear each hair piece, as a bit set over the style index. */
const WEARS = { short: 1 | 8 | 16 | 32, long: 2, cropped: 4, cap: 8, bun: 16, beard: 32, all: 63 };
/* Not a hair piece: the bag in the right hand is worn by the look's bag bit, not the style. */
const BAG_MASK = 64;

/* ------------------------------------------------------------------ geometry */

function tag(geo, bone, region, hairMask = -1) {
  const n = geo.attributes.position.count;
  /* bone, region and hair mask packed in one vec3: WebGPU allows 8 vertex
     buffers per pipeline and the instanced colours need three of them */
  const t = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { t[i * 3] = bone; t[i * 3 + 1] = region; t[i * 3 + 2] = hairMask; }
  geo.setAttribute('aTag', new THREE.BufferAttribute(t, 3));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!geo.index) geo.setIndex([...Array(n).keys()]);
  return geo;
}

/**
 * Normals averaged over coincident vertices: a lathe or sphere duplicates its
 * seam and its poles, and three's computeVertexNormals leaves a crease there.
 */
export function weldNormals(geo) {
  geo.computeVertexNormals();
  const pos = geo.attributes.position, nor = geo.attributes.normal, acc = new Map();
  const key = (i) => `${Math.round(pos.getX(i) * 2e4)},${Math.round(pos.getY(i) * 2e4)},${Math.round(pos.getZ(i) * 2e4)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = key(i), a = acc.get(k) ?? [0, 0, 0];
    a[0] += nor.getX(i); a[1] += nor.getY(i); a[2] += nor.getZ(i); acc.set(k, a);
  }
  for (let i = 0; i < pos.count; i++) {
    const a = acc.get(key(i)), l = Math.hypot(a[0], a[1], a[2]) || 1;
    nor.setXYZ(i, a[0] / l, a[1] / l, a[2] / l);
  }
  return geo;
}

/** A lathed body section: `profile` is [[radius, y], ...] bottom to top; depth squashes front-back (X). */
function lathe(profile, seg, depth = 1, width = 1) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y));
  const g = new THREE.LatheGeometry(pts, seg);
  g.scale(depth, 1, width);
  return weldNormals(g);
}

/** A tapered limb between two heights, hanging from a joint (top) toward y1 (bottom), centred at (x, z). */
function limb(rTop, rBot, yTop, yBot, x, z, seg, rings = 2) {
  const h = yTop - yBot;
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, rings, true);   // open: both ends sit inside a joint
  g.translate(x, yBot + h / 2, z);
  return weldNormals(g);
}

function ball(r, x, y, z, sx = 1, sy = 1, sz = 1, seg = 10) {
  const g = new THREE.SphereGeometry(r, seg, Math.max(3, Math.round(seg * 0.6)));
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return weldNormals(g);
}

/* The skull: centre (cx, headY, 0), half-extents rx (front-back), ry, rz. */
const HEAD = { cx: 0.006, rx: 0.098, ry: 0.118, rz: 0.080 };

/**
 * The head's shape as a function of a unit direction: round at the crown and
 * the back, the jaw narrowing to a chin, the face flatter than the back of
 * the head. Every hair piece is this same surface pushed out, so hair follows
 * the skull instead of floating on a ball in front of the face.
 */
function skull(ux, uy, uz, out) {
  let x = ux, y = uy, z = uz;
  if (y < 0) {
    const t = -y;
    z *= 1 - 0.30 * t * t;                       // the jaw narrows toward the chin
    x *= x < 0 ? 1 - 0.42 * t : 1 - 0.05 * t;    // the back of the skull tucks in to the neck
  }
  if (x > 0.5) x = 0.5 + (x - 0.5) * 0.7;        // a flatter face
  if (x < 0 && y > -0.35) x *= 1.06;             // a rounder back of the head
  return out.set(HEAD.cx + x * HEAD.rx, J.headY + y * HEAD.ry, z * HEAD.rz);
}

/**
 * A shell over the skull, on the SAME sphere grid as the skull itself (so the
 * gap between them is even everywhere): scaled out by k = [kx, ky, kz] about
 * the head centre and shifted by off = [ox, oy]. `keep(c, uy)` -- c is the
 * cosine of the direction's bearing from the face (1 front, 0 side, -1 back),
 * uy its height -- says where the shell is; everywhere else its vertices sink
 * 10% inside the skull, so the shell's edge dives into the skin: a hairline,
 * a cap line, a beard line. `warp` may move a kept vertex (long hair falls).
 */
function skullShell(seg, rings, k, off, keep, warp = null) {
  const g = new THREE.SphereGeometry(1, seg, rings);
  const pos = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const ux = pos.getX(i), uy = pos.getY(i), uz = pos.getZ(i);
    const h = Math.hypot(ux, uz), c = h > 1e-5 ? ux / h : 0;
    skull(ux, uy, uz, v);
    const on = keep(c, uy);
    const kx = on ? k[0] : 0.9, ky = on ? k[1] : 0.9, kz = on ? k[2] : 0.9;
    v.set(HEAD.cx + (v.x - HEAD.cx) * kx + (on ? off[0] : 0), J.headY + (v.y - J.headY) * ky + (on ? off[1] : 0), v.z * kz);
    if (on && warp) warp(c, uy, v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  return weldNormals(g);
}

/* Hairlines, as a height on the unit sphere by bearing: front, side, back. */
const line3 = (front, side, back) => (c) => (c >= 0 ? side + (front - side) * c : side + (side - back) * c);
const HAIRLINE = line3(0.52, 0.20, -0.55);       // short: the ears show
const LONGLINE = line3(0.52, -0.60, -0.97);      // long: over the ears, down the back
const CROPLINE = line3(0.58, 0.26, -0.45);       // cropped: a tight, high line
const CAPLINE = line3(0.32, 0.25, 0.12);         // the cap sits on the brow, tipped back
const smooth01 = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/**
 * The person, as one indexed geometry. `lod` 0 is the near mesh, 1 the far one:
 * the same bones, joints and regions, fewer segments, and the far one drops the
 * face (eyes, brows, mouth, nose, ears) and the cap's peak.
 */
export function buildHumanGeometry(lod = 0) {
  const near = lod === 0;
  const s = near ? 10 : 5;                 // radial segments, body
  const hs = near ? 14 : 8, hr = near ? 10 : 6;   // head sphere grid (skull and every hair shell share it)
  const parts = [];

  // hips / pelvis (trousers), squashed front-back
  parts.push(tag(lathe([[0.001, 0.80], [0.135, 0.82], [0.160, 0.88], [0.168, 0.95], [0.158, 1.00], [0.150, 1.04]], s, 0.70, 1.0), B.root, R.bottom));
  // belt band
  parts.push(tag(lathe([[0.152, 1.015], [0.154, 1.045]], s, 0.71, 1.0), B.root, R.belt));
  // torso: waist -> ribcage -> chest -> shoulders -> collar (top colour)
  parts.push(tag(lathe([[0.150, 1.02], [0.158, 1.10], [0.175, 1.22], [0.186, 1.32], [0.185, 1.40], [0.150, 1.46], [0.075, 1.50], [0.001, 1.505]], s, 0.64, 1.0), B.spine, R.top));
  // shoulder caps (top colour; the joint the sleeve hangs from)
  if (near) for (const z of [J.shoulderZ, -J.shoulderZ]) parts.push(tag(ball(0.050, 0, J.shoulderY - 0.012, z * 0.92, 1.0, 0.9, 1.0, s), B.spine, R.top));
  // neck
  parts.push(tag(limb(0.050, 0.056, J.neckY + 0.06, J.neckY - 0.02, 0.0, 0, s, 1), B.head, R.skin));

  // head: one sculpted skull (see skull()); the face features ride its surface
  parts.push(tag(skullShell(hs, hr, [1, 1, 1], [0, 0], () => true), B.head, R.skin));
  if (near) {
    const nose = new THREE.ConeGeometry(0.016, 0.034, 6);
    nose.rotateZ(-Math.PI / 2 - 0.18); nose.translate(0.097, J.headY - 0.022, 0);
    parts.push(tag(weldNormals(nose), B.head, R.skin));
    for (const z of [0.079, -0.079]) parts.push(tag(ball(0.024, -0.002, J.headY - 0.006, z, 0.55, 1.15, 0.45, 6), B.head, R.skin));   // ears
    for (const z of [0.032, -0.032]) parts.push(tag(ball(0.011, 0.080, J.headY + 0.006, z, 0.55, 0.8, 1.0, 6), B.head, R.eye));        // eyes
    for (const z of [0.034, -0.034]) parts.push(tag(ball(0.017, 0.080, J.headY + 0.027, z, 0.35, 0.28, 1.3, 6), B.head, R.brow));    // brows
    parts.push(tag(ball(0.020, 0.086, J.headY - 0.058, 0, 0.30, 0.22, 1.0, 6), B.head, R.lip));                                     // mouth
  }
  /* Hair: every piece is the skull pushed out (skullShell), cut by a hairline,
     so it sits ON the head; the shader collapses the pieces a person does not
     wear (WEARS bit set vs the person's style). */
  parts.push(tag(skullShell(hs, hr, [1.07, 1.05, 1.09], [-0.004, 0.004], (c, uy) => uy > HAIRLINE(c)), B.head, R.hair, WEARS.short));
  parts.push(tag(skullShell(hs, hr, [1.08, 1.05, 1.12], [-0.006, 0.004], (c, uy) => uy > LONGLINE(c), (c, uy, v) => {
    // the back and sides fall to the shoulders and flare a little
    const f = smooth01(0.35, -0.30, c) * smooth01(0.40, -0.70, uy);
    v.y -= 0.19 * f; v.x -= 0.018 * f; v.z *= 1 + 0.22 * f;
  }), B.head, R.hair, WEARS.long));
  parts.push(tag(skullShell(hs, hr, [1.02, 1.016, 1.022], [0, 0.001], (c, uy) => uy > CROPLINE(c)), B.head, R.hair, WEARS.cropped));
  parts.push(tag(skullShell(hs, hr, [1.11, 1.08, 1.12], [-0.004, 0.012], (c, uy) => uy > CAPLINE(c)), B.head, R.bottom, WEARS.cap));   // cap crown, in the trouser colour
  if (near) {
    const peak = new THREE.CylinderGeometry(0.078, 0.078, 0.008, s, 1, false, 0, Math.PI);   // a half disc on +X
    peak.scale(0.95, 1, 1); peak.rotateZ(-0.14); peak.translate(0.072, J.headY + 0.046, 0);
    parts.push(tag(weldNormals(peak), B.head, R.bottom, WEARS.cap));
  }
  // the beard rides both meshes: at 38 m a beard vanishing would be a pop
  parts.push(tag(skullShell(hs, hr, [1.035, 1.02, 1.05], [0.002, -0.002], (c, uy) => c > -0.2 && uy < (c >= 0 ? 0.15 - 0.42 * c : 0.15) && uy > -0.99), B.head, R.hair, WEARS.beard));
  parts.push(tag(ball(0.046, -0.090, J.headY + 0.094, 0, 1, 1, 1, near ? 8 : 5), B.head, R.hair, WEARS.bun));

  // arms: upper (sleeve/top), forearm (sleeve or skin by style), hand (skin)
  for (const [side, u, f] of [[1, B.uArmL, B.fArmL], [-1, B.uArmR, B.fArmR]]) {
    const z = J.shoulderZ * side;
    parts.push(tag(limb(0.050, 0.042, J.shoulderY - 0.01, J.elbowY, 0, z, s), u, R.top));
    if (near) parts.push(tag(ball(0.042, 0, J.elbowY, z, 1, 1, 1, s - 2), f, R.sleeve));
    parts.push(tag(limb(0.041, 0.032, J.elbowY, J.wristY, 0, z, s), f, R.sleeve));
    // hand: a mitten, slightly turned in, thumb forward
    parts.push(tag(ball(0.038, 0.004, J.wristY - 0.062, z * 0.985, 0.62, 1.15, 0.95, s), f, R.skin));
    if (near) parts.push(tag(ball(0.015, 0.027, J.wristY - 0.040, z * 0.96, 1, 1.4, 1, 5), f, R.skin));
  }
  // a bag in the right hand (worn by the look's bag bit): it hangs below the fist, a hand's width outboard of the leg
  parts.push(tag(new THREE.BoxGeometry(0.30, 0.27, 0.09).translate(0.01, J.wristY - 0.245, -J.shoulderZ - 0.025), B.fArmR, R.bag, BAG_MASK));
  if (near) parts.push(tag(new THREE.BoxGeometry(0.02, 0.10, 0.02).translate(0.01, J.wristY - 0.07, -J.shoulderZ - 0.02), B.fArmR, R.bag, BAG_MASK));   // the handle, into the fist

  // legs: thigh + knee + shin (trousers), shoe
  for (const [side, t, sh] of [[1, B.thighL, B.shinL], [-1, B.thighR, B.shinR]]) {
    const z = J.hipZ * side;
    parts.push(tag(limb(0.088, 0.062, J.hipY + 0.02, J.kneeY, 0, z, s), t, R.bottom));
    if (near) parts.push(tag(ball(0.061, 0.004, J.kneeY, z, 1, 1, 1, s - 2), sh, R.bottom));
    parts.push(tag(limb(0.060, 0.043, J.kneeY, J.ankleY + 0.02, 0, z, s), sh, R.bottom));
    // shoe: rounded toe box forward (+X), flat sole at y = 0
    const shoe = new THREE.SphereGeometry(0.050, s, Math.max(3, Math.round(s * 0.6)));
    shoe.scale(2.25, 0.95, 1.05); shoe.translate(0.055, 0.050, z);
    const pos = shoe.attributes.position;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 0.012) pos.setY(i, 0.0);   // flatten the sole
    parts.push(tag(weldNormals(shoe), sh, R.shoe));
    if (near) parts.push(tag(limb(0.044, 0.048, 0.11, 0.05, 0.0, z, s, 1), sh, R.shoe));        // the heel and ankle collar
  }

  const merged = mergeTagged(parts);
  merged.computeBoundingSphere();
  return merged;
}

/**
 * The head alone, for other characters built from the same skull (world/officer.js):
 * [{ name, geo, region }] in figure space (the skull centred at J.headY), untagged.
 * `hair` is 'short' | 'cropped' | 'none'; `cap: true` adds a service-cap shell
 * that hugs the skull (the crown and peak are the caller's).
 */
export function headPieces({ seg = 10, rings = 7, hair = 'short', face = true, featureSeg = 5 } = {}) {
  const f = featureSeg;
  const out = [];
  out.push({ name: 'skull', region: R.skin, geo: skullShell(seg, rings, [1, 1, 1], [0, 0], () => true) });
  if (face) {
    const nose = new THREE.ConeGeometry(0.016, 0.034, f);
    nose.rotateZ(-Math.PI / 2 - 0.18); nose.translate(0.097, J.headY - 0.022, 0);
    out.push({ name: 'nose', region: R.skin, geo: weldNormals(nose) });
    for (const z of [0.079, -0.079]) out.push({ name: 'ear', region: R.skin, geo: ball(0.024, -0.002, J.headY - 0.006, z, 0.55, 1.15, 0.45, f) });
    for (const z of [0.032, -0.032]) out.push({ name: 'eye', region: R.eye, geo: ball(0.011, 0.080, J.headY + 0.006, z, 0.55, 0.8, 1.0, f) });
    for (const z of [0.034, -0.034]) out.push({ name: 'brow', region: R.brow, geo: ball(0.017, 0.080, J.headY + 0.027, z, 0.35, 0.28, 1.3, f) });
    out.push({ name: 'mouth', region: R.lip, geo: ball(0.020, 0.086, J.headY - 0.058, 0, 0.30, 0.22, 1.0, f) });
  }
  if (hair === 'short') out.push({ name: 'hair', region: R.hair, geo: skullShell(seg, rings, [1.07, 1.05, 1.09], [-0.004, 0.004], (c, uy) => uy > HAIRLINE(c)) });
  else if (hair === 'cropped') out.push({ name: 'hair', region: R.hair, geo: skullShell(seg, rings, [1.02, 1.016, 1.022], [0, 0.001], (c, uy) => uy > CROPLINE(c)) });
  return out;
}

/** The skull pushed out and cut, for hats: `k` scale, `keep(c, uy)` where it covers (see skullShell). */
export function skullCover(seg, rings, k, off, keep) { return skullShell(seg, rings, k, off, keep); }

/** Merge indexed tagged parts into one indexed geometry (same attribute set on every part). */
function mergeTagged(parts) {
  const names = ['position', 'normal', 'uv', 'aTag'];
  let n = 0, ni = 0;
  for (const p of parts) { n += p.attributes.position.count; ni += p.index.count; }
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const size = parts[0].attributes[name].itemSize;
    const arr = new Float32Array(n * size);
    let o = 0;
    for (const p of parts) { const a = p.attributes[name]; arr.set(a.array.subarray(0, a.count * size), o); o += a.count * size; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const index = n > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let o = 0, base = 0;
  for (const p of parts) {
    const src = p.index.array;
    for (let i = 0; i < p.index.count; i++) index[o + i] = src[i] + base;
    o += p.index.count; base += p.attributes.position.count;
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  for (const p of parts) p.dispose();
  return out;
}

/* -------------------------------------------------------------------- shader */

function peopleMaterial(attrs) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.82, metalness: 0 });
  m.name = 'people';
  const aTag = attribute('aTag', 'vec3');
  const aBone = aTag.x, aRegion = aTag.y, aHairMask = aTag.z;
  const root = instancedBufferAttribute(attrs.root);
  const anim = instancedBufferAttribute(attrs.anim);
  /* the four colours ride three vec4s: c0 = top.rgb, bottom.r; c1 = bottom.gb,
     skin.rg; c2 = skin.b, hair.rgb (8 vertex buffers in all, WebGPU's limit) */
  const c0 = instancedBufferAttribute(attrs.c0), c1 = instancedBufferAttribute(attrs.c1), c2 = instancedBufferAttribute(attrs.c2);
  const top = c0.xyz, bottom = vec3(c0.w, c1.x, c1.y), skin = vec3(c1.z, c1.w, c2.x), hair = c2.yzw;

  const phase = anim.x, state = anim.y, scale = anim.z;
  /* anim.w packs the look: floor = style + 6 * (pattern + 4 * (shorts + 2 * sleeve)),
     fract = build (0.05..0.95, kept off the integers so an interpolated copy in
     the fragment stage never floors to the wrong code); see FigureFleet.colour */
  const code = floor(anim.w), build = fract(anim.w);
  const style = code.mod(6), look = floor(code.div(6));
  const pattern = look.mod(4), shorts = floor(look.div(4)).mod(2), longSleeve = floor(look.div(8)).mod(2), bag = floor(look.div(16));
  const girth = float(0.88).add(build.mul(0.34));      // 0.9 slim .. 1.2 heavy, across the body
  // hair pieces this person's style does not wear collapse to the crown, where the worn ones cover them
  const wornStyle = aHairMask.lessThan(0).or(select(aHairMask.equal(BAG_MASK), bag.greaterThan(0.5), floor(aHairMask.div(exp2(style))).mod(2).greaterThan(0.5)));

  /* The pose, in the order a skeleton applies it: the far end of a chain first.
     Every step is ONE statement on two shader variables (position P, normal N):
     each vertex rotates about its joint by an angle that is zero unless its
     bone is in that chain -- a zero rotation is the identity, so there is no
     branch per step. (The first version chained p = select(c, f(p), p): p
     appeared twice per step and TSL inlined both, so the vertex shader grew
     x3 a step to 887 kB and SwiftShader lost the device compiling it.) */
  m.positionNode = Fn(() => {
    const ph = phase.toVar();
    const walk = step(0.5, state).mul(float(1).sub(step(2.5, state))).toVar();   // walking or running
    const run = step(1.5, state).mul(float(1).sub(step(2.5, state))).toVar();
    const down = step(2.5, state).toVar();
    const idle = float(1).sub(walk).sub(down).toVar();

    const legSwing = mix(0.52, 0.92, run).mul(walk).toVar();
    const swing = sin(ph).toVar();                                   // + left leg forward
    const breathe = sin(ph.mul(0.6)).mul(0.02).mul(idle).toVar();
    const kneeK = mix(0.95, 1.55, run).mul(walk).toVar();
    const armK = mix(0.55, 0.85, run).mul(walk).div(max(legSwing, 0.001)).toVar();
    const twist = swing.mul(0.10).mul(walk).toVar();

    const b = aBone;
    const left = b.equal(B.thighL).or(b.equal(B.shinL)).or(b.equal(B.uArmL)).or(b.equal(B.fArmL));
    const side = select(left, float(1), float(-1)).toVar();          // +1 left, -1 right
    const shin = b.equal(B.shinL).or(b.equal(B.shinR));
    const leg = shin.or(b.equal(B.thighL)).or(b.equal(B.thighR));
    const fore = b.equal(B.fArmL).or(b.equal(B.fArmR));
    const arm = fore.or(b.equal(B.uArmL)).or(b.equal(B.uArmR));
    const head = b.equal(B.head);
    const upper = b.equal(B.spine).or(head).or(arm);
    const lower = leg.or(b.equal(B.root));
    const g = select(head, float(1), girth).toVar();                 // build widens all but the head

    // rest pose, widened by build; unworn hair collapsed to the crown
    const P = select(wornStyle, vec3(positionGeometry.x.mul(g), positionGeometry.y, positionGeometry.z.mul(g)), vec3(0, J.headY, 0)).toVar();
    const N = vec3(normalGeometry.x.div(g), normalGeometry.y, normalGeometry.z.div(g)).toVar();

    const turn = (axis, py, pz, a) => {
      const c = cos(a).toVar(), s = sin(a).toVar();
      const q = P.sub(vec3(0, py, pz)).toVar();
      if (axis === 'z') {
        P.assign(vec3(q.x.mul(c).sub(q.y.mul(s)), q.x.mul(s).add(q.y.mul(c)), q.z).add(vec3(0, py, pz)));
        N.assign(vec3(N.x.mul(c).sub(N.y.mul(s)), N.x.mul(s).add(N.y.mul(c)), N.z));
      } else if (axis === 'y') {
        P.assign(vec3(q.x.mul(c).add(q.z.mul(s)), q.y, q.x.mul(s).negate().add(q.z.mul(c))).add(vec3(0, py, pz)));
        N.assign(vec3(N.x.mul(c).add(N.z.mul(s)), N.y, N.x.mul(s).negate().add(N.z.mul(c))));
      } else {
        P.assign(vec3(q.x, q.y.mul(c).sub(q.z.mul(s)), q.y.mul(s).add(q.z.mul(c))).add(vec3(0, py, pz)));
        N.assign(vec3(N.x, N.y.mul(c).sub(N.z.mul(s)), N.y.mul(s).add(N.z.mul(c))));
      }
    };
    const hipZ = side.mul(J.hipZ * 1).mul(g), shZ = side.mul(J.shoulderZ).mul(g);

    // knee: folds as the leg swings THROUGH (the foot lifts to clear the ground), barely on the planted leg
    const kneeIn = max(0, sin(ph.add(1.75).add(select(left, float(0), float(Math.PI))))).mul(kneeK)
      .add(walk.mul(0.10)).add(down.mul(select(left, float(0.35), float(0.25))));
    turn('z', J.kneeY, hipZ, select(shin, kneeIn.negate(), float(0)));
    // hip: the leg swings, left and right in opposition
    const thigh = swing.mul(side).mul(legSwing).toVar();
    turn('z', J.hipY, hipZ, select(leg, thigh, float(0)));
    // elbow, then shoulder: swing counter to the same-side leg, and a little spread off the body
    const elbow = mix(0.22, 1.35, run).mul(walk).add(idle.mul(0.10)).add(breathe).add(down.mul(0.2));
    turn('z', J.elbowY, shZ, select(fore, elbow, float(0)));
    const armA = thigh.negate().mul(armK).add(down.mul(select(left, float(2.7), float(2.4))));
    const armOut = float(0.06).add(idle.mul(0.02)).add(down.mul(0.5));
    turn('z', J.shoulderY, shZ, select(arm, armA, float(0)));
    turn('x', J.shoulderY, shZ, select(arm, armOut.mul(side), float(0)));
    // head nods on the neck
    const nod = sin(ph.mul(2)).mul(0.03).mul(walk).add(breathe.mul(0.5));
    turn('z', J.neckY, 0, select(head, nod.negate(), float(0)));
    // the upper body leans and twists at the waist, carrying head and arms
    const lean = run.mul(0.24).add(walk.mul(0.05)).sub(idle.mul(0.01));
    turn('z', J.waistY, 0, select(upper, lean.negate(), float(0)));
    turn('y', J.waistY, 0, select(upper, twist, float(0)));
    // the pelvis counter-twists a touch
    turn('y', J.hipY, 0, select(lower, twist.mul(-0.35), float(0)));
    // bob with the stride (and the breath)
    P.y.addAssign(abs(swing).mul(mix(0.028, 0.06, run)).mul(walk).add(breathe.mul(0.3)));
    // down: face-down on the road, lying along +X from the feet
    turn('z', 0, 0, down.mul(-Math.PI / 2));
    P.y.addAssign(down.mul(0.14));

    // place: scale, yaw, root
    const yaw = root.w.toVar(), cy = cos(yaw).toVar(), sy = sin(yaw).toVar();
    const Q = P.mul(scale).toVar();
    normalLocal.assign(vec3(N.x.mul(cy).add(N.z.mul(sy)), N.y, N.x.mul(sy).negate().add(N.z.mul(cy))).normalize());
    return vec3(Q.x.mul(cy).add(Q.z.mul(sy)), Q.y, Q.x.mul(sy).negate().add(Q.z.mul(cy))).add(root.xyz);
  })();

  /* Colour by region, and the per-person look (FigureFleet.colour):
     sleeves -- a jacket or long sleeves carry the top colour to the wrist, the
     rest show forearm; pattern -- 0 plain, 1 stripes, 2 a chest print, 3 an
     open jacket over a pale tee; shorts end above the knee; the stripes and
     shorts crowd wears trainers. Everything keys off the REST-pose position
     (positionGeometry), so a stripe stays on the body as it walks. */
  const P = positionGeometry;
  const sleeve = mix(skin, top, longSleeve);
  const tee = mix(vec3(0.82, 0.80, 0.76), bottom.mul(0.4).add(0.5), 0.25);
  const stripe = step(0.5, fract(P.y.mul(13.0)));
  // a round chest logo with a ring, in a hue turned from the shirt's own
  const logoR = vec3(0, P.y.sub(1.30), P.z).length();
  const chest = step(0.035, P.x).mul(step(logoR, 0.052)).mul(float(1).sub(step(0.036, logoR).mul(step(logoR, 0.042)).mul(0.7)));
  const opening = step(0.03, P.x).mul(step(abs(P.z), float(0.026).add(P.y.sub(1.22).max(0).mul(0.24)))).mul(step(P.y, 1.47));   // a V wider at the collar
  const topC = select(pattern.equal(1), mix(top, top.mul(0.35).add(vec3(0.5)), stripe.mul(0.8)),
    select(pattern.equal(2), mix(top, top.zxy.mul(0.6).add(vec3(0.32)), chest),
      select(pattern.equal(3), mix(top, tee, opening), top)));
  const trainers = pattern.equal(1).or(shorts.greaterThan(0.5));
  const shoe = select(trainers, vec3(0.72, 0.72, 0.70), vec3(0.035, 0.032, 0.03).add(hair.mul(0.08)));
  const belt = bottom.mul(0.35);
  // the bag: brown leather, a paper shopping bag, or a black briefcase with the jacket
  const bagC = select(pattern.lessThan(1.5), vec3(0.24, 0.13, 0.06), select(pattern.lessThan(2.5), vec3(0.74, 0.70, 0.58), vec3(0.03, 0.03, 0.035)));
  const eye = vec3(0.02, 0.02, 0.025);
  const bare = shorts.greaterThan(0.5).and(P.y.lessThan(J.kneeY + 0.07));
  const bottomC = select(bare, skin, bottom);
  /* The region arrives in the fragment stage as an INTERPOLATED varying: three
     equal corners come out as 0.99999994 or 1.0000001 under the barycentric
     sum, `equal` misses, and the pixel falls through the chain to the eye's
     near-black -- the speckle on every cloth, hair and shoe (skin, region 0,
     interpolates to exactly 0, so it was the one clean region). Round it. */
  const r = floor(aRegion.add(0.5));
  const base = select(r.equal(R.skin), skin,
    select(r.equal(R.top), topC,
      select(r.equal(R.bottom), bottomC,
        select(r.equal(R.shoe), shoe,
          select(r.equal(R.hair), hair,
            select(r.equal(R.sleeve), sleeve,
              select(r.equal(R.belt), belt,
                select(r.equal(R.brow), mix(vec3(dot(hair, vec3(0.3, 0.59, 0.11))), hair, 0.35).mul(0.55),     // darker than the hair; a dyed head keeps natural brows
                  select(r.equal(R.lip), skin.mul(vec3(0.74, 0.56, 0.54)),
                    select(r.equal(R.bag), bagC, eye))))))))));
  // lower-body occlusion toward the feet, and a touch under the chin
  const ao = clamp(P.y.mul(0.9).add(0.35), 0.55, 1.0);
  m.colorNode = vec4(base.mul(ao), 1);
  /* Shadow acne: small, curved, animated surfaces self-shadow in dots at the
     sun's bias (0.0003 / 0.03, renderer.js). Look the received shadow up 3.5 cm
     out along the normal -- the receiver-side normal offset, for people only;
     what they CAST is untouched. */
  m.receivedShadowPositionNode = positionWorld.add(normalWorld.mul(0.035));
  m.roughnessNode = select(r.equal(R.skin).or(bare.and(r.equal(R.bottom))), float(0.55),
    select(r.equal(R.hair), float(0.5), select(r.equal(R.shoe), select(trainers, float(0.6), float(0.32)), select(r.equal(R.eye), float(0.2), select(r.equal(R.bag), float(0.6), float(0.86))))));
  return m;
}

/* --------------------------------------------------------------------- fleet */

const _c = new THREE.Color();
const NEAR_CAP = 48;     // detailed people at once: the ones round the camera
const NEAR_R = 38;       // metres: past this the 526-triangle mesh reads the same

/** One instanced draw of `cap` people with its own attribute set. */
function makeLayer(scene, cap, lod, shadows) {
  const mk = (n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
  const attrs = { root: mk(4), anim: mk(4), c0: mk(4), c1: mk(4), c2: mk(4) };
  const material = peopleMaterial(attrs);
  const mesh = new THREE.Mesh(buildHumanGeometry(lod), material);
  mesh.count = 0;                       // a plain Mesh with .count draws that many instances (RenderObject.getDrawParameters)
  mesh.frustumCulled = false;           // bounds are per person, not per mesh
  mesh.castShadow = !!shadows;
  mesh.receiveShadow = true;
  mesh.name = lod === 0 ? 'people-near' : 'people-far';
  scene.add(mesh);
  return { attrs, material, mesh, cap };
}

/**
 * A crowd of `count` people in TWO instanced draws: the nearest NEAR_CAP within
 * NEAR_R of the focus (`fleet.focus = {x, z}`, crowd.js sets it to the car)
 * wear the 2.2k-triangle mesh, everyone else the 0.5k one. The API is the old
 * FigureFleet's, so crowd.js and beach.js did not change: colour() once,
 * write() per person per frame, flush() after -- flush() sorts people into the
 * two layers and packs each one's buffers.
 */
export class FigureFleet {
  constructor(scene, count, opts = {}) {
    this.count = count;
    // the canonical per-person state (the layers are packed from it each flush)
    this.root = new Float32Array(count * 4);
    this.anim = new Float32Array(count * 4);
    this.col = new Float32Array(count * 12);      // top, bottom, skin, hair
    this.focus = null;
    this.near = makeLayer(scene, Math.min(NEAR_CAP, count), 0, opts.shadows);
    this.far = makeLayer(scene, count, 1, opts.shadows);
    this.meshes = [this.near.mesh, this.far.mesh];   // old consumers counted .meshes
    this.mesh = this.near.mesh;
    this._d = new Float32Array(count);
    this._order = new Int32Array(count);
    for (let i = 0; i < count; i++) this.hide(i);
  }

  /**
   * Per-person colours (hex): `wear` for the top, `skinHex`, `trousers`, and a
   * hair colour, style and look derived from the index (seeded, stable per
   * slot). `look` overrides any of { pattern 0-3, shorts, longSleeve, build 0-1 }.
   */
  colour(i, wear, skinHex, trousers = wear, hairHex = null, style = null, look = {}) {
    const o = i * 12, c = this.col;
    _c.setHex(wear); c[o] = _c.r; c[o + 1] = _c.g; c[o + 2] = _c.b;
    _c.setHex(trousers); c[o + 3] = _c.r; c[o + 4] = _c.g; c[o + 5] = _c.b;
    _c.setHex(skinHex); c[o + 6] = _c.r; c[o + 7] = _c.g; c[o + 8] = _c.b;
    _c.setHex(hairHex ?? HAIR[Math.floor(hash(i) * HAIR.length) % HAIR.length]); c[o + 9] = _c.r; c[o + 10] = _c.g; c[o + 11] = _c.b;
    this.anim[i * 4 + 3] = packLook(i, style, look);
  }

  /** One person's pose this frame. `state`: 0 idle, 1 walking, 2 running, 3 down. */
  write(i, x, y, z, yaw, phase, state, scale = 1) {
    const r = this.root, a = this.anim, o = i * 4;
    r[o] = x; r[o + 1] = y; r[o + 2] = z; r[o + 3] = yaw;
    a[o] = phase; a[o + 1] = state; a[o + 2] = scale;
  }

  hide(i) { this.anim[i * 4 + 2] = 0; }

  flush() {
    const n = this.count, r = this.root, a = this.anim;
    const fx = this.focus?.x, fz = this.focus?.z, hasFocus = Number.isFinite(fx);
    // who is visible, and how far from the focus
    let live = 0;
    for (let i = 0; i < n; i++) {
      if (a[i * 4 + 2] <= 0) continue;
      this._order[live] = i;
      this._d[live] = hasFocus ? Math.hypot(r[i * 4] - fx, r[i * 4 + 2] - fz) : 0;
      live++;
    }
    // near layer: the closest within NEAR_R, up to its cap (partial selection, no full sort)
    const near = this.near, far = this.far;
    let nn = 0, nf = 0;
    const cap = near.cap;
    if (!hasFocus) {
      for (let k = 0; k < live; k++) (nn < cap ? this.#put(near, nn++, this._order[k]) : this.#put(far, nf++, this._order[k]));
    } else {
      for (let k = 0; k < live; k++) {
        const i = this._order[k], d = this._d[k];
        if (d < NEAR_R && nn < cap) this.#put(near, nn++, i);
        else this.#put(far, nf++, i);
      }
    }
    near.mesh.count = nn; far.mesh.count = nf;
    for (const L of [near, far]) for (const at of Object.values(L.attrs)) at.needsUpdate = true;
  }

  #put(L, slot, i) {
    const A = L.attrs, o4 = i * 4, o12 = i * 12, s4 = slot * 4, r = this.root, a = this.anim, c = this.col;
    const ra = A.root.array, aa = A.anim.array;
    ra[s4] = r[o4]; ra[s4 + 1] = r[o4 + 1]; ra[s4 + 2] = r[o4 + 2]; ra[s4 + 3] = r[o4 + 3];
    aa[s4] = a[o4]; aa[s4 + 1] = a[o4 + 1]; aa[s4 + 2] = a[o4 + 2]; aa[s4 + 3] = a[o4 + 3];
    // the 12 colour floats are already in c0 | c1 | c2 order
    A.c0.array.set(c.subarray(o12, o12 + 4), s4);
    A.c1.array.set(c.subarray(o12 + 4, o12 + 8), s4);
    A.c2.array.set(c.subarray(o12 + 8, o12 + 12), s4);
  }

  dispose() {
    for (const L of [this.near, this.far]) { L.mesh.parent?.remove(L.mesh); L.mesh.geometry.dispose(); L.material.dispose(); }
  }
}

/* hair colours: black, dark brown, brown, auburn, blonde, grey, and a dyed one in twenty */
const HAIR = [0x0d0b0a, 0x1a120c, 0x2e1d12, 0x4a2a18, 0x6b4a2a, 0xa88a5a, 0x8a8a88, 0x0d0b0a, 0x1a120c, 0x2e1d12,
  0x1a120c, 0x0d0b0a, 0x4a2a18, 0x2e1d12, 0x6b4a2a, 0x1a120c, 0x0d0b0a, 0x2e1d12, 0x8a1d4a, 0x1a3a6a];

/**
 * The look, packed into one float for the shader (peopleMaterial decodes it):
 * floor = style + 6 * (pattern + 4 * (shorts + 2 * longSleeve)), fract = build,
 * kept inside 0.05..0.95 so no interpolation can floor it to a neighbour code.
 */
function packLook(i, style, look = {}) {
  const st = style ?? Math.floor(hash(i * 7 + 3) * HAIR_STYLES) % HAIR_STYLES;
  const h = hash(i * 13 + 5);
  const pattern = look.pattern ?? (h < 0.52 ? 0 : h < 0.68 ? 1 : h < 0.82 ? 2 : 3);
  const shorts = look.shorts ?? (hash(i * 17 + 1) < 0.18 ? 1 : 0);
  const longSleeve = look.longSleeve ?? (pattern === 3 || hash(i * 19 + 2) < 0.45 ? 1 : 0);   // an open jacket always has sleeves
  const bag = look.bag ?? (hash(i * 29 + 11) < 0.3 ? 1 : 0);                                    // three in ten carry something
  const build = look.build ?? hash(i * 23 + 7);
  return st + 6 * (pattern + 4 * (shorts + 2 * (longSleeve + 2 * bag))) + 0.05 + 0.9 * Math.min(1, Math.max(0, build));
}

/** Decode a packed look (tests, and anything that wants to know what someone wears). */
export function unpackLook(w) {
  const code = Math.floor(w), look = Math.floor(code / 6);
  return { style: code % 6, pattern: look % 4, shorts: Math.floor(look / 4) % 2, longSleeve: Math.floor(look / 8) % 2, bag: Math.floor(look / 16), build: (w - code - 0.05) / 0.9 };
}

function hash(n) {
  let t = (n * 2654435761) >>> 0;
  t ^= t >>> 15; t = Math.imul(t, 0x2c1b3c6d); t ^= t >>> 12; t = Math.imul(t, 0x297a2d39); t ^= t >>> 15;
  return (t >>> 0) / 4294967296;
}

/* Geometry stats for the test and the budget line. */
export function humanTriangles(lod = 0) {
  const g = buildHumanGeometry(lod);
  const n = g.index.count / 3;
  g.dispose();
  return n;
}

export const _internals = { J, B, R, HAIR_STYLES, WEARS, BAG_MASK, packLook, HEAD };
