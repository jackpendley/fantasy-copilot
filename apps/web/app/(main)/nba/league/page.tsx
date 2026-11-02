// League (with the season outlook, which used to be its own page): your title, playoff and
// #1-seed odds, what changed since the last simulation, your odds over time, then one table of
// every team's standing, strength and odds.

import Link from "next/link";
import { after } from "next/server";
import { ArrowLeftRight, RefreshCw } from "lucide-react";
import { PageHeader, ProbBar, SectionTitle, StatTile } from "@/components/fc/bits";
import { WhatChanged } from "@/components/fc/what-changed";
import { LiveRefresh } from "@/components/live-refresh";
import { OddsChart } from "@/components/odds-chart";
import { RunOutlook } from "@/components/run-outlook";
import { ErrorNotice, SetupNotice } from "@/components/setup-notice";
import { Button } from "@/components/ui/button";
import { dbConfigured } from "@/lib/db";
import { DISPLAY_TZ, SetupError } from "@/lib/env";
import { fmtPts, fmtTip } from "@/lib/format";
import { dateForScoringPeriod, shortDay } from "@/lib/nba/calendar";
import { leagueMovesBetween } from "@/lib/nba/changes";
import { loadLeagueView } from "@/lib/nba/league-view";
import {
  isStale,
  outlookRunning,
  recentLeagueMoves,
  refreshLogged,
} from "@/lib/nba/outlook-refresh";
import {
  latestOutlooks,
  outlookHistory,
  provisionalOutlook,
  type OutlookTeam,
} from "@/lib/nba/outlook-run";
import { cn } from "@/lib/utils";

// A visit can start a re-run in the background (after the response): ~80 s on Vercel, more
// when the instance is busy, so it gets the same budget as the nightly job.
export const maxDuration = 300;

const pct = (v: number) => (v < 0.005 && v > 0 ? "<1%" : `${Math.round(v * 100)}%`);

/** Change in percentage points since the previous run; hidden when under half a point. */
function delta(now: number, before: number | undefined) {
  if (before == null) return null;
  const d = Math.round((now - before) * 100);
  if (d === 0) return null;
  return { text: `${d > 0 ? "+" : ""}${d}`, up: d > 0 };
}

// Date and time in the display time zone (an evening run is still that day, not tomorrow's UTC date).
const when = (d: Date) => {
  const [, m, day] = new Intl.DateTimeFormat("en-CA", { timeZone: DISPLAY_TZ })
    .format(d)
    .split("-");
  return `${m}/${day} ${fmtTip(d.toISOString())}`;
};

async function loadOutlook(myId: number) {
  if (!dbConfigured()) return null;
  const [runs, history, leagueMoves, running, provisional] = await Promise.all([
    latestOutlooks(),
    outlookHistory(myId),
    recentLeagueMoves().catch(() => []),
    outlookRunning(),
    provisionalOutlook().catch(() => null),
  ]);
  const [latest, previous] = runs;
  // A roster move newer than the latest run: update now, in the background.
  const stale = isStale(leagueMoves.at(-1)?.at ?? null, latest?.run_at.getTime() ?? null);
  if (stale && !running) after(() => refreshLogged());
  // The roster moves between the two runs. Never blocks the page.
  const moves =
    latest && previous
      ? await leagueMovesBetween(
          previous.run_at,
          latest.run_at,
          previous.scoring_period,
          latest.scoring_period,
        ).catch(() => null)
      : null;
  return {
    latest,
    previous,
    history,
    moves,
    provisional,
    updating: stale || running || provisional != null,
  };
}

