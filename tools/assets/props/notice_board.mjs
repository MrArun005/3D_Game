import { Mesh } from '../../lib/mesh.mjs';

/** Glazed park notice board. */

export const tags = ["park","clutter"];

export default () => new Mesh()
  .box('timber_bare', { size: [0.1, 1.9, 0.1], pos: [-0.75, 0.95, 0] })
  .box('timber_bare', { size: [0.1, 1.9, 0.1], pos: [0.75, 0.95, 0] })
  .box('timber_painted', { size: [1.7, 1.05, 0.09], pos: [0, 1.5, 0] })
  .box('glass_shop', { size: [1.5, 0.88, 0.03], pos: [0, 1.5, 0.06] })
  .wedge('timber_painted', { size: [1.85, 0.22, 0.34], pos: [0, 2.03, 0.02] });
