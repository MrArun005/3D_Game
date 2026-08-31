/**
 * Street furniture, barriers and harbour kit — greybox blockouts.
 *
 * Origin convention: base of the object, centred in XZ. Anything with a
 * "front" faces +Z, so placement can orient by the pavement normal.
 * Budgets: small 300, medium 900, large 2500 (docs/BUDGETS.md).
 */
import { Mesh } from '../lib/mesh.mjs';

/* ------------------------------------------------------ street furniture -- */

export const lamp_arterial = () => {
  const m = new Mesh();
  m.box('concrete_cast', { size: [0.44, 0.16, 0.44], pos: [0, 0.08, 0] });
  m.cylinder('metal_painted', { r: [0.13, 0.08], h: 8.0, seg: 10, pos: [0, 0.16, 0] });
  m.box('metal_painted', { size: [0.1, 0.1, 1.5], pos: [0, 8.05, 0.7], rot: [-0.28, 0, 0] });
  m.box('metal_painted', { size: [0.3, 0.14, 0.72], pos: [0, 7.86, 1.4] });
  m.box('plastic_signage', { size: [0.26, 0.05, 0.62], pos: [0, 7.77, 1.4] });
  return m;
};

export const lamp_local = () => {
  const m = new Mesh();
  m.box('concrete_cast', { size: [0.36, 0.14, 0.36], pos: [0, 0.07, 0] });
  m.cylinder('metal_painted', { r: [0.1, 0.07], h: 6.0, seg: 8, pos: [0, 0.14, 0] });
  m.box('metal_painted', { size: [0.24, 0.2, 0.5], pos: [0, 6.05, 0.16] });
  m.box('plastic_signage', { size: [0.2, 0.05, 0.42], pos: [0, 5.94, 0.16] });
  return m;
};

export const traffic_signal = () => {
  const m = new Mesh();
  m.box('concrete_cast', { size: [0.4, 0.12, 0.4], pos: [0, 0.06, 0] });
  m.cylinder('metal_painted', { r: 0.075, h: 3.1, seg: 8, pos: [0, 0.12, 0] });
  m.box('metal_painted', { size: [0.32, 0.95, 0.28], pos: [0, 3.6, 0] });
  for (let i = 0; i < 3; i++) {
    m.cylinder('plastic_signage', { r: 0.1, h: 0.06, seg: 10, pos: [0, 3.24 + i * 0.3, 0.15], base: false });
  }
  m.box('metal_painted', { size: [0.36, 0.1, 0.34], pos: [0, 4.1, 0.03] });
  return m;
};

export const sign_gantry = () => {
  const m = new Mesh();
  for (const x of [-4.2, 4.2]) {
    m.box('concrete_cast', { size: [0.7, 0.3, 0.7], pos: [x, 0.15, 0] });
    m.cylinder('metal_galv', { r: 0.16, h: 6.2, seg: 10, pos: [x, 0.3, 0] });
  }
  m.box('metal_galv', { size: [8.8, 0.22, 0.22], pos: [0, 6.4, 0] });
  m.box('metal_galv', { size: [8.8, 0.22, 0.22], pos: [0, 5.5, 0] });
  m.repeatX(7, 1.3, (x) => m.box('metal_galv', { size: [0.1, 0.9, 0.1], pos: [x, 5.95, 0] }));
  m.box('plastic_signage', { size: [4.4, 1.7, 0.1], pos: [-1.8, 5.9, 0.18] });
  m.box('plastic_signage', { size: [2.6, 1.2, 0.1], pos: [2.4, 5.9, 0.18] });
  return m;
};

export const street_sign = () => new Mesh()
  .cylinder('metal_galv', { r: 0.045, h: 2.4, seg: 8 })
  .box('plastic_signage', { size: [0.9, 0.24, 0.03], pos: [0.35, 2.2, 0] })
  .box('plastic_signage', { size: [0.62, 0.62, 0.03], pos: [0, 1.6, 0.02] });