export default async function LeaguePage() {
  const myId = Number(process.env.ESPN_TEAM_ID);
  let v;
  let o;
  try {
    [v, o] = await Promise.all([loadLeagueView(), loadOutlook(myId).catch(() => null)]);
  } catch (e) {
    if (e instanceof SetupError) return <SetupNotice message={e.message} />;
    return <ErrorNotice title="Couldn't load the league" message={(e as Error).message} />;
  }
  // While a run refines, its odds so far are shown (compared with the latest final run).
  const shown = o?.provisional ?? o?.latest ?? null;
  const odds = new Map((shown?.results ?? []).map((r) => [r.teamId, r]));
  const me = odds.get(myId);
  const before = (o?.provisional ? o.latest : o?.previous)?.results.find((t) => t.teamId === myId);
  const standings = [...v.teams].sort(
    (a, b) =>
      b.team.wins - a.team.wins || b.team.pointsFor - a.team.pointsFor || b.perWeek - a.perWeek,
  );
  const maxTitle = Math.max(0.0001, ...(shown?.results ?? []).map((r) => r.champ));

  return (
    <>
      <PageHeader
        title="League"
        subtitle={
          o?.latest
            ? `Odds from ${o.latest.seasons.toLocaleString("en-US")} simulated seasons from ${shortDay(dateForScoringPeriod(o.latest.scoring_period))} · updated ${when(o.latest.run_at)}${o.latest.trigger ? ` after: ${o.latest.trigger}` : ""}`
            : `${v.teams.length} teams · standings and strength`
        }
      >
        <div className="flex items-center gap-2">
          {o && <RunOutlook />}
          <Button asChild size="sm">
            <Link href="/nba/league/trades">
              <ArrowLeftRight className="size-4" /> Trades
            </Link>
          </Button>
        </div>
      </PageHeader>

      {o?.updating && (
        <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm">
          <RefreshCw className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
          <span>
            {o.provisional
              ? `Refining with the latest rosters: ${o.provisional.seasons.toLocaleString("en-US")} of 2,000 seasons so far. These odds are provisional and update every few seconds.`
              : "Updating for the latest roster move. Provisional odds appear in a few seconds."}
          </span>
          <LiveRefresh active seconds={5} />
        </div>
      )}

      {me && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Title"
            value={pct(me.champ)}
            delta={delta(me.champ, before?.champ)}
            sub={`Final ${pct(me.final)}`}
          />
          <StatTile label="#1 seed" value={pct(me.seed1)} delta={delta(me.seed1, before?.seed1)} />
          <StatTile
            label="Playoffs"
            value={pct(me.playoffs)}
            delta={delta(me.playoffs, before?.playoffs)}
            sub="Top 6 of 12"
          />
          <StatTile
            label="Expected wins"
            value={me.expWins.toFixed(1)}
            sub={`${me.wins}-${me.losses} so far`}
          />
        </div>
      )}

      {o?.latest && o.previous && (
        <section className="space-y-1.5">
          <SectionTitle aside={`since ${when(o.previous.run_at)}`}>What changed</SectionTitle>
          <WhatChanged
            latest={o.latest.results}
            previous={o.previous.results}
            moves={o.moves}
            myId={myId}
          />
          <p className="px-1 text-xs text-muted-foreground">
            Shows teams whose title odds moved a point or more, or who changed their roster. Each
            run plays out {o.latest.seasons.toLocaleString("en-US")} seasons with the same random
            draws for the same players, so moves mostly reflect real changes (rosters, results,
            projections, injuries).
          </p>
        </section>
      )}

      {o && o.history.length > 1 && (
        <section className="space-y-1.5">
          <SectionTitle>Your odds over time</SectionTitle>
          <div className="rounded-xl border bg-card p-3 sm:p-4">
            <OddsChart points={o.history} />
          </div>
        </section>
      )}

      <section className="space-y-1.5">
        <SectionTitle aside="Tap a team for its roster">Standings</SectionTitle>

        {/* Phones and tablets: one card per team. */}
        <div className="divide-y overflow-hidden rounded-xl border bg-card lg:hidden">
          {standings.map((t, i) => (
            <TeamCard
              key={t.team.id}
              rank={i + 1}
              id={t.team.id}
              name={t.team.name}
              mine={t.mine}
              record={`${t.team.wins}-${t.team.losses}`}
              pf={t.team.pointsFor}
              perWeek={t.perWeek}
              power={v.power.get(t.team.id)!}
              odds={odds.get(t.team.id) ?? null}
            />
          ))}
        </div>

        {/* Desktop: one table. */}
        <div className="hidden overflow-hidden rounded-xl border bg-card lg:block">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="w-8 px-3 py-2.5 text-left font-medium">#</th>
                <th className="px-2 py-2.5 text-left font-medium">Team</th>
                <th className="px-2 py-2.5 text-right font-medium">W-L</th>
                <th className="px-2 py-2.5 text-right font-medium">PF</th>
                <th className="px-2 py-2.5 text-right font-medium">Pts/wk</th>
                {shown && (
                  <>
                    <th className="px-2 py-2.5 text-right font-medium">Exp. W</th>
                    <th className="w-32 px-2 py-2.5 text-left font-medium">Playoffs</th>
                    <th className="px-2 py-2.5 text-right font-medium">#1</th>
                    <th className="px-2 py-2.5 text-right font-medium">Final</th>
                    <th className="w-32 px-2 py-2.5 text-left font-medium">Title</th>
                    <th className="px-3 py-2.5 text-right font-medium">Active</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {standings.map((t, i) => {
                const r = odds.get(t.team.id);
                return (
                  <tr key={t.team.id} className={cn(t.mine && "bg-primary/5")}>
                    <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="px-2 py-2">
                      <Link
                        href={`/nba/league/${t.team.id}`}
                        className={cn(
                          "break-words hover:underline",
                          t.mine && "font-semibold text-primary",
                        )}
                      >
                        {t.team.name}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-right">
                      {t.team.wins}-{t.team.losses}
                    </td>
                    <td className="px-2 py-2 text-right text-muted-foreground">
                      {Math.round(t.team.pointsFor)}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <span className="font-semibold">{Math.round(t.perWeek)}</span>{" "}
                      <span className="text-xs text-muted-foreground">
                        #{v.power.get(t.team.id)}
                      </span>
                    </td>
                    {shown && (
                      <>
                        <td className="px-2 py-2 text-right">{r ? r.expWins.toFixed(1) : "—"}</td>
                        <td className="px-2 py-2">
                          {r && (
                            <div className="flex items-center gap-2">
                              <ProbBar value={r.playoffs} tone="info" />
                              <span className="w-9 text-right">{pct(r.playoffs)}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">{r ? pct(r.seed1) : "—"}</td>
                        <td className="px-2 py-2 text-right">{r ? pct(r.final) : "—"}</td>
                        <td className="px-2 py-2">
                          {r && (
                            <div className="flex items-center gap-2">
                              <ProbBar value={r.champ / maxTitle} />
                              <span className="w-9 text-right font-semibold">{pct(r.champ)}</span>
                            </div>
                          )}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2 text-right",
                            r && r.act < 0.4 ? "text-danger" : "text-muted-foreground",
                          )}
                        >
                          {r ? `${Math.round(r.act * 100)}%` : "—"}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-1 text-xs text-muted-foreground">
          PF = points scored. Pts/wk = projected starting-lineup points per regular-season week from
          today (each day&apos;s best lineup from the players with a game); # is its power rank.
          Average strength: {fmtPts(v.teams.reduce((a, t) => a + t.perWeek, 0) / v.teams.length)}{" "}
          pts/wk.
          {shown &&
            " Odds: a Monte Carlo of the rest of the season on the real NBA and league schedules (daily lineups, streaky injuries, form swings, and each manager's lineup and waiver habits). 6-team playoffs in weeks 20-22; completed weeks keep their real results. Active = share of days the manager sets a lineup. Title bars are scaled to the favorite."}
        </p>
      </section>
    </>
  );
}

function TeamCard({
  rank,
  id,
  name,
  mine,
  record,
  pf,
  perWeek,
  power,
  odds,
}: {
  rank: number;
  id: number;
  name: string;
  mine: boolean;
  record: string;
  pf: number;
  perWeek: number;
  power: number;
  odds: OutlookTeam | null;
}) {
  return (
    <Link
      href={`/nba/league/${id}`}
      className={cn("flex items-center gap-3 px-3 py-3 hover:bg-muted/50", mine && "bg-primary/5")}
    >
      <span className="w-5 text-center text-sm text-muted-foreground tabular-nums">{rank}</span>
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm break-words", mine && "font-semibold text-primary")}>
          {name}
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
          <span className="font-medium text-foreground">{record}</span>
          {[
            `${Math.round(pf)} PF`,
            `${Math.round(perWeek)} pts/wk (#${power})`,
            ...(odds
              ? [
                  `${odds.expWins.toFixed(1)} exp W`,
                  `playoffs ${pct(odds.playoffs)}`,
                  `${Math.round(odds.act * 100)}% active`,
                ]
              : []),
          ].map((x) => ` · ${x}`)}
        </div>
        {odds && <ProbBar value={odds.playoffs} tone="info" className="mt-1.5" />}
      </div>
      {odds && (
        <div className="w-14 text-right">
          <div className="text-lg font-semibold tabular-nums">{pct(odds.champ)}</div>
          <div className="text-[10px] text-muted-foreground">title</div>
        </div>
      )}
    </Link>
  );
}
