/**
 * Generates a wardrobe of *fitted* parts — beards, hair, jackets — by deriving
 * each one from the avatar's own geometry.
 *
 * Why derive rather than model: a garment authored independently has to be
 * fitted and skinned, and both are where hand-made clothing goes wrong (it
 * clips through the body, or the elbow tears when the arm bends). Selecting a
 * region of an existing mesh and pushing it out along its own normals gives:
 *
 *   - a perfect fit, by construction — the shell is parallel to the skin
 *   - correct skinning for free — JOINTS_0/WEIGHTS_0 are copied per vertex, so
 *     the part deforms exactly as the surface it came from
 *   - working UVs for free
 *   - working blendshapes for free — a beard derived from the head inherits all
 *     63 morph deltas, so it moves when the jaw opens instead of hanging in
 *     mid-air. This is the detail that separates a real beard from a sticker.
 *
 * Variants are masks, not models. A goatee and a full beard are the same three
 * lines of code with a different predicate, which is what makes the wardrobe
 * scale without an artist.
 *
 * Reads a COPY. Never writes back to the source GLBs.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { SHAPES } from './shapes.mjs';

/**
 * Anatomy of this rig, measured off the bind pose rather than guessed:
 * midline profile and per-band width gave every one of these numbers.
 */
export const ANAT = {
  eyeY: 1.722,      // eye bone height
  noseTipY: 1.687,  // frontmost point on the midline, z = 0.140
  mouthY: 1.660,    // second z peak, the lips
  chinY: 1.604,     // where the midline profile falls off the jaw
  jawTopY: 1.705,   // under the cheekbone
  earY: 1.715,
  hairlineY: 1.793, // forehead ends
  crownY: 1.833,
  headHalfWidth: 0.0925,
};

/**
 * Masks are signed *fields*, not booleans: `field(...)` returns roughly the
 * metres to the nearest edge of the region, positive inside. Two reasons.
 *
 * A boolean mask ends the shell on a triangle boundary, so the beard outline is
 * a visible stair-step — the first version of this looked exactly that bad. A
 * field lets the offset fade to zero across `feather` metres, which tucks the
 * shell edge flush into the skin and hides it.
 *
 * And composing regions becomes arithmetic: `min` intersects, `max` unions,
 * negating subtracts. A goatee is a full beard intersected with a narrow slab.
 */
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const band = (v, lo, hi) => Math.min(v - lo, hi - v);

/**
 * Measure the head off the bind pose instead of hard-coding it.
 *
 * The first version used the male's absolute millimetres, so every hair mask
 * selected zero triangles on the female — her skull simply sits lower. Regions
 * are therefore expressed in head-relative units and resolved per model:
 *
 *   Y(t)  t=0 at the chin, t=1 at the crown
 *   X(f)  f as a fraction of head half-width
 *   Z(f)  f as a fraction of face depth
 */
export function measure(P, eyeY) {
  const n = P.length / 3;
  let crownY = -9, maxZ = -9, halfW = 0;
  for (let i = 0; i < n; i++) {
    crownY = Math.max(crownY, P[i * 3 + 1]);
    maxZ = Math.max(maxZ, P[i * 3 + 2]);
    halfW = Math.max(halfW, Math.abs(P[i * 3]));
  }
  // Anchor on the eyeball, which is exact and present in every RPM head. A
  // profile-based chin detector was tried first and latched onto the neck
  // stump, which threw every proportion off by 25mm. In these heads chin-to-eye
  // and eye-to-crown are near equal, so:
  const chinY = eyeY - (crownY - eyeY) * 1.066;

  let earY = chinY, earW = 0;
  for (let i = 0; i < n; i++) {
    const y = P[i * 3 + 1];
    if (y < chinY + (crownY - chinY) * 0.45) continue;
    if (Math.abs(P[i * 3]) > earW) { earW = Math.abs(P[i * 3]); earY = y; }
  }
  return { chinY, eyeY, crownY, maxZ, halfW, earY, earW, span: crownY - chinY };
}

