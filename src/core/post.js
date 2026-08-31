import * as THREE from 'three';
import {
  pass, mrt, output, normalView, vec3, vec4, float, renderOutput,
} from 'three/tsl';
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';

/**
 * The post stack (docs/ROADMAP Tier 1.1).
 *
 * This is the dividend from the WebGPU migration rather than new work: three
 * ships GTAO, bloom, FXAA, motion blur and depth of field as TSL nodes in
 * `three/examples/jsm/tsl/display/`, and none of them can be used at all from
 * the WebGL material system. Ground-truth ambient occlusion is the one that
 * matters here — the city is 27 procedural PBR materials under a two-light
 * rig, and contact darkening where a bollard meets the pavement or a bay
 * window meets its reveal is most of what separates "textured boxes" from
 * "lit geometry". It costs no new art.
 *
 * ---------------------------------------------------------------------------
 * NOT WIRED UP. This file is a parked spike, kept because the analysis in it
 * is correct and the next attempt should not start from zero.
 *
 * It renders a white ellipse on a dark ground, which is the grade's own
 * vignette with no world behind it. The cause is architectural, not a tuning
 * problem: `PostProcessing.render()` owns the frame. core/grade.js draws its
 * vignette, grain and rain as three separate quads with `autoClear = false`
 * AFTER the world is rendered, and that compositing trick does not survive
 * being placed after a post chain -- the post pass finishes the frame and the
 * grade's pass no longer has anything under it.
 *
 * The fix is to fold the grade INTO the node graph rather than drawing it
 * afterwards: the vignette, grain and lens are already TSL functions, so they
 * become `node.mul(vignette).add(grain).add(lens)` at the end of this chain,
 * and grade.js stops owning a scene at all. That is a redesign of the render
 * path, which is Tier 1.1's actual job, and it wants doing deliberately.
 *
 * Two further things measured while this was live, worth having:
 *  - `renderOutput()` is mandatory around a custom outputNode. Without it the
 *    frame arrives un-tone-mapped and blows out. (It did not fix THIS bug.)
 *  - the scene pass logs "LightsNode.setupNodeLights: Light node not found for
 *    SpotLight" once per headlight per frame -- ~400 warnings a second. The
 *    car's two spots need looking at before any MRT pass ships.
 * ---------------------------------------------------------------------------
 */
export function createPost(renderer, scene, camera, { day = true } = {}) {
  const scenePass = pass(scene, camera);
  /* GTAO needs geometry, not just colour: view-space normals and depth. An MRT
     gets both out of the one scene pass rather than rendering the world twice. */
  scenePass.setMRT(mrt({ output, normal: normalView }));

  const colour = scenePass.getTextureNode('output');
  const normal = scenePass.getTextureNode('normal');
  const depth = scenePass.getTextureNode('depth');

  const aoPass = ao(depth, normal, camera);
  /* Radius in world units. The city is authored in metres and the detail that
     wants occluding is prop-sized -- a kerb, a reveal, a bin against a wall --
     so half a metre, not the 0.25 default that is tuned for a single object
     filling the frame. */
  aoPass.radius.value = 0.5;
  aoPass.distanceExponent.value = 1.0;
  aoPass.thickness.value = 1.0;
  aoPass.scale.value = 1.0;

  const occlusion = aoPass.getTextureNode();
  let node = colour.mul(vec4(vec3(occlusion.r), float(1)));

  /* Bloom only at night. The whole night look is baked emissive -- lit
     windows, lamp heads, signal lenses -- and nothing was bleeding it. In
     daylight it just hazes an already bright frame. */
  if (!day) node = node.add(bloom(node, 0.5, 0.4, 0.75));

  const post = new THREE.PostProcessing(renderer);
  /* renderOutput() is not optional on a custom output node.
     The scene pass hands back LINEAR HDR; the renderer's tone mapping and
     output colour space are applied by the node graph, not behind it. Without
     this the frame arrives on the canvas un-tone-mapped and blows out to
     white -- and since the grade's vignette is a MULTIPLY quad drawn on top,
     what you actually see is a white ellipse in a dark surround, which looks
     like a post bug rather than a missing conversion. */
  post.outputNode = renderOutput(node);
  return post;
}
