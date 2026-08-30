import { Mesh } from '../../lib/mesh.mjs';

/** Standard pavement bollard. */

export const tags = ["street","kerb","clutter"];

export default () => new Mesh()
  .cylinder('metal_painted', { r: 0.11, h: 0.92, seg: 10 })
  .cylinder('metal_painted', { r: 0.14, h: 0.09, seg: 10, pos: [0, 0.92, 0] });
