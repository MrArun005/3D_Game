import { Mesh } from '../../lib/mesh.mjs';

/** Glazed telephone kiosk. */

export const tags = ["street","kerb"];

export default () => {
  const m = new Mesh();
  m.box('metal_painted', { size: [0.95, 0.16, 0.95], pos: [0, 0.08, 0] });
  for (const [x, z] of [[-0.44, -0.44], [0.44, -0.44], [-0.44, 0.44], [0.44, 0.44]]) {
    m.box('metal_painted', { size: [0.1, 2.2, 0.1], pos: [x, 1.2, z] });
  }
  m.box('glass_shop', { size: [0.8, 2.0, 0.04], pos: [0, 1.25, 0.46] });
  m.box('glass_shop', { size: [0.8, 2.0, 0.04], pos: [0, 1.25, -0.46] });
  m.box('glass_shop', { size: [0.04, 2.0, 0.8], pos: [-0.46, 1.25, 0] });
  m.box('glass_shop', { size: [0.04, 2.0, 0.8], pos: [0.46, 1.25, 0] });
  m.box('metal_painted', { size: [1.05, 0.22, 1.05], pos: [0, 2.42, 0] });
  m.box('plastic_signage', { size: [0.72, 0.16, 0.06], pos: [0, 2.42, 0.5] });
  return m;
};
