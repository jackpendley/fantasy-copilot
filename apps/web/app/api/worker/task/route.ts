// Worker tasks besides simulations (lib/nba/worker-tasks.ts). GET claims the next one: 200
// with it, 202 when there's none now but the runner should stay (simulations under way often
// bring tasks), 204 when it can leave. POST returns its result, or its error, and stores the
// result where its pages read it.

import { after, NextResponse, type NextRequest } from "next/server";
import type { WireMove } from "@fantasy-copilot/fantasy-core";
import { storeBuiltJob } from "@/lib/nba/sim-jobs";
import type { StoredIdea } from "@/lib/nba/trade-task";
import { claimTask, finishTask, taskRunnerNeeded } from "@/lib/nba/worker-tasks";
import { readView, writeView } from "@/lib/view-cache";
import { refreshLogged } from "@/lib/nba/outlook-refresh";
import { tradeKey } from "@/lib/nba/sim-moves";
import { TRADE_FOR_KEY } from "@/lib/nba/trade-view";
import { workerAuthorized } from "@/lib/worker-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The packages as simulation move keys, in order. */
const packageKeys = (r: Record<string, StoredIdea[]>) =>
  Object.values(r)
    .flatMap((ps) => ps.map((i) => tradeKey(i.partnerId, i.give, i.get)))
    .join(",");

export async function GET(request: NextRequest) {
  if (!workerAuthorized(request))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const task = await claimTask();
  if (task) return NextResponse.json(task);
  return new NextResponse(null, { status: (await taskRunnerNeeded()) ? 202 : 204 });
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
  const task = await finishTask(body.id, body.error);
  if (!task || body.error) return NextResponse.json({ ok: Boolean(task) });
  if (task.kind === "trade-search") {
    await writeView("trade-targets", task.fingerprint, body.result as StoredIdea[], 0);
  } else if (task.kind === "trade-for") {
    const result = body.result as Record<string, StoredIdea[]>;
    const before = await readView<Record<string, StoredIdea[]>>(TRADE_FOR_KEY).catch(() => null);
    await writeView(TRADE_FOR_KEY, task.fingerprint, result, 0);
    // New packages to simulate: queue a job (the same ones keep their numbers).
    if (packageKeys(before?.value ?? {}) !== packageKeys(result))
      after(() => refreshLogged("New trade packages for your watch list"));
  } else if (task.kind === "sim-build") {
    const job = await storeBuiltJob(
      body.id,
      body.result as { moves: WireMove[]; leading: number; top?: number; others: number },
    );
    return NextResponse.json({ ok: true, job });
  }
  return NextResponse.json({ ok: true });
}
