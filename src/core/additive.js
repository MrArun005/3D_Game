import { mrt, vec4, output } from 'three/tsl';

/**
 * Every additive material in the game goes through here. Blending applies to
 * EVERY MRT target, so an additive sprite also adds garbage into the normal
 * target GTAO reads and the pixels behind it come out occluded (the rain
 * speckle bug, 2026-08-31). `mrt({ normal: vec4(0) })` is the additive
 * identity: the pixels keep their real normals. One shared node.
 */
export const NO_NORMAL = mrt({ normal: vec4(0) });
/* Point sprites ONLY. main.js measured the other case: on a quad or a mesh a
   zero normal reads as full occlusion to GTAO and the whole thing goes black
   (the headlight road decal). Sprites are tiny and additive, so their normal
   contribution is what smears; a mesh's real normal is the right one. */
export function additive(material) { if (material.isPointsMaterial) material.mrtNode = NO_NORMAL; return material; }

/**
 * A material that BLOOMS. Bloom reads the emissive MRT target, and a Basic,
 * Points or Line material writes nothing there, which is why tracers, sparks
 * and muzzle flashes were flat streaks and dots: they never reached the bloom
 * pass. This routes the material's own output into the emissive target,
 * scaled, with the normal guard. The per-material mrt merges with the scene
 * pass's (NodeMaterial.setup: mrt.merge(materialMRT)), so colour still lands.
 */
export function glow(material, strength = 1) {
  // meshes and lines keep their real normal (see additive); only point sprites zero it
  material.mrtNode = material.isPointsMaterial ? mrt({ normal: vec4(0), emissive: output.mul(strength) }) : mrt({ emissive: output.mul(strength) });
  return material;
}
