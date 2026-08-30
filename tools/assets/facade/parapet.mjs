import { Mesh } from '../../lib/mesh.mjs';
import { BAY } from '../../lib/facade-parts.mjs';

/** Solid parapet with a weathered stone coping. Hides roof plant from the street. */

export const tags = ["topper"];

export default () => {
  const m = new Mesh();
  m.box('brick_painted', { size: [BAY, 1.0, 0.34], pos: [0, 0.5, -0.17] });
  // coping: weathered back so water runs onto the roof, with a drip both sides
  m.profile('stone_dressed', {
    pts: [
      [-0.26, 0.00], [0.24, 0.00], [0.24, 0.05], [0.20, 0.07],
      [0.20, 0.13], [-0.22, 0.09], [-0.22, 0.04], [-0.26, 0.04],
    ],
    length: BAY, pos: [0, 1.0, -0.17],
  });
  return m;
};
