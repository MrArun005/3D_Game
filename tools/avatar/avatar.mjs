/**
 * A customiser for an RPM-schema avatar: one SkinnedMesh per swappable slot,
 * all sharing a single 67-joint skeleton, a small per-character face albedo and
 * a large shared body normal map.
 *
 * This drives *copies* of the source GLBs. Nothing here writes back to them.
 *
 * The levers that actually exist in this data, and the ones that do not:
 *   - skin tone      -> real. The body albedo is a single pixel and the face
 *                       albedo is 512px, so recolouring is cheap and exact.
 *   - hair / eye /
 *     outfit colour  -> real, via a material tint or a small canvas repaint.
 *   - expression     -> real. 63 ARKit + viseme blendshapes.
 *   - face structure -> approximate only. There is no nose-width or cheekbone
 *                       morph in this rig; the closest available is holding an
 *                       expression shape at a constant value, plus scaling the
 *                       Head/Neck bones. Labelled as approximate everywhere.
 *   - body build     -> bone scale only. There are no body morphs.
 */
import * as THREE from 'three';
import { SHAPES } from './shapes.mjs';

/** mesh name in the GLB -> the slot we expose */
const SLOTS = {
  Wolf3D_Head: 'head',
  Wolf3D_Body: 'body',
  Wolf3D_Hair: 'hair',
  Wolf3D_Teeth: 'teeth',
  Wolf3D_Glasses: 'glasses',
  Wolf3D_Outfit_Top: 'top',
  Wolf3D_Outfit_Bottom: 'bottom',
  Wolf3D_Outfit_Footwear: 'footwear',
  EyeLeft: 'eyeL',
  EyeRight: 'eyeR',
};

/**
 * Generated wardrobe parts live in the same GLB on the same skeleton. They are
 * hidden on load: a wardrobe is a menu, not a costume that is already on.
 */
export const PARTS = {
  beard: ['beard_short', 'beard_full', 'beard_goatee', 'beard_moustache', 'beard_chinstrap'],
  hair:  ['hair_buzz', 'hair_crop', 'hair_afro'],
  torso: ['jacket', 'tshirt', 'vest'],
};
const ALL_PARTS = Object.values(PARTS).flat();

const srgb = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

/** Draw a texture's image into a 2D canvas so its pixels can be read. */
function toCanvas(tex) {
  const img = tex.image;
  const w = img.width, h = img.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas: c, ctx, w, h };
}

/** A CanvasTexture that matches how GLTFLoader set up the texture it replaces. */
function canvasTexture(canvas, like) {
  const t = new THREE.CanvasTexture(canvas);
  t.flipY = false;                       // glTF convention; CanvasTexture defaults true
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = like.wrapS; t.wrapT = like.wrapT;
  t.magFilter = like.magFilter; t.minFilter = like.minFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/**
 * Mean colour of the brightest pixels. Using the plain mean would be dragged
 * down by the eyes, brows and lash line painted into the same 512px sheet; the
 * bright tail is the bare skin, which is what a skin-tone slider should target.
 */
function highlightMean(data, pct = 0.70) {
  const n = data.length / 4;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++)
    lum[i] = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
  const sorted = Float32Array.from(lum).sort();
  const cut = sorted[Math.floor(n * pct)];
  let r = 0, g = 0, b = 0, k = 0;
  for (let i = 0; i < n; i++) {
    if (lum[i] < cut) continue;
    r += data[i * 4]; g += data[i * 4 + 1]; b += data[i * 4 + 2]; k++;
  }
  return k ? [r / k, g / k, b / k] : [180, 150, 130];
}

export class Avatar {
  /** @param {THREE.Object3D} root the loaded gltf.scene (a copy) */
  constructor(root) {
    this.root = root;
    this.slots = {};
    this.morphMeshes = [];
    this.bones = {};
    this._origin = new Map();   // material -> untouched source pixels

    root.traverse((n) => {
      if (n.isBone) this.bones[n.name] = n;
      if (!n.isMesh) return;
      const slot = SLOTS[n.name] ?? (ALL_PARTS.includes(n.name) ? n.name : null);
      // clone so two avatars in one scene do not share a tint
      n.material = n.material.clone();
      n.castShadow = true; n.receiveShadow = true;
      n.frustumCulled = false;
      if (slot) this.slots[slot] = n;
      if (ALL_PARTS.includes(n.name)) n.visible = false;   // wardrobe starts empty
      if (n.morphTargetInfluences?.length) this.morphMeshes.push(n);
    });

    this.rest = {};
    for (const [name, b] of Object.entries(this.bones)) this.rest[name] = b.scale.clone();
  }

