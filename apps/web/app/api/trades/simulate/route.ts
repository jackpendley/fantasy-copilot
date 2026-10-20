// Simulate the season with and without a trade (read-only: nothing is sent to ESPN).

import { NextResponse, type NextRequest } from "next/server";
import { simulateTrade } from "@/lib/nba/outlook-run";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ids = (v: unknown) =>
  Array.isArray(v) && v.length > 0 && v.length <= 3 && v.every((x) => Number.isInteger(x) && x > 0)
    ? (v as number[])
    : null;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const partnerId = Number(body?.partnerId);
  const give = ids(body?.give);
  const get = ids(body?.get);
  if (!Number.isInteger(partnerId) || !give || !get) {
    return NextResponse.json(
      { error: "partnerId, give and get (1-3 player ids each) are required" },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await simulateTrade(partnerId, give, get));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
