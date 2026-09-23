// Geography of the film, in metres. Hand-traced from public maps, simplified.
// World frame: origin at LAT0/LON0, +x = east, -z = north, y = up, 1 unit = 1 m.

export const LAT0 = 40.80, LON0 = -73.95;
const M_LAT = 111_000;
const M_LON = 111_320 * Math.cos(LAT0 * Math.PI / 180); // ~84,300 m per degree here

export function ll(lat, lon, y = 0) {
  return { x: (lon - LON0) * M_LON, y, z: -(lat - LAT0) * M_LAT };
}
export function toLatLon(x, z) {
  return { lat: LAT0 - z / M_LAT, lon: LON0 + x / M_LON };
}
const P = (pts) => pts.map(([lat, lon]) => ll(lat, lon));

// Manhattan's shoreline, south to north up the Hudson side, then back down the
// Harlem / East River side.
const MANHATTAN_WEST = [
  [40.7010, -74.0170], [40.7115, -74.0160], [40.7270, -74.0110], [40.7400, -74.0095],
  [40.7540, -74.0070], [40.7667, -73.9950], [40.7800, -73.9890], [40.8000, -73.9760],
  [40.8200, -73.9610], [40.8400, -73.9500], [40.8520, -73.9480], [40.8650, -73.9370],
  [40.8780, -73.9270],
];
const MANHATTAN_EAST = [
  [40.8740, -73.9110], [40.8600, -73.9190], [40.8500, -73.9270], [40.8300, -73.9340],
  [40.8100, -73.9330], [40.7980, -73.9290], [40.7850, -73.9410], [40.7700, -73.9520],
  [40.7550, -73.9630], [40.7400, -73.9720], [40.7250, -73.9720], [40.7100, -73.9780],
  [40.7050, -74.0000],
];
export const MANHATTAN = P([...MANHATTAN_WEST, ...MANHATTAN_EAST]);

// The New Jersey bank of the Hudson, north to south.
const NJ_SHORE = [
  [40.9500, -73.9120], [40.9300, -73.9200], [40.8800, -73.9450], [40.8520, -73.9610],
  [40.8200, -73.9720], [40.7900, -73.9990], [40.7690, -74.0130], [40.7500, -74.0240],
  [40.7300, -74.0290], [40.7000, -74.0340], [40.6700, -74.0500], [40.6200, -74.0700],
];
export const NJ_SHORE_PTS = P(NJ_SHORE);

// Water bodies, painted over land. Overlap is fine: they are unioned by paint.
export const WATER = [
  // Hudson + Upper Bay: Manhattan's west shore up, Bronx shore to the top edge,
  // NJ shore down, then out across the bay to Brooklyn.
  P([
    ...MANHATTAN_WEST, [40.8800, -73.9230], [40.9000, -73.9170], [40.9600, -73.9050],
    ...NJ_SHORE, [40.6000, -74.0400], [40.6000, -74.0100], [40.6500, -74.0200],
    [40.6800, -74.0150], [40.6950, -74.0000], [40.7005, -74.0160],
  ]),
  // East River: Manhattan's east shore, then Queens / Brooklyn opposite.
  P([
    [40.7050, -74.0000], [40.7100, -73.9780], [40.7250, -73.9720], [40.7400, -73.9720],
    [40.7550, -73.9630], [40.7700, -73.9520], [40.7850, -73.9410], [40.7980, -73.9290],
    [40.8010, -73.9200], [40.7960, -73.9120], [40.7880, -73.9150], [40.7780, -73.9300],
    [40.7650, -73.9380], [40.7500, -73.9500], [40.7350, -73.9600], [40.7150, -73.9680],
    [40.7020, -73.9880], [40.6980, -73.9990],
  ]),
  // Hell Gate east along the Bronx shore to the Sound, and back along Queens past
  // LaGuardia (Bowery Bay, Flushing Bay).
  P([
    [40.8010, -73.9200], [40.8030, -73.9050], [40.8050, -73.8900], [40.8080, -73.8750],
    [40.8120, -73.8600], [40.8150, -73.8400], [40.8100, -73.8200], [40.8050, -73.7900],
    [40.8200, -73.7700], [40.7900, -73.7500], [40.7800, -73.7800], [40.7850, -73.8100],
    [40.7780, -73.8350], [40.7700, -73.8450], [40.7600, -73.8420], [40.7580, -73.8520],
    [40.7650, -73.8600], [40.7720, -73.8620], [40.7860, -73.8660], [40.7880, -73.8800],
    [40.7830, -73.8900], [40.7800, -73.9000], [40.7850, -73.9120], [40.7960, -73.9120],
  ]),
  // Harlem River, a thin strip along Manhattan's north-east shore.
  P([
    [40.8740, -73.9110], [40.8600, -73.9190], [40.8500, -73.9270], [40.8300, -73.9340],
    [40.8100, -73.9330], [40.7980, -73.9290], [40.8000, -73.9250], [40.8120, -73.9295],
    [40.8310, -73.9300], [40.8510, -73.9235], [40.8610, -73.9150], [40.8760, -73.9070],
    [40.8790, -73.9150],
  ]),
];

export const CENTRAL_PARK = P([
  [40.7644, -73.9730], [40.7681, -73.9819], [40.8003, -73.9582], [40.7968, -73.9493],
]);

export const PLACES = {
  lgaRwy4:  ll(40.7696, -73.8845),  // runway 4 threshold
  lgaRwy22: ll(40.7855, -73.8683),
  lgaRwy13: ll(40.7822, -73.8786),
  lgaRwy31: ll(40.7695, -73.8579),
  lga:      ll(40.7769, -73.8740),
  teterboro: ll(40.8501, -74.0608),
  gwbNJ:    ll(40.8539, -73.9628),  // towers
  gwbNY:    ll(40.8513, -73.9506),
  gwbAnchNJ: ll(40.8547, -73.9672),
  gwbAnchNY: ll(40.8505, -73.9460),
  empire:   ll(40.7484, -73.9857),
  chrysler: ll(40.7516, -73.9755),
  midtown:  ll(40.7540, -73.9840),
  downtown: ll(40.7080, -74.0100),
};

export function inPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) &&
        p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
export const isWater = (p) => WATER.some((w) => inPoly(p, w));

// Distance (m) west of the NJ shoreline, negative east of it. Used for the
// Palisades: a 90 m basalt cliff that runs north from about Edgewater.
export function westOfNJShore(p) {
  const pts = NJ_SHORE_PTS;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if ((p.z - a.z) * (p.z - b.z) <= 0) {
      const t = (p.z - a.z) / (b.z - a.z || 1);
      return (a.x + (b.x - a.x) * t) - p.x;
    }
  }
  return -1e9;
}
export function palisadesHeight(p) {
  const { lat } = toLatLon(p.x, p.z);
  if (lat < 40.795) return 0;
  const d = westOfNJShore(p);
  const fade = Math.min(1, (lat - 40.795) / 0.02);
  if (d < 60 || d > 3150) return 0;
  if (d < 110) return fade * 92 * (d - 60) / 50;
  return fade * 92;
}

export const LGA_FIELD = P([
  [40.7650, -73.8900], [40.7720, -73.8920], [40.7880, -73.8700], [40.7880, -73.8620],
  [40.7740, -73.8540], [40.7660, -73.8560], [40.7640, -73.8700],
]);
