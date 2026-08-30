import { Mesh } from '../../lib/mesh.mjs';

/** Roof access hut. */

export const tags = ["roof","access"];

export default () => new Mesh()
  .box('brick_painted', { size: [2.4, 2.3, 2.0], pos: [0, 1.15, 0] })
  .box('concrete_cast', { size: [2.6, 0.16, 2.2], pos: [0, 2.38, 0] })
  .box('metal_painted', { size: [0.9, 2.0, 0.1], pos: [0, 1.0, 1.02] })
  .box('metal_galv', { size: [0.7, 0.45, 0.1], pos: [0, 2.0, -1.02] });
