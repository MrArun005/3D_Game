/**
 * HALSTEAD LIFT BRIDGE -- the plan's one `signature: true` bridge
 * (public/halstead-bay.district.json: [[1939,2317],[1962,2698]], width 26,
 * 381 m over the harbour) and, per docs/VISUAL-BRIEF.md, the city's biggest
 * missable landmark. Until now a bridge here was a deck quad, a skirt wall to
 * the riverbed and a blank 1.0 m parapet: a road on a wall. This is the steel.
 *
 * A real VERTICAL-LIFT bridge, in the order the parts carry load:
 *
 *   tower      four braced lattice side-frames (two at each end of the
 *              channel, one either side of the carriageway), 58 m of legs +
 *              X-bracing, joined across the road by a top girder and one
 *              portal strut, standing on concrete caissons in the water
 *   sheaves    one 2.4 m cable wheel on top of each side-frame, centred over
 *              that frame's INNER leg pair, i.e. directly over the lift span's
 *              cable lug
 *   lift span  a through truss between the towers -- you drive INSIDE the
 *              steel cage, under 9 m of portal and sway bracing
 *   cables     four per side-frame: two vertical strands down to the span's
 *              lug (tangent to the sheave on the channel side) and two down to
 *              the counterweight (tangent on the outboard side). Both runs are
 *              sheave TANGENTS, which is why the total length is conserved for
 *              free -- see `opts.lift` below
 *   counterwt  a concrete block riding inside each side-frame's bay, one per
 *              sheave, moving exactly opposite the span
 *
 * THE SPAN IS MODELLED DOWN AND DOES NOT MOVE. `opts.lift` (0..1) poses it for
 * a future animation, but the default is 0 and the game never changes it: the
 * bridge carries a road the traffic graph and district.elevationAt both think
 * is continuous at 7.6 m, so a raised span would open a 74 m hole in it and
 * drop every car that crossed. Raising it needs a road closure first.
 *
 * Contract (artKit's, plus what a landmark needs -- see world/skyline.js and
 * how world/landmarks.js:#buildSkyline consumes it):
 *
 *   buildLiftBridge(a, b, width, opts) -> {
 *     parts:   [{ geo, mat }]  WORLD-SPACE geometry, mat an artKit MAT_KEY;
 *                              merge per key, one mesh each with artMaterial()
 *     lamps:   [{ x, y, z, colour, range }]  hero light heads, world frame
 *     solids:  [{ x, z, hw, hd, angle, height }]  districtWorld's box shape
 *     keepOut: [{ x, z, cy, sy, hw, hd }]  landmarks.js:keepOut records, so the
 *                              scatterers do not plant trees inside the towers
 *     rig:     the moving parts' measured positions (sheaves, lugs,
 *                              counterweights, cables, legs) -- what the test
 *                              asserts against and what an animation would read
 *     height, tris, length, angle
 *   }
 *
 * World space, not local: the whole thing is one object placed once, so there
 * is nothing to gain from a local frame and a caller that has to re-derive the
 * yaw. LIFT_BRIDGE carries the plan's numbers already worked out.
 *
 * Cost, measured in node: 7,332 triangles, 4 draws (metal / concrete / dark /
 * emit). Budget was 14,000. It is drawn once for the session, not per chunk.
 */
import * as THREE from 'three';
import { boxM, quadM, cylM, at, Parts } from './artKit.js';

/* Deck height. district.js builds every bridge span with makeSpan(pts, width,
   7.6, 62, ...) and water.js's DECK_T is the 0.9 m soffit under it -- both
   constants are duplicated there too, and all three have to agree. */
export const DECK_Y = 7.6;
const DECK_T = 0.9;
const WATER_Y = -2.6;

const TOWER_GAP = 84;        // centre-to-centre of the two towers: the channel
const LEG_DX = 4.5;          // half the side-frame's length along the road
const LEG_DZ = 1.5;          // half its depth across the road
const LEG_T = 0.72;          // a leg is a 0.72 m box column
const TOWER_TOP = 58;        // top of the legs -- the 55-65 m the brief asks for
const SHEAVE_Y = 55.8, SHEAVE_R = 2.4;
const LIFT_TRAVEL = 30;      // how far the span would rise: 37.6 m of clearance
const TRUSS_H = 9.0;         // through-truss depth; the sway bracing is the roof of the cage
const CW_TOP0 = SHEAVE_Y - 3.4;   // counterweight top with the span DOWN (it is up)
const CW_H = 6.0, CW_HX = 1.5, CW_HZ = 1.15;
const MACH_H = 4.2;          // machinery house on each tower top
const PIER_SPACING = 46, PIER_FOOT = -6;

