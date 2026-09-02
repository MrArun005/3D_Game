import * as THREE from 'three';
import { CSMShadowNode } from 'three/examples/jsm/csm/CSMShadowNode.js';

export const FOG_COLOUR = 0x222a3a;
export const FOG_DAY = 0xb7c9dd;
/** Where the day sun is. The sky dome paints its disc from this same vector. */
export const DAY_SUN = new THREE.Vector3(-190, 250, 120);
/* ?dusk: the same day rig with the sun 12 degrees up. Long shadows, orange
   key, cool fill, warm haze -- the third look after noon and night. The dome
   paints its disc from DAY_SUN, so lowering it here moves the sun in the sky
   and the shadows on the ground together. */
export const DUSK = typeof location !== 'undefined' && new URLSearchParams(location.search).has('dusk');
if (DUSK) DAY_SUN.set(-190, 52, 120);
/** Layer bit the far shadow cascade renders. Building shells enable it; nothing else does. */
export const SHADOW_FAR_LAYER = 3;

/**
 * CSMShadowNode with two additions it does not offer as options:
 * - every cascade but the first renders SHADOW_FAR_LAYER only (building
 *   shells), the layer gate Phase 0 measured -- a far map with everything
 *   casting was 1.36M triangles, with shells only ~5k;
 * - the cascade splits follow the camera. CSM fits its slices to the
 *   camera's fov/aspect/near/far once at init; photo mode zooms the fov and
 *   the window resizes, so we re-fit whenever those change.
 * Both hook methods three's own subclasses hook (_init, updateBefore).
 */
class GatedCSM extends CSMShadowNode {
  _init(builder) {
    super._init(builder);
    for (let i = 1; i < this.lights.length; i++) this.lights[i].shadow.camera.layers.set(SHADOW_FAR_LAYER);
    this._fit = '';
  }
  updateBefore(builder) {
    const c = this.camera;
    if (c) {
      const fit = `${c.fov}|${c.aspect}|${c.near}|${c.far}`;
      if (fit !== this._fit) { this._fit = fit; this.updateFrustums(); }
    }
    super.updateBefore(builder);
  }
}

