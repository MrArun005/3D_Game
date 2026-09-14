/**
 * THE HALSTEAD MILE — the scenic route.
 *
 * A 5.7 km loop that strings the map's set pieces onto one drive: the Old
 * Quarter hero block, the Marrow Road bridge, 1.3 km of river along THE
 * EMBANKMENT, the 390 m elevated deck of the Halstead Lift Bridge, the Dock
 * Road crossing, Harbour Point, the seafront promenade, and an open-ocean
 * finish with no mountains to seaward.
 *
 * Every waypoint below was routed through the real graph and profiled, not
 * picked off a map: `Navigation.findRoute` connects all seven legs, the whole
 * thing is 5,698 m, and the worst elevation step anywhere within 6 m of the
 * driving line is 0.55 m.
 *
 * THE POINT OF THE ORDER is leg 4. Its heading at the lift bridge is
 * (0.06, 1.00) -- dead +Z -- and clock.js biases the golden-hour sun fully +Z
 * (`bias = 1.0` between 16:00 and 18:00) so the disc sits at the end of the
 * road. Crossing that bridge in that window puts the sun down the deck, 7.6 m
 * over the river, mountains to the west. Start the run at 16:20 and the timing
 * lands there on its own at a normal pace; that is why DEFAULT_HOUR is 16.2.
 */

/** Waypoints, in order. `x`/`z` are world metres; `note` is what the leg is for. */
export const HALSTEAD_MILE = [
  { x: 1161, z: 1430, note: 'OLD QUARTER' },
  { x: 1720, z: 1000, note: 'MARROW ROAD BRIDGE' },
  { x: 1912, z: 2195, note: 'THE EMBANKMENT' },
  { x: 1939, z: 2317, note: 'LIFT BRIDGE' },
  { x: 1962, z: 2698, note: 'THE DECK' },
  { x: 2624, z: 2152, note: 'HARBOUR POINT' },
  { x: 3541, z: 2346, note: 'THE PROMENADE' },
  { x: 2960, z: 2700, note: 'THE BAY' },
];

/** Golden hour, timed so the lift-bridge crossing lands in the sun. */
export const DEFAULT_HOUR = 16.2;

/** Heading to face at the start line, in radians: down leg 1 toward the bridge. */
export function startYaw() {
  const a = HALSTEAD_MILE[0], b = HALSTEAD_MILE[1];
  return Math.atan2(b.z - a.z, b.x - a.x);
}

/**
 * The points in the shape `Mission.route` wants.
 *
 * Mission reads `y` as the world Z -- the same convention the road graph's
 * nodes use (`navigation.js` walks `n.x` / `n.y`), which is a trap worth
 * naming: `y` here is NOT a height.
 */
export function missionPoints() {
  return HALSTEAD_MILE.slice(1).map((p) => ({ x: p.x, y: p.z, note: p.note }));
}
