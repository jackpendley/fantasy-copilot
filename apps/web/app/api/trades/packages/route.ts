// "Find trade packages" for a watched player on another team (Players → Moves, Interested).
// POST queues the targeted search on the worker; GET says whether it's still searching (the
// button polls it, then reloads the page once). Nothing is sent to ESPN.

import { NextResponse, type NextRequest } from "next/server";
import { askPackages, packagesAsked } from "@/lib/nba/trade-view";

export const dynamic = "force-dynamic";

const idOf = (v: unknown) => {
  const id = Number(v);
  return Number.isInteger(id) && id > 0 ? id : null;
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const playerId = idOf(body?.playerId);
  if (!playerId) return NextResponse.json({ error: "playerId is required" }, { status: 400 });
  const ok = await askPackages(playerId);
  if (!ok)
    return NextResponse.json(
      { error: "He isn't a watched player on another team" },
      { status: 400 },
    );
  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest) {
  const playerId = idOf(request.nextUrl.searchParams.get("id"));
  if (!playerId) return NextResponse.json({ error: "id is required" }, { status: 400 });
  return NextResponse.json({ searching: await packagesAsked(playerId) });
}
