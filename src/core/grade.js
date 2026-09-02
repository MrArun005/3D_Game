import * as THREE from 'three';
import {
  Fn, Loop, uv, uniform, vec2, vec3, vec4, float, mix, smoothstep, clamp, fract, sin, dot,
  pass, mrt, output, emissive, normalView, renderOutput, convertToTexture,
} from 'three/tsl';
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js';
import { denoise } from 'three/examples/jsm/tsl/display/DenoiseNode.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { smaa } from 'three/examples/jsm/tsl/display/SMAANode.js';

/**
 * The post stack (docs/ROADMAP Tier 1.1) with the colour grade folded in.
 *
 * One RenderPipeline owns the frame:
 *
 *   scene pass (MRT: colour + view normals + emissive)
 *     -> GTAO from depth+normals, bilateral-denoised, multiplied into colour
 *     -> bloom fed by the emissive MRT channel only
 *     -> renderOutput()  (ACES + sRGB — the pipeline's own transform is off)
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
 *
 * `uniform()` nodes carry `.value` exactly like the old uniform objects, so
 * every caller reading `grade.grain.uniforms.uAmount.value` still works.
 */

/** The same hash the GLSL used, so the grain and rain keep their character. */
const hash2 = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));

const _size = new THREE.Vector2();

const BLOOM_STRENGTH = 0.6;

export function createGrade(renderer, scene, camera, {
  ao: withAO = true, bloom: withBloom = true, aa: withAA = true, post: withPost = true,
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
      setBloom() {}, setDrops() {},
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

  /* --- bloom -------------------------------------------------------------
     Threshold 0.25 sits between daylight's dimmed emissive (0.04) and every
     genuine night source (facade windows ~1, headlamp glass 2.2, brake
     emissive up to 3.5), which is what makes one setting serve both rigs. */
  let bloomPass = null;
  let hdr = lit;
  if (withBloom) {
    bloomPass = bloom(emissiveTex, BLOOM_STRENGTH, 0.35, 0.25);
    hdr = lit.add(bloomPass);
  }

  /* Tone map + colour space, exactly once (see header). SMAA sits between
     them: three's SMAANode wants tone-mapped input but NOT yet sRGB (unlike
     FXAA), so with AA on, renderOutput() is split into its two halves around
     the AA pass. Grain lands after AA either way — smoothed grain is mud. */
  let display;
  if (withAA) {
    const mapped = hdr.toneMapping(renderer.toneMapping);
    display = smaa(mapped).workingToColorSpace(THREE.SRGBColorSpace);
  } else {
    display = renderOutput(hdr);
  }

  /* --- the grade, in display space ---------------------------------------
     Each block reproduces its old quad's blend arithmetic exactly:
     vignette was a MultiplyBlending quad (dst * src.rgb), grain an additive
     quad at alpha 1 (dst + src.rgb), lens rain an additive quad with alpha
     (dst + src.rgb * src.a). Same maths, zero draw calls. */
  const graded = Fn(() => {
    const c = display.rgb.toVar();

    // vignette: darkens the corners, splits the frame warm/cool
    const p = uv().sub(0.5);
    const r = p.mul(vec2(1.16, 1.0)).length();
    const v = mix(float(1).sub(uStrength), 1.0, smoothstep(0.80, 0.30, r));
    // cool in the upper frame, warm down at street level
    const tint = mix(vec3(1.05, 1.00, 0.93), vec3(0.93, 0.96, 1.07), uv().y);
    c.mulAssign(vec3(v).mul(tint));

    // cinematic film S-curve contrast: expands highlights, deepens shadows
    const contrasted = c.mul(c).mul(float(3.0).sub(c.mul(2.0)));
    c.assign(mix(c, contrasted, 0.22));

    // subtle lens edge chromatic aberration on periphery
    const chromaOffset = r.mul(r).mul(0.0025);
    c.r.addAssign(chromaOffset.mul(0.12));
    c.b.subAssign(chromaOffset.mul(0.12));

    // grain
    const n = hash2(uv().mul(vec2(1920.0, 1080.0)).add(fract(gTime).mul(91.7)));
    c.addAssign(vec3(n.mul(gAmount)));

    // rain on the lens: fourteen drops, each seeded off its own index and
    // falling at its own speed. Unrolled by the compiler as the GLSL was.
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
  post.outputColorTransform = false;   // renderOutput() above is the transform
  post.outputNode = graded;

  return {
    /* same shapes the quad era exported, so existing callers keep working */
    vignette: { uniforms: { uStrength } },
    grain: { uniforms: { uTime: gTime, uAmount: gAmount } },
    lens: { uniforms: { uTime: lTime, uAmt: lAmt } },

    /* the live nodes, for tuning from the console or a later weather hook */
    gtao: aoPass,
    bloomNode: bloomPass,
    post,

    bloom: withBloom,
    setBloom(on) { if (bloomPass) bloomPass.strength.value = on ? BLOOM_STRENGTH : 0; },
    /* Night mood: signs and lamps glow harder and softer (radius up), the
       threshold stays where windows (emissive ~1.0 * tint <= 1) do not bloom
       but sign boards (1.4) and lamp caps (3.2) do. */
    setNight(on) {
      if (!bloomPass) return;
      bloomPass.strength.value = on ? 0.95 : BLOOM_STRENGTH;
      bloomPass.radius.value = on ? 0.55 : 0.35;
      bloomPass.threshold.value = on ? 0.9 : 0.25;
    },

    setDrops(amount) { lAmt.value = amount; },

    /** Legacy no-op: the pipeline owns the frame now. */
    beginScene(renderer) { renderer.setRenderTarget(null); return null; },

    sync() { /* pass + AO track drawing-buffer size themselves */ },
    resize() { /* kept so old callers are harmless */ },

    render(renderer, time) {
      gTime.value = time;
      lTime.value = time;
      post.render();
    },

    /** Drawing-buffer size, for anything that still wants to ask. */
    size(renderer) { return renderer.getDrawingBufferSize(_size); },
  };
}
