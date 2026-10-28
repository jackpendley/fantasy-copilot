// The pre-registered props test on the data collected so far (MODEL_CARD.md). Read-only.

import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { evalRows, scoredGames } from "@/lib/nba/accuracy";
import { evaluateProps } from "@/lib/nba/props-eval";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!dbConfigured()) return NextResponse.json({ error: "no database" }, { status: 503 });
  const data = evalRows(await scoredGames());
  const days = new Set(data.map((r) => r.day)).size;
  return NextResponse.json({
    collected: { games: data.length, days },
    evaluation: evaluateProps(data) ?? "not enough data yet (needs 7 game days and 800 games)",
  });
}
