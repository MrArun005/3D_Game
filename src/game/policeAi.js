import { ARSENAL } from './weapons.js';
import { firstBuildingHit } from './shooting.js';

/**
 * The pure half of the police firefight. traffic.js owns the officers and the
 * frame loop; this file answers the questions it asks each frame, with no
 * scene, no DOM and no allocation, so every rule here is unit-tested.
 *
 *   - which weapon an officer draws at a given wanted level
 *   - how badly he shoots at that level (skill -> aim jitter)
 *   - whether he can see you (buildings and vehicles block the line)
 *   - whether a given aimed shot lands on a target of a given radius
 *   - what state he should be in next
 *
 * Officers use the SAME arsenal the player does, so a rifle is a rifle in
 * anyone's hands.
 */

/** Sidearms at one star, long guns as the response escalates. Seeded by slot so a unit keeps its weapon. */
export function weaponForWanted(stars, slot = 0) {
  if (stars >= 4) return slot % 2 ? 'rifle' : 'shotgun';
  if (stars >= 3) return slot % 3 === 0 ? 'shotgun' : 'smg';
  if (stars >= 2) return slot % 2 ? 'smg' : 'pistol';
  return 'pistol';
}

/**
 * Aim jitter in radians added on top of the weapon's own spread. One-star
 * officers miss a lot; four-star ones do not. Crouching and being far away
 * both make you harder to hit; moving makes it harder still.
 */
export function aimJitter(stars, distance, targetSpeed = 0) {
  const skill = 0.075 - Math.min(4, Math.max(1, stars)) * 0.014;   // 0.061 at 1★ .. 0.019 at 4★
  const range = 1 + Math.min(1.2, distance / 40);                  // longer shots wander more
  const motion = 1 + Math.min(1.0, targetSpeed / 6) * 0.9;          // a running target is hard
  return skill * range * motion;
}

/** Fire cadence per weapon in a burst, and the pause between bursts, seconds. */
export function burstFor(kind) {
  const w = ARSENAL[kind] ?? ARSENAL.pistol;
  if (kind === 'shotgun') return { shots: 1, gap: w.cooldown, pause: 1.6 };
  if (kind === 'pistol') return { shots: 2, gap: 0.28, pause: 1.1 };
  return { shots: 3, gap: w.cooldown * 1.6, pause: 0.9 };   // smg / rifle: three-round bursts
}

/**
 * Line of sight from an officer's gun to a point: false if a building face or
 * a vehicle sphere sits between. `vehicles` are { x, z, r, y? }; the shooter's
 * own cruiser is passed as `ignore` so it never blocks its own officer.
 */
export function hasLineOfSight(ox, oy, oz, tx, ty, tz, buildings, vehicles = [], ignore = null) {
  const dx = tx - ox, dy = ty - oy, dz = tz - oz;
  const len = Math.hypot(dx, dy, dz) || 1;
  const nx = dx / len, ny = dy / len, nz = dz / len;
  if (firstBuildingHit(ox, oy, oz, nx, ny, nz, buildings, len) < len) return false;
  for (const v of vehicles) {
    if (v === ignore) continue;
    const px = v.x - ox, py = (v.y ?? 0.8) - oy, pz = v.z - oz;
    const along = px * nx + py * ny + pz * nz;
    if (along <= 0.5 || along >= len - 0.5) continue;
    const cx = px - nx * along, cy = py - ny * along, cz = pz - nz * along;
    if (Math.hypot(cx, cy, cz) < (v.r ?? 1.2)) return false;
  }
  return true;
}

/**
 * One aimed shot. Perfect aim is the direction to the target; jitter is a
 * random angle in a cone of `jitterRad`. Returns true if the perturbed ray
 * passes within `targetR` of the target centre. `rnd` is injected so it is
 * seedable and testable.
 */
