// Scheduled jobs, with `Authorization: Bearer CRON_SECRET`. Vercel cron calls nightly and
// pregame once a day; gameday is called every 5 minutes by cron-job.org, which gives up after
// 30 seconds, so it answers at once and does its work after the response (`?wait=1` waits).

import { after, NextResponse, type NextRequest } from "next/server";
import { gamedayJob, nightlyJob, pregameJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Jobs that answer at once and run in the background. */
const BACKGROUND = new Set(["gameday"]);

const JOBS: Record<string, () => Promise<Record<string, unknown>>> = {
  gameday: () => gamedayJob(),
  nightly: () => nightlyJob(),
  pregame: () => pregameJob(),
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { job } = await params;
  const run = JOBS[job];
  if (!run) {
    return NextResponse.json(
      { error: `job must be one of ${Object.keys(JOBS).join(", ")}` },
      { status: 400 },
    );
  }
  if (BACKGROUND.has(job) && request.nextUrl.searchParams.get("wait") !== "1") {
    // The job logs its own failures to refresh_log.
    after(() => run().catch(() => {}));
    return NextResponse.json({ job, accepted: true });
  }
  try {
    return NextResponse.json({ job, ...(await run()) });
  } catch (e) {
    return NextResponse.json({ job, error: (e as Error).message }, { status: 500 });
  }
}
