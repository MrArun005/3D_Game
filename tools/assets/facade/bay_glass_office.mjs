import { Mesh } from '../../lib/mesh.mjs';
import { BAY, H_COMM, D } from '../../lib/facade-parts.mjs';

/** Curtain-wall bay. Mullions are what stop this reading as a blue rectangle. */

export const tags = ["bay","commercial","modern"];

export default () => {
  const m = new Mesh(), h = H_COMM;
  m.box('glass_curtain', { size: [BAY, h, 0.06], pos: [0, h / 2, -0.08] });
  // mullions are what stop curtain wall reading as a blue rectangle
  m.repeatX(4, BAY / 3, (x) => m.box('alloy_polished', { size: [0.11, h, 0.14], pos: [x, h / 2, 0] }));
  m.box('alloy_polished', { size: [BAY, 0.16, 0.16], pos: [0, 0.08, 0] });
  m.box('alloy_polished', { size: [BAY, 0.16, 0.16], pos: [0, h - 0.08, 0] });
  m.box('concrete_precast', { size: [BAY, 0.34, D], pos: [0, h - 0.17, -D / 2 - 0.05] });
  return m;
};
