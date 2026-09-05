import { mrt, vec4 } from 'three/tsl';

/**
 * Every additive material in the game goes through here. Blending applies to
 * EVERY MRT target, so an additive sprite also adds garbage into the normal
 * target GTAO reads and the pixels behind it come out occluded (the rain
 * speckle bug, 2026-08-31). `mrt({ normal: vec4(0) })` is the additive
 * identity: the pixels keep their real normals. One shared node.
 */
export const NO_NORMAL = mrt({ normal: vec4(0) });
export function additive(material) { material.mrtNode = NO_NORMAL; return material; }
