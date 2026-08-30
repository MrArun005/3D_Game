import { Mesh } from '../../lib/mesh.mjs';

/** Quay wall section: battered concrete face, granite coping, timber fenders. */

export const tags = ["harbour","edge"];

export default () => {
  const m = new Mesh();
  // battered face — a dock wall leans back, it is not a vertical slab
  m.profile('concrete_cast', {
    pts: [[-0.70, 0.00], [0.62, 0.00], [0.50, 1.62], [-0.70, 1.62]],
    length: 4.0, pos: [0, 0, 0], rot: Math.PI / 2,
  });
  // granite coping with a nosing over the face
  m.profile('stone_dressed', {
    pts: [[-0.74, 0.00], [0.60, 0.00], [0.60, 0.14], [0.52, 0.20], [-0.74, 0.20]],
    length: 4.0, pos: [0, 1.62, 0], rot: Math.PI / 2,
  });
  // fenders hung off the face, scuffed and slightly out of true
  for (const [x, tilt] of [[-1.32, 0.012], [0, -0.008], [1.32, 0.015]]) {
    m.box('timber_bare', { size: [0.34, 1.42, 0.26], pos: [x, 0.76, 0.60], rot: [0, 0, tilt], bevel: 0.02 });
    m.box('metal_rust', { size: [0.40, 0.09, 0.10], pos: [x, 1.38, 0.68] });
  }
  return m;
};
