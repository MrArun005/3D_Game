import { Mesh } from '../../lib/mesh.mjs';

/** Heavy concrete Jersey barrier for roadblocks and perimeter security. */

export const tags = ["roadworks", "police", "street"];

export default () => new Mesh()
  // Wide weighted base
  .box('concrete_precast', { size: [2.4, 0.28, 0.64], pos: [0, 0.14, 0] })
  // Inward taper midsection
  .box('concrete_precast', { size: [2.36, 0.38, 0.44], pos: [0, 0.44, 0] })
  // Narrow vertical top crest
  .box('concrete_precast', { size: [2.34, 0.32, 0.24], pos: [0, 0.76, 0] })
  // Reflective hazard striping
  .box('plastic_signage', { size: [0.6, 0.22, 0.26], pos: [-0.6, 0.76, 0] })
  .box('plastic_signage', { size: [0.6, 0.22, 0.26], pos: [0.6, 0.76, 0] })
  // Galvanized steel crane lifting loop
  .cylinder('metal_galv', { r: [0.03, 0.03], h: 0.22, seg: 6, pos: [0, 0.98, 0] });
