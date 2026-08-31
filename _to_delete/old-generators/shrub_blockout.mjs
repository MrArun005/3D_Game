import { Mesh } from '../../lib/mesh.mjs';

/** PLACEHOLDER. Replace with authored or CC0 planting before Tier 3 ships. */

export const tags = ["park","green","placeholder"];

export default () => {
  const m = new Mesh();
  for (const [x, y, z, s] of [[0, 0.42, 0, 0.95], [-0.4, 0.3, 0.3, 0.65], [0.35, 0.34, -0.25, 0.7]]) {
    m.box('foliage', { size: [s, s * 0.85, s], pos: [x, y, z], rot: [0, x * 2, 0] });
  }
  return m;
};
