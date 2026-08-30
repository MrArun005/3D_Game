import { Mesh } from '../../lib/mesh.mjs';

/** Pond retaining edge with a timber lip. */

export const tags = ["park","water","edge"];

export default () => new Mesh()
  .box('stone_dressed', { size: [3.0, 0.5, 0.8], pos: [0, 0.25, 0] })
  .box('stone_dressed', { size: [3.0, 0.14, 1.0], pos: [0, 0.57, 0] })
  .box('timber_bare', { size: [3.0, 0.5, 0.25], pos: [0, 0.25, 0.52] });
