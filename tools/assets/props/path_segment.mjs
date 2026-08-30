import { Mesh } from '../../lib/mesh.mjs';

/** Park path with moulded kerb edging. Tiles along its X axis. */

export const tags = ["park","path","flat"];

export default () => {
  const m = new Mesh();
  m.box('pavement_slab', { size: [4.0, 0.09, 2.4], pos: [0, 0.045, 0], bevel: 0.006 });
  for (const pz of [-1.28, 1.28]) {
    m.profile('kerb_stone', {
      pts: [[-0.09, 0.00], [0.09, 0.00], [0.09, 0.11], [0.05, 0.15], [-0.09, 0.15]],
      length: 4.0, pos: [0, 0, pz], rot: pz > 0 ? Math.PI : 0,
    });
  }
  return m;
};
