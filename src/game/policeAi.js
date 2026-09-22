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
export function burstFor(kind, suppressing = false) {
  const w = ARSENAL[kind] ?? ARSENAL.pistol;
  // A SUPPRESSING officer is covering a team mate's rush: longer bursts, half
  // the pause. He is not trying to kill you this second, he is trying to stop
  // you leaning out while the other man moves.
  const k = suppressing ? 0.45 : 1;
  if (kind === 'shotgun') return { shots: 1, gap: w.cooldown, pause: 1.6 * k };
  if (kind === 'pistol') return { shots: suppressing ? 3 : 2, gap: 0.28, pause: 1.1 * k };
  return { shots: suppressing ? 5 : 3, gap: w.cooldown * 1.6, pause: 0.9 * k };   // smg / rifle: three-round bursts
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
    if (offRay(v.x - ox, (v.y ?? 0.8) - oy, v.z - oz, nx, ny, nz, len) < (v.r ?? 1.2)) return false;
  }
  return true;
}

/**
 * Perpendicular distance from a sphere centre (given RELATIVE to the ray
 * origin) to the ray, or Infinity if the sphere sits behind the shooter or
 * past the target. Shared by the vehicle test above and the bystander test
 * below so there is one piece of ray/sphere maths in this file.
 */
function offRay(px, py, pz, nx, ny, nz, len, pad = 0.5) {
  const along = px * nx + py * ny + pz * nz;
  if (along <= pad || along >= len - pad) return Infinity;
  return Math.hypot(px - nx * along, py - ny * along, pz - nz * along);
}

/**
 * Is anyone standing in the shot? `actors` are pedestrians AND the other
 * officers -- the police do not shoot through a civilian or through the man
 * who is rushing. Live, upright actors only; a body on the pavement is not a
 * reason to hold fire. Returns the blocking actor, or null.
 */
