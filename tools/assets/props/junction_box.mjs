import { Mesh } from '../../lib/mesh.mjs';

/** Kerbside services cabinet. */

export const tags = ["street","kerb","service"];

export default () => new Mesh()
  .box('concrete_cast', { size: [0.9, 0.1, 0.55], pos: [0, 0.05, 0] })
  .box('metal_galv', { size: [0.8, 1.25, 0.42], pos: [0, 0.68, 0] })
  .box('metal_galv', { size: [0.88, 0.08, 0.5], pos: [0, 1.34, 0] })
  .box('metal_painted', { size: [0.36, 0.06, 0.03], pos: [0.2, 0.7, 0.22] });