export function createRenderer(canvas) {
  /* WebGPURenderer, from the three/webgpu build the vite alias points at.
     It picks a WebGPU device where one exists and a WebGL2 backend where one
     does not, so this is not a hardware requirement -- it is the node-based
     material system, which is what Tier 1's post stack needs. */
  const renderer = new THREE.WebGPURenderer({
    canvas, antialias: true, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(1.0);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  /* PCF, and it is not a choice.
     The original comment here said PCFSoft was deprecated. I decided that was
     invented, swapped in PCFSoftShadowMap, and claimed softer shadows. The
     browser disagrees, out loud, on every load:
       THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated.
       Using PCFShadowMap instead.
     So the constant is still exported, but setting it changes nothing except
     adding a warning to the console. Softer contact shadows are real work --
     the cascaded shadow map in docs/ROADMAP Tier 1.2 -- not a one-line enum. */
  renderer.shadowMap.type = THREE.PCFShadowMap;
  patchNestedRenderInBundle(renderer);
  return renderer;
}

/**
 * three r185: a nested render inside a bundle recording truncates the bundle.
 *
 * Bundles are rendered before the plain render lists, so the first lit object
 * of the frame is usually inside a bundle being recorded. Its
 * nodes.updateBefore() lazily renders the shadow maps -- a nested
 * renderer.render(scene, shadowCamera) -- and _renderBundle() ends every
 * (nested) bundle with `this._currentRenderBundle = null`, which the outer
 * recording never gets back. Every object after it is drawn directly (so the
 * frame looks right) but is not recorded: measured 2026-09-02, the spawn
 * chunk's render list had 81 objects and its recording 1, while the three
 * shadow-cascade recordings (no nesting) held 44/12/12. On replay the 80
 * missing objects vanish -- the tower next to the spawn disappeared and the
 * scene changed by 21% of pixels after a forced re-record.
 * Saving and restoring the pointer around render() makes nested renders
 * transparent to the recording. Private field, so guarded.
 */
function patchNestedRenderInBundle(renderer) {
  if (!('_currentRenderBundle' in renderer) || renderer.__bundleSafe) return;
  const render = renderer.render;
  renderer.render = function (...args) {
    const outer = this._currentRenderBundle;
    this._currentRenderBundle = null;           // the nested pass records its own bundles, not ours
    try { return render.apply(this, args); } finally { this._currentRenderBundle = outer; }
  };
  renderer.__bundleSafe = true;
}

/**
 * Resolution is the single biggest cost in this scene: at DPR 2 on a Retina
 * panel we are shading 6.7 megapixels and the M2 drops to 37fps; at 1.25 the
 * exact same frame locks 60. So we do not pick a fixed ratio -- we watch the
 * frame time and let the panel earn its pixels back.
 */
export function autoResolution(renderer) {
  return () => {};
}

/**
 * Midday. One hard sun with a wide shadow frustum, a bright sky/ground
 * hemisphere for the ambient, and no warm fill -- daylight bounce is neutral
 * and adding a coloured fill is what makes a "day" scene look like a lit set.
 */
function createDayLights(scene) {
  /* Less fill, more sun. At 1.05 the hemisphere lit every face the same and
     the 2.6 sun never produced light-and-shade -- a facade turned away from
     the sun was the same tone as one facing it, which is most of why day read
     as milky. Ambient is now the sky's job at 0.55; the sun carries the form. */
  const hemi = new THREE.HemisphereLight(DUSK ? 0x6f7fa8 : 0xa9c4e0, DUSK ? 0x5c4a3c : 0x8f8873, DUSK ? 0.42 : 0.55);
  scene.add(hemi);

  /* One sun, three real cascades.
     The previous rig was two directional lights, "a poor man's cascade": a
     3.4 sun with an 80m shadow box and a 0-intensity twin with a 460m box,
     "shadows only". A shadow multiplies its own light's contribution, and
     this one's was zero -- so the far map never darkened a single pixel in
     the life of the project (verified 2026-09-02: splitting the intensity
     1.7/1.7 made the Kingsway tower's shadow appear on the grass; at 3.4/0
     it was not there). Every triangle drawn into it was waste.

     CSMShadowNode is three's cascaded shadow map for the WebGPU renderer:
     one light, N slices of the view frustum, each with its own 2048 map
     fitted to that slice, so shadow density falls off with distance instead
     of stepping between two boxes. Cascade 0 (the street you are in) and 1
     take every caster; the far cascade takes SHADOW_FAR_LAYER only -- the
     building shells -- because at its texel size nothing smaller resolves. */
  const sun = new THREE.DirectionalLight(DUSK ? 0xffa25a : 0xffeac6, DUSK ? 2.8 : 3.4);
  sun.position.copy(DAY_SUN);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.0003;      // CSM multiplies bias by (cascade + 1)
  sun.shadow.normalBias = 0.03;
  /* Splits measured 2026-09-02 at kingsway-corner (draws / Mtris):
       practical 89/199/520, cascade 1 all casters   1327 / 4.66
       practical 89/199/520, cascade 1 shells only   1054 / 3.39
       custom    52/156/520, cascade 1 shells only   1017 / 3.32  <- this
       custom    52/156/520, cascade 1 all casters   1259 / 4.57
     The gated two-light rig it replaces was 939 / 3.31 with no working far
     shadow at all, so real tower shadows cost one extra pass and ~10k
     triangles. Cascade 0 carries every caster to 52m; beyond that only the
     shells, whose shadows are the only ones that still resolve. */
  const csm = new GatedCSM(sun, { cascades: 3, maxFar: 520, mode: 'custom', lightMargin: 300 });
  csm.customSplitsCallback = (n, near, far, target) => { target.push(0.1, 0.3, 1); };
  csm.fade = true;
  sun.shadow.shadowNode = csm;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(0xd8e6f5, 0.22);
  fill.position.set(180, 80, -160);
  scene.add(fill);
  return { hemi, sun, csm, fill };
}

export function createScene(day = false) {
  const scene = new THREE.Scene();
  // clear daylight sees a long way; a 4.2km city is worth showing off
  scene.fog = day ? new THREE.FogExp2(DUSK ? 0xc9a48a : FOG_DAY, DUSK ? 0.00024 : 0.00017)   // aerial perspective: depth, not murk
                  : new THREE.FogExp2(FOG_COLOUR, 0.0034);
  return scene;
}

/**
 * Two directional lights and a hemisphere. No per-lamp lights anywhere in the
 * city: the street lighting is painted into the facade emissive maps and faked
 * with additive pools, which is why this scene can afford hundreds of buildings.
 */
export function createLights(scene, day = false) {
  if (day) return createDayLights(scene);
  // the ground half is warm on purpose: sodium bouncing off wet tarmac is what
  // separates a lit street from a scene that merely has lamps in it
  const hemi = new THREE.HemisphereLight(0x55699c, 0x33241a, 0.98);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffab5e, 0.72);
  sun.position.set(-260, 42, 150);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 220;
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.bias = -0.002;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(0x5d78ad, 0.30);
  fill.position.set(210, 90, -140);
  scene.add(fill);

  return { hemi, sun, fill };
}
