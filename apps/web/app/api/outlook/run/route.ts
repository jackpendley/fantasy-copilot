import { NextResponse } from "next/server";
import { refreshOutlook } from "@/lib/nba/outlook-refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Re-run the season outlook now (button on /nba/outlook), unless a run is already going. */
export async function POST() {
  try {
    const outcome = await refreshOutlook(null);
    return NextResponse.json({ ok: true, outcome });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
