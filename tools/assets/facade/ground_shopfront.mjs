import { Mesh } from '../../lib/mesh.mjs';
import { BAY, H_GROUND, D } from '../../lib/facade-parts.mjs';

/** Retail ground floor: stallriser, glazing, fascia. The base every other shopfront extends. */

export const tags = ["ground","retail"];

export default () => {
  const m = new Mesh(), h = H_GROUND;
  m.box('concrete_cast', { size: [0.3, h, D], pos: [-BAY / 2 + 0.15, h / 2, -D / 2] });
  m.box('concrete_cast', { size: [0.3, h, D], pos: [BAY / 2 - 0.15, h / 2, -D / 2] });
  m.box('timber_painted', { size: [BAY - 0.6, 0.55, 0.3], pos: [0, 0.275, -0.1] });     // stallriser
  m.box('glass_shop', { size: [BAY - 0.7, 2.5, 0.05], pos: [0, 1.85, -0.14] });
  m.box('metal_painted', { size: [0.08, 2.5, 0.12], pos: [-0.55, 1.85, -0.1] });
  m.box('metal_painted', { size: [0.08, 2.5, 0.12], pos: [0.55, 1.85, -0.1] });
  m.box('plastic_signage', { size: [BAY - 0.5, 0.7, 0.16], pos: [0, h - 0.45, -0.02] }); // fascia
  m.box('concrete_cast', { size: [BAY, 0.24, D], pos: [0, h - 0.12, -D / 2] });
  return m;
};
