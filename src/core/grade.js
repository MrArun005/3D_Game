import * as THREE from 'three';
import {
  Fn, Loop, uv, uniform, vec2, vec3, vec4, float, mix, smoothstep, clamp, fract, sin, dot,
} from 'three/tsl';

/**
 * In-canvas colour grade: vignette, warm/cool split, grain, rain on the lens.
 *
 * These used to be CSS overlays sitting on top of the canvas, which meant they
 * were absent from anything that captured the canvas — screenshots and video
 * both came out ungraded. Doing it as blended fullscreen quads keeps what you
 * see and what you record identical, and costs two triangles each.
 *
 * TSL, not GLSL (Tier 0.3). Three things changed in the port and all three are
 * simplifications:
 *
 *  - The custom vertex shaders are gone. Every one of them wrote
 *    `gl_Position = vec4(position.xy, 0, 1)`, which is exactly what a 2x2
 *    plane under an OrthographicCamera(-1, 1, 1, -1) already produces. They
 *    were belt-and-braces against a camera that was already correct.
 *  - The hand-rolled bloom chain is gone: a bright-pass, two nine-tap
 *    gaussians and a blit, three ShaderMaterials and three render targets to
 *    reimplement something three now ships as `BloomNode`. It had been
 *    disabled since it broke the frame, so this deletes dead code rather than
 *    losing a feature — see setBloom().
 *  - `uniform()` nodes carry a `.value` exactly like the old uniform objects,
 *    so every caller reading `grade.grain.uniforms.uAmount.value` still works.
 */

/** The same hash the GLSL used, so the grain and rain keep their character. */
const hash2 = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));

const _size = new THREE.Vector2();

export function createGrade() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.PlaneGeometry(2, 2);

  /* --- vignette: darkens the corners, and splits the frame warm/cool ----- */
  const uStrength = uniform(0.62);
  const vignette = new THREE.MeshBasicNodeMaterial({
    blending: THREE.MultiplyBlending, premultipliedAlpha: true,
    depthTest: false, depthWrite: false, transparent: true,
  });
  vignette.colorNode = Fn(() => {
    const p = uv().sub(0.5);
    const r = p.mul(vec2(1.16, 1.0)).length();
    const v = mix(float(1).sub(uStrength), 1.0, smoothstep(0.80, 0.30, r));
    // cool in the upper frame, warm down at street level
    const tint = mix(vec3(1.05, 1.00, 0.93), vec3(0.93, 0.96, 1.07), uv().y);
    return vec4(vec3(v).mul(tint), 1.0);
  })();
  vignette.uniforms = { uStrength };

  /* --- grain ------------------------------------------------------------ */
  const gTime = uniform(0);
  const gAmount = uniform(0.030);
  const grain = new THREE.MeshBasicNodeMaterial({
    blending: THREE.AdditiveBlending,
    depthTest: false, depthWrite: false, transparent: true,
  });
  grain.colorNode = Fn(() => {
    const n = hash2(uv().mul(vec2(1920.0, 1080.0)).add(fract(gTime).mul(91.7)));
    return vec4(vec3(n.mul(gAmount)), 1.0);
  })();
  grain.uniforms = { uTime: gTime, uAmount: gAmount };

  /* --- rain on the lens -------------------------------------------------- */
  const lTime = uniform(0);
  const lAmt = uniform(0.7);
  const lens = new THREE.MeshBasicNodeMaterial({
    blending: THREE.AdditiveBlending,
    depthTest: false, depthWrite: false, transparent: true,
  });
  const lensRgba = Fn(() => {
    const col = vec3(0).toVar();
    const a = float(0).toVar();
    /* Fourteen drops, each seeded off its own index and falling at its own
       speed. Unrolled by the compiler exactly as the GLSL `for` was. */
    Loop(14, ({ i }) => {
      const fi = float(i);
      const s = vec2(fi.mul(13.17), fi.mul(7.91));
      const px = hash2(s);
      const spd = hash2(s.add(2.1)).mul(0.07).add(0.035);
      const py = fract(hash2(s.add(1.4)).sub(lTime.mul(spd)));
      const d = uv().sub(vec2(px, py)).mul(vec2(1.7, 1.0)).toVar();
      d.y.mulAssign(hash2(s.add(3.3)).mul(0.25).add(0.38));
      const r = d.length();
      const drop = smoothstep(0.026, 0.004, r);
      const hl = smoothstep(0.012, 0.0, d.sub(vec2(-0.004, 0.003)).length());
      col.addAssign(vec3(0.72, 0.82, 0.95).mul(drop.mul(0.28).add(hl.mul(0.4))));
      a.addAssign(drop.mul(0.22));
    });
    return vec4(col.mul(lAmt), clamp(a.mul(lAmt), 0.0, 0.55));
  });
  lens.colorNode = lensRgba();
  lens.uniforms = { uTime: lTime, uAmt: lAmt };

  const vMesh = new THREE.Mesh(quad, vignette);
  const gMesh = new THREE.Mesh(quad, grain);
  const lMesh = new THREE.Mesh(quad, lens);
  for (const m of [vMesh, gMesh, lMesh]) m.frustumCulled = false;
  vMesh.renderOrder = 0;
  gMesh.renderOrder = 1;
  lMesh.renderOrder = 2;
  scene.add(vMesh, gMesh, lMesh);

  return {
    scene, camera, vignette, grain, lens, bloom: false,

    /**
     * Kept as a no-op so callers are harmless.
     *
     * The hand-rolled chain this used to drive is deleted. The replacement is
     * `three/addons/tsl/display/BloomNode.js` hung off a PostProcessing pass,
     * which is Tier 1.1 work and wants the whole post stack designed at once
     * rather than one effect bolted to the side of the grade.
     */
    setBloom() { this.bloom = false; },

    setDrops(amount) { lAmt.value = amount; },

    /** No longer diverts the frame; the world renders straight to the canvas. */
    beginScene(renderer) { renderer.setRenderTarget(null); return null; },

    sync() { /* nothing offscreen left to size */ },
    resize() { /* kept so old callers are harmless */ },

    render(renderer, time) {
      gTime.value = time;
      lTime.value = time;
      renderer.setRenderTarget(null);
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = true;
    },

    /** Drawing-buffer size, for anything that still wants to ask. */
    size(renderer) { return renderer.getDrawingBufferSize(_size); },
  };
}
