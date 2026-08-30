import { Mesh } from '../../lib/mesh.mjs';

/** Illuminated wall-mounted fascia box. */

export const tags = ["signage","facade","retail"];

export default () => new Mesh()
  .box('plastic_signage', { size: [2.6, 0.7, 0.18], pos: [0, 0.35, 0] })
  .box('metal_galv', { size: [2.7, 0.08, 0.22], pos: [0, 0.04, 0] })
  .box('metal_galv', { size: [2.7, 0.08, 0.22], pos: [0, 0.66, 0] });
