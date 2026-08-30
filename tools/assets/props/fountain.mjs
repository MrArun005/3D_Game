import { Mesh } from '../../lib/mesh.mjs';

/** Tiered fountain basin. */

export const tags = ["park","landmark","water"];

export default () => {
  const m = new Mesh();
  m.cylinder('stone_dressed', { r: 2.6, h: 0.52, seg: 16 });
  m.cylinder('asphalt_wet', { r: 2.3, h: 0.06, seg: 16, pos: [0, 0.42, 0] });
  m.cylinder('stone_dressed', { r: 0.55, h: 0.85, seg: 12, pos: [0, 0.42, 0] });
  m.cylinder('stone_dressed', { r: [1.15, 0.9], h: 0.24, seg: 12, pos: [0, 1.27, 0] });
  m.cylinder('stone_dressed', { r: 0.24, h: 0.75, seg: 10, pos: [0, 1.51, 0] });
  m.cylinder('stone_dressed', { r: [0.6, 0.45], h: 0.18, seg: 10, pos: [0, 2.26, 0] });
  return m;
};
