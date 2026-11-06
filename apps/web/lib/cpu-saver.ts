// The CPU saver (docs/COMPUTE.md, Nov 6): Vercel Hobby's 30-day window had 26 of its 240
// minutes left on Nov 6, and little rolls off before Nov 18, so the background work runs at a
// slower cadence until the heavy late-October days have left the window. Nothing is switched
// off: other teams' moves, injury news and the game-window checks just arrive later. It ends on
// its own.

export const SAVER_UNTIL = Date.parse("2026-11-22T00:00:00Z");

export const saverOn = (now = Date.now()) => now < SAVER_UNTIL;