  // ---------------------------------------------------------------- slots

  /** Show or hide a slot. Hiding `hair` is how "bald" works; there is no bald mesh. */
  show(slot, on) { const m = this.slots[slot]; if (m) m.visible = on; return this; }
  has(slot) { return !!this.slots[slot]; }
  listSlots() { return Object.keys(this.slots); }

  /**
   * Wear one part from a group, or nothing. Exclusive within the group, because
   * two beards at once is not a look.
   */
  wear(group, part) {
    for (const p of PARTS[group] ?? []) if (this.slots[p]) this.slots[p].visible = false;
    if (group === 'hair') this.show('hair', part === 'styled');       // the authored hair mesh
    if (part && part !== 'none' && part !== 'styled' && this.slots[part]) this.slots[part].visible = true;
    return this;
  }

  /** Colour a generated part (beard, derived hair, jacket). */
  tint(part, hex, { roughness } = {}) {
    const m = this.slots[part]?.material;
    if (!m) return this;
    m.color.copy(srgb(hex));
    if (roughness !== undefined) m.roughness = roughness;
    m.needsUpdate = true;
    return this;
  }

  /** Beard colour is normally hair colour; keep them in step by default. */
  setBeard(hex) { for (const p of PARTS.beard) this.tint(p, hex); return this; }

  listParts() { return ALL_PARTS.filter((p) => this.slots[p]); }

  // ---------------------------------------------------------------- colour

  /**
   * Skin tone. The body albedo is 1x1, so it is replaced outright; the face
   * albedo is repainted through a per-channel gain that lands its bright tail
   * on the target, which keeps the painted brows, lashes and lips intact.
   */
  setSkin(hex) {
    const target = srgb(hex);
    const body = this.slots.body;
    if (body) {
      const px = new Uint8Array([
        Math.round(target.r * 255), Math.round(target.g * 255), Math.round(target.b * 255), 255]);
      const t = new THREE.DataTexture(px, 1, 1, THREE.RGBAFormat);
      t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
      body.material.map?.dispose?.();
      body.material.map = t;
      body.material.needsUpdate = true;
    }
    const head = this.slots.head;
    if (head?.material.map) {
      const mat = head.material;
      if (!this._origin.has(mat)) {
        const { ctx, w, h } = toCanvas(mat.map);
        this._origin.set(mat, { data: ctx.getImageData(0, 0, w, h), w, h, tex: mat.map });
      }
      const src = this._origin.get(mat);
      const base = highlightMean(src.data.data);
      const gain = [
        (target.r * 255) / Math.max(1, base[0]),
        (target.g * 255) / Math.max(1, base[1]),
        (target.b * 255) / Math.max(1, base[2]),
      ];
      const c = document.createElement('canvas');
      c.width = src.w; c.height = src.h;
      const cctx = c.getContext('2d', { willReadFrequently: true });
      const out = cctx.createImageData(src.w, src.h);
      const s = src.data.data, d = out.data;
      for (let i = 0; i < s.length; i += 4) {
        d[i]     = Math.min(255, s[i]     * gain[0]);
        d[i + 1] = Math.min(255, s[i + 1] * gain[1]);
        d[i + 2] = Math.min(255, s[i + 2] * gain[2]);
        d[i + 3] = s[i + 3];
      }
      cctx.putImageData(out, 0, 0);
      if (mat.map !== src.tex) mat.map.dispose();
      mat.map = canvasTexture(c, src.tex);
      mat.needsUpdate = true;
    }
    return this;
  }

  /** Hair colour. `hair_color` is a near-flat 256px sheet, so a tint is enough. */
  setHair(hex, { roughness } = {}) {
    const m = this.slots.hair?.material;
    if (!m) return this;
    m.color.copy(srgb(hex));
    if (roughness !== undefined) m.roughness = roughness;
    m.needsUpdate = true;
    return this;
  }

