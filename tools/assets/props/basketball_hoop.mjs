import { Mesh } from '../../lib/mesh.mjs';

/** Backboard and hoop on a post. */

export const tags = ["park","sport"];

export default () => new Mesh()
  .box('concrete_cast', { size: [0.7, 0.14, 0.7], pos: [0, 0.07, 0] })
  .cylinder('metal_galv', { r: 0.11, h: 3.4, seg: 8, pos: [0, 0.14, 0] })
  .box('metal_galv', { size: [0.1, 0.1, 1.0], pos: [0, 3.5, 0.5] })
  .box('plastic_signage', { size: [1.8, 1.05, 0.08], pos: [0, 3.55, 1.0] })
  .cylinder('metal_painted', { r: 0.23, h: 0.05, seg: 10, pos: [0, 3.05, 0.75], base: false });
