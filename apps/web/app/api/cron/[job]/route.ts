// Scheduled jobs, with `Authorization: Bearer CRON_SECRET`. Vercel cron calls nightly and
// pregame once a day; gameday is meant for a 5-minute external scheduler.

import { NextResponse, type NextRequest } from "next/server";
import { gamedayJob, nightlyJob, pregameJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  try {
    return NextResponse.json({ job, ...(await run()) });
  } catch (e) {
    return NextResponse.json({ job, error: (e as Error).message }, { status: 500 });
  }
}
