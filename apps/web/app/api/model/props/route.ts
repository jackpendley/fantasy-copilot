// The pre-registered props test on the data collected so far (MODEL_CARD.md). Read-only.

import { NextResponse } from "next/server";
import { db, dbConfigured } from "@/lib/db";
import { evaluateProps, type EvalRow } from "@/lib/nba/props-eval";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!dbConfigured()) return NextResponse.json({ error: "no database" }, { status: 503 });
  const rows = await db()<
    { player_id: number; day: string; model_fppg: number; vegas_fppg: number; fp: number }[]
  >`
    select p.player_id, to_char(p.tip at time zone 'America/New_York', 'YYYY-MM-DD') as day,
      p.model_fppg, p.vegas_fppg, r.fp
    from pregame_projections p
    join game_results r using (game_id, player_id)
    where p.snapshot = 'pregame' and p.vegas_fppg is not null
  `;
  const data: EvalRow[] = rows.map((r) => ({
    playerId: r.player_id,
    day: r.day,
    model: r.model_fppg,
    vegas: r.vegas_fppg,
    actual: r.fp,
  }));
  const days = new Set(data.map((r) => r.day)).size;
  return NextResponse.json({
    collected: { games: data.length, days },
    evaluation: evaluateProps(data) ?? "not enough data yet (needs 7 game days and 800 games)",
  });
}
