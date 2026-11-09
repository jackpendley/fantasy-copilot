// One move's simulation input, built as a job would build it right now: the season as it
// stands and the move on it (lib/nba/sim-jobs.ts moveSimInput), for a one-off simulation run
// elsewhere. Read-only and stores nothing; Jack's session only (proxy.ts). One request costs
// a job's preparation (~5 s of CPU), so it's for occasional use.

import { NextResponse, type NextRequest } from "next/server";
import { moveSimInput } from "@/lib/nba/sim-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key") ?? "";
  if (!/^\d+:\d*:\d*$/.test(key)) {
    return NextResponse.json({ error: "key is add:drop:il (player ids)" }, { status: 400 });
  }
  const input = await moveSimInput(key);
  if (!input) return NextResponse.json({ error: "That move isn't available now" }, { status: 404 });
  return NextResponse.json(input, {
    headers: { "Content-Disposition": 'attachment; filename="sim-input.json"' },
  });
}
