import { Mesh } from '../../lib/mesh.mjs';

/** Tapered street litter bin. */

export const tags = ["street","kerb","clutter"];

export default () => new Mesh()
  .cylinder('metal_painted', { r: [0.24, 0.28], h: 0.86, seg: 10 })
  .cylinder('metal_galv', { r: 0.3, h: 0.06, seg: 10, pos: [0, 0.86, 0] })
  .box('metal_painted', { size: [0.06, 0.5, 0.06], pos: [0, 0.25, 0.3] });
