import * as THREE from 'three';
import {
  Fn, Loop, uv, uniform, vec2, vec3, vec4, float, mix, smoothstep, clamp, fract, sin, dot,
  pass, mrt, output, emissive, normalView, convertToTexture, cameraWorldMatrix,
  max, min, pow, toneMappingExposure,
} from 'three/tsl';
import { ssr } from 'three/examples/jsm/tsl/display/SSRNode.js';
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js';
import { denoise } from 'three/examples/jsm/tsl/display/DenoiseNode.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { smaa } from 'three/examples/jsm/tsl/display/SMAANode.js';
import { interpolateGradeProfile } from '../game/clock.js';

/**
 * Cinematic Grade Presets.
 *
 * Can be triggered via /grade <preset>, photo mode, or cycled with hotkeys.
 * 'DEFAULT' delegates control to the continuous diurnal timecycle in clock.js.
 */
export const GRADE_PRESETS = {
  DEFAULT: {
    name: 'Dynamic Timecycle',
    description: 'Dynamic physical lighting and atmosphere tied to game clock',
  },
  NEON_NOIR: {
    name: 'Neon Noir (Cyberpunk)',
    description: 'Vibrant electric cyan/magenta with deep inky shadows and high contrast',
    sat: 1.38,
    vibrance: 0.25,
    contrast: 0.36,
    split: 0.95,
    shadowTint: [0.88, 0.92, 1.10],   // indigo/cold shadows
    midTint: [0.98, 0.95, 1.02],
    highTint: [1.12, 0.94, 1.08],     // magenta highlights
    slope: [1.02, 1.0, 1.06],
    offset: [-0.015, -0.015, -0.01],
    power: [1.05, 1.05, 1.02],
    bloomStrength: 1.10,
    bloomRadius: 0.58,
    bloomThreshold: 0.80,
    vignette: 0.65,
    grain: 0.032,
    filmic: 1.0,                      // per-channel Hable: the tubes stay magenta and cyan
  },
  VINTAGE_70S: {
    name: 'Vintage 70s (Fuji Film)',
    description: 'Warm nostalgic tones, lifted green-gold shadows, soft organic roll-off',
    sat: 0.92,
    vibrance: -0.10,
    contrast: 0.26,
    split: 0.75,
    shadowTint: [0.94, 1.04, 0.98],   // greenish/warm shadows
    midTint: [1.03, 1.01, 0.97],
    highTint: [1.10, 1.03, 0.92],     // golden highlights
    slope: [1.04, 0.98, 0.92],
    offset: [0.02, 0.03, 0.015],      // lifted film blacks
    power: [0.96, 1.02, 1.06],
    bloomStrength: 0.50,
    bloomRadius: 0.40,
    bloomThreshold: 0.35,
    vignette: 0.55,
    grain: 0.040,
    filmic: 0.0,
  },
  BLACK_WHITE_NOIR: {
    name: 'Classic B&W Noir',
    description: 'High-contrast monochrome with silver-metallic midtones and gritty film grain',
    sat: 0.0,
    vibrance: 0.0,
    contrast: 0.48,
    split: 0.0,
    shadowTint: [1.0, 1.0, 1.0],
    midTint: [1.0, 1.0, 1.0],
    highTint: [1.0, 1.0, 1.0],
    slope: [1.10, 1.10, 1.10],
    offset: [-0.02, -0.02, -0.02],
    power: [1.08, 1.08, 1.08],
    bloomStrength: 0.75,
    bloomRadius: 0.45,
    bloomThreshold: 0.40,
    vignette: 0.70,
    grain: 0.048,
    filmic: 0.0,
  },
  BLEACH_BYPASS: {
    name: 'Bleach Bypass',
    description: 'Aggressive metallic silver retention, crushed darks, muted palette',
    sat: 0.55,
    vibrance: -0.20,
    contrast: 0.44,
    split: 0.65,
    shadowTint: [0.88, 0.95, 1.04],
    midTint: [0.98, 1.0, 1.0],
    highTint: [1.05, 1.02, 0.98],
    slope: [1.12, 1.12, 1.12],
    offset: [-0.03, -0.03, -0.03],
    power: [1.15, 1.15, 1.15],
    bloomStrength: 0.40,
    bloomRadius: 0.30,
    bloomThreshold: 0.30,
    vignette: 0.62,
    grain: 0.035,
    filmic: 0.0,
  },
  GOLDEN_HOUR: {
    name: 'Golden Hour Sunset',
    description: 'Intense warm sunlight flare, violet-blue cast in shadowed streets',
    sat: 1.22,
    vibrance: 0.18,
    contrast: 0.34,
    split: 0.85,
    shadowTint: [0.90, 0.92, 1.08],   // cool violet shadows
    midTint: [1.04, 1.01, 0.97],
    highTint: [1.15, 1.02, 0.88],     // rich golden sun highlights
    slope: [1.05, 1.02, 0.96],
    offset: [-0.005, -0.005, 0.0],
    power: [1.02, 1.02, 1.04],
    bloomStrength: 0.85,
    bloomRadius: 0.50,
    bloomThreshold: 0.30,
    vignette: 0.52,
    grain: 0.022,
    filmic: 0.0,
  },
};

