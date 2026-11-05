// Worker tasks besides simulations (lib/nba/worker-tasks.ts). GET claims the next one (204
// when there's none); POST returns its result, or its error.

import { NextResponse, type NextRequest } from "next/server";
import { claimTask, finishTask } from "@/lib/nba/worker-tasks";
import { workerAuthorized } from "@/lib/worker-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!workerAuthorized(request))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const task = await claimTask();
  return task ? NextResponse.json(task) : new NextResponse(null, { status: 204 });
}

export async function POST(request: NextRequest) {
  if (!workerAuthorized(request))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    id?: number;
    result?: unknown;
    error?: string;
  } | null;
  if (!body?.id || (body.result === undefined && !body.error)) {
    return NextResponse.json({ error: "id and result (or error) are required" }, { status: 400 });
  }
  const ok = await finishTask(body.id, body.result, body.error);
  return NextResponse.json({ ok });
}
