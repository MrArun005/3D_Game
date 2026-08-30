import { Mesh } from '../../lib/mesh.mjs';

/** ISO shipping container. */

export const tags = ["harbour","industrial"];

export default () => new Mesh()
  .box('metal_rust', { size: [6.05, 2.59, 2.44], pos: [0, 1.295, 0] })
  .box('metal_painted', { size: [6.1, 0.14, 2.5], pos: [0, 0.07, 0] })
  .box('metal_painted', { size: [6.1, 0.14, 2.5], pos: [0, 2.52, 0] })
  .box('metal_painted', { size: [0.1, 2.5, 2.5], pos: [-3.0, 1.3, 0] })
  .box('metal_painted', { size: [0.1, 2.5, 2.5], pos: [3.0, 1.3, 0] });
