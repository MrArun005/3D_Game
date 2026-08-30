import { Mesh } from '../../lib/mesh.mjs';

/** Three-aspect traffic signal on a post. */

export const tags = ["street","junction"];

export default () => {
  const m = new Mesh();
  m.box('concrete_cast', { size: [0.4, 0.12, 0.4], pos: [0, 0.06, 0] });
  m.cylinder('metal_painted', { r: 0.075, h: 3.1, seg: 8, pos: [0, 0.12, 0] });
  m.box('metal_painted', { size: [0.32, 0.95, 0.28], pos: [0, 3.6, 0] });
  for (let i = 0; i < 3; i++) {
    m.cylinder('plastic_signage', { r: 0.1, h: 0.06, seg: 10, pos: [0, 3.24 + i * 0.3, 0.15], base: false });
  }
  m.box('metal_painted', { size: [0.36, 0.1, 0.34], pos: [0, 4.1, 0.03] });
  return m;
};