const STEEL = 0x7d858c, DARK_STEEL = 0x3a4148, CONCRETE = 0x9a978e, CW_CONCRETE = 0x8d8a82;
const RED = [1, 0.12, 0.06], GREEN = [0.15, 1, 0.4], WARM = [1, 0.86, 0.62];

const _m = new THREE.Matrix4();

/* ---- local-frame helpers. x runs along the plan line from a, z across it
   (+z is left of travel), y is world y. The towers and span sit on DY (the
   lift deck); the approaches follow opts.deckAt -- district.js's lift
   system lands both ends at grade INSIDE [0, L] (2026-09-25). ---- */

/** A strut between two points in the x-y plane at z, `t` square. */
function strut(P, key, x0, y0, x1, y1, z, t, hex) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const g = boxM(len, t, t, hex);
  g.applyMatrix4(_m.makeRotationZ(Math.atan2(y1 - y0, x1 - x0)));
  return P.push(key, at(g, (x0 + x1) / 2, (y0 + y1) / 2, z));
}
/** A vertical member. */
const post = (P, key, x, y0, y1, z, t, hex) => P.push(key, at(boxM(t, y1 - y0, t, hex), x, (y0 + y1) / 2, z));
/** A member running across the road at (x, y), from z0 to z1. */
const cross = (P, key, x, y, z0, z1, t, hex) => P.push(key, at(boxM(t, t, Math.abs(z1 - z0), hex), x, y, (z0 + z1) / 2));

