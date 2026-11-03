// The worker's first, cheap question: is there anything to simulate? (200 yes, 204 no.)

import { NextResponse, type NextRequest } from "next/server";
import { hasWork } from "@/lib/nba/sim-jobs";
import { workerAuthorized } from "@/lib/worker-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!workerAuthorized(request))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return (await hasWork())
    ? NextResponse.json({ work: true })
    : new NextResponse(null, { status: 204 });
}
