import * as THREE from 'three';

/**
 * In-canvas colour grade: vignette, warm/cool split, grain, rain on the lens.
 *
 * These used to be CSS overlays sitting on top of the canvas, which meant they
 * were absent from anything that captured the canvas — screenshots and video
 * both came out ungraded. Doing it as two fullscreen blended quads keeps what
 * you see and what you record identical, and costs two triangles.
 */
const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const VIGNETTE_FRAG = `
varying vec2 vUv;
uniform float uStrength;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p * vec2(1.16, 1.0));
  float v = smoothstep(0.80, 0.30, r);
  v = mix(1.0 - uStrength, 1.0, v);
  // cool in the upper frame, warm down at street level
  vec3 tint = mix(vec3(1.05, 1.00, 0.93), vec3(0.93, 0.96, 1.07), vUv.y);
  gl_FragColor = vec4(vec3(v) * tint, 1.0);
}`;

const GRAIN_FRAG = `
varying vec2 vUv;
uniform float uTime;
uniform float uAmount;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float n = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 91.7);
  gl_FragColor = vec4(vec3(n * uAmount), 1.0);
}`;

const LENS_FRAG = `
varying vec2 vUv;
uniform float uTime;
uniform float uAmt;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 col = vec3(0.0);
  float a = 0.0;
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    vec2 s = vec2(fi * 13.17, fi * 7.91);
    float px = hash(s);
    float spd = 0.035 + hash(s + 2.1) * 0.07;
    float py = fract(hash(s + 1.4) - uTime * spd);
    vec2 d = (vUv - vec2(px, py)) * vec2(1.7, 1.0);
    d.y *= 0.38 + hash(s + 3.3) * 0.25;
    float r = length(d);
    float drop = smoothstep(0.026, 0.004, r);
    float hl = smoothstep(0.012, 0.0, length(d - vec2(-0.004, 0.003)));
    col += vec3(0.72, 0.82, 0.95) * (drop * 0.28 + hl * 0.4);
    a += drop * 0.22;
  }
  gl_FragColor = vec4(col * uAmt, clamp(a * uAmt, 0.0, 0.55));
}`;

/**
 * Bloom, without an EffectComposer.
 *
 * The whole night look is baked emissive -- lit windows, lamp heads, signal
 * lenses -- and nothing was bleeding it, so every light source stayed a flat
 * rectangle. This is the cheapest honest version: copy the frame, keep only
 * what is brighter than the threshold, blur it twice at quarter resolution,
 * and add it back. Three small passes on top of the fullscreen quad this
 * module already owned.
 */
const COPY_VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BRIGHT_FRAG = `
uniform sampler2D tSrc;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // soft knee, so a window does not pop the instant it crosses the line
  float k = clamp((l - uThreshold) / max(0.0001, 1.0 - uThreshold), 0.0, 1.0);
  gl_FragColor = vec4(c * k * k, 1.0);
}`;

const BLUR_FRAG = `
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  // nine-tap gaussian, separable: run it once across and once down
  vec4 sum = texture2D(tSrc, vUv) * 0.2270270270;
  sum += texture2D(tSrc, vUv + uDir * 1.3846153846) * 0.3162162162;
  sum += texture2D(tSrc, vUv - uDir * 1.3846153846) * 0.3162162162;
  sum += texture2D(tSrc, vUv + uDir * 3.2307692308) * 0.0702702703;
  sum += texture2D(tSrc, vUv - uDir * 3.2307692308) * 0.0702702703;
  gl_FragColor = sum;
}`;

const _size = new THREE.Vector2();

