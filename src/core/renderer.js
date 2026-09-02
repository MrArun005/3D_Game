import * as THREE from 'three';

export const FOG_COLOUR = 0x222a3a;
export const FOG_DAY = 0xb7c9dd;
/** Where the day sun is. The sky dome paints its disc from this same vector. */
export const DAY_SUN = new THREE.Vector3(-190, 250, 120);
/** Layer bit the far shadow cascade renders. Building shells enable it; nothing else does. */
export const SHADOW_FAR_LAYER = 3;

export function createRenderer(canvas) {
  /* WebGPURenderer, from the three/webgpu build the vite alias points at.
     It picks a WebGPU device where one exists and a WebGL2 backend where one
     does not, so this is not a hardware requirement -- it is the node-based
     material system, which is what Tier 1's post stack needs. */
  const renderer = new THREE.WebGPURenderer({
    canvas, antialias: true, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
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
  return renderer;
}

/**
 * Resolution is the single biggest cost in this scene: at DPR 2 on a Retina
 * panel we are shading 6.7 megapixels and the M2 drops to 37fps; at 1.25 the
 * exact same frame locks 60. So we do not pick a fixed ratio -- we watch the
 * frame time and let the panel earn its pixels back.
 */
export function autoResolution(renderer) {
  const MIN = 1, MAX = Math.min(window.devicePixelRatio, 2);
  let acc = 0, n = 0, hold = 0;
  return (dt) => {
    if (hold > 0) { hold -= dt; return; }
    acc += dt; n++;
    if (n < 45) return;
    const ms = (acc / n) * 1000; acc = 0; n = 0;
    const pr = renderer.getPixelRatio();
    // 19ms leaves headroom under the 16.7ms budget; 13.5 means we have spare
    const next = ms > 19 ? pr - 0.25 : ms < 13.5 ? pr + 0.25 : pr;
    const want = Math.max(MIN, Math.min(MAX, next));
    if (want !== pr) {
      renderer.setPixelRatio(want);
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      hold = 0.6;   // let the new resolution settle before judging it
    }
  };
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
  const hemi = new THREE.HemisphereLight(0xa9c4e0, 0x8f8873, 0.55);
  scene.add(hemi);

  /* Two suns, one shadow each: a poor man's cascade.
     A single 2048 map over 240m of width is 8.5 texels per metre, which is why
     a kerb five metres away had no shadow worth the name. `near` spans 80m at
     25.6 texels/m -- three times the density, over the street you are actually
     in; `far` spans 460m at 4.5 texels/m for the towers whose shadows have to
     fall across it. Both are the same light direction and colour
     so they read as one sun. Four true cascades want a CSM pass; this buys
     most of the difference for two draws. */
  const sun = new THREE.DirectionalLight(0xffeac6, 3.4);
  sun.position.copy(DAY_SUN);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 620;
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  scene.add(sun, sun.target);

  const sunFar = new THREE.DirectionalLight(0xfff0d2, 0);   // shadows only
  sunFar.castShadow = true;
  sunFar.shadow.mapSize.set(2048, 2048);
  sunFar.shadow.camera.near = 1;
  sunFar.shadow.camera.far = 900;
  sunFar.shadow.camera.left = -230;
  sunFar.shadow.camera.right = 230;
  sunFar.shadow.camera.top = 260;
  sunFar.shadow.camera.bottom = -230;
  sunFar.shadow.bias = -0.0012;
  sunFar.shadow.normalBias = 0.09;
  /* The far cascade only sees SHADOW_FAR_LAYER. At 4.5 texels/m a bin, a
     pedestrian or a parked car casts nothing you can see, yet every caster
     was re-drawn into this map: profiled 2026-09-02 at the downtown spawn,
     the far pass cost 1.36M triangles with everything casting and 0.2M with
     only the building shells. The WebGPU shadow pass renders through
     renderer.render(scene, shadow.camera), which honours camera.layers, so
     the shells enable the bit (districtWorld) and this camera looks only at
     it. The near cascade keeps every caster. */
  sunFar.shadow.camera.layers.set(SHADOW_FAR_LAYER);
  scene.add(sunFar, sunFar.target);

  const fill = new THREE.DirectionalLight(0xd8e6f5, 0.22);
  fill.position.set(180, 80, -160);
  scene.add(fill);
  return { hemi, sun, sunFar, fill };
}

export function createScene(day = false) {
  const scene = new THREE.Scene();
  // clear daylight sees a long way; a 4.2km city is worth showing off
  scene.fog = day ? new THREE.FogExp2(FOG_DAY, 0.00017)   // aerial perspective: depth, not murk
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
