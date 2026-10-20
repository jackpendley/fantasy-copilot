// Add a free agent (or file a waiver claim), dropping one player. Called only from the
// confirm dialog on /nba/waivers. The server re-checks the move against fresh ESPN data:
// the player must still be available with the same status, the drop must still be on the
// roster and not locked, and an add must be left this week. Every write is audited.

import { NextResponse, type NextRequest } from "next/server";
import { submitAddDrop } from "@fantasy-copilot/espn";
import { auditAvailable, recordAction } from "@/lib/audit";
import { espnConfig } from "@/lib/env";
import { loadWaiverView } from "@/lib/nba/waivers-view";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) {
    return NextResponse.json({ error: "cross-origin request refused" }, { status: 403 });
  }
  if (process.env.ESPN_LEAGUE_FILE) {
    return NextResponse.json(
      { error: "writes are disabled while ESPN_LEAGUE_FILE is set" },
      { status: 409 },
    );
  }
  if (!auditAvailable()) {
    return NextResponse.json(
      { error: "writes need the audit log: set DATABASE_URL first" },
      { status: 503 },
    );
  }
  const body = await request.json().catch(() => null);
  const addId = Number(body?.addId);
  const dropId = body?.dropId == null ? null : Number(body.dropId);
  if (!Number.isInteger(addId) || addId <= 0 || (dropId != null && !Number.isInteger(dropId))) {
    return NextResponse.json({ error: "addId (and dropId) are required" }, { status: 400 });
  }

  const v = await loadWaiverView();
  const fa = v.freeAgents.find((f) => f.player.id === addId);
  if (!fa) {
    return NextResponse.json(
      { error: "stale", message: "That player is no longer available." },
      { status: 409 },
    );
  }
  const claim = fa.status === "WAIVERS";
  if (dropId != null) {
    const drop = v.data.me.roster.find((p) => p.id === dropId);
    if (!drop)
      return NextResponse.json(
        { error: "stale", message: "That player isn't on your roster anymore." },
        { status: 409 },
      );
    if (v.lockedToday.has(dropId)) {
      return NextResponse.json(
        { error: "locked", message: "His game has started; he can't be dropped right now." },
        { status: 409 },
      );
    }
  } else {
    const limit = Object.entries(v.data.settings.slotCounts)
      .filter(([s]) => s !== "IR")
      .reduce((a, [, n]) => a + n, 0);
    if (v.data.me.roster.filter((p) => p.slot !== "IR").length >= limit) {
      return NextResponse.json(
        { error: "roster full", message: "Pick a player to drop." },
        { status: 409 },
      );
    }
  }
  if (!claim && v.addsUsed >= v.addsCap) {
    return NextResponse.json(
      { error: "no adds", message: `All ${v.addsCap} adds this week are used.` },
      { status: 409 },
    );
  }

  const cfg = espnConfig();
  const move = { addId, dropId, claim };
  const result = await submitAddDrop(cfg, cfg.teamId, v.sp, move);
  try {
    await recordAction({
      kind: claim ? "waiver-claim" : "add-drop",
      scoringPeriodId: v.sp,
      request: {
        ...move,
        add: fa.player.name,
        drop: v.data.me.roster.find((p) => p.id === dropId)?.name ?? null,
      },
      ...result,
    });
  } catch (e) {
    return NextResponse.json(
      { ...result, claim, auditError: (e as Error).message },
      { status: result.ok ? 200 : 502 },
    );
  }
  return NextResponse.json({ ...result, claim }, { status: result.ok ? 200 : 502 });
}
