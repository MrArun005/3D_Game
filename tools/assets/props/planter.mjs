import { Mesh } from '../../lib/mesh.mjs';

/** Precast street planter with a moulded rim and mixed planting. */

export const tags = ["street","kerb","green"];

export default () => {
  const m = new Mesh();
  // tapered tub reads far better than a straight box at pavement level
  m.profile('concrete_precast', {
    pts: [[-0.32, 0.00], [0.32, 0.00], [0.38, 0.58], [-0.38, 0.58]],
    length: 1.5, pos: [0, 0, 0], rot: Math.PI / 2,
  });
  m.profile('concrete_precast', {
    pts: [[-0.44, 0.00], [0.44, 0.00], [0.44, 0.07], [0.38, 0.11], [-0.38, 0.11], [-0.44, 0.07]],
    length: 1.6, pos: [0, 0.58, 0], rot: Math.PI / 2,
  });
  m.box('grass', { size: [1.32, 0.1, 0.62], pos: [0, 0.58, 0] });
  for (const [x, z, s] of [[-0.42, 0.04, 0.44], [0.1, -0.1, 0.56], [0.48, 0.08, 0.38]]) {
    m.box('foliage', { size: [s, s * 0.9, s * 0.85], pos: [x, 0.62 + s * 0.4, z], rot: [0, x * 3, 0], bevel: 0.04 });
  }
  return m;
};
