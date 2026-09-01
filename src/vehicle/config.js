export const WHEELBASE = 2.72;
export const AXLE_F = 0.98;
export const AXLE_R = AXLE_F + WHEELBASE;
export const TRACK = 1.58;
export const WHEEL_R = 0.345;
/**
 * The hull is modelled from the nose (x=0) backward, but the simulation's
 * origin is the centre of gravity. Everything visual is shifted by this so the
 * mesh and the physics agree; without it the car renders 2.2m ahead of itself.
 */
export const CG_X = AXLE_F + WHEELBASE * 0.46;

/**
 * Which quads of the loft are glazing.
 * Geometric rather than index-based, so the section resolution can change
 * without rewriting this. `hf` is height above the beltline (0 at the shoulder,
 * 1 at the roof); `wf` is |z| as a fraction of the section's widest half-width.
 */
export function hullClassify(xm, hf, wf, yc = 0, zc = 0) {
  /* Doors first, so they win over the generic 'body' bucket.
     A door is the SIDE skin (wf > 0.56) between two shutlines, above the sill
     (0.30m) and below the glass line. Front doors hinge on the A-pillar
     shutline, rear doors on the B-pillar. Sides are named by hull-local z;
     model.js decides which is the driver's. Glass rules below still win for
     the window area because they return before this is reached... except
     they do not -- so the door band is capped at the beltline hf where the
     side-glass rule begins. */
  const side = zc > 0 ? 'L' : 'R';
  if (wf > 0.56 && yc > 0.30 && !(hf > 0.14 && xm > 1.66 + hf * 0.52 && xm < 3.60 - hf * 0.40 && hf < 0.92 && !(xm > 2.50 && xm < 2.76))) {
    if (xm > SHUTLINES[0] && xm < SHUTLINES[1]) return 'doorF' + side;
    if (xm > SHUTLINES[1] && xm < SHUTLINES[2]) return 'doorR' + side;
  }
  if (hf < 0.14) return 'body';                    // everything below the beltline

  // The A- and C-pillars are raked: the glass boundary walks backward as it
  // rises, which is what gives the cabin its shape rather than a slab of glass.
  const aPillar = 1.66 + hf * 0.52;
  const cPillar = 3.60 - hf * 0.40;
  const bPillar = xm > 2.50 && xm < 2.76;

  if (wf > 0.56 && !bPillar && xm > aPillar && xm < cPillar && hf < 0.92) {
    // side glass inside a door band swings WITH the door
    if (xm > SHUTLINES[0] && xm < SHUTLINES[1]) return 'doorF' + side + 'g';
    if (xm > SHUTLINES[1] && xm < SHUTLINES[2]) return 'doorR' + side + 'g';
    return 'glass';
  }
  if (wf < 0.66 && hf > 0.32 && xm > 1.58 && xm < 2.42) return 'glass';   // windscreen
  if (wf < 0.66 && hf > 0.32 && xm > 3.18 && xm < 3.76) return 'glass';   // backlight
  return 'body';
}

/**
 * The same idea as hullClassify, but proportional.
 *
 * hullClassify measures pillars in absolute metres off the hero's 4.6m body.
 * The traffic fleet runs from a hatch to a van, so its glass has to be found
 * as a fraction of the car's own length -- which is why every one of them was
 * lofted with everything classified as 'body' and came out a solid lump with
 * no windows at all.
 */
export function stuntClassify(spec) {
  return (xm, hf, wf) => {
    if (hf < 0.17) return 'body';
    const u = xm / spec.L;
    const a = 0.355 + hf * 0.10;
    const c = 0.790 - hf * 0.085;
    const bPillar = u > 0.552 && u < 0.598;
    if (wf > 0.56 && !bPillar && u > a && u < c && hf < 0.90) return 'glass';
    if (wf < 0.66 && hf > 0.34 && u > 0.335 && u < 0.525) return 'glass';   // windscreen
    if (wf < 0.66 && hf > 0.34 && u > 0.700 && u < 0.825) return 'glass';   // backlight
    return 'body';
  };
}

/** Vertical panel shutlines: front wing / door / rear quarter / boot. */
export const SHUTLINES = [1.50, 2.62, 3.28, 3.98];

/**
 * Parametric station generator.
 * Hand-tuning a station table per body style does not scale, so a body is
 * described by its landmarks — roofline, ride height, axles, width — and the
 * stations fall out. Wheel arches come from the axle positions automatically.
 */
