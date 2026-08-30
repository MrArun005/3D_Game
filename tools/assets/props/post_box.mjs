import { Mesh } from '../../lib/mesh.mjs';

/** Pillar post box. */

export const tags = ["street","kerb","clutter"];

export default () => new Mesh()
  .cylinder('metal_painted', { r: 0.32, h: 1.25, seg: 12 })
  .cylinder('metal_painted', { r: 0.35, h: 0.1, seg: 12, pos: [0, 1.25, 0] })
  .cylinder('metal_painted', { r: 0.22, h: 0.14, seg: 12, pos: [0, 1.35, 0] })
  .box('metal_rust', { size: [0.3, 0.05, 0.06], pos: [0, 1.0, 0.31] });
