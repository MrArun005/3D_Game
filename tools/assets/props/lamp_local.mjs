import { Mesh } from '../../lib/mesh.mjs';

/** 6 m local street lamp. */

export const tags = ["street","kerb","lighting","local"];

export default () => {
  const m = new Mesh();
  m.box('concrete_cast', { size: [0.36, 0.14, 0.36], pos: [0, 0.07, 0] });
  m.cylinder('metal_painted', { r: [0.1, 0.07], h: 6.0, seg: 8, pos: [0, 0.14, 0] });
  m.box('metal_painted', { size: [0.24, 0.2, 0.5], pos: [0, 6.05, 0.16] });
  m.box('plastic_signage', { size: [0.2, 0.05, 0.42], pos: [0, 5.94, 0.16] });
  return m;
};
