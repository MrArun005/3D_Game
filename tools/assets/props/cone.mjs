import { Mesh } from '../../lib/mesh.mjs';

/** Traffic cone. */

export const tags = ["roadworks","clutter"];

export default () => new Mesh()
  .box('plastic_signage', { size: [0.36, 0.05, 0.36] })
  .cylinder('plastic_signage', { r: [0.15, 0.03], h: 0.68, seg: 8, pos: [0, 0.05, 0] });
