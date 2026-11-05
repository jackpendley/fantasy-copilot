// A runner's next chunks of seasons (204 when there's nothing left). `have`: the job it
// already holds and `moves` how many of its moves, so the simulation input isn't sent again.

import { NextResponse, type NextRequest } from "next/server";
import { addJobCpu, nextAssignment } from "@/lib/nba/sim-jobs";
import { SIM_LOCK, heartbeat } from "@/lib/nba/worker-tasks";
import { workerAuthorized } from "@/lib/worker-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!workerAuthorized(request))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = request.nextUrl.searchParams;
  const count = Math.min(Math.max(Number(q.get("count")) || 4, 1), 16);
  const have = Number(q.get("have")) || null;
  const moves = q.has("moves") ? Number(q.get("moves")) : null;
  const cpu0 = process.cpuUsage();
  const a = await nextAssignment(count, have, Number.isInteger(moves) ? moves : null);
  if (a) await addJobCpu(a.jobId, cpu0);
  // Nothing now: the runner waits for a job being built (lib/nba/worker-tasks.ts SIM_LOCK).
  // Short, so a runner that leaves instead doesn't hold it long (waiting runners poll every 5 s).
  else await heartbeat(SIM_LOCK, 20);
  return a ? NextResponse.json(a) : new NextResponse(null, { status: 204 });
}