export function buildStations(p) {
  const {
    L, axleF, axleR, wheelR, ride, top, wMax, tumble = 0.66,
    bonnetY, roofY, beltY, detail = 1,
  } = p;

  const topAt = (x) => {
    for (let i = 0; i < top.length - 1; i++) {
      if (x <= top[i + 1][0]) {
        const t = (x - top[i][0]) / Math.max(1e-4, top[i + 1][0] - top[i][0]);
        return top[i][1] + (top[i + 1][1] - top[i][1]) * Math.max(0, Math.min(1, t));
      }
    }
    return top[top.length - 1][1];
  };
  const archR = wheelR + 0.07;
  const bottomAt = (x) => {
    let y = ride;
    for (const ax of [axleF, axleR]) {
      const d = Math.abs(x - ax);
      if (d < archR) y = Math.max(y, wheelR * 0.30 + Math.sqrt(archR * archR - d * d) * 0.86);
    }
    return y;
  };
  const widthAt = (x) => {
    const nose = Math.min(1, x / (L * 0.15));
    const tail = Math.min(1, (L - x) / (L * 0.13));
    return 0.60 + 0.40 * Math.pow(Math.min(nose, tail), 0.5);
  };

  const xs = new Set([0, L]);
  for (const [x] of top) xs.add(Math.max(0, Math.min(L, x)));
  const archSamples = detail > 0.6
    ? [-1, -0.72, -0.42, 0, 0.42, 0.72, 1]
    : [-1, -0.55, 0, 0.55, 1];
  for (const ax of [axleF, axleR]) {
    for (const k of archSamples) xs.add(Math.max(0, Math.min(L, ax + k * archR)));
  }
  const fill = detail > 0.6 ? 10 : 5;
  for (let i = 0; i <= fill; i++) xs.add((L * i) / fill);

  return [...xs].sort((a, b) => a - b).map((x) => {
    const yb = bottomAt(x);
    const yt = Math.max(topAt(x), yb + 0.22);
    const f = widthAt(x);
    const wm = wMax * f;
    // tumblehome only where the body is actually cabin, not over the bonnet
    const cabin = Math.max(0, Math.min(1, (yt - bonnetY) / Math.max(0.1, roofY - bonnetY)));
    const wTop = wm * (0.88 + (tumble - 0.88) * cabin);
    const sy = Math.min(yt - 0.04, Math.max(yb + 0.10, beltY));
    return [x, yb, yt, wm * 0.90, wm, wTop, sy];
  });
}

/**
 * Parked and moving traffic. Six silhouettes, so a street is not one car
 * repeated forty times.
 */
export const BODY_TYPES = {
  sedan: {
    L: 4.62, axleF: 1.00, axleR: 3.66, wheelR: 0.33, ride: 0.26, wMax: 0.88,
    bonnetY: 0.90, roofY: 1.45, beltY: 0.62, tumble: 0.64, detail: 0.4,
    top: [[0, 0.74], [0.28, 0.86], [1.45, 0.92], [1.60, 1.00], [2.45, 1.45],
          [3.10, 1.47], [3.35, 1.36], [3.85, 1.04], [4.30, 0.95], [4.62, 0.80]],
  },
  hatch: {
    L: 3.98, axleF: 0.86, axleR: 3.14, wheelR: 0.31, ride: 0.26, wMax: 0.85,
    bonnetY: 0.88, roofY: 1.48, beltY: 0.62, tumble: 0.66, detail: 0.4,
    top: [[0, 0.72], [0.24, 0.84], [1.10, 0.90], [1.28, 1.00], [2.05, 1.47],
          [2.95, 1.49], [3.35, 1.36], [3.72, 1.04], [3.98, 0.86]],
  },
  wagon: {
    L: 4.78, axleF: 1.00, axleR: 3.72, wheelR: 0.33, ride: 0.26, wMax: 0.88,
    bonnetY: 0.90, roofY: 1.52, beltY: 0.63, tumble: 0.68, detail: 0.4,
    top: [[0, 0.74], [0.28, 0.86], [1.45, 0.92], [1.62, 1.02], [2.45, 1.50],
          [4.10, 1.52], [4.42, 1.40], [4.78, 0.94]],
  },
  suv: {
    L: 4.70, axleF: 1.02, axleR: 3.72, wheelR: 0.39, ride: 0.42, wMax: 0.93,
    bonnetY: 1.10, roofY: 1.82, beltY: 0.86, tumble: 0.74, detail: 0.4,
    top: [[0, 0.94], [0.30, 1.06], [1.42, 1.12], [1.62, 1.26], [2.30, 1.80],
          [3.90, 1.82], [4.28, 1.66], [4.70, 1.12]],
  },
  van: {
    L: 4.95, axleF: 1.02, axleR: 3.92, wheelR: 0.35, ride: 0.36, wMax: 0.95,
    bonnetY: 1.10, roofY: 2.10, beltY: 0.94, tumble: 0.86, detail: 0.4,
    top: [[0, 0.96], [0.26, 1.10], [0.90, 1.14], [1.05, 1.40], [1.70, 2.06],
          [4.55, 2.10], [4.80, 1.90], [4.95, 1.30]],
  },
  pickup: {
    L: 5.10, axleF: 1.06, axleR: 4.02, wheelR: 0.38, ride: 0.42, wMax: 0.92,
    bonnetY: 1.08, roofY: 1.78, beltY: 0.86, tumble: 0.76, detail: 0.4,
    top: [[0, 0.92], [0.30, 1.04], [1.30, 1.10], [1.50, 1.28], [2.10, 1.76],
          [3.05, 1.78], [3.22, 1.24], [3.35, 1.16], [4.90, 1.16], [5.10, 1.02]],
  },
};
export const BODY_KEYS = Object.keys(BODY_TYPES);

