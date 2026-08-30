/**
 * Shared facade construction parts.
 *
 * Every facade module is a SHELL, not a solid: the facade plane sits at z = 0
 * and the module extends backwards into -z, so districtWorld stacks these
 * against a building mass rather than replacing it. A 78 m tower stays one box
 * plus n instanced bays.
 *
 * BAY and the storey heights are a contract between every module and the
 * assembly code. Changing them changes every building in Halstead Bay.
 */
import { Mesh } from './mesh.mjs';

export const BAY = 3.6;          // module width, metres
export const H_COMM = 3.2;       // commercial storey
export const H_RES = 2.9;        // residential storey
export const H_GROUND = 4.2;     // ground floor is always taller
export const D = 0.45;                  // shell depth

/* A recessed opening: reveal box back from the facade plane, glazing behind. */
export function opening(m, { w, h, y, glass = 'glass_shop', reveal = 0.18, sill = null, frame = 'metal_painted' }) {
  m.box(glass, { size: [w - 0.1, h - 0.1, 0.04], pos: [0, y + h / 2, -reveal] });
  // reveal jambs and head, so the window reads as a hole with depth
  m.box(frame, { size: [0.09, h, reveal], pos: [-w / 2 + 0.045, y + h / 2, -reveal / 2] });
  m.box(frame, { size: [0.09, h, reveal], pos: [w / 2 - 0.045, y + h / 2, -reveal / 2] });
  m.box(frame, { size: [w, 0.09, reveal], pos: [0, y + h - 0.045, -reveal / 2] });
  if (sill) m.box(sill, { size: [w + 0.24, 0.09, 0.26], pos: [0, y - 0.02, -0.02] });
  return m;
}

/* Wall panel with a rectangular hole punched in it. Four boxes, no booleans. */
export function punched(m, mat, { w, h, ow, oh, oy, depth = D }) {
  const side = (w - ow) / 2;
  m.box(mat, { size: [side, h, depth], pos: [-(ow / 2 + side / 2), h / 2, -depth / 2] });
  m.box(mat, { size: [side, h, depth], pos: [ow / 2 + side / 2, h / 2, -depth / 2] });
  m.box(mat, { size: [ow, oy, depth], pos: [0, oy / 2, -depth / 2] });
  const above = h - (oy + oh);
  if (above > 0.01) m.box(mat, { size: [ow, above, depth], pos: [0, oy + oh + above / 2, -depth / 2] });
  return m;
}