/** Build the field set for one measured head. */
export function makeFields(A) {
  const Y = (t) => A.chinY + t * A.span;
  const X = (f) => A.halfW * f;
  const Z = (f) => A.maxZ * f;

  // t-fractions, read off the measured male head and reused proportionally
  // Every fraction below was read off the measured male head:
  //   chin 1.604  lips 1.636-1.686  nose base 1.679  nose 1.726  eye 1.722
  //   ear 1.695-1.745  hairline 1.793  crown 1.833   =>  span 0.229
  const T = { jawBottom: -0.020, lipLo: 0.139, lipHi: 0.358,
              noseLo: 0.327, noseHi: 0.533,
              cheek0: 0.148, cheekCap: 0.480,
              mouLo: 0.257, mouHi: 0.336,
              ear0: 0.397, ear1: 0.616, burn1: 0.620,
              hairline: 0.825, skull: 0.559 };

  const cheekLine = (x) => Math.min(Y(T.cheek0) + 0.62 * Math.abs(x), Y(T.cheekCap));

  const noseBlob = (x, y, z) =>
    Math.min(X(0.54) - Math.abs(x), z - Z(0.76), band(y, Y(T.noseLo), Y(T.noseHi)));
  // Tight to the lips only. A wider exclusion left a ring of bare skin around
  // the mouth that read as a scar rather than a shave line.
  const lipBlob = (x, y, z) =>
    Math.min(X(0.30) - Math.abs(x), z - Z(0.86), band(y, Y(T.lipLo + 0.02), Y(T.lipHi - 0.02)));
  /** The ear. Subtracted from every beard — sideburns stop in front of it. */
  const earBlob = (x, y, z) =>
    Math.min(Math.abs(x) - A.earW * 0.82, band(y, Y(T.ear0), Y(T.ear1)), Z(0.42) - z);

  const jawField = (x, y, z, nx, ny, nz) => Math.min(
    cheekLine(x) - y,
    y - Y(T.jawBottom),          // stops at the jaw, not down the neck
    z + Z(0.07),
    nz + 0.50,
  );
  const sideburnField = (x, y, z, nx, ny, nz) => Math.min(
    Math.abs(x) - A.earW * 0.74, Y(T.burn1) - y, y - Y(0.30), z + Z(0.04), nz + 0.65,
  );

  const beardBase = (x, y, z, nx, ny, nz) => Math.min(
    Math.max(jawField(x, y, z, nx, ny, nz), sideburnField(x, y, z, nx, ny, nz)),
    -noseBlob(x, y, z),
    -lipBlob(x, y, z),
    -earBlob(x, y, z),
  );

  const skullField = (x, y, z, nx, ny, nz) => Math.min(
    y - Y(T.skull), ny + 0.55, Math.max(y - Y(T.hairline), Z(0.36) - z),
  );

  return {
    beard_full:      { offset: 0.0062, feather: 0.014, field: beardBase },
    beard_short:     { offset: 0.0026, feather: 0.012, field: beardBase },
    beard_goatee:    { offset: 0.0070, feather: 0.012,
                       field: (x, y, z, nx, ny, nz) => Math.min(
                         beardBase(x, y, z, nx, ny, nz), X(0.56) - Math.abs(x), z - Z(0.20)) },
    // The strip of skin between the lip line and the base of the nose. An
    // earlier version subtracted noseBlob, which fully contained this band and
    // deleted the whole moustache.
    beard_moustache: { offset: 0.0050, feather: 0.006,
                       field: (x, y, z, nx, ny, nz) => Math.min(
                         X(0.46) - Math.abs(x),
                         band(y, Y(T.mouLo), Y(T.mouHi)),
                         z - Z(0.74), nz + 0.20) },
    beard_chinstrap: { offset: 0.0046, feather: 0.010,
                       field: (x, y, z, nx, ny, nz) => Math.min(
                         beardBase(x, y, z, nx, ny, nz),
                         // A strap follows the jaw edge and crosses the chin.
                         // Both terms are even in x, so the result is symmetric;
                         // the first version unioned a signed term and came out
                         // covering one whole cheek.
                         Math.max(Math.abs(x) - X(0.40), Y(0.10) - y),
                         Y(0.34) - y) },

    hair_buzz: { offset: 0.0042, feather: 0.010, field: skullField },
    hair_crop: { offset: 0.0140, feather: 0.014, field: skullField },
    hair_afro: { offset: 0.0380, feather: 0.020,
                 field: (x, y, z, nx, ny, nz) => Math.min(
                   y - Y(T.skull - 0.04), ny + 0.72,
                   Z(0.36) - z + (y - Y(T.hairline - 0.14)) * 2) },
  };
}

