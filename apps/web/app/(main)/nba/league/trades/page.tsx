import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { FantasyTeam, RosterPlayer } from "@fantasy-copilot/espn";
import { Callout, PageHeader, SectionTitle } from "@/components/fc/bits";
import { PlayerAvatar } from "@/components/fc/player-avatar";
import { StatusPill } from "@/components/fc/status-pill";
import { SimulateTrade } from "@/components/simulate-trade";
import { Button } from "@/components/ui/button";
import { ErrorNotice, SetupNotice } from "@/components/setup-notice";
import { SetupError } from "@/lib/env";
import { fmtPts } from "@/lib/format";
import { loadLeagueView } from "@/lib/nba/league-view";
import { perGameProjection } from "@/lib/nba/projection";
import {
  PLAYOFF_WEIGHT,
  evaluateTrade,
  findTradeTargets,
  type TradeEval,
  type ValueContext,
} from "@/lib/nba/trade";
import { cn } from "@/lib/utils";

const ids = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v : v ? [v] : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
const signed = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n)}`;
const tone = (n: number) =>
  n > 1 ? "text-success" : n < -1 ? "text-danger" : "text-muted-foreground";
const tradeHref = (team: number, give: number[], get: number[]) =>
  `/nba/league/trades?team=${team}${give.map((g) => `&give=${g}`).join("")}${get.map((g) => `&get=${g}`).join("")}`;

function Names({ players }: { players: RosterPlayer[] }) {
  return <>{players.map((p) => p.name).join(" + ")}</>;
}

function PickList({
  name,
  players,
  picked,
}: {
  name: "give" | "get";
  players: RosterPlayer[];
  picked: number[];
}) {
  const sorted = [...players].sort((a, b) => perGameProjection(b).fppg - perGameProjection(a).fppg);
  return (
    <div className="divide-y overflow-hidden rounded-xl border bg-card">
      {sorted.map((p) => (
        <label
          key={p.id}
          className="flex cursor-pointer items-center gap-2.5 px-3 py-2 has-checked:bg-primary/10"
        >
          <input
            type="checkbox"
            name={name}
            value={p.id}
            defaultChecked={picked.includes(p.id)}
            className="size-4 accent-[var(--primary)]"
          />
          <PlayerAvatar id={p.id} name={p.name} size={28} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{p.name}</span>
              <StatusPill status={p.injuryStatus ?? "ACTIVE"} />
            </div>
            <div className="text-[11px] text-muted-foreground">{p.positions.join("/")}</div>
          </div>
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {fmtPts(perGameProjection(p).fppg)}
          </span>
        </label>
      ))}
    </div>
  );
}

function Verdict({ e }: { e: TradeEval }) {
  const me = e.mine.regular + PLAYOFF_WEIGHT * e.mine.playoffs;
  const them = e.theirs.regular + e.theirs.playoffs;
  return (
    <p className="text-sm">
      {me > 1 ? (
        <span className="font-medium text-success">Helps your lineup.</span>
      ) : (
        <span className="font-medium text-danger">Doesn&apos;t help your lineup.</span>
      )}{" "}
      {e.rawGap > 0
        ? `You'd get ${Math.round(e.rawGap)} more raw season points than you send, so they may push back.`
        : `They'd get ${Math.round(-e.rawGap)} more raw season points than they send: easier to sell.`}{" "}
      {them < -50
        ? "Their lineup gets worse."
        : them > 1
          ? "Their lineup gets better too."
          : "Their lineup stays about the same."}
    </p>
  );
}

