import { mrt, vec4, output } from 'three/tsl';

/**
 * Every additive material in the game goes through here. Blending applies to
 * EVERY MRT target, so an additive sprite also adds garbage into the normal
 * target GTAO reads and the pixels behind it come out occluded (the rain
 * speckle bug, 2026-08-31). `mrt({ normal: vec4(0) })` is the additive
 * identity: the pixels keep their real normals. One shared node.
 */
export const NO_NORMAL = mrt({ normal: vec4(0) });
export function additive(material) { material.mrtNode = NO_NORMAL; return material; }

/**
 * A material that BLOOMS. Bloom reads the emissive MRT target, and a Basic,
 * Points or Line material writes nothing there, which is why tracers, sparks
 * and muzzle flashes were flat streaks and dots: they never reached the bloom
 * pass. This routes the material's own output into the emissive target,
 * scaled, with the normal guard. The per-material mrt merges with the scene
 * pass's (NodeMaterial.setup: mrt.merge(materialMRT)), so colour still lands.
 */
export function glow(material, strength = 1) {
  material.mrtNode = mrt({ normal: vec4(0), emissive: output.mul(strength) });
  return material;
}
