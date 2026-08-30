import { Mesh } from '../../lib/mesh.mjs';

/** Post-mounted parking meter. */

export const tags = ["street","kerb","clutter"];

export default () => new Mesh()
  .cylinder('metal_galv', { r: 0.05, h: 1.1, seg: 8 })
  .box('metal_painted', { size: [0.26, 0.46, 0.2], pos: [0, 1.32, 0] })
  .box('glass_shop', { size: [0.18, 0.2, 0.03], pos: [0, 1.42, 0.11] });
