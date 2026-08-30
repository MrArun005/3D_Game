import { Mesh } from '../../lib/mesh.mjs';

/** Timber site hoarding with a signage panel. */

export const tags = ["boundary","roadworks"];

export default () => new Mesh()
  .box('timber_painted', { size: [4.0, 2.4, 0.1], pos: [0, 1.2, 0] })
  .box('timber_bare', { size: [0.1, 2.5, 0.1], pos: [-1.9, 1.25, -0.1] })
  .box('timber_bare', { size: [0.1, 2.5, 0.1], pos: [1.9, 1.25, -0.1] })
  .box('timber_bare', { size: [4.0, 0.12, 0.12], pos: [0, 2.42, -0.1] })
  .box('plastic_signage', { size: [1.6, 1.0, 0.03], pos: [0.6, 1.5, 0.06] });
