import * as THREE from 'three';
import { CSMShadowNode } from 'three/examples/jsm/csm/CSMShadowNode.js';

/* The dome's own colour ~10 degrees above the horizon (textures.js SKY_DAY at
   v=0.55). It was 0xb7c9dd, paler than the sky behind the mountains, which is
   why the range read brighter than the sky (2026-09-08). clock.js sets the
   same value each frame; keep the two together. */
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
      const px = Math.round(this.light.position.x * 0.1);
      const py = Math.round(this.light.position.y * 0.1);
      const pz = Math.round(this.light.position.z * 0.1);
      const fit = `${c.fov}|${c.aspect}|${c.near}|${c.far}|${px}|${py}|${pz}`;
      if (fit !== this._fit) { this._fit = fit; this.updateFrustums(); }
    }
    super.updateBefore(builder);
  }
}

/** Pixel ratio that caps the drawing buffer at the budget (1.0 when the window is already smaller). */
export const RENDER_BUDGET_PX = 1440 * 860;        // ~1.24 MP (Full mode)
export const RENDER_BUDGET_PX_LITE = 1152 * 680;   // ~0.78 MP (Lite mode, 37% fill-rate savings for integrated GPUs)

/* Escape hatches, in order of precedence:
     ?res=N    draw at N device pixels per CSS pixel. `?res=1` is a 1:1 4K
               frame on a 4K monitor; `?res=2` is 1:1 on a retina panel, which
               is 8.3 MP of shading and roughly seven times the 60 fps budget.
               Anything above the display's own ratio is wasted, so it clamps.
     ?native   1:1 in CSS pixels (the old flag, kept).
   Pair either with ?nodrs, or the adaptive scaler drags you straight back
   down the moment the frame goes over 19.5 ms -- which at 4K it will. */
export function renderScale(w, h, lite = false) {
  if (typeof location === 'undefined') return Math.min(1, Math.sqrt((lite ? RENDER_BUDGET_PX_LITE : RENDER_BUDGET_PX) / Math.max(1, w * h)));
  const q = new URLSearchParams(location.search);
  if (q.has('4k')) {
    // True 4K UHD rendering (3840x2160 internal buffer)
    return Math.max(1, 3840 / Math.max(1, w));
  }
  const res = parseFloat(q.get('res'));
  if (Number.isFinite(res) && res > 0) return Math.min(res, (globalThis.devicePixelRatio || 1) * 2);
  if (q.has('native')) return 1;
  const budget = lite ? RENDER_BUDGET_PX_LITE : RENDER_BUDGET_PX;
  return Math.min(1, Math.sqrt(budget / Math.max(1, w * h)));
}

export function createRenderer(canvas, lite = false) {
  /* WebGPURenderer, from the three/webgpu build the vite alias points at.
     It picks a WebGPU device where one exists and a WebGL2 backend where one
     does not, so this is not a hardware requirement -- it is the node-based
     material system, which is what Tier 1's post stack needs. */
  const renderer = new THREE.WebGPURenderer({
    canvas, antialias: true, powerPreference: 'high-performance',
  });
  /* Render-scale cap (2026-09-11). The 60 fps floor is defined at 1440x860 =
     1.24 MP (or 1152x680 = 0.78 MP in LITE mode on integrated GPUs).
     The drawing buffer is capped at the floor's pixel count (aspect preserved)
     and the canvas CSS stays 100% so the browser upscales -- a 1.33x upscale in a
     moving frame is hard to see, a 2x shading bill is not. Set ONCE here and in the
     resize handler, never per frame: reallocating the buffer rebuilds the whole post
     stack. ?native renders at full window resolution. */
  renderer.setPixelRatio(renderScale(window.innerWidth, window.innerHeight, lite));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  /* Day exposure. Measured 2026-09-08 at kingsway-corner and tower-shadow: dropping
     this to 0.88 darkened the frame (mean 123 -> 115) and bought +1.5pp saturation
     but did NOT add contrast (luminance sd 42.8 -> 41.9). The flat noon image is
     the lit-to-shadow ratio, not the exposure -- that lever is the hemisphere fill
     in createDayLights, and it wants an A/B, not a guess. */
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
 * Dynamic Resolution Scaling (DRS).
 *
 * Resolution is the single biggest fill-rate cost in this scene.
 * autoResolution monitors rolling frame times over a 60-frame window.
 * If median frame time exceeds 19.5 ms (dropping under 50 fps), it gently
 * steps the drawing buffer scale down (floor at 0.50). When frame times stay
 * below 14.2 ms for over 2.5 seconds, it gradually recovers back to baseScale.
 */
export function autoResolution(renderer, grade = null, lite = false) {
  if (typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search);
    if (q.has('native') || q.has('nodrs') || q.has('4k')) {
      return function noop() {};
    }
  }

  const baseScale = renderScale(window.innerWidth, window.innerHeight, lite);
  let currentScale = baseScale;
  let frameCount = 0;
  let sumMs = 0;
  let lastAdjustTime = 0;
  const MIN_SCALE = 0.50;
  /* THE SCALER MUST SETTLE. Down at >19.5 ms and up at <14.2 ms looks like
     hysteresis, but a 6% down-step removes ~12% of the pixels, which drops the
     frame time under the up threshold, which steps back up, which puts it over
     the down threshold again: it hunts forever, once every 2.5 s. Each step
     reallocates every render target and visibly changes sharpness, so on a
     74 s recording that is ~30 resolution pops -- the flicker Arun saw.
     Three things stop it: a window must be bad (or good) TWICE RUNNING before
     the scale moves, the up threshold drops to 13.0 ms so the two bands cannot
     touch, and after three direction reversals the scaler LOCKS -- by then it
     has found the level this machine holds, and further hunting is all cost
     and no benefit. ?nodrs still pins it outright. */
  let badRun = 0, goodRun = 0, reversals = 0, lastDir = 0, locked = false;

  return function updateAutoResolution(dt) {
    frameCount++;
    sumMs += dt * 1000;

    // Sample every 60 frames (~1 second at 60 FPS)
    if (!locked && frameCount >= 60) {
      const avgMs = sumMs / frameCount;
      frameCount = 0;
      sumMs = 0;
      const now = performance.now();

      // Cooldown of at least 2.5 seconds between adjustments to avoid thrashing
      if (lastAdjustTime !== 0 && now - lastAdjustTime < 2500) return;

      // two consecutive windows agree, or nothing moves
      badRun = avgMs > 19.5 ? badRun + 1 : 0;
      goodRun = avgMs < 13.0 ? goodRun + 1 : 0;

      if (badRun >= 2 && currentScale > MIN_SCALE) {
        badRun = 0;
        if (lastDir === 1) reversals++;
        lastDir = -1;
        // Step down by 6%
        currentScale = Math.max(MIN_SCALE, currentScale * 0.94);
        lastAdjustTime = now;
        renderer.setPixelRatio(currentScale);
        renderer.setSize(window.innerWidth, window.innerHeight, false);
        grade?.resize?.(window.innerWidth * currentScale, window.innerHeight * currentScale);
        console.info(`[drs] downscale -> ratio: ${currentScale.toFixed(2)} (avg frame: ${avgMs.toFixed(1)} ms)`);
      } else if (goodRun >= 2 && currentScale < baseScale) {
        goodRun = 0;
        if (lastDir === -1) reversals++;
        lastDir = 1;
        // Step up by 4%
        currentScale = Math.min(baseScale, currentScale * 1.04);
        lastAdjustTime = now;
        renderer.setPixelRatio(currentScale);
        renderer.setSize(window.innerWidth, window.innerHeight, false);
        grade?.resize?.(window.innerWidth * currentScale, window.innerHeight * currentScale);
        console.info(`[drs] upscale -> ratio: ${currentScale.toFixed(2)} (avg frame: ${avgMs.toFixed(1)} ms)`);
      }
      if (reversals >= 3) {
        locked = true;
        console.info(`[drs] settled at ratio ${currentScale.toFixed(2)} after ${reversals} reversals; no further changes`);
      }
    }
  };
}

