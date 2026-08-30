import { Mesh } from '../../lib/mesh.mjs';

/** Timber-slat park bin. */

export const tags = ["park","clutter"];

export default () => new Mesh()
  .cylinder('timber_bare', { r: [0.26, 0.3], h: 0.8, seg: 10 })
  .cylinder('timber_painted', { r: 0.34, h: 0.07, seg: 10, pos: [0, 0.8, 0] })
  .box('metal_galv', { size: [0.05, 0.9, 0.05], pos: [0, 0.45, 0.3] });
