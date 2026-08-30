import { Mesh } from '../../lib/mesh.mjs';

/** Kerbside fire hydrant. */

export const tags = ["street","kerb","clutter"];

export default () => new Mesh()
  .cylinder('metal_rust', { r: 0.2, h: 0.1, seg: 10 })
  .cylinder('metal_painted', { r: 0.13, h: 0.62, seg: 10, pos: [0, 0.1, 0] })
  .cylinder('metal_painted', { r: 0.17, h: 0.12, seg: 10, pos: [0, 0.72, 0] })
  .cylinder('metal_painted', { r: 0.08, h: 0.14, seg: 8, pos: [0, 0.84, 0] })
  .box('metal_painted', { size: [0.46, 0.14, 0.14], pos: [0, 0.5, 0] });
