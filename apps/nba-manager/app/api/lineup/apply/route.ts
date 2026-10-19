// Apply today's recommended lineup moves to ESPN. Called only from the confirm dialog.
// The server recomputes the moves from fresh ESPN data and refuses if they no longer match
// what the user confirmed, so a stale screen can never push an outdated lineup.

import { NextResponse, type NextRequest } from "next/server";
import { submitLineup, type LineupMove } from "@fantasy-copilot/espn";
import { auditAvailable, recordAction } from "@/lib/audit";
import { LAST_SCORING_PERIOD, scoringPeriodForDate } from "@/lib/calendar";
import { loadLeague } from "@/lib/data";
import { buildDayBoard } from "@/lib/day";
import { espnConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

const key = (m: LineupMove) => `${m.playerId}:${m.from}>${m.to}`;
const sameMoves = (a: readonly LineupMove[], b: readonly LineupMove[]) =>
  a.length === b.length && new Set(a.map(key)).size === new Set([...a, ...b].map(key)).size;

export async function POST(request: NextRequest) {
  // Same-origin only (the session cookie is SameSite=Lax; this closes the rest).
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) {
    return NextResponse.json({ error: "cross-origin request refused" }, { status: 403 });
  }
  if (process.env.ESPN_LEAGUE_FILE) {
    return NextResponse.json(
      { error: "writes are disabled while ESPN_LEAGUE_FILE is set" },
      { status: 409 },
    );
  }
  if (!auditAvailable()) {
    return NextResponse.json(
      { error: "writes need the audit log: configure Supabase first" },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  const date: unknown = body?.date;
  const confirmed: LineupMove[] = Array.isArray(body?.moves) ? body.moves : [];
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !confirmed.length) {
    return NextResponse.json({ error: "date and moves are required" }, { status: 400 });
  }
  const sp = scoringPeriodForDate(date);
  if (sp < 1 || sp > LAST_SCORING_PERIOD) {
    return NextResponse.json({ error: "date outside the season" }, { status: 400 });
  }

  const data = await loadLeague(sp, date);
  const board = buildDayBoard({
    roster: data.me.roster,
    slotCounts: data.settings.slotCounts,
    games: data.games.filter((g) => g.scoringPeriodId === sp),
    scoreboard: data.scoreboard,
    injuries: data.injuries,
    lineups: data.lineups,
  });
  const fresh: LineupMove[] = board.moves.map(({ playerId, from, to }) => ({ playerId, from, to }));
  if (!sameMoves(fresh, confirmed)) {
    return NextResponse.json(
      { error: "stale", message: "Your lineup or the news changed. Review the new moves." },
      { status: 409 },
    );
  }

  const cfg = espnConfig();
  const result = await submitLineup(cfg, cfg.teamId, sp, fresh);
  try {
    await recordAction({
      kind: "lineup",
      scoringPeriodId: sp,
      request: { date, moves: fresh },
      ...result,
    });
  } catch (e) {
    // The write already happened; say so rather than hiding it.
    return NextResponse.json(
      { ...result, auditError: (e as Error).message },
      { status: result.ok ? 200 : 502 },
    );
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
