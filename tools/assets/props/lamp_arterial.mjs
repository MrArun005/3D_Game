import { Mesh } from '../../lib/mesh.mjs';

/** 8 m arterial street lamp with a swan-neck arm. */

export const tags = ["street","kerb","lighting","arterial"];

export default () => {
  const m = new Mesh();
  m.box('concrete_cast', { size: [0.44, 0.16, 0.44], pos: [0, 0.08, 0] });
  m.cylinder('metal_painted', { r: [0.13, 0.08], h: 8.0, seg: 10, pos: [0, 0.16, 0] });
  m.box('metal_painted', { size: [0.1, 0.1, 1.5], pos: [0, 8.05, 0.7], rot: [-0.28, 0, 0] });
  m.box('metal_painted', { size: [0.3, 0.14, 0.72], pos: [0, 7.86, 1.4] });
  m.box('plastic_signage', { size: [0.26, 0.05, 0.62], pos: [0, 7.77, 1.4] });
  return m;
};
