import { Mesh } from '../../lib/mesh.mjs';

/** Gully grate. Place against the kerb line. */

export const tags = ["street","kerb","flat"];

export default () => new Mesh()
  .box('kerb_stone', { size: [0.52, 0.05, 0.34] })
  .box('metal_rust', { size: [0.42, 0.05, 0.26], pos: [0, 0.01, 0] });
