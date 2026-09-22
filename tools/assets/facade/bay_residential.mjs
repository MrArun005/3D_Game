import { Mesh } from '../../lib/mesh.mjs';
import { BAY, H_RES, opening, punched } from '../../lib/facade-parts.mjs';

/** Compact Little Tokyo residential bay: a shallow balcony, rails and a wall AC unit. */

export const tags = ['bay', 'residential', 'tokyo'];

export default () => {
  const m = new Mesh(), h = H_RES;
  punched(m, 'brick_painted', { w: BAY, h, ow: 2.42, oh: 1.82, oy: 0.62 });
  opening(m, { w: 2.42, h: 1.82, y: 0.62, frame: 'timber_painted', sill: 'stone_dressed' });
  // A real shallow balcony gives the building silhouette, while the rail keeps
  // the module light enough to instance across a block.
  m.box('concrete_precast', { size: [2.78, 0.12, 0.72], pos: [-0.28, 0.55, -0.32] });
  for (const x of [-1.54, -0.96, -0.38, 0.20, 0.78]) {
    m.box('metal_painted', { size: [0.045, 0.62, 0.045], pos: [x, 0.90, -0.61] });
  }
  m.box('metal_painted', { size: [2.38, 0.055, 0.055], pos: [-0.38, 1.18, -0.61] });
  // Offset exterior AC: a small, highly readable lived-in detail.
  m.box('metal_galv', { size: [0.52, 0.38, 0.30], pos: [1.38, 1.02, 0.10] });
  m.box('metal_galv', { size: [0.62, 0.045, 0.34], pos: [1.38, 0.78, 0.08] });
  return m;
};
