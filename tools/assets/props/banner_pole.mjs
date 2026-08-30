import { Mesh } from '../../lib/mesh.mjs';

/** Lamp-standard banner pole. */

export const tags = ["signage","street","kerb"];

export default () => new Mesh()
  .cylinder('metal_galv', { r: 0.07, h: 5.0, seg: 8 })
  .box('metal_galv', { size: [0.06, 0.06, 0.55], pos: [0, 4.4, 0.28] })
  .box('metal_galv', { size: [0.06, 0.06, 0.55], pos: [0, 2.9, 0.28] })
  .box('fabric_awning', { size: [0.04, 1.55, 0.5], pos: [0, 3.65, 0.5] });