/** Torso parts come off the outfit mesh, which needs no head anatomy. */
export const TORSO = {
  jacket: { from: 'Wolf3D_Outfit_Top', offset: 0.0135, feather: 0.010, material: 'jacket',
            field: (x, y, z) => Math.min(y - 1.055,
              -Math.min(0.024 - Math.abs(x), z - 0.045, band(y, 1.10, 1.50))) },
  tshirt: { from: 'Wolf3D_Outfit_Top', offset: 0.0060, feather: 0.008, material: 'tshirt',
            field: (x, y, z) => Math.min(y - 1.075, 0.215 - Math.abs(x)) },
  vest:   { from: 'Wolf3D_Outfit_Top', offset: 0.0095, feather: 0.008, material: 'vest',
            field: (x, y, z) => Math.min(y - 1.075, 0.155 - Math.abs(x)) },
};

const HEAD_MATERIAL = { beard_full: 'beard', beard_short: 'beard', beard_goatee: 'beard',
  beard_moustache: 'beard', beard_chinstrap: 'beard',
  hair_buzz: 'hair_shell', hair_crop: 'hair_shell', hair_afro: 'hair_shell' };

/** New materials for the generated parts. Colour is a runtime lever, not baked. */
const MATERIALS = {
  beard:      { base: [0.048, 0.040, 0.036, 1], rough: 0.62, metal: 0 },
  hair_shell: { base: [0.052, 0.045, 0.041, 1], rough: 0.58, metal: 0 },
  jacket:     { base: [0.108, 0.122, 0.150, 1], rough: 0.68, metal: 0 },
  tshirt:     { base: [0.720, 0.725, 0.730, 1], rough: 0.90, metal: 0 },
  vest:       { base: [0.230, 0.200, 0.160, 1], rough: 0.82, metal: 0 },
};

/**
 * Extract the masked region of `srcMesh`, pushed `offset` along its normals,
 * as a new mesh sharing the source's skin.
 */
function derive(doc, srcMesh, spec, name) {
  const buffer = doc.getRoot().listBuffers()[0];
  const prim = srcMesh.listPrimitives()[0];
  const P = prim.getAttribute('POSITION').getArray();
  const N = prim.getAttribute('NORMAL').getArray();
  const UV = prim.getAttribute('TEXCOORD_0').getArray();
  const J = prim.getAttribute('JOINTS_0').getArray();
  const W = prim.getAttribute('WEIGHTS_0').getArray();
  const idx = prim.getIndices().getArray();
  const nv = P.length / 3;

  const mask = new Uint8Array(nv);
  const push = new Float32Array(nv);          // per-vertex offset, faded at the edge
  const feather = spec.feather ?? 0.010;
  for (let i = 0; i < nv; i++) {
    const f = spec.field(P[i * 3], P[i * 3 + 1], P[i * 3 + 2],
                         N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
    if (f <= 0) continue;
    mask[i] = 1;
    push[i] = spec.offset * smooth(f / feather);
  }

  // A triangle survives only if all three corners do, so the shell edge lands
  // on the mask boundary instead of stretching across it.
  const remap = new Int32Array(nv).fill(-1);
  const order = [];
  const tris = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (!(mask[a] && mask[b] && mask[c])) continue;
    for (const v of [a, b, c]) {
      if (remap[v] < 0) { remap[v] = order.length; order.push(v); }
      tris.push(remap[v]);
    }
  }
  if (!tris.length) return null;

  const m = order.length;
  const pos = new Float32Array(m * 3), nrm = new Float32Array(m * 3);
  const uv = new Float32Array(m * 2);
  const jn = new Uint8Array(m * 4), wt = new Float32Array(m * 4);
  for (let k = 0; k < m; k++) {
    const s = order[k];
    for (let c = 0; c < 3; c++) {
      nrm[k * 3 + c] = N[s * 3 + c];
      pos[k * 3 + c] = P[s * 3 + c] + N[s * 3 + c] * push[s];
    }
    uv[k * 2] = UV[s * 2]; uv[k * 2 + 1] = UV[s * 2 + 1];
    for (let c = 0; c < 4; c++) { jn[k * 4 + c] = J[s * 4 + c]; wt[k * 4 + c] = W[s * 4 + c]; }
  }

  const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const out = doc.createPrimitive()
    .setIndices(acc('SCALAR', m > 65535 ? new Uint32Array(tris) : new Uint16Array(tris)))
    .setAttribute('POSITION', acc('VEC3', pos))
    .setAttribute('NORMAL', acc('VEC3', nrm))
    .setAttribute('TEXCOORD_0', acc('VEC2', uv))
    .setAttribute('JOINTS_0', acc('VEC4', jn))
    .setAttribute('WEIGHTS_0', acc('VEC4', wt));

  // Inherit every blendshape so the part deforms with the face it sits on.
  const srcTargets = prim.listTargets();
  for (const st of srcTargets) {
    const sp = st.getAttribute('POSITION');
    if (!sp) { out.addTarget(doc.createPrimitiveTarget()); continue; }
    const sa = sp.getArray();
    const d = new Float32Array(m * 3);
    for (let k = 0; k < m; k++) {
      const s = order[k];
      for (let c = 0; c < 3; c++) d[k * 3 + c] = sa[s * 3 + c];
    }
    out.addTarget(doc.createPrimitiveTarget().setAttribute('POSITION', acc('VEC3', d)));
  }

  const md = MATERIALS[spec.material];
  out.setMaterial(doc.createMaterial(spec.material)
    .setBaseColorFactor(md.base).setRoughnessFactor(md.rough).setMetallicFactor(md.metal)
    .setDoubleSided(true));

  const mesh = doc.createMesh(name).addPrimitive(out);
  if (srcTargets.length) mesh.setExtras({ targetNames: SHAPES.slice(0, srcTargets.length) });
  return mesh;
}