/**
 * The post stack (docs/ROADMAP Tier 1.1) with the colour grade folded in.
 *
 * One RenderPipeline owns the frame:
 *
 *   scene pass (MRT: colour + view normals + emissive)
 *     -> GTAO from depth+normals, bilateral-denoised, multiplied into colour
 *     -> bloom fed by the emissive MRT channel only
 *     -> tone map (AgX by day, mixed toward per-channel Hable at night) + sRGB
 *        (the pipeline's own transform is off)
 *     -> vignette * grain + lens rain, in display space
 *
 * Architecture notes, learned the expensive way (see the parked spike this
 * replaces, core/post.js at ca38713):
 *
 *  - The grade CANNOT stay a second autoClear=false pass drawn after the
 *    pipeline: RenderPipeline.render() owns the frame, and quads composited
 *    afterwards have nothing under them. The vignette/grain/lens were already
 *    TSL functions, so they are now literally part of the output node.
 *  - `outputColorTransform = false` + a manual renderOutput() mid-chain is the
 *    one correct place to tone map. Leaving the default `true` wraps the
 *    output node in a SECOND renderOutput() and double-tone-maps the frame;
 *    omitting renderOutput() entirely ships linear HDR and blows out white.
 *  - Bloom reads the `emissive` MRT target, not the lit frame. The night look
 *    is 100% baked emissive (lit windows, lamp heads, signal lenses), so this
 *    blooms exactly the light sources; and because daylightAssets() dims
 *    facade emissive to 0.04, daylight bloom self-limits to signals and brake
 *    lights with no day/night switch here.
 *  - GTAO rotates its sample pattern over a 6-frame cycle (frameId % 6) by
 *    design — undenoised it strobes at 10 Hz on flat surfaces. The bilateral
 *    denoise pass is not optional until TAA (Tier 1.1 item 2) lands.
 *  - The MRT normal target inherits each material's blending, so the night
 *    rain — 5200 additive point sprites with depthWrite:false — smears its
 *    normals over everything behind it and GTAO turns that into faint dark
 *    speckles at night (sky included: the dome is real geometry at finite
 *    depth). KNOWN, OPEN. The clean fix — GTAO's null-normal path, which
 *    reconstructs normals from depth that rain never writes — renders BLACK
 *    on this stack: getNormalFromDepth() wraps the raw DepthTexture in a
 *    fresh texture() node and that binding reads as zero under WebGPU here.
 *    Next attempt: per-material `mrtNode = mrt({ normal: vec4(0) })` on the
 *    two weather materials, once they are NodeMaterials.
 *  - GTAO renders to a RedFormat target: sample `.r` and splat. Multiplying
 *    the frame by the denoised vec4 tints everything red.
 *  - AgX trades chroma for brightness (measured 2026-09-12, exposure 1.15:
 *    a (2,0,0) tube comes out (0.966, 0.244, 0.169), 100% -> 83% saturation;
 *    a (2.4, 0.3, 0.9) magenta 88% -> 47%). That is the operator doing its
 *    job by day, and the reason the neon never reads as neon at night. The
 *    night profile blends the frame toward `hableToneMap` (Uncharted 2, one
 *    curve per channel, so a zero channel STAYS zero: the same two colours
 *    keep 100% / 63%). `HABLE.BIAS` is solved so both operators put mid-grey
 *    0.18 at the same 0.239, so the blend moves hue retention, not exposure.
 *  - The bloom high-pass thresholds the LUMINANCE OF THE EMISSIVE MRT before
 *    exposure is applied (BloomNode.js:14; exposure lands later, in the tone
 *    map), while the eye judges "bright" after it. So a threshold authored by
 *    eye is a display quantity, and the HDR one that reproduces it is
 *    T_display / exposure -- `bloomThresholdFor()`. The profile numbers were
 *    tuned at night exposure 1.15, so that is the reference: night is bit-
 *    identical to before, day's 0.25 at 1.05 becomes 0.274 (still between
 *    the dimmed 0.04 facades and a 2.2 headlamp lens).
 *
 * `uniform()` nodes carry `.value` exactly like the old uniform objects, so
 * every caller reading `grade.grain.uniforms.uAmount.value` still works.
 */

