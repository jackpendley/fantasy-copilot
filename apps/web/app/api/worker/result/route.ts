// A runner posts its finished chunks; the Outlook and the Moves checks update from them. With
// `next`, the answer also carries the runner's next chunks (or "wait"), so one request does
// both (Vercel CPU, docs/COMPUTE.md).

import { NextResponse, type NextRequest } from "next/server";
import type { ChunkResult } from "@fantasy-copilot/fantasy-core";
import { addJobCpu, assignOrWait, groupOf, postChunks } from "@/lib/nba/sim-jobs";
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
    /** Ask for the next chunks too (as /api/worker/next takes them). */
    next?: { count?: number; have?: number; moves?: number };
  } | null;
  const results = body?.results ?? (body?.result ? [body.result] : []);
  if (!body?.jobId || !results.length || !results.every((r) => Number.isInteger(r?.chunk))) {
    return NextResponse.json({ error: "jobId and results are required" }, { status: 400 });
  }
  const cpu0 = process.cpuUsage();
  const group = Number.isInteger(body.group) ? body.group! : await groupOf(body.jobId, results[0]!);
  const out = await postChunks(body.jobId, group, results);
  await addJobCpu(body.jobId, cpu0);
  if (!body.next) return NextResponse.json(out);
  const n = body.next;
  const a = await assignOrWait(
    Math.min(Math.max(Number(n.count) || 4, 1), 16),
    Number(n.have) || null,
    Number.isInteger(n.moves) ? n.moves! : null,
  );
  return NextResponse.json({ ...out, next: typeof a === "string" ? null : a, wait: a === "wait" });
}
