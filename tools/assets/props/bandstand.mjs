import { Mesh } from '../../lib/mesh.mjs';

/** Bandstand. Park landmark. */

export const tags = ["park","landmark"];

export default () => {
  const m = new Mesh();
  m.cylinder('stone_dressed', { r: 3.4, h: 0.55, seg: 12 });
  m.cylinder('timber_painted', { r: 3.15, h: 0.09, seg: 12, pos: [0, 0.55, 0] });
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * Math.PI * 2;
    m.box('timber_painted', {
      size: [0.16, 3.0, 0.16],
      pos: [Math.cos(t) * 2.85, 2.14, Math.sin(t) * 2.85],
    });
  }
  m.cylinder('metal_galv', { r: [3.5, 0.4], h: 1.5, seg: 12, pos: [0, 3.64, 0], caps: false });
  m.cylinder('metal_painted', { r: 0.14, h: 0.7, seg: 8, pos: [0, 5.1, 0] });
  return m;
};
