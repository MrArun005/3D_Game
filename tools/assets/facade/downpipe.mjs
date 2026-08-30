import { Mesh } from '../../lib/mesh.mjs';

/** Cast downpipe on brackets. Cheapest way to make a blank wall read as real. */

export const tags = ["vertical","service"];

export default () => new Mesh()
  .cylinder('metal_galv', { r: 0.055, h: 3.2, seg: 8, pos: [0, 0, -0.1] })
  .box('metal_galv', { size: [0.16, 0.06, 0.16], pos: [0, 1.0, -0.1] })
  .box('metal_galv', { size: [0.16, 0.06, 0.16], pos: [0, 2.4, -0.1] });
