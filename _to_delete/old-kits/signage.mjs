/**
 * Signage kit — greybox blockouts.
 *
 * Signage is the cheapest "this is a real city" cue there is, and Halstead Bay
 * currently has none outside road markings. These carry a flat plastic_signage
 * face; the artwork arrives as a texture atlas in Tier 2, not as geometry.
 */
import { Mesh } from '../lib/mesh.mjs';

export const sign_projecting = () => new Mesh()
  .box('metal_galv', { size: [0.5, 0.09, 0.09], pos: [0.25, 2.6, 0] })
  .box('metal_galv', { size: [0.06, 0.55, 0.06], pos: [0.48, 2.35, 0] })
  .box('plastic_signage', { size: [0.09, 0.95, 1.25], pos: [0.5, 1.95, 0] });

export const sign_wall_box = () => new Mesh()
  .box('plastic_signage', { size: [2.6, 0.7, 0.18], pos: [0, 0.35, 0] })
  .box('metal_galv', { size: [2.7, 0.08, 0.22], pos: [0, 0.04, 0] })
  .box('metal_galv', { size: [2.7, 0.08, 0.22], pos: [0, 0.66, 0] });

export const billboard_wall = () => new Mesh()
  .box('metal_galv', { size: [6.2, 3.2, 0.14], pos: [0, 1.6, 0] })
  .box('plastic_signage', { size: [5.9, 2.95, 0.06], pos: [0, 1.6, 0.09] })
  .box('metal_galv', { size: [6.4, 0.14, 0.5], pos: [0, 3.32, 0.16] });

export const billboard_freestanding = () => {
  const m = new Mesh();
  for (const x of [-2.2, 2.2]) {
    m.box('concrete_cast', { size: [0.8, 0.3, 0.8], pos: [x, 0.15, 0] });
    m.box('metal_galv', { size: [0.28, 5.0, 0.28], pos: [x, 2.5, 0] });
  }
  m.box('metal_galv', { size: [6.6, 3.4, 0.2], pos: [0, 5.4, 0] });
  m.box('plastic_signage', { size: [6.3, 3.15, 0.06], pos: [0, 5.4, 0.13] });
  m.box('metal_galv', { size: [6.8, 0.14, 0.6], pos: [0, 7.15, 0.2] });
  return m;
};

export const banner_pole = () => new Mesh()
  .cylinder('metal_galv', { r: 0.07, h: 5.0, seg: 8 })
  .box('metal_galv', { size: [0.06, 0.06, 0.55], pos: [0, 4.4, 0.28] })
  .box('metal_galv', { size: [0.06, 0.06, 0.55], pos: [0, 2.9, 0.28] })
  .box('fabric_awning', { size: [0.04, 1.55, 0.5], pos: [0, 3.65, 0.5] });

export const a_frame_sign = () => new Mesh()
  .box('timber_painted', { size: [0.7, 1.0, 0.05], pos: [0, 0.5, -0.22], rot: [0.22, 0, 0] })
  .box('timber_painted', { size: [0.7, 1.0, 0.05], pos: [0, 0.5, 0.22], rot: [-0.22, 0, 0] })
  .box('timber_painted', { size: [0.7, 0.05, 0.05], pos: [0, 1.0, 0] });

export const market_stall = () => {
  const m = new Mesh();
  for (const [x, z] of [[-1.5, -1.0], [1.5, -1.0], [-1.5, 1.0], [1.5, 1.0]]) {
    m.box('metal_galv', { size: [0.07, 2.3, 0.07], pos: [x, 1.15, z] });
  }
  m.box('fabric_awning', { size: [3.4, 0.1, 1.2], pos: [0, 2.42, -0.55], rot: [-0.3, 0, 0] });
  m.box('fabric_awning', { size: [3.4, 0.1, 1.2], pos: [0, 2.42, 0.55], rot: [0.3, 0, 0] });
  m.box('timber_bare', { size: [3.2, 0.07, 1.1], pos: [0, 0.85, 0] });
  m.box('timber_bare', { size: [3.2, 0.5, 0.06], pos: [0, 0.6, -0.52] });
  m.box('plastic_signage', { size: [1.4, 0.3, 0.05], pos: [0, 2.15, 1.0] });
  return m;
};

export const cafe_umbrella = () => new Mesh()
  .cylinder('concrete_cast', { r: 0.34, h: 0.1, seg: 10 })
  .cylinder('metal_galv', { r: 0.045, h: 2.3, seg: 8, pos: [0, 0.1, 0] })
  .cylinder('fabric_awning', { r: [1.55, 0.12], h: 0.42, seg: 8, pos: [0, 2.05, 0], caps: false })
  .box('fabric_awning', { size: [0.12, 0.3, 0.12], pos: [0, 2.4, 0] });

export const utility_pole = () => {
  const m = new Mesh();
  m.cylinder('timber_bare', { r: [0.17, 0.13], h: 8.5, seg: 8 });
  for (const y of [7.3, 7.9]) {
    m.box('timber_bare', { size: [2.2, 0.12, 0.14], pos: [0, y, 0] });
    m.repeatX(4, 0.6, (x) => m.cylinder('glass_shop', { r: 0.055, h: 0.16, seg: 6, pos: [x, y + 0.06, 0] }));
  }
  m.box('metal_rust', { size: [0.36, 0.5, 0.36], pos: [0.2, 5.4, 0] });
  return m;
};
