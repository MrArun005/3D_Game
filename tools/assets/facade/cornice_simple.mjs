import { Mesh } from '../../lib/mesh.mjs';
import { BAY } from '../../lib/facade-parts.mjs';

/** Modern cornice: a stepped precast section with a drip throat under the nose. */

export const tags = ["topper","modern"];

export default () => new Mesh().profile('concrete_precast', {
  // section runs from the wall face (z=0) outward. The undercut at the nose is
  // the drip — without it rain tracks back and the profile reads as a slab.
  pts: [
    [0.00, 0.00], [0.30, 0.00], [0.34, 0.05], [0.30, 0.09],
    [0.42, 0.13], [0.46, 0.20], [0.40, 0.30], [0.24, 0.34],
    [0.20, 0.46], [0.00, 0.46],
  ],
  length: BAY, pos: [0, 0, -0.02],
});
