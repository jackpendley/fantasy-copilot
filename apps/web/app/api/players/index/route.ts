// Every player for search as you type: one compact list the browser searches on each
// keystroke (lib/player-search.ts). Kept for 10 minutes per server instance.

import { NextResponse } from "next/server";
import { loadSearchIndex } from "@/lib/nba/pool";
import type { SearchPlayer } from "@/lib/player-search";

export const dynamic = "force-dynamic";

const FRESH_MS = 10 * 60_000;
let cached: { at: number; players: Promise<SearchPlayer[]> } | null = null;

export async function GET() {
  if (!cached || Date.now() - cached.at > FRESH_MS) {
    const players = loadSearchIndex();
    cached = { at: Date.now(), players };
    players.catch(() => {
      if (cached?.players === players) cached = null;
    });
  }
  try {
    return NextResponse.json(
      { players: await cached.players },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