export function bystanderInLine(ox, oy, oz, tx, ty, tz, actors, r = 0.55) {
  const dx = tx - ox, dy = ty - oy, dz = tz - oz;
  const len = Math.hypot(dx, dy, dz) || 1;
  const nx = dx / len, ny = dy / len, nz = dz / len;
  for (const a of actors) {
    if (a.live === false || a.down) continue;
    if (offRay(a.x - ox, (a.y ?? 1.0) - oy, a.z - oz, nx, ny, nz, len, 1.2) < (a.r ?? r)) return a;
  }
  return null;
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
 *   cover   behind the door, not exposed
 *   peek    leaning out; this is the only state that fires
 *   rush    SPRINTING to a new piece of cover, 2-4 s, while a team mate shoots
 *   reload  magazine out, gun down, for the weapon's own reload time
 *   advance walking to the next cover, 8 m closer, when you have gone quiet
 *   arrest  close and stopped: cuffs out
 *   down    hit points gone
 *
 * `role` comes from assignRoles() and `dest` from rushPlan(); an officer only
 * rushes when the squad has given him the mover's slot AND there is real cover
 * to rush to. Everything below role/dest is the original machine, unchanged.
 */
export function nextState(s) {
  const { state, hp, gap, playerSpeed, quietFor, canSee, burstLeft, t, role, dest, reloadLeft = 0 } = s;
  if (hp <= 0) return 'down';
  if (gap < 6.5 && playerSpeed < 1.2 && canSee) return 'arrest';
  if (state === 'rush') return !s.arrived && t < (s.rushTime ?? RUSH_MAX_S) ? 'rush' : 'cover';   // a rush finishes; it is not interrupted by seeing you
  if (reloadLeft > 0) return 'reload';                      // gun empty: nothing else happens until it is fed
  if (state === 'reload') return 'cover';
  if (state === 'peek') return burstLeft > 0 && canSee ? 'peek' : 'cover';
  if (state === 'advance') return t >= 1 ? 'cover' : 'advance';
  if (state === 'cover') {
    if ((role === 'rush' || role === 'flank') && dest) return 'rush';
    if (quietFor > 4 && gap > 12) return 'advance';
    if (s.playerOnFoot && gap > 25 && canSee && t > 1.2) return 'advance';   // you are running: they come after you
    return canSee && t > 0.6 ? 'peek' : 'cover';
  }
  return 'cover';
}

/* ------------------------------------------------------------------ *
 *  Fire and movement: bounding overwatch
 *
 *  Four officers who all stand at their doors and shoot is a crowd. One
 *  running while the others keep your head down is a firefight. Everything
 *  here is pure -- traffic.js owns the meshes and integrates the positions;
 *  these functions only ever say WHERE and HOW FAST.
 * ------------------------------------------------------------------ */

export const WALK_SPEED = 1.6;      // closing on a stopped target, cuffs out
export const RUSH_SPEED = 4.4;      // a run between two pieces of cover
export const SPRINT_SPEED = 5.4;    // the flanker, who has the furthest to go
export const RUSH_MIN_S = 2, RUSH_MAX_S = 4;   // a rush is SHORT: you get 2-4 seconds of him in the open
export const RUSH_COOL_S = 3.5;     // and then he stays put for at least this long
export const RUSH_MIN_GAP = 10;     // nobody rushes from inside ten metres; he is already there
export const SETTLE_S = 0.7;        // the beat between getting a line on you and the first round: no snap shots
// SETTLE_S has to be LONGER than the 0.6 s dwell nextState makes an officer
// spend in cover before he peeks, or it never binds: at 0.45 the cover dwell
// was always the slower of the two and the 'sight picture' beat did nothing.
const FLANK_ARC = 1.15;             // ~66 degrees around you, which is a flank and not a charge

/**
 * Move one step toward a point at a given speed. Pure; traffic.js feeds the
 * officer's current XZ and writes back what comes out, so the officer walks
 * rather than teleports, and `moved / dt` is the speed the animation needs.
 */
export function stepToward(x, z, tx, tz, speed, dt) {
  const dx = tx - x, dz = tz - z, d = Math.hypot(dx, dz), step = speed * dt;
  if (d <= step || d < 1e-4) return { x: tx, z: tz, moved: d, arrived: true };
  return { x: x + (dx / d) * step, z: z + (dz / d) * step, moved: step, arrived: false };
}

/**
 * Who moves and who shoots. Given the whole squad, returns one role per
 * officer, in the same order:
 *   'rush' / 'flank'  the mover -- at most one (two at four stars), and never
 *                     every officer, so somebody is always shooting
 *   'suppress'        keeping your head down while he runs
 *   'arrest' / 'down' untouched: the existing behaviours own those
 *
 * Deterministic: whoever is already mid-rush keeps the slot (that IS the
 * stagger), and the next mover is whoever has the most ground to make up,
 * tie-broken by squad slot. Each entry is { hp, state, role, gap, rushCool,
 * reloadLeft, flanks }.
 */
export function assignRoles(squad, { wanted = 1, movers = null } = {}) {
  const roles = squad.map((o) => (o.hp <= 0 || o.state === 'down' ? 'down' : o.state === 'arrest' ? 'arrest' : 'suppress'));
  const free = roles.map((r, i) => (r === 'suppress' ? i : -1)).filter((i) => i >= 0);
  if (free.length < 2) return roles;                       // a lone officer does not bound: he holds his cover
  // never spend the last gun: at least one man stays on you while the others move
  const cap = Math.min(movers ?? (wanted >= 4 ? 2 : 1), free.length - 1);
  let left = cap;
  for (const i of free) if (squad[i].state === 'rush') { roles[i] = squad[i].role === 'flank' ? 'flank' : 'rush'; left--; }
  if (left <= 0) return roles;
  const ready = free.filter((i) => squad[i].state !== 'rush' && (squad[i].rushCool ?? 0) <= 0
    && (squad[i].reloadLeft ?? 0) <= 0 && (squad[i].gap ?? 0) > RUSH_MIN_GAP)
    .sort((a, b) => (squad[b].gap ?? 0) - (squad[a].gap ?? 0) || a - b);
  for (const i of ready) {
    if (left-- <= 0) break;
    // three stars and up, the first man out goes wide instead of straight at you
    roles[i] = wanted >= 3 && (squad[i].flanks ?? 0) === 0 && !roles.includes('flank') ? 'flank' : 'rush';
  }
  return roles;
}

/**
 * The wide way round: a point on the far side of an arc swung around the
 * player from where the officer stands now. `side` picks left or right; the
 * caller keeps it stable per officer so he does not oscillate.
 */
export function flankPoint(px, pz, ox, oz, side = 1, radius = 18) {
  const a = Math.atan2(oz - pz, ox - px) + side * FLANK_ARC;
  return { x: px + Math.cos(a) * radius, z: pz + Math.sin(a) * radius };
}

/**
 * The best piece of cover to run to. `covers` are candidate points traffic.js
 * collects from the world (cruisers, parked cars, the solids of street
 * furniture) -- this only ever CHOOSES one, and returns null when there is
 * nothing worth running to, which is how an officer never ends a rush in the
 * open. `toward` is the point he wants to end up near: the player for a
 * straight rush, a flankPoint for the wide one.
 */
export function pickCover(covers, ox, oz, px, pz, { toward = null, minGap = 8, maxRush = 16, mustGain = true } = {}) {
  const gap = Math.hypot(px - ox, pz - oz);
  const ax = toward ? toward.x : px, az = toward ? toward.z : pz;
  let best = null, bestScore = -Infinity;
  for (const c of covers) {
    const run = Math.hypot(c.x - ox, c.z - oz);
    if (run < 3 || run > maxRush) continue;                  // already here, or too far to cross in one rush
    const toP = Math.hypot(c.x - px, c.z - pz);
    if (toP < minGap) continue;                              // not into your lap
    if (mustGain && toP > gap - 2) continue;                 // a rush has to buy ground
    const score = -Math.hypot(c.x - ax, c.z - az) - run * 0.25 + (c.score ?? 0);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

/**
 * The whole rush, for one officer, in one call: where he is going, how fast,
 * and how long he is allowed to be out there. Returns null when there is no
 * cover to reach -- the officer then simply stays where he is. Pure.
 */
export function rushPlan(o, { px, pz, covers = [], radius = 18 } = {}) {
  const flank = o.role === 'flank';
  const speed = flank ? SPRINT_SPEED : RUSH_SPEED;
  // WHERE HE STANDS. traffic.js keeps a deployed officer's own position in
  // coverX/coverZ -- c.x/c.z is his CRUISER. Reading it here means the caller
  // passes the officer itself, with no per-frame copy of him to fix it up.
  const ox = o.coverX ?? o.x, oz = o.coverZ ?? o.z;
  const toward = flank ? flankPoint(px, pz, ox, oz, (o.slot ?? 0) % 2 ? 1 : -1, radius) : null;
  // he must be able to CROSS it inside the rush window, or the timer ends with
  // him standing in the middle of the road
  const cover = pickCover(covers, ox, oz, px, pz, { toward, mustGain: !flank, maxRush: speed * (RUSH_MAX_S - 0.4) });
  if (!cover) return null;
  const d = Math.hypot(cover.x - ox, cover.z - oz);
  return { x: cover.x, z: cover.z, speed, time: Math.max(RUSH_MIN_S, Math.min(RUSH_MAX_S, d / speed + 0.35)), flank };
}

/**
 * Where this officer wants to be THIS tick and how fast he should get there,
 * for every state. traffic.js integrates with stepToward() and hands the
 * resulting speed to the model so it can pick a walk or a run clip.
 */
export function moveTarget(o, { px, pz } = {}) {
  if (o.state === 'rush' && o.dest) return { x: o.dest.x, z: o.dest.z, speed: o.dest.speed ?? RUSH_SPEED };
  const ox = o.coverX ?? o.x, oz = o.coverZ ?? o.z;           // his position, not his cruiser's -- see rushPlan
  if (o.state === 'advance' || o.state === 'arrest') {
    const dx = px - ox, dz = pz - oz, gap = Math.hypot(dx, dz) || 1;
    const stop = o.state === 'arrest' ? 1.2 : 7;              // he stops at arm's length to cuff you, a cover's length to shoot
    const d = Math.max(0, gap - stop);
    return { x: ox + (dx / gap) * d, z: oz + (dz / gap) * d, speed: WALK_SPEED * (o.state === 'arrest' ? 1 : 1.6) };
  }
  return { x: ox, z: oz, speed: 0 };
}

/**
 * Weapon handling for one officer, one tick. Everything that decides whether a
 * round leaves the barrel lives here so there is one answer, not five:
 *
 *   reload   the magazine runs out and the gun is DOWN for its own reload
 *            time -- a real pause, a pose and a shout, not an instant refill
 *   settle   he has to hold a line on you for SETTLE_S before the first round
 *            of a burst: no snap shots the frame he rounds a corner
 *   ceasefire  no line of sight, or a civilian (or the man rushing) in it
 *   discipline burstFor()'s cadence, wider and faster when suppressing
 *
 * Returns the officer's new weapon state plus `fire`, which is the whole
 * answer to "does he shoot this frame". `hold` says why not, for the poses
 * and the radio.
 */
export function fireControl(o, ctx) {
  const kind = o.gunKind ?? 'pistol';
  const w = ARSENAL[kind] ?? ARSENAL.pistol;
  const dt = ctx.dt ?? 0;
  const out = {
    fire: false, hold: null, reloadStart: false,
    reloadLeft: Math.max(0, (o.reloadLeft ?? 0) - dt),
    settleLeft: Math.max(0, (o.settleLeft ?? 0) - dt),
    ammo: o.ammo ?? w.mag, burstLeft: o.burstLeft ?? 0, fireT: (o.fireT ?? 0) - dt,
  };
  if ((o.reloadLeft ?? 0) > 0) { out.hold = 'reload'; out.settleLeft = SETTLE_S; out.burstLeft = 0; return out; }
  if (out.ammo <= 0) {
    out.hold = 'reload'; out.reloadStart = true; out.reloadLeft = w.reload; out.settleLeft = SETTLE_S;
    out.ammo = w.mag; out.burstLeft = 0; return out;         // the fresh magazine is only usable once reloadLeft hits 0
  }
  if (!ctx.canSee) { out.hold = 'nolos'; out.settleLeft = SETTLE_S; return out; }        // lose the line, lose the sight picture
  if (ctx.blocked) { out.hold = 'blocked'; return out; }                                  // someone is in the way
  if (!shouldFire(ctx.stars ?? 1, ctx.quietFor ?? 99)) { out.hold = 'holdfire'; return out; }
  if (out.settleLeft > 0) { out.hold = 'settle'; return out; }
  if (o.state !== 'peek') { out.hold = 'nostate'; return out; }
  const b = burstFor(kind, !!ctx.suppressing);
  if (out.burstLeft <= 0 && out.fireT <= -0.06) out.burstLeft = b.shots;                  // fresh burst once the pause is served
  if (out.burstLeft <= 0 || out.fireT > -0.06) { out.hold = 'cadence'; return out; }
  out.fire = true; out.burstLeft--; out.ammo--;
  out.fireT = out.burstLeft > 0 ? b.gap : b.pause;
  return out;
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

/**
 * Two rifle posts behind a roadblock: on the far side of the cruisers from the
 * approaching car (further along the road direction u), one each side of the
 * centreline, facing back down the road. Pure; tested.
 */
export function roadblockPosts(qx, qz, ux, uz, half, back = 2.6) {
  const nx = -uz, nz = ux;
  const yaw = Math.atan2(uz, -ux);           // facing -u: toward the car
  return [-1, 1].map((side) => ({ x: qx + ux * back + nx * half * 0.30 * side, z: qz + uz * back + nz * half * 0.30 * side, yaw }));
}

/**
 * Losing the police. Stars only used to bleed off 240 m from the nearest
 * cruiser; on foot that never happened. GTA's rule is line of sight: nobody
 * has seen you for a while, they are searching where you WERE, and the level
 * drains. Returns the decay rate in stars per second, 0 while they have you.
 *   hot     an officer or cruiser has a line on you this frame
 *   eyesOn  the helicopter does (it does not lose you)
 *   coldFor seconds since anyone had a line
 *   nearest metres to the nearest live cruiser (Infinity: none out yet)
 *   cool    seconds the old "clear of everyone" rule has held
 */
export const HIDDEN_AFTER_S = 10;
export function evasionDecay({ hot, eyesOn, coldFor, nearest, wanted, cool = 0 }) {
  if (hot || eyesOn) return 0;
  if (cool > 9) return 0.55;                                     // nobody within 240 m: the old rule
  if (nearest === Infinity || nearest > 200) return 0;           // they have not arrived; nothing to hide from yet
  if (wanted >= 4) return coldFor > HIDDEN_AFTER_S * 2 ? 0.25 : 0;   // four stars: the air has to lose you too, and it takes twice as long
  return coldFor > HIDDEN_AFTER_S ? 0.35 : 0;
}

/** Search-ring radius in metres around your last seen spot: it grows as they lose confidence. */
export function searchRadius(coldFor) {
  return Math.min(90, 22 + Math.max(0, coldFor - 3) * 5);
}

/**
 * Did anyone see that? With no stars yet, a crime needs a witness: a cruiser
 * within 90 m, or pedestrians within 45 m -- two for an assault, since the
 * victim alone is on the ground. Hitting the police is always seen. Once you
 * are wanted everything counts. Pure; tested.
 */
export function crimeWitnessed(tag, px, pz, peds, police, wanted = 0, reach = 1) {
  if (wanted > 0 || tag === 'police') return true;
  // `reach` scales both radii: the Underworld Network perk halves it
  for (const c of police) if (c.live && Math.hypot(c.x - px, c.z - pz) < 90 * reach) return true;
  let n = 0;
  for (const p of peds) if (p.live && !p.down && Math.hypot(p.x - px, p.z - pz) < 45 * reach && ++n >= (tag === 'person' ? 2 : 1)) return true;
  return false;
}

/**
 * Does an officer open fire? At one star GTA's police come to ARREST you;
 * they shoot back only if you have been shooting (quietFor is seconds since
 * your last shot). From two stars they fire on sight. Pure; tested.
 */
export function shouldFire(stars, quietFor) {
  return stars >= 2 || quietFor < 8;
}