export function buildLiftBridge(a, b, width = 26, opts = {}) {
  /* opts.deckY / opts.deckAt (2026-09-25): the deck the towers and span sit on,
     and the approach deck's height t metres along -- district.js's lift
     system (a flat lift deck, a junction deck at DOCK ROAD, both ends at
     grade). Without them the bridge is the old flat 7.6 m deck. */
  const DY = opts.deckY ?? DECK_Y;
  const lift = Math.min(1, Math.max(0, opts.lift ?? 0));
  const ax = a[0], az = a[1];
  const dx = b[0] - ax, dz = b[1] - az;
  const L = Math.hypot(dx, dz), yaw = Math.atan2(dz, dx);
  const halfW = width / 2;
  /* Tower and truss centreline, across the road. district.js lifts the BAND
     `half + 5.5`, but nothing is DRAWN out there: districtWorld's carriageway
     is one quad per segment at `s.half`, so on this bridge the deck geometry
     stops dead at +-13 m (measured in node over the plan file). Anything the
     old `halfW + 6.0` put at +-19 -- railing, lamp columns, truss chords --
     hung in open air five metres off the edge. The steel sits at +-16: the
     caisson's inner face is 0.2 m clear of the deck edge, the legs are just
     outboard of the kerb on it, and the chords give 3 m either side of the
     carriageway. */
  const TZ = halfW + 3.0;

  const P = new Parts(), lamps = [], solids = [], rig = { sheaves: [], lugs: [], counterweights: [], cables: [], legs: [], deckY: DY, travel: LIFT_TRAVEL, spanY: DY + lift * LIFT_TRAVEL, trussH: TRUSS_H };
  const tA = L / 2 - TOWER_GAP / 2, tB = L / 2 + TOWER_GAP / 2;

  /* ---------- the two towers ---------- */
  for (const [ti, TX] of [[0, tA], [1, tB]]) {
    const inner = ti === 0 ? 1 : -1;                 // which way the channel lies
    const SX = TX + inner * LEG_DX;                  // sheaves sit over the inner leg pair
    const lugX = SX + inner * SHEAVE_R;              // span cable: sheave tangent, channel side
    const cwX = SX - inner * SHEAVE_R;               // counterweight cable: tangent, outboard side

    for (const sz of [-1, 1]) {
      const FZ = sz * TZ;                            // this side-frame's centreline

      // caisson: one concrete box per side-frame, from the riverbed to the deck
      P.push('concrete', at(boxM(2 * LEG_DX + 2.6, DY - PIER_FOOT, 2 * LEG_DZ + 2.6, CONCRETE), TX, (DY + PIER_FOOT) / 2, FZ));

      // four legs
      for (const lx of [-LEG_DX, LEG_DX]) for (const lz of [-LEG_DZ, LEG_DZ]) {
        post(P, 'metal', TX + lx, DY - 0.4, TOWER_TOP, FZ + lz, LEG_T, STEEL);
        rig.legs.push({ x: TX + lx, z: FZ + lz, half: LEG_T / 2 });
      }

      /* Lattice. The two 9 m faces you see from the road get the full
         horizontal-plus-X pattern; the 3 m faces across the frame get
         horizontals only (a diagonal that shallow is a pixel at 400 m and
         twelve triangles nobody sees). The counterweight rides INSIDE the
         frame, between the four legs, so nothing here is in its way. */
      const y0 = DY + 1.2, levels = 8, dy = (TOWER_TOP - y0) / levels;
      for (const lz of [-LEG_DZ, LEG_DZ]) {
        for (let i = 0; i <= levels; i++) strut(P, 'metal', TX - LEG_DX, y0 + i * dy, TX + LEG_DX, y0 + i * dy, FZ + lz, 0.42, STEEL);
        for (let i = 0; i < levels; i++) {
          strut(P, 'dark', TX - LEG_DX, y0 + i * dy, TX + LEG_DX, y0 + (i + 1) * dy, FZ + lz, 0.3, DARK_STEEL);
          strut(P, 'dark', TX - LEG_DX, y0 + (i + 1) * dy, TX + LEG_DX, y0 + i * dy, FZ + lz, 0.3, DARK_STEEL);
        }
      }
      for (const lx of [-LEG_DX, LEG_DX])
        for (let i = 0; i <= levels; i++) cross(P, 'metal', TX + lx, y0 + i * dy, FZ - LEG_DZ, FZ + LEG_DZ, 0.36, STEEL);

      // the sheave: a wheel turning in the x-y plane, so its axle runs across the road
      const wheel = cylM(SHEAVE_R, 0.5, DARK_STEEL, 16);
      wheel.applyMatrix4(_m.makeRotationX(Math.PI / 2));
      P.push('dark', at(wheel, SX, SHEAVE_Y, FZ));
      cross(P, 'metal', SX, SHEAVE_Y, FZ - LEG_DZ - 0.4, FZ + LEG_DZ + 0.4, 0.5, STEEL);            // axle
      cross(P, 'metal', TX, TOWER_TOP - 0.6, FZ - LEG_DZ - 0.5, FZ + LEG_DZ + 0.5, 0.7, STEEL);     // the girder it hangs from
      rig.sheaves.push({ x: SX, y: SHEAVE_Y, z: FZ, r: SHEAVE_R });

      // machinery house + its lit window, and the aviation beacon over it
      P.push('metal', at(boxM(2 * LEG_DX + 0.8, MACH_H, 2 * LEG_DZ + 1.4, STEEL), TX, TOWER_TOP + MACH_H / 2, FZ));
      P.push('dark', at(boxM(2 * LEG_DX + 0.9, 0.8, 2 * LEG_DZ + 1.5, DARK_STEEL), TX, TOWER_TOP + MACH_H - 0.9, FZ));
      P.push('emit', at(quadM(3.0, 1.1, 0x2a2f36, WARM, 0.8), TX, TOWER_TOP + 1.9, FZ + sz * (LEG_DZ + 0.72), sz > 0 ? 0 : Math.PI));
      const beaconY = TOWER_TOP + MACH_H + 0.25;   // sitting ON the roof, not 0.45 m over it
      P.push('emit', at(boxM(0.5, 0.5, 0.5, 0x3a0a08, RED, 2.2), TX, beaconY, FZ));
      lamps.push({ x: TX, y: beaconY, z: FZ, colour: 0xff2a18, range: 70 });

      /* Cables. Both runs leave the sheave as vertical tangents, so the pair
         is (S - lugY) + (S - cwTopY) with lugY and cwTopY moving by +d and -d:
         the total is constant in `lift` by construction, and the strand
         lengths below are measured from those points, never assumed. */
      const lugY = DY + lift * LIFT_TRAVEL + TRUSS_H;
      const cwTopY = CW_TOP0 - lift * LIFT_TRAVEL;
      for (const off of [-0.55, 0.55]) {
        strut(P, 'dark', lugX, lugY, lugX, SHEAVE_Y, FZ + off, 0.09, DARK_STEEL);
        strut(P, 'dark', cwX, cwTopY, cwX, SHEAVE_Y, FZ + off, 0.09, DARK_STEEL);
      }
      rig.cables.push(
        { from: [lugX, SHEAVE_Y, FZ], to: [lugX, lugY, FZ], end: 'span', len: SHEAVE_Y - lugY },
        { from: [cwX, SHEAVE_Y, FZ], to: [cwX, cwTopY, FZ], end: 'counterweight', len: SHEAVE_Y - cwTopY },
      );

      // the counterweight, hanging from the same tangent line, inside the frame
      P.push('concrete', at(boxM(2 * CW_HX, CW_H, 2 * CW_HZ, CW_CONCRETE), cwX, cwTopY - CW_H / 2, FZ));
      P.push('dark', at(boxM(2 * CW_HX + 0.3, 0.4, 2 * CW_HZ + 0.3, DARK_STEEL), cwX, cwTopY - 0.2, FZ));
      rig.counterweights.push({ x: cwX, y: cwTopY, z: FZ, hx: CW_HX, h: CW_H, hz: CW_HZ });

      // one solid per side-frame: the car meets the tower, not the gap between its legs
      solids.push({ x: TX, z: FZ, hw: LEG_DX + LEG_T / 2, hd: LEG_DZ + LEG_T / 2, local: true, height: TOWER_TOP });

      // red pier light on the caisson, marking the channel edge at water level
      P.push('emit', at(boxM(0.4, 0.5, 0.4, 0x3a0a08, RED, 1.8), TX + inner * (LEG_DX + 1.3), WATER_Y + 1.6, FZ));
      rig.lugs.push({ x: lugX, y: lugY, z: FZ });
    }

    // across the road: the top girder, and one portal strut clear of the counterweights
    cross(P, 'metal', TX, TOWER_TOP - 1.4, -TZ - LEG_DZ, TZ + LEG_DZ, 1.3, STEEL);
    cross(P, 'metal', TX - inner * 2.5, DY + 6.6, -TZ - LEG_DZ, TZ + LEG_DZ, 1.0, STEEL);
  }

  /* ---------- the lift span: a through truss you drive inside ---------- */
  const sy = DY + lift * LIFT_TRAVEL;                 // the span's own deck level
  const s0 = tA + LEG_DX + 0.6, s1 = tB - LEG_DX - 0.6, sl = s1 - s0;
  const panels = 8, pw = sl / panels;
  for (const sz of [-1, 1]) {
    const FZ = sz * TZ;
    strut(P, 'metal', s0, sy + TRUSS_H, s1, sy + TRUSS_H, FZ, 0.55, STEEL);      // top chord
    strut(P, 'metal', s0, sy - 0.35, s1, sy - 0.35, FZ, 0.55, STEEL);            // bottom chord
    for (let i = 0; i <= panels; i++) post(P, 'metal', s0 + i * pw, sy - 0.35, sy + TRUSS_H, FZ, 0.42, STEEL);
    for (let i = 0; i < panels; i++) {                                            // Warren diagonals, alternating
      const x0 = s0 + i * pw, x1 = x0 + pw;
      strut(P, 'dark', x0, i % 2 ? sy + TRUSS_H : sy - 0.35, x1, i % 2 ? sy - 0.35 : sy + TRUSS_H, FZ, 0.34, DARK_STEEL);
    }
  }
  for (let i = 0; i <= panels; i++) {                                             // sway bracing: the roof of the cage
    const x = s0 + i * pw;
    cross(P, 'metal', x, sy + TRUSS_H, -TZ, TZ, 0.4, STEEL);
    cross(P, 'metal', x, sy - 0.35, -TZ, TZ, 0.45, STEEL);                        // floor beam
    if (i < panels) {
      strut(P, 'dark', x, sy + TRUSS_H - 0.55, x + pw, sy + TRUSS_H - 0.55, TZ - 1.6, 0.26, DARK_STEEL);
      strut(P, 'dark', x, sy + TRUSS_H - 0.55, x + pw, sy + TRUSS_H - 0.55, -TZ + 1.6, 0.26, DARK_STEEL);
    }
  }
  // portal frames at both ends of the cage, and the span's own thin deck plate
  for (const x of [s0, s1]) {
    cross(P, 'metal', x, sy + TRUSS_H - 1.3, -TZ, TZ, 0.8, STEEL);
    for (const sz of [-1, 1]) strut(P, 'dark', x, sy + TRUSS_H - 1.3, x, sy + 5.6, sz * TZ * 0.55, 0.3, DARK_STEEL);
  }
  P.push('dark', at(boxM(sl, 0.32, 2 * TZ, DARK_STEEL), (s0 + s1) / 2, sy - 0.5, 0));   // chord to chord, or the cage has no floor
  // green navigation light under the centre of the channel span
  P.push('emit', at(boxM(0.45, 0.5, 0.45, 0x07240f, GREEN, 2.0), (s0 + s1) / 2, sy - 1.1, 0));
  lamps.push({ x: (s0 + s1) / 2, y: sy - 1.1, z: 0, colour: 0x2bff77, range: 40 });

  /* ---------- the approaches: piers, railings, lamp standards ---------- */
  const yAt = opts.deckAt ?? (() => DY);
  const gaps = opts.gaps ?? [];                      // [t0, t1]: a road crosses the deck edge here (DOCK ROAD)
  const open = (t) => gaps.some(([g0, g1]) => t > g0 && t < g1);
  const STEP = 16;
  const knots = [];
  for (let i = 0, n = Math.ceil(L / STEP); i <= n; i++) knots.push(L * i / n);
  for (let t = PIER_SPACING; t < L - PIER_SPACING / 2; t += PIER_SPACING) {
    /* Nothing between the towers: that is the navigation channel the lift
       span exists to open, and the 16 m either side is the caissons. The two
       conditions this replaces were ANDed, which is only true in a 4 m window
       -- it left a pier standing at t=184, mid-channel, under the lift span. */
    if (t > tA - 16 && t < tB + 16) continue;
    const top = yAt(t) - DECK_T - 0.9;
    if (top - PIER_FOOT < 2) continue;
    for (const sz of [-1, 1]) P.push('concrete', at(boxM(2.2, top - PIER_FOOT, 2.4, CONCRETE), t, (top + PIER_FOOT) / 2, sz * halfW * 0.45));
    P.push('concrete', at(boxM(2.6, 0.9, 2 * halfW * 0.75, CONCRETE), t, top + 0.45, 0));
  }
  /* The deck edge, both sides, on the deck's own height (yAt): a 1.0 m
     concrete parapet, a two-rail steel railing on its cap, posts every 6 m --
     and GAPS where DOCK ROAD crosses the edge at its junctions. The approach
     soffit closes the deck from below between the towers' caissons and the
     ends. Collision for the parapet comes back in `edgeSolids`, 8 m pieces
     with their own baseY (district.js resolveBoxes contract). */
  const RZ = halfW - 0.19, edgeSolids = [];
  for (let i = 0; i < knots.length - 1; i++) {
    const t0 = knots[i], t1 = knots[i + 1];
    if (!(t1 < tA - 8 || t0 > tB + 8)) continue;   // the lift span has its own floor plate
    P.push('concrete', at(boxM(t1 - t0, 0.12, 2 * halfW - 0.6, CONCRETE), (t0 + t1) / 2, (yAt(t0) + yAt(t1)) / 2 - DECK_T, 0));
  }
  for (const sz of [-1, 1]) {
    // intervals of the edge with no gap, cut at the profile knots
    const cuts = [...new Set([...knots, ...gaps.flat()])].filter((t) => t >= 0 && t <= L).sort((p, q) => p - q);
    for (let i = 0; i < cuts.length - 1; i++) {
      const t0 = cuts[i], t1 = cuts[i + 1];
      if (t1 - t0 < 0.3 || open((t0 + t1) / 2)) continue;
      const y0 = yAt(t0), y1 = yAt(t1);
      strut(P, 'concrete', t0, y0 + 0.5, t1, y1 + 0.5, sz * (halfW - 0.19), 0.38, CONCRETE);   // 0.38 square: the upstand...
      strut(P, 'concrete', t0, y0 + 0.19, t1, y1 + 0.19, sz * (halfW - 0.19), 0.38, CONCRETE); // ...two courses, 1.0 m cap would read as a wall
      for (const ry of [1.95, 1.35]) strut(P, 'metal', t0, y0 + ry, t1, y1 + ry, sz * RZ, 0.08, STEEL);
      for (let a0 = t0; a0 < t1 - 0.3; a0 += 8) {
        const a1 = Math.min(t1, a0 + 8);
        edgeSolids.push({ x: (a0 + a1) / 2, z: sz * RZ, hw: (a1 - a0) / 2, hd: 0.34, baseY: Math.min(yAt(a0), yAt(a1), yAt((a0 + a1) / 2)), height: 1.0 });
      }
    }
    for (let t = 3; t < L; t += 6) if (!open(t)) post(P, 'metal', t, yAt(t) + 0.7, yAt(t) + 2.0, sz * RZ, 0.09, STEEL);
  }
  /* Lamp standards, alternating sides, off the channel. The column stands on
     the parapet cap with the railing (there is no footway on this deck -- the
     plan gives it 26 m of carriageway and nothing else) and reaches 3 m in
     over the kerb, which is where a real bridge column goes. */
  let side = 1;
  for (let t = 24; t < L - 12; t += 44, side = -side) {
    if (t > tA - 10 && t < tB + 10) continue;
    if (open(t)) continue;
    const y = yAt(t);
    const lz = side * RZ, hz = lz - side * 3.0;
    post(P, 'metal', t, y + 1.0, y + 9.0, lz, 0.26, STEEL);
    cross(P, 'metal', t, y + 9.0, hz, lz, 0.2, STEEL);
    P.push('emit', at(boxM(0.7, 0.24, 0.4, 0x2a2622, WARM, 1.6), t, y + 8.85, hz));
    lamps.push({ x: t, y: y + 8.85, z: hz, colour: 0xffd9a0, range: 34 });
  }

  /* ---------- local -> world ---------- */
  const c = Math.cos(yaw), s = Math.sin(yaw);
  /* three's rotation.y = -yaw maps local +X onto the plan direction; this is
     that matrix, applied once to every part instead of parenting a Group, so
     the caller merges four meshes and is done. */
  const M = new THREE.Matrix4().makeTranslation(ax, 0, az).multiply(new THREE.Matrix4().makeRotationY(-yaw));
  const W = (x, y, z) => [ax + x * c - z * s, y, az + x * s + z * c];
  for (const { geo } of P.list) geo.applyMatrix4(M);
  for (const l of lamps) { const [wx, , wz] = W(l.x, 0, l.z); l.x = wx; l.z = wz; }
  for (const o of solids) { const [wx, , wz] = W(o.x, 0, o.z); o.x = wx; o.z = wz; o.angle = yaw; delete o.local; }
  for (const o of edgeSolids) { const [wx, , wz] = W(o.x, 0, o.z); o.x = wx; o.z = wz; o.angle = yaw; }
  for (const g of [rig.sheaves, rig.counterweights, rig.legs, rig.lugs]) for (const o of g) { const [wx, , wz] = W(o.x, 0, o.z); o.x = wx; o.z = wz; }
  for (const cb of rig.cables) { cb.from = W(...cb.from); cb.to = W(...cb.to); }

  /* Keep-out for the scatterers, in landmarks.js:keepOut's own record shape
     (cy/sy are cos/sin of the THREE rotation, which is -yaw). One rect per
     tower, NOT the whole bridge: the deck is already protected by
     tarmacDepth, and reserving 381 x 38 m of harbour would delete the
     quayside dressing at both abutments. */
  const kcy = Math.cos(-yaw), ksy = Math.sin(-yaw);
  const keepOut = [tA, tB].map((TX) => {
    const [wx, , wz] = W(TX, 0, 0);
    return { x: wx, z: wz, cy: kcy, sy: ksy, hw: LEG_DX + 2.0, hd: TZ + LEG_DZ + 2.0 };
  });

  let tris = 0;
  for (const { geo } of P.list) tris += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
  return { parts: P.list, lamps, solids, edgeSolids, keepOut, rig, tris, length: L, angle: yaw, lift, height: TOWER_TOP + MACH_H + 0.5 };
}

/* The plan's numbers, worked out once, so a caller places the bridge without
   reopening halstead-bay.district.json: `bridges[0]`, the only signature one. */
const A = [1939, 2317], B = [1962, 2698];
export const LIFT_BRIDGE = {
  name: 'HALSTEAD LIFT BRIDGE',
  a: A, b: B, width: 26,
  x: (A[0] + B[0]) / 2, z: (A[1] + B[1]) / 2,
  angle: Math.atan2(B[1] - A[1], B[0] - A[0]),
  length: Math.hypot(B[0] - A[0], B[1] - A[1]),
  deckY: DECK_Y,
  height: TOWER_TOP + MACH_H + 0.5,
  district: 'HARBOUR POINT',
};
