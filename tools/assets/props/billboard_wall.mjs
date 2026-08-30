import { Mesh } from '../../lib/mesh.mjs';

/** Wall-mounted billboard. */

export const tags = ["signage","facade"];

export default () => new Mesh()
  .box('metal_galv', { size: [6.2, 3.2, 0.14], pos: [0, 1.6, 0] })
  .box('plastic_signage', { size: [5.9, 2.95, 0.06], pos: [0, 1.6, 0.09] })
  .box('metal_galv', { size: [6.4, 0.14, 0.5], pos: [0, 3.32, 0.16] });