export const bin = () => new Mesh()
  .cylinder('metal_painted', { r: [0.24, 0.28], h: 0.86, seg: 10 })
  .cylinder('metal_galv', { r: 0.3, h: 0.06, seg: 10, pos: [0, 0.86, 0] })
  .box('metal_painted', { size: [0.06, 0.5, 0.06], pos: [0, 0.25, 0.3] });

export const bollard = () => new Mesh()
  .cylinder('metal_painted', { r: 0.11, h: 0.92, seg: 10 })
  .cylinder('metal_painted', { r: 0.14, h: 0.09, seg: 10, pos: [0, 0.92, 0] });

export const hydrant = () => new Mesh()
  .cylinder('metal_rust', { r: 0.2, h: 0.1, seg: 10 })
  .cylinder('metal_painted', { r: 0.13, h: 0.62, seg: 10, pos: [0, 0.1, 0] })
  .cylinder('metal_painted', { r: 0.17, h: 0.12, seg: 10, pos: [0, 0.72, 0] })
  .cylinder('metal_painted', { r: 0.08, h: 0.14, seg: 8, pos: [0, 0.84, 0] })
  .box('metal_painted', { size: [0.46, 0.14, 0.14], pos: [0, 0.5, 0] });

export const parking_meter = () => new Mesh()
  .cylinder('metal_galv', { r: 0.05, h: 1.1, seg: 8 })
  .box('metal_painted', { size: [0.26, 0.46, 0.2], pos: [0, 1.32, 0] })
  .box('glass_shop', { size: [0.18, 0.2, 0.03], pos: [0, 1.42, 0.11] });

export const post_box = () => new Mesh()
  .cylinder('metal_painted', { r: 0.32, h: 1.25, seg: 12 })
  .cylinder('metal_painted', { r: 0.35, h: 0.1, seg: 12, pos: [0, 1.25, 0] })
  .cylinder('metal_painted', { r: 0.22, h: 0.14, seg: 12, pos: [0, 1.35, 0] })
  .box('metal_rust', { size: [0.3, 0.05, 0.06], pos: [0, 1.0, 0.31] });

export const phone_box = () => {
  const m = new Mesh();
  m.box('metal_painted', { size: [0.95, 0.16, 0.95], pos: [0, 0.08, 0] });
  for (const [x, z] of [[-0.44, -0.44], [0.44, -0.44], [-0.44, 0.44], [0.44, 0.44]]) {
    m.box('metal_painted', { size: [0.1, 2.2, 0.1], pos: [x, 1.2, z] });
  }
  m.box('glass_shop', { size: [0.8, 2.0, 0.04], pos: [0, 1.25, 0.46] });
  m.box('glass_shop', { size: [0.8, 2.0, 0.04], pos: [0, 1.25, -0.46] });
  m.box('glass_shop', { size: [0.04, 2.0, 0.8], pos: [-0.46, 1.25, 0] });
  m.box('glass_shop', { size: [0.04, 2.0, 0.8], pos: [0.46, 1.25, 0] });
  m.box('metal_painted', { size: [1.05, 0.22, 1.05], pos: [0, 2.42, 0] });
  m.box('plastic_signage', { size: [0.72, 0.16, 0.06], pos: [0, 2.42, 0.5] });
  return m;
};

export const bus_shelter = () => {
  const m = new Mesh();
  m.repeatX(2, 3.2, (x) => {
    m.box('metal_galv', { size: [0.1, 2.5, 0.1], pos: [x, 1.25, -0.6] });
    m.box('metal_galv', { size: [0.1, 2.5, 0.1], pos: [x, 1.25, 0.6] });
  });
  m.box('metal_galv', { size: [3.6, 0.12, 1.5], pos: [0, 2.56, 0] });
  m.box('glass_shop', { size: [3.3, 2.2, 0.04], pos: [0, 1.35, -0.62] });
  m.box('glass_shop', { size: [0.04, 2.2, 1.1], pos: [-1.68, 1.35, 0] });
  m.box('timber_bare', { size: [2.6, 0.08, 0.42], pos: [0, 0.62, -0.36] });
  m.box('metal_galv', { size: [2.6, 0.4, 0.06], pos: [0, 0.85, -0.56] });
  m.box('plastic_signage', { size: [0.72, 1.1, 0.06], pos: [1.5, 1.5, 0.62] });
  return m;
};

