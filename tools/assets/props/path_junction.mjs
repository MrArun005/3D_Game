import { Mesh } from '../../lib/mesh.mjs';

/** Park path junction piece. */

export const tags = ["park","path","flat"];

export default () => new Mesh()
  .slab('pavement_slab', { size: [2.4, 0.09, 2.4] })
  .box('kerb_stone', { size: [0.16, 0.13, 0.16], pos: [-1.28, 0.065, -1.28], base: false })
  .box('kerb_stone', { size: [0.16, 0.13, 0.16], pos: [1.28, 0.065, -1.28], base: false })
  .box('kerb_stone', { size: [0.16, 0.13, 0.16], pos: [-1.28, 0.065, 1.28], base: false })
  .box('kerb_stone', { size: [0.16, 0.13, 0.16], pos: [1.28, 0.065, 1.28], base: false });
