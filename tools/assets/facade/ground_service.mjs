import { Mesh } from '../../lib/mesh.mjs';
import { BAY, H_GROUND, D } from '../../lib/facade-parts.mjs';

/** Blank service frontage with a door, a louvre and a meter box. */

export const tags = ["ground","service"];

export default () => {
  const m = new Mesh(), h = H_GROUND;
  m.box('concrete_cast', { size: [BAY, h, D], pos: [0, h / 2, -D / 2] });
  m.box('metal_painted', { size: [1.0, 2.1, 0.1], pos: [-0.9, 1.05, 0.01] });
  m.box('metal_galv', { size: [0.9, 0.7, 0.12], pos: [1.0, 2.6, 0.01] });   // louvre
  m.box('metal_rust', { size: [0.4, 0.5, 0.22], pos: [1.5, 1.1, 0.05] });   // meter box
  return m;
};