export const bench = () => {
  const m = new Mesh();
  for (const x of [-0.7, 0.7]) {
    m.box('metal_painted', { size: [0.08, 0.42, 0.5], pos: [x, 0.21, 0] });
    m.box('metal_painted', { size: [0.08, 0.55, 0.08], pos: [x, 0.68, -0.2] });
  }
  m.repeatX(4, 0.14, (z) => m.box('timber_bare', { size: [1.8, 0.05, 0.11], pos: [0, 0.45, z] }));
  m.box('timber_bare', { size: [1.8, 0.42, 0.05], pos: [0, 0.72, -0.22] });
  return m;
};

export const planter = () => new Mesh()
  .box('concrete_precast', { size: [1.5, 0.6, 0.7], pos: [0, 0.3, 0] })
  .box('concrete_precast', { size: [1.6, 0.09, 0.8], pos: [0, 0.62, 0] })
  .box('timber_bare', { size: [1.3, 0.12, 0.5], pos: [0, 0.6, 0] });

export const junction_box = () => new Mesh()
  .box('concrete_cast', { size: [0.9, 0.1, 0.55], pos: [0, 0.05, 0] })
  .box('metal_galv', { size: [0.8, 1.25, 0.42], pos: [0, 0.68, 0] })
  .box('metal_galv', { size: [0.88, 0.08, 0.5], pos: [0, 1.34, 0] })
  .box('metal_painted', { size: [0.36, 0.06, 0.03], pos: [0.2, 0.7, 0.22] });

export const manhole = () => new Mesh()
  .cylinder('metal_rust', { r: 0.35, h: 0.04, seg: 14 })
  .cylinder('kerb_stone', { r: 0.42, h: 0.03, seg: 14 });

export const drain_grate = () => new Mesh()
  .box('kerb_stone', { size: [0.52, 0.05, 0.34] })
  .box('metal_rust', { size: [0.42, 0.05, 0.26], pos: [0, 0.01, 0] });

export const bike_rack = () => {
  const m = new Mesh();
  m.repeatX(4, 0.8, (x) => {
    m.box('metal_galv', { size: [0.06, 0.75, 0.06], pos: [x - 0.28, 0.375, 0] });
    m.box('metal_galv', { size: [0.06, 0.75, 0.06], pos: [x + 0.28, 0.375, 0] });
    m.box('metal_galv', { size: [0.62, 0.06, 0.06], pos: [x, 0.75, 0] });
  });
  return m;
};

/* ------------------------------------------------ barriers and roadworks -- */

export const cone = () => new Mesh()
  .box('plastic_signage', { size: [0.36, 0.05, 0.36] })
  .cylinder('plastic_signage', { r: [0.15, 0.03], h: 0.68, seg: 8, pos: [0, 0.05, 0] });

export const barrier = () => new Mesh()
  .box('plastic_signage', { size: [2.0, 0.65, 0.42], pos: [0, 0.33, 0] })
  .box('plastic_signage', { size: [2.0, 0.14, 0.5], pos: [0, 0.72, 0] })
  .box('metal_galv', { size: [0.1, 0.8, 0.1], pos: [-0.9, 0.4, 0] })
  .box('metal_galv', { size: [0.1, 0.8, 0.1], pos: [0.9, 0.4, 0] });

export const fence_panel = () => {
  const m = new Mesh();
  m.box('metal_galv', { size: [0.09, 2.0, 0.09], pos: [-1.45, 1.0, 0] });
  m.box('metal_galv', { size: [0.09, 2.0, 0.09], pos: [1.45, 1.0, 0] });
  m.box('metal_galv', { size: [3.0, 0.06, 0.05], pos: [0, 1.92, 0] });
  m.box('metal_galv', { size: [3.0, 0.06, 0.05], pos: [0, 0.12, 0] });
  m.repeatX(14, 0.2, (x) => m.box('metal_galv', { size: [0.035, 1.9, 0.035], pos: [x, 1.0, 0] }));
  return m;
};

