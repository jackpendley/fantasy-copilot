// Protect a player or lift it (ADR-060): "Not for trade" or "Never drop". Changes only the
// app's suggestions; nothing is sent to ESPN.

import { after, NextResponse, type NextRequest } from "next/server";
import { forgetResponses } from "@/lib/fetch-memo";
import { refreshLogged } from "@/lib/nba/outlook-refresh";
import { setPref } from "@/lib/nba/prefs";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const playerId = Number(body?.playerId);
  const field = body?.field;
  const on = body?.on;
  if (
    !Number.isInteger(playerId) ||
    playerId <= 0 ||
    (field !== "noTrade" && field !== "noDrop") ||
    typeof on !== "boolean"
  ) {
    return NextResponse.json(
      { error: 'playerId, field ("noTrade" or "noDrop") and on (true/false) are required' },
      { status: 400 },
    );
  }
  await setPref(playerId, field, on);
  forgetResponses();
  // The moves and trade ideas to check have changed: re-check them.
  after(() => refreshLogged("You changed your protected players"));
  return NextResponse.json({ ok: true });
}
