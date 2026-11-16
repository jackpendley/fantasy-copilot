// The Moves page's deep checks while the worker re-checks them (ADR-058): each move's numbers
// and state, and the job's progress, so the page can poll it instead of re-rendering
// (lib/nba/move-shown.ts). A page that already has the latest version gets 204 without them.

import { NextResponse, type NextRequest } from "next/server";
import { deepView } from "@/lib/nba/move-shown";
import { deepVersion, liveJob, settledResults } from "@/lib/nba/sim-jobs";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    roster?: string;
    keys?: string[];
    /** The version the page has (DeepView.version). */
    version?: string | null;
  } | null;
  const keys = (body?.keys ?? []).filter((k) => typeof k === "string").slice(0, 600);
  if (typeof body?.roster !== "string" || !keys.length) {
    return NextResponse.json({ error: "roster and keys are required" }, { status: 400 });
  }
  if (body.version && body.version === (await deepVersion())) {
    return new NextResponse(null, { status: 204 });
  }
  const [job, last] = await Promise.all([liveJob(), settledResults(keys)]);
  return NextResponse.json(deepView(keys, job, last, body.roster));
}