/**
 * Build one GLB holding the base avatar plus every generated part, all bound to
 * the one skeleton. Parts are separate meshes on separate nodes, so the runtime
 * picks a look by toggling visibility — no rebinding, no second skeleton.
 */
export async function buildWardrobe(srcPath, outPath, { only } = {}) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(srcPath);
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const scene = root.listScenes()[0];

  const headMesh = root.listMeshes().find((m) => m.getName() === 'Wolf3D_Head');
  if (!headMesh) throw new Error('no Wolf3D_Head in ' + srcPath);
  const hp = headMesh.listPrimitives()[0];
  // eye height from the eyeball mesh's own bounds
  const eye = root.listMeshes().find((m) => m.getName() === 'EyeLeft');
  if (!eye) throw new Error('no EyeLeft in ' + srcPath);
  const ep = eye.listPrimitives()[0].getAttribute('POSITION').getArray();
  let elo = 9, ehi = -9;
  for (let i = 1; i < ep.length; i += 3) { elo = Math.min(elo, ep[i]); ehi = Math.max(ehi, ep[i]); }
  const anat = measure(hp.getAttribute('POSITION').getArray(), (elo + ehi) / 2);

  const specs = {};
  for (const [name, f] of Object.entries(makeFields(anat)))
    specs[name] = { ...f, from: 'Wolf3D_Head', material: HEAD_MATERIAL[name] };
  Object.assign(specs, TORSO);

  const srcNode = root.listNodes().find((n) => n.getMesh() && n.getSkin());
  const parent = root.listNodes().find((n) => n.listChildren().includes(srcNode)) || null;

  const made = [];
  for (const [name, spec] of Object.entries(specs)) {
    if (only && !only.includes(name)) continue;
    const src = root.listMeshes().find((m) => m.getName() === spec.from);
    if (!src) { made.push({ name, ok: false, why: 'no source mesh ' + spec.from }); continue; }
    const mesh = derive(doc, src, spec, name);
    if (!mesh) { made.push({ name, ok: false, why: 'mask selected no triangles' }); continue; }
    const node = doc.createNode(name).setMesh(mesh).setSkin(skin);
    (parent || scene).addChild(node);
    made.push({ name, ok: true,
      tris: mesh.listPrimitives()[0].getIndices().getCount() / 3,
      verts: mesh.listPrimitives()[0].getAttribute('POSITION').getCount() });
  }

  await io.write(outPath, doc);
  return { anat, made };
}