export const railing = () => {
  const m = new Mesh();
  m.box('metal_painted', { size: [2.4, 0.06, 0.06], pos: [0, 1.05, 0] });
  m.box('metal_painted', { size: [2.4, 0.05, 0.05], pos: [0, 0.55, 0] });
  m.repeatX(2, 2.3, (x) => m.box('metal_painted', { size: [0.07, 1.1, 0.07], pos: [x, 0.55, 0] }));
  m.repeatX(8, 0.3, (x) => m.box('metal_painted', { size: [0.03, 1.0, 0.03], pos: [x, 0.53, 0] }));
  return m;
};

export const hoarding = () => new Mesh()
  .box('timber_painted', { size: [4.0, 2.4, 0.1], pos: [0, 1.2, 0] })
  .box('timber_bare', { size: [0.1, 2.5, 0.1], pos: [-1.9, 1.25, -0.1] })
  .box('timber_bare', { size: [0.1, 2.5, 0.1], pos: [1.9, 1.25, -0.1] })
  .box('timber_bare', { size: [4.0, 0.12, 0.12], pos: [0, 2.42, -0.1] })
  .box('plastic_signage', { size: [1.6, 1.0, 0.03], pos: [0.6, 1.5, 0.06] });

export const scaffold_bay = () => {
  const m = new Mesh();
  for (const z of [-0.6, 0.6]) {
    m.repeatX(2, 2.4, (x) => m.cylinder('metal_galv', { r: 0.05, h: 6.0, seg: 6, pos: [x, 0, z] }));
    for (const y of [2.0, 4.0, 6.0]) m.box('metal_galv', { size: [2.5, 0.05, 0.05], pos: [0, y, z] });
  }
  for (const y of [2.0, 4.0]) {
    m.box('timber_bare', { size: [2.4, 0.05, 1.15], pos: [0, y + 0.05, 0] });
    m.box('metal_galv', { size: [2.5, 0.05, 0.05], pos: [0, y + 1.0, 0.62] });
  }
  m.box('metal_galv', { size: [0.05, 6.0, 1.3], pos: [-1.2, 3.0, 0], rot: [0, 0, 0] });
  return m;
};

/* --------------------------------------------------------------- harbour -- */

export const quay_edge = () => new Mesh()
  .box('concrete_cast', { size: [4.0, 1.6, 1.2], pos: [0, 0.8, 0] })
  .box('stone_dressed', { size: [4.0, 0.22, 1.4], pos: [0, 1.71, 0] })
  .box('timber_bare', { size: [0.3, 1.4, 0.22], pos: [-1.3, 0.7, 0.6] })
  .box('timber_bare', { size: [0.3, 1.4, 0.22], pos: [1.3, 0.7, 0.6] });

export const mooring_bollard = () => new Mesh()
  .cylinder('metal_rust', { r: 0.34, h: 0.14, seg: 12 })
  .cylinder('metal_rust', { r: [0.24, 0.19], h: 0.55, seg: 12, pos: [0, 0.14, 0] })
  .cylinder('metal_rust', { r: 0.3, h: 0.16, seg: 12, pos: [0, 0.69, 0] });

export const quay_ladder = () => {
  const m = new Mesh();
  m.box('metal_rust', { size: [0.06, 2.6, 0.06], pos: [-0.24, 1.3, 0] });
  m.box('metal_rust', { size: [0.06, 2.6, 0.06], pos: [0.24, 1.3, 0] });
  for (let i = 0; i < 8; i++) m.box('metal_rust', { size: [0.54, 0.04, 0.04], pos: [0, 0.2 + i * 0.32, 0] });
  return m;
};

