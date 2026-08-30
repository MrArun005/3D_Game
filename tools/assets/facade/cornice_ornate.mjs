import { Mesh } from '../../lib/mesh.mjs';
import { BAY } from '../../lib/facade-parts.mjs';

/** Period cornice: cyma, fascia, deep corona with a drip, dentils under. */

export const tags = ["topper","period"];

export default () => {
  const m = new Mesh();
  m.profile('stone_dressed', {
    pts: [
      [0.00, 0.00], [0.22, 0.00], [0.26, 0.06], [0.20, 0.12],   // bed mould
      [0.30, 0.16], [0.34, 0.24],                                // fascia
      [0.62, 0.30], [0.64, 0.40], [0.56, 0.44],                  // corona + drip
      [0.50, 0.56], [0.34, 0.64], [0.30, 0.74], [0.00, 0.74],    // cyma to the wall
    ],
    length: BAY, pos: [0, 0, -0.02],
  });
  // dentil course under the bed mould — the detail that says "period" at 20 m
  m.repeatX(12, BAY / 12, (x) =>
    m.box('stone_dressed', { size: [0.14, 0.11, 0.13], pos: [x, -0.055, 0.13] }));
  return m;
};
