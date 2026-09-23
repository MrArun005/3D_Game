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
 */

export const DIFFICULTY_KEY = 'hb.difficulty';

export const DIFFICULTY = {
  easy: { name: 'easy', crimeScale: 0.4, maxWanted: 2, decayScale: 2.5, hurtScale: 0.35, crashScale: 0.5, vigilante: false },
  hard: { name: 'hard', crimeScale: 1, maxWanted: 5, decayScale: 1, hurtScale: 1, crashScale: 1, vigilante: true },
};

/** `?hard` / `?easy` in the address  >  the stored choice  >  easy. */
export function pickDifficulty(search = '', stored = null) {
  const q = new URLSearchParams(search);
  if (q.has('hard')) return DIFFICULTY.hard;
  if (q.has('easy')) return DIFFICULTY.easy;
  return DIFFICULTY[stored] ?? DIFFICULTY.easy;
}

/**
 * The wanted level after a crime worth `gain` stars: scaled, and capped at the
 * difficulty's ceiling -- but never LOWER than it already was, so a mission or
 * mode that set three stars keeps them.
 */
export function addHeat(wanted, gain, diff = DIFFICULTY.hard) {
  return Math.max(wanted, Math.min(diff.maxWanted, wanted + gain * diff.crimeScale));
}
