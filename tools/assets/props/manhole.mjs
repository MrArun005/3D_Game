import { Mesh } from '../../lib/mesh.mjs';

/** Flush manhole cover. Place on the carriageway. */

export const tags = ["street","road","flat"];

export default () => new Mesh()
  .cylinder('metal_rust', { r: 0.35, h: 0.04, seg: 14 })
  .cylinder('kerb_stone', { r: 0.42, h: 0.03, seg: 14 });
