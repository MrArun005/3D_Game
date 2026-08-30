import { Mesh } from '../../lib/mesh.mjs';

/** Projecting shop sign on a bracket. */

export const tags = ["signage","facade","retail"];

export default () => new Mesh()
  .box('metal_galv', { size: [0.5, 0.09, 0.09], pos: [0.25, 2.6, 0] })
  .box('metal_galv', { size: [0.06, 0.55, 0.06], pos: [0.48, 2.35, 0] })
  .box('plastic_signage', { size: [0.09, 0.95, 1.25], pos: [0.5, 1.95, 0] });