  /**
   * Eye colour. The sheet holds both sclera and iris, so the repaint is
   * weighted by saturation: the white of the eye is desaturated and stays put,
   * the iris is not and moves to the target.
   */
  setEye(hex) {
    const m = this.slots.eyeL?.material;
    if (!m?.map) return this;
    if (!this._origin.has(m)) {
      const { ctx, w, h } = toCanvas(m.map);
      this._origin.set(m, { data: ctx.getImageData(0, 0, w, h), w, h, tex: m.map });
    }
    const src = this._origin.get(m);
    const target = srgb(hex);
    const c = document.createElement('canvas');
    c.width = src.w; c.height = src.h;
    const cctx = c.getContext('2d', { willReadFrequently: true });
    const out = cctx.createImageData(src.w, src.h);
    const s = src.data.data, d = out.data;
    for (let i = 0; i < s.length; i += 4) {
      const r = s[i], g = s[i + 1], b = s[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      const w = Math.min(1, sat * 2.2);              // iris weight
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      d[i]     = r * (1 - w) + target.r * 255 * lum * 1.35 * w;
      d[i + 1] = g * (1 - w) + target.g * 255 * lum * 1.35 * w;
      d[i + 2] = b * (1 - w) + target.b * 255 * lum * 1.35 * w;
      d[i + 3] = s[i + 3];
    }
    cctx.putImageData(out, 0, 0);
    const tex = canvasTexture(c, src.tex);
    for (const k of ['eyeL', 'eyeR']) {
      const mm = this.slots[k]?.material;
      if (mm) { mm.map = tex; mm.needsUpdate = true; }
    }
    return this;
  }

  /** Tint a clothing slot. The albedo keeps its weave and print; this shifts it. */
  setOutfit(slot, hex) {
    const m = this.slots[slot]?.material;
    if (!m) return this;
    m.color.copy(srgb(hex));
    m.needsUpdate = true;
    return this;
  }

  // ---------------------------------------------------------------- shapes

  /**
   * Set one blendshape by name across every mesh that carries it. The female
   * copy ships no `extras.targetNames`, so three.js builds no
   * morphTargetDictionary for it and the canonical order is the only way in.
   */
  setShape(name, v) {
    const fallback = SHAPES.indexOf(name);
    for (const mesh of this.morphMeshes) {
      const i = mesh.morphTargetDictionary?.[name] ?? fallback;
      if (i >= 0 && i < mesh.morphTargetInfluences.length) mesh.morphTargetInfluences[i] = v;
    }
    return this;
  }

  getShape(name) {
    const mesh = this.morphMeshes[0];
    if (!mesh) return 0;
    const i = mesh.morphTargetDictionary?.[name] ?? SHAPES.indexOf(name);
    return i >= 0 ? mesh.morphTargetInfluences[i] : 0;
  }

  setShapes(obj) { for (const [k, v] of Object.entries(obj)) this.setShape(k, v); return this; }
  clearShapes() { for (const m of this.morphMeshes) m.morphTargetInfluences.fill(0); return this; }

  // ---------------------------------------------------------------- build

  /**
   * Bone scale. This is the only body-proportion lever in the data — there are
   * no body morphs. Scaling a parent bone scales its whole chain, so `height`
   * goes on Hips and the limb entries are applied to the top of each chain.
   */
  setBuild({ height = 1, head = 1, neck = 1, shoulders = 1, arms = 1, legs = 1, chest = 1 } = {}) {
    const put = (name, s) => {
      const b = this.bones[name]; if (!b) return;
      b.scale.copy(this.rest[name]).multiplyScalar(1).multiply(new THREE.Vector3(s, s, s));
    };
    put('Hips', height);
    put('Head', head);
    put('Neck', neck);
    put('Spine2', chest);
    for (const s of ['Left', 'Right']) {
      put(s + 'Shoulder', shoulders);
      put(s + 'Arm', arms);
      put(s + 'UpLeg', legs);
    }
    return this;
  }

  /** Feet on y=0, and report the height so a caller can place a camera. */
  groundAndMeasure() {
    this.root.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(this.root);
    this.root.position.y -= bb.min.y;
    this.root.updateMatrixWorld(true);
    return bb.max.y - bb.min.y;
  }

  triangles() {
    let t = 0;
    this.root.traverse((n) => {
      if (!n.isMesh || !n.visible) return;
      const ix = n.geometry.index;
      t += (ix ? ix.count : n.geometry.attributes.position.count) / 3;
    });
    return t | 0;
  }
}
