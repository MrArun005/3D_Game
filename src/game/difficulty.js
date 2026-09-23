/**
 * How hard the city pushes back (2026-09-23).
 *
 * The owner asked for "easy game play, no complications": free roam is EASY
 * by default. Stars come slowly (40% of the heat per crime) and crimes alone
 * never push past two -- so no helicopter, roadblocks, SWAT or tanks while you
 * are just driving around; they drain two and a half times faster once you are
 * out of sight; officers' rounds hurt a third as much and crashes half as much;
 * and nothing pops up offering you a job. Everything you CHOOSE still brings
 * its own heat: story missions, a getaway job, the hold-out (addHeat never
 * lowers a level something else set).
 *
 * `?hard` (or localStorage `hb.difficulty = 'hard'`) is the full game, and is
 * what every system falls back to when nobody set one -- so the tests, which
 * build their own Traffic, exercise the full mechanics.
 *
 * JUST DRIVE (2026-09-23, same day: "can drive like GTA for now bro"). Easy
 * also switches off the police THEATRE that ran round you whatever you did,
 * measured from the code's own constants (a node Monte Carlo of
 * traffic.js's patrol cadence): per hour of plain driving, 52.8 patrol
 * "calls" with lights and siren, 21.1 NPC pursuits each with a spoken
 * DISPATCH line, ~30 distant sirens, ~50 bursts of distant gunfire at night,
 * pedestrians shouting at near misses -- and one pedestrian within 45 m made
 * every bump into a civilian car a reportable crime, so four fender-benders
 * downtown were a star, and at two stars officers fired on sight.
 *   patrolCalls        the zero-star patrol takes calls and runs NPC pursuits
 *   farSirens          a siren somewhere across the city every 60-180 s
 *   farGunfire         distant gunfire every 35-110 s from 21:00 to 05:00
 *   pedVoices          pedestrians' spoken shouts (near misses, horn answers)
 *   pedsReportCrashes  a pedestrian witness is enough for a crash into traffic
 *                      (without it only a cruiser within 90 m sees it -- GTA's
 *                      rule; running people over and hitting cruisers still count)
 *   fireFrom           the star level at which officers fire on sight (below it
 *                      they come to arrest and only shoot back)
 *   quietHud           frame-rate governor notices go to the console, not a toast
 * The patrol cruiser itself still drives about: a policed-looking city, and the
 * witness crimeWitnessed needs. `?city` (or any title card but Just drive,
 * which upgrades through withCity) brings the city life back on easy.
 */

export const DIFFICULTY_KEY = 'hb.difficulty';

export const DIFFICULTY = {
  easy: {
    name: 'easy', crimeScale: 0.4, maxWanted: 2, decayScale: 2.5, hurtScale: 0.35, crashScale: 0.5, vigilante: false,
    patrolCalls: false, farSirens: false, farGunfire: false, pedVoices: false, pedsReportCrashes: false, fireFrom: 3, quietHud: true,
  },
  hard: {
    name: 'hard', crimeScale: 1, maxWanted: 5, decayScale: 1, hurtScale: 1, crashScale: 1, vigilante: true,
    patrolCalls: true, farSirens: true, farGunfire: true, pedVoices: true, pedsReportCrashes: true, fireFrom: 2, quietHud: false,
  },
};

/** The ambient knobs `?city` and the mode cards turn back on. Nothing else moves. */
export const CITY_LIFE = ['patrolCalls', 'farSirens', 'farGunfire', 'pedVoices'];

/**
 * `d` with the city's background life back on: patrol calls, far sirens, far
 * gunfire, street voices. Stars, damage, crash witnesses and the fire-on-sight
 * level stay as `d` has them. Idempotent: a difficulty that already has all of
 * it (hard, or one already upgraded) comes back as it is.
 */
export function withCity(d) {
  if (CITY_LIFE.every((k) => d[k])) return d;
  const out = { ...d, name: `${d.name}+city` };
  for (const k of CITY_LIFE) out[k] = true;
  return out;
}

/** `?hard` / `?easy` in the address  >  the stored choice  >  easy; `?city` adds the city life to whichever. */
export function pickDifficulty(search = '', stored = null) {
  const q = new URLSearchParams(search);
  const base = q.has('hard') ? DIFFICULTY.hard
    : q.has('easy') ? DIFFICULTY.easy
      : DIFFICULTY[stored] ?? DIFFICULTY.easy;
  return q.has('city') ? withCity(base) : base;
}

/**
 * The wanted level after a crime worth `gain` stars: scaled, and capped at the
 * difficulty's ceiling -- but never LOWER than it already was, so a mission or
 * mode that set three stars keeps them.
 */
export function addHeat(wanted, gain, diff = DIFFICULTY.hard) {
  return Math.max(wanted, Math.min(diff.maxWanted, wanted + gain * diff.crimeScale));
}
