import { Mesh } from '../../lib/mesh.mjs';

/** One bay of scaffold with boarded lifts. */

export const tags = ["roadworks","facade"];

export default () => {
  const m = new Mesh();
  for (const z of [-0.6, 0.6]) {
    m.repeatX(2, 2.4, (x) => m.cylinder('metal_galv', { r: 0.05, h: 6.0, seg: 6, pos: [x, 0, z] }));
    for (const y of [2.0, 4.0, 6.0]) m.box('metal_galv', { size: [2.5, 0.05, 0.05], pos: [0, y, z] });
  }
  for (const y of [2.0, 4.0]) {
    m.box('timber_bare', { size: [2.4, 0.05, 1.15], pos: [0, y + 0.05, 0] });
    m.box('metal_galv', { size: [2.5, 0.05, 0.05], pos: [0, y + 1.0, 0.62] });
  }
  m.box('metal_galv', { size: [0.05, 6.0, 1.3], pos: [-1.2, 3.0, 0], rot: [0, 0, 0] });
  return m;
};
