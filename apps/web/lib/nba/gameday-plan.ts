// Which parts of the 5-minute gameday job are due this run, decided from the NBA schedule
// before the league is loaded (docs/COMPUTE.md: loading it is most of a run's Vercel CPU, and
// on most runs nothing needs it). Pure.

/** Window around today's games when the 5-minute checks do real work. */
export const BEFORE_FIRST_TIP_MS = 90 * 60_000;
export const AFTER_LAST_TIP_MS = 15 * 60_000;
/** Games are surely over this long after the last tip. */
export const TIMELINE_AFTER_MS = 3.5 * 3600_000;

export interface GamedayPlan {
  /** Some step needs the league this run. */
  load: boolean;
  /** Log the official report and ESPN's injury feed (the availability forward test). */
  availability: boolean;
  /** Record the pregame win-chance point if it's missing (needs no league). */
  snapshot: boolean;
}

export function gamedayPlan(a: {
  t: number;
  /** UTC minute of the hour (runs come every 5 minutes). */
  minute: number;
  /** Hour of the day in US/Eastern. */
  etHour: number;
  /** Today's tip times (ms). */
  tips: number[];
  /** The roster watch saw a recent move. */
  moveSeen: boolean;
}): GamedayPlan {
  const games = a.tips.length > 0;
  const first = games ? Math.min(...a.tips) : 0;
  const last = games ? Math.max(...a.tips) : 0;
  const window = games && a.t >= first - BEFORE_FIRST_TIP_MS && a.t <= last + AFTER_LAST_TIP_MS;
  const timeline = games && a.t >= first && a.t <= last + TIMELINE_AFTER_MS && a.minute % 15 < 5;
  // From 9 AM ET: every 5 minutes in the game window, every 10 before it (MODEL_CARD,
  // 2026-11-05 note: official reports come every 15 minutes, so none is missed).
  const availability =
    games && a.etHour >= 9 && a.t <= last + AFTER_LAST_TIP_MS && (window || a.minute % 10 < 5);
  // DARKO publishes once a day at no fixed time: looked for hourly from 6 AM ET.
  const darko = a.minute < 5 && a.etHour >= 6;
  return {
    load: a.moveSeen || window || timeline || availability || darko,
    availability,
    snapshot: games && a.t < first && a.etHour >= 8,
  };
}
