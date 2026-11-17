// The Moves page's deep checks while the worker re-checks them (ADR-058): each move's numbers
// and state, and the job's progress, so the page can poll it instead of re-rendering
// (lib/nba/move-shown.ts). A page that already has the latest version gets 204 without them.

import { after, NextResponse, type NextRequest } from "next/server";
import { deepView } from "@/lib/nba/move-shown";
import {
  closeQuietJobs,
  deepVersion,
  ensureWorker,
  liveJob,
  settledResults,
} from "@/lib/nba/sim-jobs";

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
  // The page polls while a job is live: one whose runners went quiet is closed while Jack
  // watches (its version then changes, and the next poll brings the final numbers).
  after(() => closeQuietJobs(2 * 60_000).catch(() => null));
  if (body.version && body.version === (await deepVersion())) {
    return new NextResponse(null, { status: 204 });
  }
  const [job, last] = await Promise.all([liveJob(false, { keys }), settledResults(keys)]);
  // A job waiting with no runner (a missed dispatch) gets one while Jack watches.
  if (job?.live) after(() => ensureWorker(2 * 60_000).catch(() => false));
  return NextResponse.json(deepView(keys, job, last, body.roster));
}
