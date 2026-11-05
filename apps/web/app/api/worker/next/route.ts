// A runner's next chunks of seasons (204 when there's nothing left). `have`: the job it
// already holds and `moves` how many of its moves, so the simulation input isn't sent again.

import { NextResponse, type NextRequest } from "next/server";
import { nextAssignment } from "@/lib/nba/sim-jobs";
import { workerAuthorized } from "@/lib/worker-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!workerAuthorized(request))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = request.nextUrl.searchParams;
  const count = Math.min(Math.max(Number(q.get("count")) || 4, 1), 16);
  const have = Number(q.get("have")) || null;
  const moves = q.has("moves") ? Number(q.get("moves")) : null;
  const a = await nextAssignment(count, have, Number.isInteger(moves) ? moves : null);
  return a ? NextResponse.json(a) : new NextResponse(null, { status: 204 });
}