/** The same hash the GLSL used, so the grain and rain keep their character. */
const hash2 = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));

const _size = new THREE.Vector2();

const BLOOM_STRENGTH = 0.6;

/** Exposure the grade profiles were tuned at (main.js sets 1.15 for a night boot). */
export const NIGHT_EXPOSURE = 1.15;

/** Bloom high-pass threshold in HDR emissive units for a threshold authored at
 *  `ref` exposure: the same emissive reads the same brightness on screen at any
 *  exposure, so the same sources bloom (see header). */
export function bloomThresholdFor(threshold, exposure, ref = NIGHT_EXPOSURE) {
  return threshold * ref / exposure;
}

/**
 * The high-pass KNEE (BloomNode's `smoothWidth`), in the same HDR units.
 *
 * BloomNode's filter is `mix(0, texel, smoothstep(T, T + w, luminance))` and
 * `w` defaults to 0.01 -- a cliff, and it passes the WHOLE texel, not the
 * excess over T. So at night (T = 0.85) a lit facade window at luminance ~1.0
 * dumps 100% of a large area into the blur and the whole window glows, which
 * is exactly the "lifeless haze" the brief rules out; the sign's letters at
 * ~2.0 pass the same 100%, and area does the rest.
 *
 * A knee of 0.65 x T keeps every genuine hot core at full weight and all but
 * removes the large dim ones (night, T = 0.85, band 0.85 -> 1.40):
 *
 *   facade window / window quad  0.79-1.00  ->  0-19%   (was 100%)
 *   Tokyo lit window     1.35 x 0.55 = 0.74 ->  0%      (unchanged: under T)
 *   sign ink       2.46 x 0.8  = ~2.0       ->  100%
 *   lamp head glow             ~2.15        ->  100%
 *   Tokyo neon     1.35 x 1.4  = 1.89       ->  100%
 *   headlamp lens               4.8         ->  100%
 *
 * It is strictly a tightening: nothing blooms that did not before. The soft
 * edge also stops a source sitting on T from strobing in and out of the blur.
 */
export const BLOOM_KNEE = 0.65;
export function bloomKnee(hdrThreshold) { return Math.max(0.01, hdrThreshold * BLOOM_KNEE); }

/* Hable / Uncharted 2 filmic curve. One function serves the shader and the
   tests: with a number it does arithmetic, with a TSL node it builds nodes,
   so the maths is written once. Constants are Hable's GDC 2010 set; BIAS is
   solved so hable(0.18 * 1.15) == agx(0.18 * 1.15) == 0.239 (scratch script,
   2026-09-12), i.e. the night blend does not change the exposure of the frame. */