/**
 * Midday. One hard sun with a wide shadow frustum, a bright sky/ground
 * hemisphere for the ambient, and no warm fill -- daylight bounce is neutral
 * and adding a coloured fill is what makes a "day" scene look like a lit set.
 */
function createDayLights(scene, lite = false) {
  /* Less fill, more sun. At 1.05 the hemisphere lit every face the same and
     the 2.6 sun never produced light-and-shade -- a facade turned away from
     the sun was the same tone as one facing it, which is most of why day read
     as milky. Ambient is now the sky's job at 0.55; the sun carries the form. */
  /* 0.40 and blue (2026-09-08; clock.js rewrites these every frame with the
     same numbers): shade under a clear sky is sky-coloured, and at 0.55 grey
     plus the env map the shaded face of a building was a stop from the lit one. */
  const hemi = new THREE.HemisphereLight(DUSK ? 0x6f7fa8 : 0x8cb3eb, DUSK ? 0x5c4a3c : 0x7a706a, DUSK ? 0.42 : 0.40);
  scene.add(hemi);

  /* Cascaded Shadow Maps:
     In FULL mode: 3 cascades at 2048x2048 (~12.58 MP shadow pass per frame).
     In LITE mode: 2 cascades at 1024x1024 (~2.09 MP shadow pass per frame),
     reducing shadow pass fill-rate by 83.3% for integrated graphics. */
  const sun = new THREE.DirectionalLight(DUSK ? 0xffa25a : 0xffeac6, DUSK ? 2.8 : 3.4);
  sun.position.copy(DAY_SUN);
  sun.castShadow = true;
  const mapSize = lite ? 1024 : 2048;
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = lite ? 600 : 900;
  sun.shadow.bias = -0.0003;      // CSM multiplies bias by (cascade + 1)
  sun.shadow.normalBias = 0.03;

  const csmCascades = lite ? 2 : 3;
  const csmFar = lite ? 320 : 520;
  const csm = new GatedCSM(sun, { cascades: csmCascades, maxFar: csmFar, mode: 'custom', lightMargin: lite ? 200 : 300 });
  csm.customSplitsCallback = (n, near, far, target) => {
    if (lite) {
      target.push(0.18, 1);
    } else {
      target.push(0.1, 0.3, 1);
    }
  };
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
  // Linear fog keeps foreground/midground city (0-380m) 100% crisp and clear with ZERO fog,
  // letting distant horizon and mountains gently blend without washing out urban architecture.
  /* NO FOG. Removed 2026-09-13 at Arun's instruction -- he does not want it
     anywhere in the codebase. Distance is carried by the sky, the grade and the
     mountain palette instead. Nothing may set scene.fog again. */
  return scene;
}

/**
 * Two directional lights and a hemisphere. No per-lamp lights anywhere in the
 * city: the street lighting is painted into the facade emissive maps and faked
 * with additive pools, which is why this scene can afford hundreds of buildings.
 */
export function createLights(scene, day = false, lite = false) {
  if (day) return createDayLights(scene, lite);
  // the ground half is warm on purpose: sodium bouncing off wet tarmac is what
  // separates a lit street from a scene that merely has lamps in it
  const hemi = new THREE.HemisphereLight(0x55699c, 0x33241a, 0.98);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffab5e, 0.72);
  sun.position.set(-260, 42, 150);
  sun.castShadow = true;
  const mapSize = lite ? 1024 : 2048;
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = lite ? 160 : 220;
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