export function createGrade() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.PlaneGeometry(2, 2);

  const vignette = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: VIGNETTE_FRAG,
    uniforms: { uStrength: { value: 0.62 } },
    blending: THREE.MultiplyBlending, premultipliedAlpha: true,
    depthTest: false, depthWrite: false, transparent: true,
  });
  const grain = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: GRAIN_FRAG,
    uniforms: { uTime: { value: 0 }, uAmount: { value: 0.030 } },
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
  });

  /* --- bloom chain ---------------------------------------------------- */
  const rtOpts = { depthBuffer: false, stencilBuffer: false };
  const rtScene = new THREE.WebGLRenderTarget(1, 1, rtOpts);
  const rtA = new THREE.WebGLRenderTarget(1, 1, rtOpts);
  const rtB = new THREE.WebGLRenderTarget(1, 1, rtOpts);
  const bloomScene = new THREE.Scene();
  const bloomCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const brightMat = new THREE.ShaderMaterial({
    vertexShader: COPY_VERT, fragmentShader: BRIGHT_FRAG,
    uniforms: { tSrc: { value: null }, uThreshold: { value: 0.62 } },
    depthTest: false, depthWrite: false,
  });
  const blurMat = new THREE.ShaderMaterial({
    vertexShader: COPY_VERT, fragmentShader: BLUR_FRAG,
    uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
    depthTest: false, depthWrite: false,
  });
  const blitMat = new THREE.ShaderMaterial({
    vertexShader: COPY_VERT,
    fragmentShader: 'uniform sampler2D tSrc; varying vec2 vUv;'
      + 'void main() { gl_FragColor = texture2D(tSrc, vUv); }',
    uniforms: { tSrc: { value: null } },
    depthTest: false, depthWrite: false,
  });
  const passMesh = new THREE.Mesh(quad, brightMat);
  passMesh.frustumCulled = false;
  bloomScene.add(passMesh);

  // the additive layer that goes back over the frame
  const bloomMat = new THREE.MeshBasicMaterial({
    map: null, blending: THREE.AdditiveBlending,
    transparent: true, depthTest: false, depthWrite: false, opacity: 0.85,
  });
  const bloomMesh = new THREE.Mesh(quad, bloomMat);
  bloomMesh.frustumCulled = false;
  bloomMesh.renderOrder = -1;

  const vMesh = new THREE.Mesh(quad, vignette);
  const gMesh = new THREE.Mesh(quad, grain);
  const lens = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: LENS_FRAG,
    uniforms: { uTime: { value: 0 }, uAmt: { value: 0.7 } },
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
  });
  const lMesh = new THREE.Mesh(quad, lens);
  vMesh.frustumCulled = false;
  gMesh.frustumCulled = false;
  lMesh.frustumCulled = false;
  vMesh.renderOrder = 0;
  gMesh.renderOrder = 1;
  lMesh.renderOrder = 2;
  scene.add(bloomMesh, vMesh, gMesh, lMesh);

  return {
    scene, camera, vignette, grain, lens, bloom: true,
    setBloom(on, threshold, strength) {
      this.bloom = on;
      if (threshold !== undefined) brightMat.uniforms.uThreshold.value = threshold;
      if (strength !== undefined) bloomMat.opacity = strength;
    },
    setDrops(amount) { lens.uniforms.uAmt.value = amount; },
    /**
     * Size the offscreen targets from the renderer's ACTUAL drawing buffer.
     *
     * This used to be a resize() the caller had to remember, and the adaptive
     * resolution scaler changes the pixel ratio on its own every few seconds
     * without going through window resize -- so the scene target silently
     * stopped matching the canvas and the blit came out scrambled. Nothing
     * outside this file should have to know.
     */
    sync(renderer) {
      const size = renderer.getDrawingBufferSize(_size);
      const w = Math.max(1, size.x | 0), h = Math.max(1, size.y | 0);
      if (w === rtScene.width && h === rtScene.height) return;
      rtScene.setSize(w, h);
      rtA.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
      rtB.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    },

    resize() { /* kept so old callers are harmless; sync() does the work */ },

    /** Render the world into the bloom source instead of the canvas. */
    beginScene(renderer) {
      /* Only divert the frame if we are actually going to put it back.
         This used to redirect unconditionally while the blit lived behind
         `if (this.bloom)`, so switching bloom off rendered the whole world
         into a target nothing ever copied to the screen -- and made my own
         bloom-on/bloom-off comparison meaningless. */
      if (!this.bloom) { renderer.setRenderTarget(null); return null; }
      this.sync(renderer);
      renderer.setRenderTarget(rtScene);
      renderer.clear();
      return rtScene;
    },

    render(renderer, time) {
      grain.uniforms.uTime.value = time;
      lens.uniforms.uTime.value = time;

      if (this.bloom) {
        const w = rtA.width, h = rtA.height;
        passMesh.material = brightMat;
        brightMat.uniforms.tSrc.value = rtScene.texture;
        renderer.setRenderTarget(rtA);
        renderer.render(bloomScene, bloomCam);

        passMesh.material = blurMat;
        blurMat.uniforms.tSrc.value = rtA.texture;
        blurMat.uniforms.uDir.value.set(1 / w, 0);
        renderer.setRenderTarget(rtB);
        renderer.render(bloomScene, bloomCam);

        blurMat.uniforms.tSrc.value = rtB.texture;
        blurMat.uniforms.uDir.value.set(0, 1 / h);
        renderer.setRenderTarget(rtA);
        renderer.render(bloomScene, bloomCam);

        bloomMat.map = rtA.texture;
        bloomMesh.visible = true;
      } else {
        bloomMesh.visible = false;
      }

      // the scene itself, blitted back to the canvas
      renderer.setRenderTarget(null);
      if (this.bloom) {
        passMesh.material = blitMat;
        blitMat.uniforms.tSrc.value = rtScene.texture;
        renderer.render(bloomScene, bloomCam);
      }
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = true;
    },
  };
}
