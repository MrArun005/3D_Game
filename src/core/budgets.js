/**
 * Budget constants shared between the streamer and the overlay that judges it.
 *
 * Three copies of the chunk-build budget disagreed for a week (code 2.0,
 * stats.js 3, BUDGETS.md 4). One number, imported by both, documented in
 * docs/BUDGETS.md.
 */

/* Per-frame chunk-build budget in ms. districtWorld pumps a chunk's generator
   while the frame has spent less than this; the generator's own tick() yields
   at 1.8 ms. Worst case is therefore one full slice plus the un-yielded step
   that overran it (~3.8 ms plus one step), which is why the overlay judges the
   per-frame slice against this number and reports the worst single step
   separately. */
export const BUILD_MS = 2.0;
