import { Mesh } from '../../lib/mesh.mjs';

/** Pavement A-frame. Pair with ground_cafe. */

export const tags = ["signage","spillout","clutter"];

export default () => new Mesh()
  .box('timber_painted', { size: [0.7, 1.0, 0.05], pos: [0, 0.5, -0.22], rot: [0.22, 0, 0] })
  .box('timber_painted', { size: [0.7, 1.0, 0.05], pos: [0, 0.5, 0.22], rot: [-0.22, 0, 0] })
  .box('timber_painted', { size: [0.7, 0.05, 0.05], pos: [0, 1.0, 0] });
