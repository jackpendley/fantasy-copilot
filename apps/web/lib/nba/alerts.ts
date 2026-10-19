// Game-day alert rules, evaluated every few minutes before and during the day's games.
// Pure: the cron job passes a fresh day board; each alert carries a dedupe key so it is
// sent once per situation (the sender records keys in `alerts_sent`).

import { isStartingSlot } from "@fantasy-copilot/fantasy-core";
import type { DayBoard } from "./day";

export interface Alert {
  key: string;
  title: string;
  body: string;
  url: string;
}

/** Lineup alerts fire this close to the next tip involving one of my players. */
const LINEUP_WINDOW_MS = 30 * 60_000;
/** Hedge reminders fire this close to the questionable player's tip. */
const HEDGE_WINDOW_MS = 45 * 60_000;
/** Ignore lineup gaps smaller than this many projected points. */
const MIN_GAIN = 1;

export function gamedayAlerts(
  board: DayBoard,
  date: string,
  now: Date,
  fmtTime: (iso: string) => string,
): Alert[] {
  const url = `/nba/today?date=${date}`;
  const out: Alert[] = [];

  // A starter ruled out (ESPN "Out" or NBA.com inactive) while his slot can still change.
  for (const r of board.rows) {
    if (!isStartingSlot(r.currentSlot) || r.game?.state !== "pre" || r.playProb > 0) continue;
    out.push({
      key: `out-starter:${date}:${r.player.id}`,
      title: `${r.player.name} is out`,
      body: `He's in your ${r.currentSlot} slot (tip ${fmtTime(r.game.tip)}). Swap him out before then.`,
      url,
    });
  }

  // Lineup below optimal with the next relevant tip close.
  const gain = board.optimalPoints - board.currentPoints;
  const nextTip = Math.min(
    ...board.rows
      .filter((r) => r.game?.state === "pre" && r.value > 0)
      .map((r) => Date.parse(r.game!.tip)),
  );
  if (gain >= MIN_GAIN && board.moves.length && nextTip - now.getTime() <= LINEUP_WINDOW_MS) {
    const signature = board.moves
      .map((m) => `${m.playerId}>${m.to}`)
      .sort()
      .join(",");
    out.push({
      key: `lineup:${date}:${signature}`,
      title: "Lineup not optimal",
      body: `+${gain.toFixed(1)} projected points with ${board.moves.length} move${board.moves.length > 1 ? "s" : ""}. Next tip ${fmtTime(new Date(nextTip).toISOString())}.`,
      url,
    });
  }

  // Questionable starter about to tip, with a later bench option ready.
  for (const h of board.hedges) {
    const until = Date.parse(h.tip) - now.getTime();
    if (!h.backup || until > HEDGE_WINDOW_MS || until < 0) continue;
    out.push({
      key: `hedge:${date}:${h.playerId}`,
      title: `Check ${h.name} before ${fmtTime(h.tip)}`,
      body: `Listed ${h.status}. If he's ruled out, swap in ${h.backup.name} (tips ${fmtTime(h.backup.tip)}).`,
      url,
    });
  }
  return out;
}