/** Muted only. No showroom reds, no primary blues. */
export const HERO_SPEC = {
  L: 4.64, axleF: AXLE_F, axleR: AXLE_R, wheelR: WHEEL_R, ride: 0.245, wMax: 0.90,
  bonnetY: 0.90, roofY: 1.46, beltY: 0.62, tumble: 0.62, detail: 1,
  top: [[0, 0.74], [0.26, 0.845], [1.34, 0.905], [1.55, 0.94], [2.15, 1.32],
        [2.45, 1.43], [2.80, 1.46], [3.15, 1.44], [3.55, 1.26], [3.95, 1.03],
        [4.30, 0.94], [4.64, 0.78]],
};

export const PAINT_COLOURS = [
  0x1b1e23, 0x2f343a, 0x6f7479, 0xa9acae,
  0x27333f, 0x422a2a, 0x30392c, 0x55504a,
];

/** Chassis, driveline and tyre constants. */
export const V = {
  mass: 1480, inertia: 2100,
  cgH: 0.52,
  a: WHEELBASE * 0.46, b: WHEELBASE * 0.54,
  track: TRACK,
  wheelI: 1.35,
  engI: 0.21,                 // engine + flywheel, reflected through ratio^2
  muPeak: 1.42,
  Cf: 12.5, Cr: 14.0, Cx: 16.0,
  dragC: 0.62, rollC: 12.0, downF: 0.45,
  /* The handbrake has to actually lock the rears. At 3400Nm through the 0.5
     scaling in the brake loop it only slowed them to within 10% of rolling,
     so the tail never stepped out and the car left almost no rubber. */
  brakeMax: 5200, handbrake: 9000,

  /* Suspension. Four rays instead of a weight-transfer formula: the spring
     compression at each corner IS the tyre's normal load, so weight transfer,
     dive, squat and roll all fall out of one model instead of being three
     separate fudges. */
  restLength: 0.34,          // ride height at rest, hub to spring seat
  maxTravel: 0.17,
  springK: 46000,            // N/m, ~0.085m static sag at the front
  damperC: 3400,             // N/(m/s) compression
  damperR: 4600,             // rebound is stiffer, as on a real damper
  antiRollF: 12000,          // N/m of left-right compression difference
  antiRollR: 8000,
  Ipitch: 2100, Iroll: 620,
  sprungMass: 1240,
  steerMax: 0.6,
  gears: [-3.3, 0, 3.62, 2.19, 1.54, 1.18, 0.96, 0.78],   // [R, N, 1..6]
  final: 3.55,
  idle: 850, redline: 6800, shiftUp: 6200, shiftDown: 2400,
};

/* The body mesh is authored at its laden ride height, so heave has to be
   measured from there rather than from the free spring length — otherwise the
   car renders sitting 7cm into its own arches. */
V.staticSag = (V.sprungMass * 9.81) / (4 * V.springK);
V.rideHeight = WHEEL_R + V.restLength - V.staticSag;
