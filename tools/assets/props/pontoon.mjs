import { Mesh } from '../../lib/mesh.mjs';

/** Floating timber pontoon on guide piles. */

export const tags = ["harbour","water"];

export default () => new Mesh()
  .box('timber_bare', { size: [8.0, 0.3, 2.6], pos: [0, 0.15, 0] })
  .box('timber_painted', { size: [8.0, 0.12, 0.12], pos: [0, 0.36, -1.24] })
  .box('timber_painted', { size: [8.0, 0.12, 0.12], pos: [0, 0.36, 1.24] })
  .box('metal_galv', { size: [0.16, 3.0, 0.16], pos: [-3.6, 1.5, 1.24] })
  .box('metal_galv', { size: [0.16, 3.0, 0.16], pos: [3.6, 1.5, 1.24] });
