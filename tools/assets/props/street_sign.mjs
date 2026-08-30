import { Mesh } from '../../lib/mesh.mjs';

/** Post-mounted street name and regulatory sign. */

export const tags = ["street","kerb","junction"];

export default () => new Mesh()
  .cylinder('metal_galv', { r: 0.045, h: 2.4, seg: 8 })
  .box('plastic_signage', { size: [0.9, 0.24, 0.03], pos: [0.35, 2.2, 0] })
  .box('plastic_signage', { size: [0.62, 0.62, 0.03], pos: [0, 1.6, 0.02] });
