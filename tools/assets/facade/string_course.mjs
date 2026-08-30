import { Mesh } from '../../lib/mesh.mjs';
import { BAY } from '../../lib/facade-parts.mjs';

/** Moulded band. Use to break a facade between storey groups. */

export const tags = ["band","period"];

export default () => new Mesh().profile('stone_dressed', {
  pts: [[0.00, 0.00], [0.10, 0.02], [0.15, 0.07], [0.13, 0.14],
        [0.16, 0.18], [0.10, 0.24], [0.00, 0.26]],
  length: BAY, pos: [0, 0, 0.01],
});
