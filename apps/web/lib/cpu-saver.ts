// The CPU saver (docs/COMPUTE.md, Nov 6): Vercel Hobby's 30-day window had 26 of its 240
// minutes left on Nov 6, and little rolls off before Nov 18, so the background work runs at a
// slower cadence until the heavy late-October days have left the window (Nov 29). Nothing is
// switched off: other teams' moves, injury news and the game-window checks just arrive later.
// It ends on its own.
//
// Minimal mode (Nov 9, Jack's choice over paying for Pro): with 9 minutes left and almost
// nothing rolling off before Nov 18, until Nov 21 the background work runs every 30 minutes,
// and simulations run only after Jack's own moves, when he asks, and nightly. Pages still read
// ESPN live. docs/COMPUTE.md §9 lists what waits and for how long.
//
// Both ended Nov 10: the window went over 4 h that morning and Jack moved to Vercel Pro, which
// has no CPU cap (usage comes out of its monthly credit). The switches stay for a future squeeze.

export const MINIMAL_UNTIL = Date.parse("2026-11-10T00:00:00Z");
export const SAVER_UNTIL = Date.parse("2026-11-10T00:00:00Z");

export const minimalOn = (now = Date.now()) => now < MINIMAL_UNTIL;
export const saverOn = (now = Date.now()) => now < SAVER_UNTIL;
