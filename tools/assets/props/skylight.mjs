import { Mesh } from '../../lib/mesh.mjs';

/** Pitched rooflight. */

export const tags = ["roof"];

export default () => new Mesh()
  .box('metal_galv', { size: [2.2, 0.24, 1.6], pos: [0, 0.12, 0] })
  .box('glass_curtain', { size: [2.0, 0.5, 1.4], pos: [0, 0.42, 0], rot: [0.2, 0, 0] });
