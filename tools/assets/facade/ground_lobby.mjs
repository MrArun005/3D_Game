import { Mesh } from '../../lib/mesh.mjs';
import { BAY, H_GROUND, D } from '../../lib/facade-parts.mjs';

/** Commercial entrance: recessed doors under a stone canopy. */

export const tags = ["ground","commercial"];

export default () => {
  const m = new Mesh(), h = H_GROUND;
  m.box('stone_dressed', { size: [1.0, h, D], pos: [-BAY / 2 + 0.5, h / 2, -D / 2] });
  m.box('stone_dressed', { size: [1.0, h, D], pos: [BAY / 2 - 0.5, h / 2, -D / 2] });
  m.box('stone_dressed', { size: [BAY, 1.0, D], pos: [0, h - 0.5, -D / 2] });
  m.box('glass_shop', { size: [1.55, 2.6, 0.05], pos: [0, 1.3, -0.6] });     // recessed
  m.box('alloy_polished', { size: [0.08, 2.6, 0.1], pos: [0, 1.3, -0.55] }); // door split
  m.box('stone_dressed', { size: [BAY, 0.14, 1.3], pos: [0, 2.68, -0.65] }); // canopy
  m.box('pavement_slab', { size: [1.6, 0.12, 0.6], pos: [0, 0.06, -0.3] });
  return m;
};
