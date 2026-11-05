// The worker's first, cheap question: is there anything to simulate or compute? (200 yes,
// 204 no.)

import { NextResponse, type NextRequest } from "next/server";
import { hasWork } from "@/lib/nba/sim-jobs";
import { hasTasks, taskRunnerNeeded } from "@/lib/nba/worker-tasks";
import { workerAuthorized } from "@/lib/worker-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!workerAuthorized(request))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // The task runner asks whether to stay up (lib/nba/worker-tasks.ts taskRunnerNeeded).
  if (request.nextUrl.searchParams.get("for") === "tasks") {
    return (await taskRunnerNeeded())
      ? NextResponse.json({ work: true })
      : new NextResponse(null, { status: 204 });
  }
  return (await hasWork()) || (await hasTasks())
    ? NextResponse.json({ work: true })
    : new NextResponse(null, { status: 204 });
}
