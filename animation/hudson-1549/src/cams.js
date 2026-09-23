// Camera moves, one per shot name. Each takes (ft, u, S) and returns
// { pos, look, fov, up? }. Shared by both films.
import * as THREE from 'three';
import { planeState, lerp, smooth, STRIKE_FT, DITCH_FT, RWY_DIR, LAND_Y } from './timeline.js';
import { PLACES, ll } from './geo.js';

export const V = (x, y, z) => new THREE.Vector3(x, y, z);
const FLOAT = planeState(DITCH_FT + 40).pos;
const AWAY = Math.atan2(FLOAT.z - PLACES.midtown.z, FLOAT.x - PLACES.midtown.x); // bearing from Midtown out past the aircraft
export const W3 = (p, y) => V(p.x, y, p.z);
export const world = (S, x, y, z) => S.pos.clone().addScaledVector(S.f, x).addScaledVector(S.u, y).addScaledVector(S.r, z);
export const flat = (S, x, y, z) => S.pos.clone().addScaledVector(S.fh, x).add(V(0, y, 0)).addScaledVector(S.rh, z);

// Each shot returns { pos, look, fov, up? }.
export const CAMS = {
  title(ft, u) {
    const a = ll(40.7330, -74.0260), b = ll(40.7420, -74.0230);
    return { pos: V(lerp(a.x, b.x, u), 430 - 40 * u, lerp(a.z, b.z, u)), look: W3(ll(40.7900, -73.9700), 80), fov: 42 };
  },
  takeoff(ft, u, S) {
    const side = V(-RWY_DIR.z, 0, RWY_DIR.x);
    const base = W3(PLACES.lgaRwy4, LAND_Y + 2.2).addScaledVector(RWY_DIR, 1010).addScaledVector(side, 62);
    return { pos: base, look: S.pos.clone().addScaledVector(S.f, 6), fov: lerp(34, 24, smooth(0.45, 1, u)) };
  },
  climb(ft, u, S) {
    return { pos: flat(S, -62 + 10 * u, 7, 30 - 8 * u), look: world(S, 6, 0, 0), fov: 38 };
  },
  geese(ft, u, S) {
    const K = planeState(STRIKE_FT);
    return { pos: flat(K, 150, 3, 20), look: S.pos.clone().lerp(flat(K, 40, 0, 0), 0.25), fov: 34 };
  },
  strike(ft, u, S) {
    return { pos: world(S, 26 - 4 * u, 1.2, -12.5), look: world(S, 1, -1.6, -5), fov: 46, up: S.u };
  },
  mayday(ft, u, S) {
    return { pos: flat(S, -30 + 55 * u, -8, -95), look: world(S, 3, 0, 0), fov: 36 };
  },
  turn(ft, u) {
    const c = ll(40.6950, -73.9300);
    return { pos: V(c.x - 700 * u, 8600 - 500 * u, c.z), look: W3(ll(40.8120, -73.9580), 0), fov: 46 };
  },
  gwb(ft, u, S) {
    // Riding above and behind the left wing, the bridge slides by underneath.
    return { pos: flat(S, -92 + 16 * u, 46, -6), look: world(S, 70, -75, 0), fov: 50 };
  },
  river(ft, u, S) {
    return { pos: flat(S, 60 - 80 * u, 3, 150), look: world(S, 4, 0, 0), fov: 38 };
  },
  ditch(ft, u, S) {
    const K = planeState(DITCH_FT);
    const base = flat(K, 175, 0, 72);
    base.y = 3.2;
    const shake = Math.exp(-Math.max(0, ft - DITCH_FT) * 1.2) * (ft > DITCH_FT ? 0.25 : 0);
    base.x += Math.sin(ft * 57) * shake; base.y += Math.sin(ft * 43) * shake;
    return { pos: base, look: S.pos.clone().add(V(0, 1, 0)), fov: lerp(24, 38, smooth(0.35, 0.85, u)) };
  },
  // Both after-shots stand on the Jersey side, so Midtown is the backdrop.
  evac(ft, u, S) {
    const a = AWAY + lerp(-0.55, 0.25, u);
    const r = 62;
    return { pos: V(S.pos.x + Math.cos(a) * r, 10 - 3 * u, S.pos.z + Math.sin(a) * r), look: S.pos.clone().add(V(0, 0.5, 0)), fov: 42 };
  },
  end(ft, u, S) {
    const e = smooth(0, 1, u);
    const a = AWAY + 0.25 + 0.2 * e;
    const r = lerp(62, 820, e);
    return { pos: V(S.pos.x + Math.cos(a) * r, lerp(7, 300, e), S.pos.z + Math.sin(a) * r), look: S.pos.clone().lerp(W3(PLACES.midtown, 80), 0.35 * e), fov: 42 };
  },
};
