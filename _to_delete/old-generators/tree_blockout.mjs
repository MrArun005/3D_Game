import { Mesh } from '../../lib/mesh.mjs';

/** PLACEHOLDER. Replace with an authored or CC0 tree before Tier 3 ships. */

export const tags = ["park","green","tree","placeholder"];

export default () => {
  const m = new Mesh();
  m.cylinder('bark', { r: [0.24, 0.16], h: 2.6, seg: 8 });
  m.box('bark', { size: [1.4, 0.12, 0.12], pos: [0.4, 2.3, 0], rot: [0, 0, 0.5] });
  m.box('bark', { size: [1.2, 0.12, 0.12], pos: [-0.35, 2.6, 0.2], rot: [0, 1.1, -0.6] });
  for (const [x, y, z, s] of [[0, 3.9, 0, 2.5], [-1.0, 3.4, 0.5, 1.7], [0.9, 3.5, -0.6, 1.6], [0.2, 4.6, 0.4, 1.5]]) {
    m.box('foliage', { size: [s, s * 0.75, s], pos: [x, y, z], rot: [0, (x + z) * 0.7, 0] });
  }
  return m;
};
