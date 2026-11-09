// Simulate a trade Jack built (or picked) on the worker: the season with and without it, to
// the top tier's precision (ADR-060), as an asked trade (lib/nba/asked-trades.ts). POST asks;
// GET says whether its result is still coming and its numbers so far (the button polls, then
// reloads once). Read-only: nothing is sent to ESPN.

import { NextResponse, type NextRequest } from "next/server";
import { askPending } from "@/lib/nba/asked-trades";
import { loadLeagueView } from "@/lib/nba/league-view";
import { liveJob, requestTradeChecks, settledResults } from "@/lib/nba/sim-jobs";
import { deepView } from "@/lib/nba/move-shown";
import { tradeKey } from "@/lib/nba/sim-moves";
import { evaluateTrade } from "@/lib/nba/trade";
import { compact } from "@/lib/nba/trade-task";

export const dynamic = "force-dynamic";

const ids = (v: unknown) =>
  Array.isArray(v) && v.length > 0 && v.length <= 3 && v.every((x) => Number.isInteger(x) && x > 0)
    ? (v as number[])
    : null;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const partnerId = Number(body?.partnerId);
  const giveIds = ids(body?.give);
  const getIds = ids(body?.get);
  if (!Number.isInteger(partnerId) || !giveIds || !getIds) {
    return NextResponse.json(
      { error: "partnerId, give and get (1-3 player ids each) are required" },
      { status: 400 },
    );
  }
  const v = await loadLeagueView();
  const me = v.data.me;
  const partner = v.data.teams.find((t) => t.id === partnerId && t.id !== me.id);
  const give = me.roster.filter((p) => giveIds.includes(p.id));
  const get = partner?.roster.filter((p) => getIds.includes(p.id)) ?? [];
  if (!partner || give.length !== giveIds.length || get.length !== getIds.length)
    return NextResponse.json(
      { error: "Those players have moved: reload the page" },
      { status: 409 },
    );
  // The same evaluation as the page: the drops and pickups the trade needs come with it.
  const e = evaluateTrade(
    { teamId: me.id, roster: me.roster, noDrop: [...v.prefs.noDrop] },
    { teamId: partner.id, roster: partner.roster },
    give,
    get,
    v.ctx,
    { freeAgents: v.freeAgents, market: v.market },
  );
  const spec = compact({ ...e, partnerId, score: 0 });
  await requestTradeChecks([{ spec, top: true }], "You asked to simulate a trade");
  return NextResponse.json({ key: tradeKey(partnerId, spec.give, spec.get) });
}

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });
  const [pending, job, last] = await Promise.all([
    askPending(key),
    liveJob(true),
    settledResults([key]),
  ]);
  // Numbers so far, from the job under way (read for Jack's roster as that job has it: a page
  // load checks it against the roster now).
  const view = deepView([key], job, last, job?.rosterKey ?? "");
  return NextResponse.json({
    pending,
    sim: view.sims[key] ?? null,
    state: view.states[key] ?? null,
    running: job?.live ?? false,
  });
}
