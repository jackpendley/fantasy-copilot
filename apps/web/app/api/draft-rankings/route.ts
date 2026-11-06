// Upload Jack's pre-draft rankings (apps/draft-nba/dist/rankings.csv) for Players → Draft. Stored
// privately in the database (never in git); an upload replaces the last one.

import { NextResponse, type NextRequest } from "next/server";
import { importRankings } from "@/lib/nba/draft-view";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A rankings file is ~50 KB; anything far bigger isn't one. */
const MAX_BYTES = 2_000_000;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const csv = body?.csv;
  if (typeof csv !== "string" || !csv.trim() || csv.length > MAX_BYTES) {
    return NextResponse.json(
      { error: "csv (the file's text, under 2 MB) is required" },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await importRankings(csv));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
}
