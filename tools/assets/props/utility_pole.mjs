import { Mesh } from '../../lib/mesh.mjs';

/** Timber utility pole with crossarms. */

export const tags = ["street","kerb","service"];

export default () => {
  const m = new Mesh();
  m.cylinder('timber_bare', { r: [0.17, 0.13], h: 8.5, seg: 8 });
  for (const y of [7.3, 7.9]) {
    m.box('timber_bare', { size: [2.2, 0.12, 0.14], pos: [0, y, 0] });
    m.repeatX(4, 0.6, (x) => m.cylinder('glass_shop', { r: 0.055, h: 0.16, seg: 6, pos: [x, y + 0.06, 0] }));
  }
  m.box('metal_rust', { size: [0.36, 0.5, 0.36], pos: [0.2, 5.4, 0] });
  return m;
};
