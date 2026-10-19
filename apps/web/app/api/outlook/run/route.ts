import { NextResponse } from "next/server";
import { runOutlook } from "@/lib/nba/outlook-run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Re-run the season outlook now (button on /nba/outlook; the nightly cron does the same). */
export async function POST() {
  try {
    const { scoringPeriod } = await runOutlook();
    return NextResponse.json({ ok: true, scoringPeriod });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
