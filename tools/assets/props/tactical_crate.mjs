import { Mesh } from '../../lib/mesh.mjs';

/** Tactical military / police supply drop crate with steel corner guards. */

export const tags = ["clutter", "industrial", "police", "loot"];

export default () => new Mesh()
  // Main painted composite case
  .box('metal_painted', { size: [1.1, 0.72, 0.78], pos: [0, 0.36, 0] })
  // Protective lid band
  .box('metal_painted', { size: [1.14, 0.14, 0.82], pos: [0, 0.68, 0] })
  // Front heavy duty latch
  .box('alloy_polished', { size: [0.14, 0.12, 0.04], pos: [0, 0.62, 0.42] })
  // Side lifting handles
  .box('metal_galv', { size: [0.04, 0.08, 0.28], pos: [0.57, 0.48, 0] })
  .box('metal_galv', { size: [0.04, 0.08, 0.28], pos: [-0.57, 0.48, 0] })
  // Stenciled yellow hazard marker panel
  .box('plastic_signage', { size: [0.38, 0.18, 0.02], pos: [0, 0.38, 0.40] });
