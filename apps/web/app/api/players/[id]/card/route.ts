// Player card data (read-only): tapped from any player row.

import { NextResponse, type NextRequest } from "next/server";
import { loadPlayerCard } from "@/lib/nba/player-card";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "bad player id" }, { status: 400 });
  }
  try {
    const card = await loadPlayerCard(id);
    if (!card) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(card, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
