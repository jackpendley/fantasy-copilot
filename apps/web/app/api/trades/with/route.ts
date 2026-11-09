// "Find trades with {team}" (League → Trades): POST queues the search limited to that team on
// the worker; GET says whether it's still searching (the button polls it, then reloads the page
// once). Nothing is sent to ESPN.

import { NextResponse, type NextRequest } from "next/server";
import { askTradesWith, tradesWithAsked } from "@/lib/nba/trade-view";

export const dynamic = "force-dynamic";

const idOf = (v: unknown) => {
  const id = Number(v);
  return Number.isInteger(id) && id > 0 ? id : null;
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const partnerId = idOf(body?.partnerId);
  if (!partnerId) return NextResponse.json({ error: "partnerId is required" }, { status: 400 });
  if (!(await askTradesWith(partnerId)))
    return NextResponse.json({ error: "That team isn't in the league" }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest) {
  const partnerId = idOf(request.nextUrl.searchParams.get("team"));
  if (!partnerId) return NextResponse.json({ error: "team is required" }, { status: 400 });
  return NextResponse.json({ searching: await tradesWithAsked(partnerId) });
}
