import { Mesh } from '../../lib/mesh.mjs';

/** Elevated helicopter landing pad with perimeter safety rim and corner lights. */

export const tags = ["roof", "infrastructure", "helipad"];

export default () => new Mesh()
  // Main concrete octagonal landing deck
  .cylinder('concrete_cast', { r: [5.2, 5.4], h: 0.28, seg: 12, pos: [0, 0.14, 0] })
  // Asphalt touchdown center ring
  .cylinder('asphalt', { r: [4.2, 4.2], h: 0.04, seg: 12, pos: [0, 0.3, 0] })
  // Yellow/hazard painted landing cross / 'H' markings
  .box('plastic_signage', { size: [0.5, 0.06, 2.8], pos: [-0.9, 0.32, 0] })
  .box('plastic_signage', { size: [0.5, 0.06, 2.8], pos: [0.9, 0.32, 0] })
  .box('plastic_signage', { size: [1.8, 0.06, 0.5], pos: [0, 0.32, 0] })
  // Perimeter perimeter warning border
  .cylinder('metal_painted', { r: [5.3, 5.35], h: 0.12, seg: 12, pos: [0, 0.34, 0] })
  // 4 elevated corner landing beacon mounts
  .cylinder('alloy_polished', { r: [0.08, 0.08], h: 0.45, seg: 6, pos: [3.8, 0.45, 3.8] })
  .cylinder('alloy_polished', { r: [0.08, 0.08], h: 0.45, seg: 6, pos: [-3.8, 0.45, 3.8] })
  .cylinder('alloy_polished', { r: [0.08, 0.08], h: 0.45, seg: 6, pos: [3.8, 0.45, -3.8] })
  .cylinder('alloy_polished', { r: [0.08, 0.08], h: 0.45, seg: 6, pos: [-3.8, 0.45, -3.8] });
