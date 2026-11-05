// A runner posts its finished chunks; the Outlook and the Moves checks update from them.

import { NextResponse, type NextRequest } from "next/server";
import type { ChunkResult } from "@fantasy-copilot/fantasy-core";
import { groupOf, postChunks } from "@/lib/nba/sim-jobs";
import { workerAuthorized } from "@/lib/worker-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!workerAuthorized(request))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    jobId?: number;
    group?: number;
    results?: ChunkResult[];
    /** One chunk, from runners before groups. */
    result?: ChunkResult;
  } | null;
  const results = body?.results ?? (body?.result ? [body.result] : []);
  if (!body?.jobId || !results.length || !results.every((r) => Number.isInteger(r?.chunk))) {
    return NextResponse.json({ error: "jobId and results are required" }, { status: 400 });
  }
  const group = Number.isInteger(body.group) ? body.group! : await groupOf(body.jobId, results[0]!);
  return NextResponse.json(await postChunks(body.jobId, group, results));
}
