import { Mesh } from '../../lib/mesh.mjs';

/** Cast mooring bollard. */

export const tags = ["harbour","edge","clutter"];

export default () => new Mesh()
  .cylinder('metal_rust', { r: 0.34, h: 0.14, seg: 12 })
  .cylinder('metal_rust', { r: [0.24, 0.19], h: 0.55, seg: 12, pos: [0, 0.14, 0] })
  .cylinder('metal_rust', { r: 0.3, h: 0.16, seg: 12, pos: [0, 0.69, 0] });
