import * as THREE from 'three';
import { uv, texture, instancedBufferAttribute, reference, vec2, vec3, vec4, float, smoothstep, length } from 'three/tsl';
import { glow } from './additive.js';

/**
 * Turn a THREE.Points cloud into sized, instanced sprites -- in place.
 *
 * WebGPU draws THREE.Points at ONE pixel (CLAUDE.md, glare notes): `size` and
 * `sizeAttenuation` are ignored, so every spark, smoke puff, rain streak, fire
 * core, blood spray and steam jet in the game was a dot. The glare sprites
 * fixed it for lamps with an instanced THREE.Sprite; this does the same for
 * every particle system WITHOUT rewriting them:
 *
 *   - the Points' own position (and colour) arrays are re-wrapped as
 *     InstancedBufferAttributes and put back on its geometry, so the owner's
 *     `geometry.attributes.position.needsUpdate = true` and its writes into the
 *     Float32Array keep driving the particles exactly as before;
 *   - a Sprite with `count = n` is added as a CHILD of the Points, so it rides
 *     whatever the Points is attached to and leaves the scene with it;
 *   - the Points itself stops drawing (material.visible = false; its children
 *     still render), and the sprite reads the PointsMaterial's size, colour and
 *     opacity by reference every frame, so owners that fade `opacity` or
 *     recolour `color` at runtime still work;
 *   - `geometry.drawRange.count`, when an owner sets one, caps the instances.
 *
 * Size: an attenuated PointsMaterial size projects like a world size of about
 * size * tan(fov / 2) (~0.55 at this game's 58 deg lens), so that is the scale.
 * Blending follows the material. Output goes through glow() -- NOT the
 * zero-normal guard, which draws a quad black under GTAO (the glare lesson) --
 * so hot particles (sparks, fire) can also feed bloom via `bloom`.
 */
export const SIZE_TO_METRES = 0.55;

export function spriteCloud(points, { bloom = 0 } = {}) {
  if (!points?.isPoints || points.userData.spriteCloud) return points?.userData?.spriteCloud ?? null;
  if (!THREE.SpriteNodeMaterial) return null;   // plain three (the node test runner): nothing to draw, leave the Points alone
  const pm = points.material, geo = points.geometry;
  const pa = geo.attributes.position;
  if (!pa || !pa.count) return null;
  const n = pa.count;

  const ipos = new THREE.InstancedBufferAttribute(pa.array, 3);
  ipos.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', ipos);
  let icol = null;
  if (pm.vertexColors && geo.attributes.color) {
    const ca = geo.attributes.color;
    icol = new THREE.InstancedBufferAttribute(ca.array, ca.itemSize);
    icol.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('color', icol);
  }

  const m = new THREE.SpriteNodeMaterial({
    transparent: true, depthWrite: false, depthTest: pm.depthTest !== false,
    blending: pm.blending ?? THREE.NormalBlending, fog: false,
  });
  m.positionNode = instancedBufferAttribute(ipos);
  const size = reference('size', 'float', pm).mul(SIZE_TO_METRES);
  m.scaleNode = vec2(size, size);
  m.sizeAttenuation = pm.sizeAttenuation !== false;

  const c = uv().sub(0.5);
  const disc = smoothstep(float(0.5), float(0.12), length(c));          // round, soft edge on every quad
  const tex = pm.map ? texture(pm.map) : vec4(1, 1, 1, 1);
  const vc = icol ? instancedBufferAttribute(icol).xyz : vec3(1, 1, 1);
  const rgb = reference('color', 'color', pm).mul(vc).mul(tex.rgb);
  const a = tex.a.mul(disc).mul(reference('opacity', 'float', pm));
  m.colorNode = vec4(rgb, a);
  glow(m, bloom);

  const sp = new THREE.Sprite(m);
  sp.frustumCulled = false;
  sp.renderOrder = points.renderOrder;
  Object.defineProperty(sp, 'count', {
    get() { const dr = geo.drawRange.count; return Number.isFinite(dr) ? Math.max(0, Math.min(n, dr)) : n; },
    set() { /* owned by the Points' draw range */ },
    configurable: true,
  });
  points.add(sp);
  pm.visible = false;                 // the Points draws nothing; its sprite child does
  points.userData.spriteCloud = sp;
  return sp;
}
