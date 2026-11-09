// Chart x axes that keep days evenly spaced (Jack, Nov 9). Pure.
//
// The week's win chance: each day gets an equal slot, and inside it time is spread by activity:
// the night and morning (one pregame point) get the first 10% of the slot, the games (first tip
// to ~2.5 hours after the last tip) 85%, the rest of the evening 5%. A plain clock axis spent
// most of each day on flat overnight lines and squeezed the games into a sliver.

const DAY = 86_400_000;
/** Games are about over this long after the last tip. */
const GAME_LENGTH_MS = 2.5 * 3600_000;
const BEFORE = 0.1;
const DURING = 0.85;

export interface DayWindow {
  /** The day's first instant (local midnight, ms). */
  start: number;
  /** First tip and when the last game is about over (ms), or null without games. */
  first: number | null;
  end: number | null;
}

/**
 * Each day's game window from its tips (ms). `lastPoint`: the latest logged point of a day, so a
 * long game's last points stay inside the games' part of the slot.
 */
export function dayWindows(
  start: number,
  days: number,
  tipsByDay: number[][],
  lastPointByDay: (number | null)[] = [],
): DayWindow[] {
  return Array.from({ length: days }, (_, i) => {
    const dayStart = start + i * DAY;
    const tips = tipsByDay[i] ?? [];
    if (!tips.length) return { start: dayStart, first: null, end: null };
    const first = Math.min(...tips);
    const end = Math.min(
      Math.max(Math.max(...tips) + GAME_LENGTH_MS, lastPointByDay[i] ?? 0),
      dayStart + DAY - 60_000,
    );
    return { start: dayStart, first, end };
  });
}

/** Position on the week's axis (0 to the number of days) of the instant `t`. */
export function gameTimeX(t: number, windows: DayWindow[]): number {
  if (!windows.length) return 0;
  const i = Math.floor((t - windows[0]!.start) / DAY);
  if (i < 0) return 0;
  if (i >= windows.length) return windows.length;
  const { start, first, end } = windows[i]!;
  const share = (from: number, to: number) =>
    to > from ? Math.min(1, Math.max(0, (t - from) / (to - from))) : 0;
  if (first == null || end == null) return i + (t - start) / DAY;
  if (t < first) return i + BEFORE * share(start, first);
  if (t <= end) return i + BEFORE + DURING * share(first, end);
  return i + BEFORE + DURING + (1 - BEFORE - DURING) * share(end, start + DAY);
}

/** Local midnights (ms) from the day of `from` through the day of `to`; `offsetMs` = UTC − local. */
export function dayStarts(from: number, to: number, offsetMs: number): number[] {
  const first = Math.floor((from - offsetMs) / DAY) * DAY + offsetMs;
  const out: number[] = [];
  for (let d = first; d <= to; d += DAY) out.push(d);
  return out;
}
