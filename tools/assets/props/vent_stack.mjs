import { Mesh } from '../../lib/mesh.mjs';

/** Brick vent stack with flue pipes. */

export const tags = ["roof","plant"];

export default () => new Mesh()
  .box('brick_red', { size: [1.1, 1.9, 1.1], pos: [0, 0.95, 0] })
  .box('concrete_cast', { size: [1.3, 0.16, 1.3], pos: [0, 1.98, 0] })
  .cylinder('metal_rust', { r: 0.19, h: 0.8, seg: 8, pos: [-0.25, 2.06, 0] })
  .cylinder('metal_rust', { r: 0.19, h: 1.1, seg: 8, pos: [0.25, 2.06, 0] });
