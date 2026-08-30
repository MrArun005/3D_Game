import { Mesh } from '../../lib/mesh.mjs';

/** Applied pilaster with base and cap. Breaks long period frontages. */

export const tags = ["vertical","period"];

export default () => new Mesh()
  .box('stone_dressed', { size: [0.55, 3.2, 0.28], pos: [0, 1.6, -0.14] })
  .box('stone_dressed', { size: [0.7, 0.3, 0.36], pos: [0, 0.15, -0.14] })
  .box('stone_dressed', { size: [0.7, 0.26, 0.36], pos: [0, 3.07, -0.14] });