export function shotLands(ox, oy, oz, tx, ty, tz, targetR, jitterRad, rnd = Math.random) {
  const dx = tx - ox, dy = ty - oy, dz = tz - oz;
  const len = Math.hypot(dx, dy, dz) || 1;
  // a random offset in the plane normal to the shot, magnitude ~ jitter * distance
  const a = rnd() * Math.PI * 2, m = Math.sqrt(rnd()) * Math.tan(jitterRad) * len;
  // any two perpendicular unit vectors to the ray will do for the offset
  let ux = -dz, uy = 0, uz = dx; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
  const vx = (dy * uz - dz * uy) / len, vy = (dz * ux - dx * uz) / len, vz = (dx * uy - dy * ux) / len;
  const offX = (ux * Math.cos(a) + vx * Math.sin(a)) * m;
  const offY = (uy * Math.cos(a) + vy * Math.sin(a)) * m;
  const offZ = (uz * Math.cos(a) + vz * Math.sin(a)) * m;
  return Math.hypot(offX, offY, offZ) <= targetR;
}

/** Target centre height and radius: crouching makes you lower and smaller. */
export function targetProfile(onFoot, crouch) {
  if (!onFoot) return { y: 0.9, r: 0.9 };          // in a car: the cabin
  return crouch ? { y: 0.75, r: 0.32 } : { y: 1.1, r: 0.42 };
}

/**
 * Next state for a deployed officer.
 *   cover  behind the door, not exposed
 *   peek   leaning out; this is the only state that fires
 *   advance moving to the next cover, 8 m closer, when you have gone quiet
 *   arrest close and stopped: cuffs out
 *   down   hit points gone
 */
export function nextState(s) {
  const { state, hp, gap, playerSpeed, quietFor, canSee, burstLeft, t } = s;
  if (hp <= 0) return 'down';
  if (gap < 6.5 && playerSpeed < 1.2 && canSee) return 'arrest';
  if (state === 'peek') return burstLeft > 0 && canSee ? 'peek' : 'cover';
  if (state === 'advance') return t >= 1 ? 'cover' : 'advance';
  if (state === 'cover') {
    if (quietFor > 4 && gap > 12) return 'advance';
    return canSee && t > 0.6 ? 'peek' : 'cover';
  }
  return 'cover';
}

/** The maximum number of officers out of their cars at once. Everything past this stays in the cruiser. */
export const MAX_DEPLOYED = 6;

/**
 * Rooftops for marksmen at four stars: the tallest roofs between `near` and
 * `far` metres of the player, at least `minH` high so the angle is real, the
 * two best spread apart so they cross fire. Pure; tested.
 */
export function pickRooftops(roofs, px, pz, { near = 45, far = 130, minH = 18, count = 2 } = {}) {
  const ok = roofs.filter((r) => { const d = Math.hypot(r.x - px, r.z - pz); return d >= near && d <= far && r.h >= minH; })
    .sort((a, b) => b.h - a.h);
  const out = [];
  for (const r of ok) {
    if (out.length >= count) break;
    if (out.every((o) => Math.hypot(o.x - r.x, o.z - r.z) > 40)) out.push(r);
  }
  return out;
}

/**
 * Which side of the cruiser to take cover on: the side AWAY from the player,
 * so the car body is between them. Returns the door position. Pure; tested.
 */
export function coverSide(cx, cz, yaw, px, pz, off = 1.9) {
  const ax = cx + Math.cos(yaw + Math.PI / 2) * off, az = cz - Math.sin(yaw + Math.PI / 2) * off;
  const bx = cx - Math.cos(yaw + Math.PI / 2) * off, bz = cz + Math.sin(yaw + Math.PI / 2) * off;
  return Math.hypot(ax - px, az - pz) >= Math.hypot(bx - px, bz - pz) ? { x: ax, z: az } : { x: bx, z: bz };
}

/** Body armour soaks 60% of a hit until it is gone. Returns { health, armour } deltas applied. */
export function absorb(armour, hit) {
  if (armour <= 0) return { toHealth: hit, toArmour: 0 };
  const soak = Math.min(armour, hit * 0.6);
  return { toHealth: hit - soak, toArmour: soak };
}
