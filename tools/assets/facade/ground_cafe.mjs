import { Mesh } from '../../lib/mesh.mjs';
import ground_shopfront from './ground_shopfront.mjs';

/** Shopfront plus pavement tables. Pair with cafe_umbrella and a_frame_sign. */

export const tags = ["ground","retail","spillout"];

export default () => {
  const m = ground_shopfront();
  m.box('metal_painted', { size: [0.05, 0.75, 0.05], pos: [-1.2, 0.375, -1.5] });
  m.box('timber_bare', { size: [0.7, 0.06, 0.7], pos: [-1.2, 0.75, -1.5] });
  m.box('metal_painted', { size: [0.05, 0.75, 0.05], pos: [1.2, 0.375, -1.5] });
  m.box('timber_bare', { size: [0.7, 0.06, 0.7], pos: [1.2, 0.75, -1.5] });
  return m;
};