function Evaluation({ e, partner }: { e: TradeEval; partner: FantasyTeam }) {
  const rows = [
    { who: "You", d: e.mine },
    { who: partner.name, d: e.theirs },
  ];
  return (
    <section className="space-y-1.5">
      <SectionTitle>Evaluation</SectionTitle>
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div className="text-sm">
          <span className="text-danger">Send</span> <Names players={e.give} />{" "}
          <span className="text-muted-foreground">·</span> <span className="text-success">Get</span>{" "}
          <Names players={e.get} />
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Starting points</th>
                <th className="px-3 py-2 text-right font-medium">Regular season</th>
                <th className="px-3 py-2 text-right font-medium">Playoff weeks</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.who}>
                  <td className="max-w-32 truncate px-3 py-2 font-medium">{r.who}</td>
                  <td className={cn("px-3 py-2 text-right font-semibold", tone(r.d.regular))}>
                    {signed(r.d.regular)}
                  </td>
                  <td className={cn("px-3 py-2 text-right font-semibold", tone(r.d.playoffs))}>
                    {signed(r.d.playoffs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Verdict e={e} />
        <SimulateTrade
          partnerId={partner.id}
          partnerName={partner.name}
          give={e.give.map((p) => p.id)}
          get={e.get.map((p) => p.id)}
        />
      </div>
    </section>
  );
}

/** Streamed in after the rest of the page: searching every 1-for-1 deal takes a few seconds. */
async function Targets({
  me,
  others,
  ctx,
}: {
  me: FantasyTeam;
  others: FantasyTeam[];
  ctx: ValueContext;
}) {
  await Promise.resolve();
  const ideas = findTradeTargets(
    { teamId: me.id, roster: me.roster },
    others.map((t) => ({ teamId: t.id, roster: t.roster })),
    ctx,
  );
  const name = new Map(others.map((t) => [t.id, t.name]));
  if (!ideas.length)
    return <Callout tone="info">No 1-for-1 deal clears the bar right now.</Callout>;
  return (
    <div className="divide-y overflow-hidden rounded-xl border bg-card">
      {ideas.map((i) => (
        <Link
          key={`${i.partnerId}-${i.give[0]!.id}-${i.get[0]!.id}`}
          href={tradeHref(i.partnerId, [i.give[0]!.id], [i.get[0]!.id])}
          className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50"
        >
          <div className="flex shrink-0 -space-x-2">
            <PlayerAvatar id={i.give[0]!.id} name={i.give[0]!.name} size={32} />
            <PlayerAvatar id={i.get[0]!.id} name={i.get[0]!.name} size={32} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">
              <span className="text-muted-foreground">Send</span> {i.give[0]!.name}{" "}
              <span className="text-muted-foreground">for</span>{" "}
              <span className="font-medium">{i.get[0]!.name}</span>
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              with {name.get(i.partnerId)} · their lineup{" "}
              {signed(i.theirs.regular + i.theirs.playoffs)}
            </div>
          </div>
          <div className="shrink-0 text-right tabular-nums">
            <div className={cn("font-semibold", tone(i.mine.regular))}>
              {signed(i.mine.regular)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {signed(i.mine.playoffs)} playoffs
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; give?: string | string[]; get?: string | string[] }>;
}) {
  const sp = await searchParams;
  let v;
  try {
    v = await loadLeagueView();
  } catch (e) {
    if (e instanceof SetupError) return <SetupNotice message={e.message} />;
    return <ErrorNotice title="Couldn't load the league" message={(e as Error).message} />;
  }
  const me = v.data.me;
  const others = v.data.teams.filter((t) => t.id !== me.id);
  const partner = others.find((t) => t.id === Number(sp.team)) ?? null;
  const give = me.roster.filter((p) => ids(sp.give).includes(p.id));
  const get = partner ? partner.roster.filter((p) => ids(sp.get).includes(p.id)) : [];
  const e =
    partner && give.length && get.length
      ? evaluateTrade(
          { teamId: me.id, roster: me.roster },
          { teamId: partner.id, roster: partner.roster },
          give,
          get,
          v.ctx,
        )
      : null;

  return (
    <>
      <Link
        href="/nba/league"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> League
      </Link>
      <PageHeader
        title="Trades"
        subtitle="Judged by projected starting-lineup points for the rest of the season"
      />

      <section className="space-y-1.5">
        <SectionTitle>Trade with</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {others.map((t) => (
            <Link
              key={t.id}
              href={`/nba/league/trades?team=${t.id}`}
              className={cn(
                "max-w-48 truncate rounded-lg border px-2.5 py-1 text-xs font-medium",
                partner?.id === t.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "bg-card text-muted-foreground",
              )}
            >
              {t.name}
            </Link>
          ))}
        </div>
      </section>

      {partner && (
        <form action="/nba/league/trades" className="space-y-3">
          <input type="hidden" name="team" value={partner.id} />
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <div className="px-1 text-xs font-medium">You send</div>
              <PickList name="give" players={me.roster} picked={give.map((p) => p.id)} />
            </div>
            <div className="space-y-1">
              <div className="truncate px-1 text-xs font-medium">You get from {partner.name}</div>
              <PickList name="get" players={partner.roster} picked={get.map((p) => p.id)} />
            </div>
          </div>
          <Button type="submit" className="w-full sm:w-auto">
            Evaluate trade
          </Button>
        </form>
      )}

      {partner && (give.length > 0 || get.length > 0) && !e && (
        <Callout tone="info">Pick at least one player on each side.</Callout>
      )}
      {e && partner && <Evaluation e={e} partner={partner} />}

      <section className="space-y-1.5">
        <SectionTitle aside="1-for-1, ranked by your gain">Trade targets</SectionTitle>
        <Suspense
          fallback={
            <div className="rounded-xl border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
              Searching every 1-for-1 deal in the league…
            </div>
          }
        >
          <Targets me={me} others={others} ctx={v.ctx} />
        </Suspense>
        <p className="px-1 text-xs text-muted-foreground">
          A target must raise your starting points (playoff weeks count double), send them at least
          ~95% of the raw season points they give up, and not cost their lineup more than ~50
          points. Raw value is what most managers look at; lineup fit is where you gain.
        </p>
      </section>
    </>
  );
}
