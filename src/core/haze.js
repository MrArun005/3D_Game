import * as THREE from 'three';
import { Fn, uniform, vec4, output, positionWorld, cameraPosition, smoothstep, exp, max, pow, dot, normalize, mix } from 'three/tsl';

/**
 * Aerial haze (2026-09-28) -- OPT-IN, `?haze`. renderer.js createScene records
 * the owner's 2026-09-13 instruction: no fog, anywhere. This is not on by
 * default for that reason; it exists so he can look at it and decide.
 *
 * What it is: a scene.fogNode (material stage, no extra pass, no depth read --
 * grade.js's depth-reconstruction dead end does not apply) that
 *   - starts at START m and saturates at CAP, so the streets you drive stay
 *     crisp and only the far city softens;
 *   - thins with height (scale HEIGHT m), so tower tops stand out of it;
 *   - takes its colour from the sun and the sky: warm looking toward the sun,
 *     the sky's blue looking away -- one dot product.
 * The sky dome, the mountain belt and every additive material are `fog: false`
 * or skipped below, so the haze never touches the sky or adds light.
 * Cost: ~12 ALU per fragment on fogged materials, one uniform update a frame.
 * It changes every material's program cache key, so it is boot-time only.
 */
const _c = new THREE.Color();
const START = 260, FULL = 1400, CAP = 0.55, HEIGHT = 140;

export function createHaze(scene) {
  const warm = uniform(new THREE.Color(1, 0.8, 0.6));
  const cool = uniform(new THREE.Color(0.55, 0.66, 0.85));
  const sunDir = uniform(new THREE.Vector3(0, 0.3, 1));
  const amount = uniform(1);

  scene.fogNode = Fn((_, builder) => {
    const m = builder.material;
    if (m && (m.blending === THREE.AdditiveBlending || m.isSpriteNodeMaterial)) return output;
    const rel = positionWorld.sub(cameraPosition);
    const d = rel.length();
    const view = normalize(rel);
    const lift = exp(max(positionWorld.y, 0).div(-HEIGHT));
    const k = smoothstep(START, FULL, d).mul(lift).mul(CAP).mul(amount);
    const toward = pow(max(dot(view, sunDir), 0), 5);
    const col = mix(cool, warm, toward);
    return vec4(mix(output.rgb, col, k), output.a);
  })();

  return {
    /** Per frame from main, from the lights clock.js just wrote: the haze is
        in the same linear units as a lit surface, so it scales with them. */
    update(sun, hemi, k) {
      sunDir.value.copy(sun.position).sub(sun.target.position).normalize();
      warm.value.copy(sun.color).multiplyScalar(sun.intensity * 0.22).add(_c.copy(hemi.color).multiplyScalar(hemi.intensity));
      cool.value.copy(hemi.color).multiplyScalar(hemi.intensity * 1.6 + 0.25);
      amount.value = k;
    },
  };
}
