import { Mesh } from '../../lib/mesh.mjs';

/** Loose timber crates, battened and stacked slightly out of square. */

export const tags = ["harbour","clutter"];

const crate = (m, w, h, d, x, y, z, ry) => {
  m.box('timber_bare', { size: [w, h, d], pos: [x, y + h / 2, z], rot: [0, ry, 0], bevel: 0.014 });
  // corner battens, which is what makes a crate read as a crate and not a box
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const bx = x + Math.cos(ry) * sx * (w / 2 - 0.03) - Math.sin(ry) * sz * (d / 2 - 0.03);
    const bz = z + Math.sin(ry) * sx * (w / 2 - 0.03) + Math.cos(ry) * sz * (d / 2 - 0.03);
    m.box('timber_painted', { size: [0.07, h + 0.02, 0.07], pos: [bx, y + h / 2, bz], rot: [0, ry, 0] });
  }
  m.box('timber_painted', { size: [w + 0.02, 0.06, d * 0.2], pos: [x, y + h * 0.72, z], rot: [0, ry, 0] });
};

export default () => {
  const m = new Mesh();
  crate(m, 1.2, 0.9, 1.0, -0.5, 0, 0, 0.04);
  crate(m, 1.0, 0.8, 0.9, 0.72, 0, 0.2, -0.09);
  crate(m, 0.86, 0.66, 0.78, -0.36, 0.9, -0.06, 0.42);
  return m;
};
