import { Mesh } from '../../lib/mesh.mjs';

/** Parasol on a weighted base. */

export const tags = ["street","spillout","seating"];

export default () => new Mesh()
  .cylinder('concrete_cast', { r: 0.34, h: 0.1, seg: 10 })
  .cylinder('metal_galv', { r: 0.045, h: 2.3, seg: 8, pos: [0, 0.1, 0] })
  .cylinder('fabric_awning', { r: [1.55, 0.12], h: 0.42, seg: 8, pos: [0, 2.05, 0], caps: false })
  .box('fabric_awning', { size: [0.12, 0.3, 0.12], pos: [0, 2.4, 0] });
