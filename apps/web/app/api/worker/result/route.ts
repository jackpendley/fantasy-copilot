// A runner posts one finished chunk; the Outlook and the Moves checks update from it.

import { NextResponse, type NextRequest } from "next/server";
import type { ChunkResult } from "@fantasy-copilot/fantasy-core";
import { postChunk } from "@/lib/nba/sim-jobs";
import { workerAuthorized } from "@/lib/worker-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!workerAuthorized(request))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    jobId?: number;
    result?: ChunkResult;
  } | null;
  if (!body?.jobId || !body.result || !Number.isInteger(body.result.chunk)) {
    return NextResponse.json({ error: "jobId and result are required" }, { status: 400 });
  }
  return NextResponse.json(await postChunk(body.jobId, body.result));
}
