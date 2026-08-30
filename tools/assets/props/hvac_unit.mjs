import { Mesh } from '../../lib/mesh.mjs';

/** Rooftop air handling unit on anti-vibration rails. */

export const tags = ["roof","plant"];

export default () => {
  const m = new Mesh();
  m.box('metal_galv', { size: [2.2, 1.0, 1.6], pos: [0, 0.5, 0] });
  m.box('metal_painted', { size: [2.3, 0.12, 1.7], pos: [0, 1.06, 0] });
  m.cylinder('metal_painted', { r: 0.42, h: 0.22, seg: 12, pos: [-0.5, 1.12, 0] });
  m.cylinder('metal_painted', { r: 0.42, h: 0.22, seg: 12, pos: [0.5, 1.12, 0] });
  m.box('metal_rust', { size: [2.4, 0.14, 0.2], pos: [0, 0.07, -0.6] });
  m.box('metal_rust', { size: [2.4, 0.14, 0.2], pos: [0, 0.07, 0.6] });
  return m;
};