export const HABLE = { A: 0.15, B: 0.50, C: 0.10, D: 0.20, E: 0.02, F: 0.30, W: 11.2, BIAS: 3.57 };
export function hableCurve(x) {
  const { A, B, C, D, E, F } = HABLE;
  if (typeof x === 'number') return (x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F) - E / F;
  return x.mul(x.mul(A).add(C * B)).add(D * E).div(x.mul(x.mul(A).add(B)).add(D * F)).sub(E / F);
}
/** JS twin of `hableToneMapNode`: linear rgb array in, display-linear array out. */
export function hableToneMap(rgb, exposure) {
  const white = hableCurve(HABLE.W);
  return rgb.map((x) => Math.min(1, Math.max(0, hableCurve(x * exposure * HABLE.BIAS) / white)));
}
const hableToneMapNode = Fn(([color, exposure]) =>
  hableCurve(color.mul(exposure).mul(HABLE.BIAS)).div(hableCurve(HABLE.W)).clamp());

export function createGrade(renderer, scene, camera, {
  ao: withAO = true, bloom: withBloom = true, aa: withAA = true, post: withPost = true, blur: withBlur = true,
  ssr: withSSR = false,
} = {}) {
  /* ?nopost: no pipeline, no MRT, no grade — the pre-Tier-1.1 render path.
     An A/B lever and an escape hatch: the MRT pass does make every scene
     material compile a heavier 3-target variant, but the one time cold loads
     were seen at ~2 minutes, ?nopost measured just as slow — the machine was
     saturated, not the shader count. Measure on a quiet box before blaming
     either. */
  if (!withPost) {
    return {
      vignette: { uniforms: { uStrength: { value: 0 } } },
      grain: { uniforms: { uTime: { value: 0 }, uAmount: { value: 0 } } },
      lens: { uniforms: { uTime: { value: 0 }, uAmt: { value: 0 } } },
      gtao: null, bloomNode: null, post: null, bloom: false,
      setBloom() {}, setDrops() {}, setHurt() {}, setSpeed() {}, setWet() {},
      setNight() {}, setGradeProfile() {}, setPreset() { return 'DEFAULT'; }, cyclePreset() { return 'DEFAULT'; },
      currentPreset: 'DEFAULT', presetDetails: GRADE_PRESETS.DEFAULT, presets: GRADE_PRESETS,
      beginScene(renderer) { renderer.setRenderTarget(null); return null; },
      sync() {}, resize() {},
      render(renderer) { renderer.render(scene, camera); },
      size(renderer) { return renderer.getDrawingBufferSize(_size); },
    };
  }

  /* --- grade uniforms, same names and defaults as the quad era ----------- */
  const uStrength = uniform(0.62);
  const gTime = uniform(0);
  const gAmount = uniform(0.030);
  const lTime = uniform(0);
  const lAmt = uniform(0.7);
  const uHurt = uniform(0);      // 0..1: red at the frame edge -- a hit pulses it, low health holds it
  const uSat = uniform(1.0);     // colour saturation
  const uVibrance = uniform(0.05); // selective vibrance protection for neon and skin tones
  const uSplit = uniform(0.0);   // split tone amount
  const uSpeed = uniform(0);     // 0..1: high speed / NOS visual warp and chromatic stretch
  const uFilmic = uniform(0);    // 0..1: AgX -> per-channel Hable (night keeps its neon saturated)

  // 3-Way Color Balance
  const uShadowTint = uniform(new THREE.Vector3(0.94, 0.99, 1.05));   // shadows lean cool/teal by default
  const uMidTint = uniform(new THREE.Vector3(1.0, 1.0, 1.0));         // neutral midtones
  const uHighTint = uniform(new THREE.Vector3(1.06, 1.01, 0.95));     // highlights lean sun-warm
  const uContrast = uniform(0.34);                                    // S-curve mix

  // ASC CDL (Slope, Offset, Power)
  const uSlope = uniform(new THREE.Vector3(1.0, 1.0, 1.0));
  const uOffset = uniform(new THREE.Vector3(0.0, 0.0, 0.0));
  const uPower = uniform(new THREE.Vector3(1.0, 1.0, 1.0));

  /* --- scene pass --------------------------------------------------------
     GTAO needs geometry (depth + view normals) and selective bloom needs the
     emissive term; one MRT scene pass gets all three without rendering the
     world twice. */
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, normal: normalView, emissive }));

  const beauty = scenePass.getTextureNode('output');
  const normalTex = scenePass.getTextureNode('normal');
  const depthTex = scenePass.getTextureNode('depth');
  const emissiveTex = scenePass.getTextureNode('emissive');

  /* --- GTAO --------------------------------------------------------------
     Radius in world units. The city is authored in metres and the detail that
     wants occluding is prop-sized — a kerb, a reveal, a bin against a wall —
     so half a metre, not the 0.25 default that is tuned for a single object
     filling the frame. */
  let lit = beauty;
  let aoPass = null;
  if (withAO) {
    aoPass = ao(depthTex, normalTex, camera);
    aoPass.radius.value = 0.42;
    /* convertToTexture keeps the denoiser out of the output shader */
    const aoDenoised = convertToTexture(
      denoise(aoPass.getTextureNode(), depthTex, normalTex, camera));
    const contactAO = clamp(aoDenoised.r.pow(1.2), 0.0, 1.0);
    lit = beauty.mul(vec4(vec3(contactAO), 1));
  }

  /* --- wet-street reflections (OPT-IN: ?ssr) ------------------------------ */
  let ssrPass = null;
  const uWet = uniform(0);
  if (withSSR) {
    const worldUpness = cameraWorldMatrix.mul(vec4(normalTex.rgb, 0)).xyz.y;
    const groundMask = smoothstep(0.86, 0.97, worldUpness).mul(0.9);
    const ssrInput = convertToTexture(vec4(clamp(vec3(lit.x, lit.y, lit.z), vec3(0), vec3(1.15)), 1));
    ssrPass = ssr(ssrInput, depthTex, normalTex, { metalnessNode: groundMask, roughnessNode: float(0.03), stochastic: true, camera });
    ssrPass.resolutionScale = 0.5;
    ssrPass.maxDistance.value = 13;
    ssrPass.thickness.value = 0.4;
    const refl = clamp(vec3(ssrPass.x, ssrPass.y, ssrPass.z), vec3(0), vec3(1.1));
    lit = mix(lit, vec4(refl, 1), ssrPass.a.mul(0.45).mul(uWet));
  }

  /* --- bloom -------------------------------------------------------------
     Threshold 0.25 sits between daylight's dimmed emissive (0.04) and every
     genuine night source (facade windows ~1, headlamp glass 2.2, brake
     emissive up to 3.5), which is what makes one setting serve both rigs.
     The diurnal profile (clock.js) moves strength/radius/threshold from here;
     the threshold is rescaled by exposure on the way in (bloomThresholdFor). */
  let bloomPass = null;
  let hdr = lit;
  if (withBloom) {
    bloomPass = bloom(emissiveTex, BLOOM_STRENGTH, 0.35, 0.25);
    bloomPass.smoothWidth.value = bloomKnee(0.25);   // before the first profile lands
    hdr = lit.add(bloomPass);
  }

  /* Tone map + colour space, exactly once (see header). SMAA sits between
     them: three's SMAANode wants tone-mapped input but NOT yet sRGB (unlike
     FXAA), so with AA on, renderOutput() is split into its two halves around
     the AA pass. Grain lands after AA either way — smoothed grain is mud. */
  const agx = hdr.toneMapping(renderer.toneMapping).rgb;
  const mapped = vec4(mix(agx, hableToneMapNode(hdr.rgb, toneMappingExposure), uFilmic), 1.0);
  const aa = (withAA ? smaa(mapped) : mapped).workingToColorSpace(THREE.SRGBColorSpace);

  /* --- High-Speed Radial Motion Blur ---
     High-velocity radial motion blur (as in APEX / Heat / Forza racing).
     Peripheral scenery, street lamps, and roadside buildings streak outward
     with speed, while the center vehicle and forward road remain crisp and focused. */
  const displayTex = convertToTexture(aa);
  const motionBlurred = Fn(() => {
    const uvs = uv();
    const center = vec2(0.5, 0.48);
    const dir = uvs.sub(center);
    const dist = dir.length();
    const edgeMask = smoothstep(0.12, 0.68, dist);
    const speedFactor = smoothstep(0.18, 0.88, uSpeed);
    const blurAmt = speedFactor.mul(edgeMask).mul(0.042);

    const baseCol = displayTex.sample(uvs).rgb;
    const step = dir.mul(blurAmt.div(6.0));
    const sum = baseCol.toVar();
    sum.addAssign(displayTex.sample(clamp(uvs.add(step.mul(1.0)), vec2(0.001), vec2(0.999))).rgb);
    sum.addAssign(displayTex.sample(clamp(uvs.add(step.mul(2.0)), vec2(0.001), vec2(0.999))).rgb);
    sum.addAssign(displayTex.sample(clamp(uvs.add(step.mul(3.0)), vec2(0.001), vec2(0.999))).rgb);
    sum.addAssign(displayTex.sample(clamp(uvs.sub(step.mul(1.0)), vec2(0.001), vec2(0.999))).rgb);
    sum.addAssign(displayTex.sample(clamp(uvs.sub(step.mul(2.0)), vec2(0.001), vec2(0.999))).rgb);
    sum.addAssign(displayTex.sample(clamp(uvs.sub(step.mul(3.0)), vec2(0.001), vec2(0.999))).rgb);
    sum.divAssign(7.0);

    return vec4(mix(baseCol, sum, smoothstep(0.005, 0.12, blurAmt)), 1.0);
  });

  const display = withBlur ? motionBlurred() : aa;   // ?noblur

  /* --- the grade, in display space ---------------------------------------
     Each block reproduces its old quad's blend arithmetic exactly:
     vignette was a MultiplyBlending quad (dst * src.rgb), grain an additive
     quad at alpha 1 (dst + src.rgb), lens rain an additive quad with alpha
     (dst + src.rgb * src.a). Same maths, zero draw calls. The CDL, 3-way
     balance and vibrance stages (2026-09-11) sit in the same display-space
     chain and are driven by clock.js's diurnal profile or a named preset. */
  const graded = Fn(() => {
    const c = display.rgb.toVar();

    // 1. ASC CDL (Slope, Offset, Power)
    const cdl = clamp(c.mul(uSlope).add(uOffset), 0.0, 1.0);
    c.assign(cdl.pow(uPower));

    // 2. Vignette: darkens corners, splits warm/cool vertically
    const p = uv().sub(0.5);
    const r = p.mul(vec2(1.16, 1.0)).length();
    const v = mix(float(1).sub(uStrength), 1.0, smoothstep(0.80, 0.30, r));
    const tint = mix(vec3(1.05, 1.00, 0.93), vec3(0.93, 0.96, 1.07), uv().y);
    c.mulAssign(vec3(v).mul(tint));

    // 3. Luminance (Rec. 709)
    const lum = c.r.mul(0.2126).add(c.g.mul(0.7152)).add(c.b.mul(0.0722));

    // 4. 3-Way Color Balance (Shadows, Midtones, Highlights)
    const shadowWeight = float(1.0).sub(smoothstep(0.05, 0.40, lum));
    const highWeight = smoothstep(0.60, 0.95, lum);
    const midWeight = clamp(float(1.0).sub(shadowWeight).sub(highWeight), 0.0, 1.0);
    const toneMult = uShadowTint.mul(shadowWeight)
      .add(uMidTint.mul(midWeight))
      .add(uHighTint.mul(highWeight));
    c.assign(mix(c, c.mul(toneMult), uSplit));

    // 5. Saturation & Vibrance (with Hurt desaturation)
    const effSat = uSat.mul(float(1.0).sub(uHurt.mul(0.35)));
    c.assign(mix(vec3(lum), c, effSat));

    // Vibrance: boosts low-saturation hues more than already saturated ones
    const maxC = max(c.r, max(c.g, c.b));
    const minC = min(c.r, min(c.g, c.b));
    const satDelta = maxC.sub(minC);
    const vibFactor = float(1.0).sub(satDelta).mul(uVibrance);
    c.assign(mix(c, mix(vec3(lum), c, float(1.0).add(vibFactor)), clamp(uVibrance.abs(), 0.0, 1.0)));
    c.assign(clamp(c, 0.0, 1.0));   // saturation past 1 and vibrance both extrapolate; the S-curve below assumes 0..1

    // 6. Hurt: blood vignette at the edges of vision
    const hurtEdge = smoothstep(0.30, 0.80, r).mul(uHurt);
    c.assign(mix(c, vec3(0.42, 0.01, 0.01), hurtEdge.mul(0.85)));

    // 7. Film S-curve contrast
    const contrasted = c.mul(c).mul(float(3.0).sub(c.mul(2.0)));
    c.assign(mix(c, contrasted, uContrast));

    // 8. Lens edge chromatic aberration + high-speed warp
    const chromaOffset = r.mul(r).mul(float(0.0025).add(uSpeed.mul(0.012)));
    c.r.addAssign(chromaOffset.mul(0.14));
    c.b.subAssign(chromaOffset.mul(0.14));

    // 9. Film grain (luminance-weighted: organic in mid/darks, subtle in brights)
    const n = hash2(uv().mul(vec2(1920.0, 1080.0)).add(fract(gTime).mul(91.7)));
    const grainMask = float(1.0).sub(lum.mul(0.55));
    c.addAssign(vec3(n.mul(gAmount).mul(grainMask)));

    // 10. Rain on the lens: 14 drops, each seeded off its own index
    const col = vec3(0).toVar();
    const a = float(0).toVar();
    Loop(14, ({ i }) => {
      const fi = float(i);
      const s = vec2(fi.mul(13.17), fi.mul(7.91));
      const px = hash2(s);
      const spd = hash2(s.add(2.1)).mul(0.07).add(0.035);
      const py = fract(hash2(s.add(1.4)).sub(lTime.mul(spd)));
      const d = uv().sub(vec2(px, py)).mul(vec2(1.7, 1.0)).toVar();
      d.y.mulAssign(hash2(s.add(3.3)).mul(0.25).add(0.38));
      const rd = d.length();
      const drop = smoothstep(0.026, 0.004, rd);
      const hl = smoothstep(0.012, 0.0, d.sub(vec2(-0.004, 0.003)).length());
      col.addAssign(vec3(0.72, 0.82, 0.95).mul(drop.mul(0.28).add(hl.mul(0.4))));
      a.addAssign(drop.mul(0.22));
    });
    c.addAssign(col.mul(lAmt).mul(clamp(a.mul(lAmt), 0.0, 0.55)));

    return vec4(c, 1.0);
  })();

  const post = new THREE.RenderPipeline(renderer);
  post.outputColorTransform = false;   // the toneMapping + workingToColorSpace above IS the transform (see header)
  post.outputNode = graded;

  let activePreset = 'DEFAULT';

  function applyProfileValues(p) {
    if (!p) return;
    if (p.sat !== undefined) uSat.value = p.sat;
    if (p.vibrance !== undefined) uVibrance.value = p.vibrance;
    if (p.contrast !== undefined) uContrast.value = p.contrast;
    if (p.split !== undefined) uSplit.value = p.split;
    if (p.vignette !== undefined) uStrength.value = p.vignette;
    if (p.grain !== undefined) gAmount.value = p.grain;
    uFilmic.value = p.filmic ?? 0;   // no key (clock.js before it carries one) means AgX -- and a return to DEFAULT
                                      // from NEON_NOIR must not leave Hable switched on until the profile learns the key

    if (p.shadowTint) uShadowTint.value.set(p.shadowTint[0], p.shadowTint[1], p.shadowTint[2]);
    if (p.midTint) uMidTint.value.set(p.midTint[0], p.midTint[1], p.midTint[2]);
    if (p.highTint) uHighTint.value.set(p.highTint[0], p.highTint[1], p.highTint[2]);

    if (p.slope) uSlope.value.set(p.slope[0], p.slope[1], p.slope[2]);
    if (p.offset) uOffset.value.set(p.offset[0], p.offset[1], p.offset[2]);
    if (p.power) uPower.value.set(p.power[0], p.power[1], p.power[2]);

    if (bloomPass) {
      if (p.bloomStrength !== undefined) bloomPass.strength.value = p.bloomStrength;
      if (p.bloomRadius !== undefined) bloomPass.radius.value = p.bloomRadius;
      if (p.bloomThreshold !== undefined) {
        const t = bloomThresholdFor(p.bloomThreshold, renderer.toneMappingExposure);
        bloomPass.threshold.value = t;
        bloomPass.smoothWidth.value = bloomKnee(t);   // only tiny bright cores: see bloomKnee()
      }
    }
  }

  return {
    /* backwards-compatible uniform getters */
    vignette: { uniforms: { uStrength } },
    grain: { uniforms: { uTime: gTime, uAmount: gAmount } },
    lens: { uniforms: { uTime: lTime, uAmt: lAmt } },

    gtao: aoPass,
    bloomNode: bloomPass,
    post,
    bloom: withBloom,

    setBloom(on) { if (bloomPass) bloomPass.strength.value = on ? BLOOM_STRENGTH : 0; },

    /**
     * Dynamic Diurnal Profile Setter.
     * Called continuously from clock.js to blend Day/Dusk/Night/Dawn & weather states.
     */
    setGradeProfile(profile) {
      if (activePreset !== 'DEFAULT') return; // Presets take precedence over dynamic timecycle
      applyProfileValues(profile);
    },

    /**
     * Preset switcher. Pass 'DEFAULT' to resume automatic diurnal grading.
     */
    setPreset(name) {
      if (!name || name === 'DEFAULT' || !GRADE_PRESETS[name]) {
        activePreset = 'DEFAULT';
        return 'DEFAULT';
      }
      activePreset = name;
      applyProfileValues(GRADE_PRESETS[name]);
      return activePreset;
    },

    cyclePreset(dir = 1) {
      const keys = Object.keys(GRADE_PRESETS);
      let idx = keys.indexOf(activePreset);
      if (idx < 0) idx = 0;
      idx = (idx + dir + keys.length) % keys.length;
      return this.setPreset(keys[idx]);
    },

    get currentPreset() {
      return activePreset;
    },

    get presetDetails() {
      return GRADE_PRESETS[activePreset] || GRADE_PRESETS.DEFAULT;
    },

    get presets() {
      return GRADE_PRESETS;
    },

    /**
     * Legacy discrete day/night swap. The numbers live in ONE place -- the
     * diurnal profiles in clock.js -- so this is the midnight or noon sample
     * of that curve, not a second copy of it (a second copy drifted within a
     * day of being written, 2026-09-11).
     */
    setNight(on) {
      this.setGradeProfile(interpolateGradeProfile(on ? 0.0 : 12.0, 'CLEAR'));
    },

    setDrops(amount) { lAmt.value = amount; },
    setWet(amount) { uWet.value = Math.max(0, Math.min(1, amount || 0)); },
    ssrNode: ssrPass,
    setHurt(amount) { uHurt.value = Math.max(0, Math.min(1, amount)); },
    setSpeed(amount) { uSpeed.value = Math.max(0, Math.min(1, amount)); },

    beginScene(renderer) { renderer.setRenderTarget(null); return null; },
    sync() {},
    resize() {},

    render(renderer, time) {
      gTime.value = time;
      lTime.value = time;
      post.render();
    },

    size(renderer) { return renderer.getDrawingBufferSize(_size); },
  };
}
