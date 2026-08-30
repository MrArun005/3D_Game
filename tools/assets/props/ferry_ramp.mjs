import { Mesh } from '../../lib/mesh.mjs';

/** Vehicle ferry ramp: hinged apron sloping down to the water, with side rails. */

export const tags = ["harbour","edge","transit"];

export default () => {
  const m = new Mesh();
  m.box('concrete_cast', { size: [7.0, 1.4, 3.0], pos: [0, 0.7, -1.5] });      // abutment
  m.box('metal_rust', { size: [6.0, 0.18, 5.4], pos: [0, 1.06, 2.3], rot: [0.22, 0, 0] });
  m.box('metal_rust', { size: [6.0, 0.3, 0.3], pos: [0, 1.42, -0.15] });        // hinge beam
  for (const sx of [-1, 1]) {
    m.box('metal_painted', { size: [0.1, 1.15, 5.4], pos: [sx * 3.0, 1.75, 2.3], rot: [0.22, 0, 0] });
    for (let i = 0; i < 4; i++) {
      m.box('metal_painted', { size: [0.09, 1.1, 0.09], pos: [sx * 3.0, 1.35 + i * 0.3, 0.4 + i * 1.35] });
    }
  }
  return m;
};
