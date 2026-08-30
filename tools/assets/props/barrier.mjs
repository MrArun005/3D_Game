import { Mesh } from '../../lib/mesh.mjs';

/** Plastic roadworks barrier. */

export const tags = ["roadworks"];

export default () => new Mesh()
  .box('plastic_signage', { size: [2.0, 0.65, 0.42], pos: [0, 0.33, 0] })
  .box('plastic_signage', { size: [2.0, 0.14, 0.5], pos: [0, 0.72, 0] })
  .box('metal_galv', { size: [0.1, 0.8, 0.1], pos: [-0.9, 0.4, 0] })
  .box('metal_galv', { size: [0.1, 0.8, 0.1], pos: [0.9, 0.4, 0] });
