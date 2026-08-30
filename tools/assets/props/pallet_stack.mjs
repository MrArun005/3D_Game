import { Mesh } from '../../lib/mesh.mjs';

/** Stacked pallets. */

export const tags = ["harbour","industrial","clutter"];

export default () => {
  const m = new Mesh();
  for (let i = 0; i < 5; i++) {
    m.box('timber_bare', { size: [1.2, 0.06, 0.8], pos: [0, 0.03 + i * 0.15, 0] });
    m.box('timber_bare', { size: [0.1, 0.09, 0.8], pos: [-0.5, 0.11 + i * 0.15, 0] });
    m.box('timber_bare', { size: [0.1, 0.09, 0.8], pos: [0.5, 0.11 + i * 0.15, 0] });
  }
  return m;
};