export const dock_crane = () => {
  const m = new Mesh();
  for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
    m.box('metal_painted', { size: [0.3, 9.0, 0.3], pos: [x, 4.5, z] });
  }
  for (const y of [3.0, 6.0]) {
    m.box('metal_painted', { size: [3.5, 0.16, 0.16], pos: [0, y, -1.6] });
    m.box('metal_painted', { size: [3.5, 0.16, 0.16], pos: [0, y, 1.6] });
    m.box('metal_painted', { size: [0.16, 0.16, 3.5], pos: [-1.6, y, 0] });
    m.box('metal_painted', { size: [0.16, 0.16, 3.5], pos: [1.6, y, 0] });
  }
  m.box('metal_painted', { size: [4.0, 1.6, 4.0], pos: [0, 9.8, 0] });
  m.box('metal_galv', { size: [0.5, 0.5, 14.0], pos: [0, 10.4, 6.0] });
  m.box('metal_galv', { size: [0.4, 0.4, 5.0], pos: [0, 10.4, -3.0] });
  m.box('glass_shop', { size: [1.4, 1.1, 1.4], pos: [1.6, 9.4, 1.6] });
  m.box('metal_rust', { size: [0.9, 1.2, 0.9], pos: [0, 8.6, 9.5] });
  return m;
};

export const container = () => new Mesh()
  .box('metal_rust', { size: [6.05, 2.59, 2.44], pos: [0, 1.295, 0] })
  .box('metal_painted', { size: [6.1, 0.14, 2.5], pos: [0, 0.07, 0] })
  .box('metal_painted', { size: [6.1, 0.14, 2.5], pos: [0, 2.52, 0] })
  .box('metal_painted', { size: [0.1, 2.5, 2.5], pos: [-3.0, 1.3, 0] })
  .box('metal_painted', { size: [0.1, 2.5, 2.5], pos: [3.0, 1.3, 0] });

export const container_stack = () => {
  const m = new Mesh();
  const one = (x, y, z) => m.box('metal_rust', { size: [6.05, 2.59, 2.44], pos: [x, y + 1.295, z] });
  one(0, 0, 0); one(0, 2.62, 0); one(0, 5.24, 0);
  one(0, 0, 2.55); one(0, 2.62, 2.55);
  one(0, 0, -2.55);
  return m;
};

export const pontoon = () => new Mesh()
  .box('timber_bare', { size: [8.0, 0.3, 2.6], pos: [0, 0.15, 0] })
  .box('timber_painted', { size: [8.0, 0.12, 0.12], pos: [0, 0.36, -1.24] })
  .box('timber_painted', { size: [8.0, 0.12, 0.12], pos: [0, 0.36, 1.24] })
  .box('metal_galv', { size: [0.16, 3.0, 0.16], pos: [-3.6, 1.5, 1.24] })
  .box('metal_galv', { size: [0.16, 3.0, 0.16], pos: [3.6, 1.5, 1.24] });

export const ferry_ramp = () => new Mesh()
  .wedge('concrete_cast', { size: [6.0, 1.2, 4.0], flip: true })
  .box('metal_rust', { size: [5.6, 0.14, 3.0], pos: [0, 0.9, 0.4], rot: [-0.14, 0, 0] })
  .box('metal_painted', { size: [0.12, 1.1, 3.0], pos: [-2.9, 1.4, 0.4] })
  .box('metal_painted', { size: [0.12, 1.1, 3.0], pos: [2.9, 1.4, 0.4] });

export const crates = () => new Mesh()
  .box('timber_bare', { size: [1.2, 0.9, 1.0], pos: [-0.5, 0.45, 0] })
  .box('timber_bare', { size: [1.0, 0.8, 0.9], pos: [0.7, 0.4, 0.2] })
  .box('timber_bare', { size: [0.9, 0.7, 0.8], pos: [-0.3, 1.25, -0.1], rot: [0, 0.4, 0] });

export const pallet_stack = () => {
  const m = new Mesh();
  for (let i = 0; i < 5; i++) {
    m.box('timber_bare', { size: [1.2, 0.06, 0.8], pos: [0, 0.03 + i * 0.15, 0] });
    m.box('timber_bare', { size: [0.1, 0.09, 0.8], pos: [-0.5, 0.11 + i * 0.15, 0] });
    m.box('timber_bare', { size: [0.1, 0.09, 0.8], pos: [0.5, 0.11 + i * 0.15, 0] });
  }
  return m;
};
