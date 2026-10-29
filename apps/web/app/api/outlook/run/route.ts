import { after, NextResponse } from "next/server";
import { outlookRunning, refreshLogged } from "@/lib/nba/outlook-refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Re-run the season outlook (button on /nba/outlook), unless a run is already going. It answers
 * at once; the run reports its odds as it goes, which the page shows while it refreshes.
 */
export async function POST() {
  try {
    if (await outlookRunning()) return NextResponse.json({ ok: true, outcome: "busy" });
    after(() => refreshLogged(null));
    return NextResponse.json({ ok: true, outcome: "started" });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
