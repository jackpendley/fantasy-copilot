// Season-simulation check of one waiver move on request (a drop Jack picked instead of the
// recommended one). Read-only on ESPN: it simulates and stores the result, it never adds or
// drops anyone.

import { after, NextResponse, type NextRequest } from "next/server";
import { checkMove } from "@/lib/nba/move-checks";
import { workerEnabled } from "@/lib/nba/outlook-refresh";
import { requestMoveCheck } from "@/lib/nba/sim-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const id = (x: unknown) => (x == null ? null : Number.isInteger(Number(x)) ? Number(x) : NaN);

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const addId = id(body?.addId);
  const dropId = id(body?.dropId);
  const ilId = id(body?.ilId);
  if (!addId || Number.isNaN(dropId) || Number.isNaN(ilId)) {
    return NextResponse.json({ error: "addId (and dropId or ilId) are required" }, { status: 400 });
  }
  try {
    const effect = await checkMove(addId, dropId, ilId);
    if (!effect) {
      return NextResponse.json(
        { error: "That move isn't available any more. Reload the page." },
        { status: 404 },
      );
    }
    // The deep check (thousands of seasons on the worker) follows within minutes.
    if (workerEnabled()) {
      const key = `${addId}:${dropId ?? ""}:${ilId ?? ""}`;
      after(() => requestMoveCheck(key).catch(() => null));
    }
    return NextResponse.json({ effect, deep: workerEnabled() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
