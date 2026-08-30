import { Mesh } from '../../lib/mesh.mjs';

/** Portal dock crane. The harbour landmark. */

export const tags = ["harbour","landmark"];

export default () => {
  const m = new Mesh();
  for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
    m.box('metal_painted', { size: [0.3, 9.0, 0.3], pos: [x, 4.5, z] });
  }
  for (const y of [3.0, 6.0]) {
    m.box('metal_painted', { size: [3.5, 0.16, 0.16], pos: [0, y, -1.6] });
    m.box('metal_painted', { size: [3.5, 0.16, 0.16], pos: [0, y, 1.6] });
    m.box('metal_painted', { size: [0.16, 0.16, 3.5], pos: [-1.6, y, 0] });
    m.box('metal_painted', { size: [0.16, 0.16, 3.5], pos: [1.6, y, 0] });
  }
  m.box('metal_painted', { size: [4.0, 1.6, 4.0], pos: [0, 9.8, 0] });
  m.box('metal_galv', { size: [0.5, 0.5, 14.0], pos: [0, 10.4, 6.0] });
  m.box('metal_galv', { size: [0.4, 0.4, 5.0], pos: [0, 10.4, -3.0] });
  m.box('glass_shop', { size: [1.4, 1.1, 1.4], pos: [1.6, 9.4, 1.6] });
  m.box('metal_rust', { size: [0.9, 1.2, 0.9], pos: [0, 8.6, 9.5] });
  return m;
};
