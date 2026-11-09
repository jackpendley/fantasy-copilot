// League (with the season outlook, which used to be its own page): your title, playoff and
// #1-seed odds, what changed since the last simulation, your odds over time, then one table of
// every team's standing, strength and odds.

import { Suspense } from "react";
import Link from "next/link";
import { ImpactfulMoves } from "@/components/fc/move-history";
import { mostImpactfulMoves } from "@/lib/nba/move-history";
import { ArrowLeftRight, RefreshCw } from "lucide-react";
import { PageHeader, SectionTitle, StatTile } from "@/components/fc/bits";
import { StandingsTable, type StandingsRow } from "@/components/fc/standings-table";
import { WhatChanged } from "@/components/fc/what-changed";
import { LiveRefresh } from "@/components/live-refresh";
import { OddsChart } from "@/components/odds-chart";
import { nowMs } from "@/lib/nba/calendar";
import { minimalOn } from "@/lib/cpu-saver";
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
  othersWithinMinutes,
  refreshIfStale,
  outlookRunning,
  recentLeagueMoves,
} from "@/lib/nba/outlook-refresh";
import {
  latestOutlooks,
  outlookHistory,
  provisionalOutlook,
  type OutlookTeam,
} from "@/lib/nba/outlook-run";
import { STANDINGS_SORTS, type StandingsSort } from "@/lib/standings";

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
  // A roster move newer than the latest run: queue it for the worker (another team's move waits
  // up to othersWithinMinutes(); later moves ride along with the next run).
  const newest = leagueMoves.at(-1)?.at ?? null;
  const lastAt = latest?.run_at.getTime() ?? null;
  const stale = isStale(newest, lastAt);
  // A visit counts as another team's move (Jack's own are checked as soon as they're seen).
  const state = running ? "running" : await refreshIfStale(newest, lastAt, Date.now(), false);
  const due = state === "refreshing" || state === "queued";
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
    updating: due || running || provisional != null,
    /** A newer move that the next run (within othersWithinMinutes()) will include. */
    waiting: stale && !due && !running && provisional == null,
  };
}

export default async function LeaguePage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort: sortParam } = await searchParams;
  const sort = STANDINGS_SORTS.includes(sortParam as StandingsSort)
    ? (sortParam as StandingsSort)
    : "rank";
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
  const rows: StandingsRow[] = standings.map((t, i) => {
    const r = odds.get(t.team.id);
    return {
      id: t.team.id,
      rank: i + 1,
      name: t.team.name,
      mine: t.mine,
      wins: t.team.wins,
      losses: t.team.losses,
      pf: t.team.pointsFor,
      perWeek: t.perWeek,
      power: v.power.get(t.team.id)!,
      odds: r
        ? {
            expWins: r.expWins,
            playoffs: r.playoffs,
            seed1: r.seed1,
            bye: r.bye ?? null,
            final: r.final,
            champ: r.champ,
            act: r.act,
          }
        : null,
    };
  });
  const byeValue = shown ? byeEffect(shown.results, shown.seasons, myId) : null;

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

      {o?.waiting && (
        <p className="rounded-xl border bg-card px-3 py-2.5 text-sm text-muted-foreground">
          {minimalOn()
            ? "A newer roster move isn't in these odds yet: tonight's update includes it."
            : `A newer roster move isn't in these odds yet: the next update (within ${
                othersWithinMinutes() >= 120
                  ? `${othersWithinMinutes() / 60} hours)`
                  : `${othersWithinMinutes()} minutes)`
              } includes it.`}
        </p>
      )}

      {o?.updating && (
        <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm">
          <RefreshCw className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
          <span>
            {o.provisional
              ? `Refining with the latest rosters: ${o.provisional.seasons.toLocaleString("en-US")} seasons so far. These odds are provisional and update every few seconds.`
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
          {me.bye != null ? (
            <StatTile
              label="First-round bye"
              value={pct(me.bye)}
              delta={delta(me.bye, before?.bye)}
              sub={`#1 seed ${pct(me.seed1)}`}
            />
          ) : (
            <StatTile
              label="#1 seed"
              value={pct(me.seed1)}
              delta={delta(me.seed1, before?.seed1)}
            />
          )}
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

      {byeValue && (
        <section className="space-y-1.5">
          <SectionTitle aside={`${byeValue.seasons.toLocaleString("en-US")} simulated seasons`}>
            What a bye is worth
          </SectionTitle>
          <div className="rounded-xl border bg-card px-3 py-2.5 text-sm">
            <p>
              Across the league, a team with a first-round bye wins the title{" "}
              <span className="font-semibold">{pct(byeValue.league.withBye)}</span> of the time; a
              3-6 seed wins it <span className="font-semibold">{pct(byeValue.league.without)}</span>
              {byeValue.league.without > 0 && (
                <> ({(byeValue.league.withBye / byeValue.league.without).toFixed(1)}× as often)</>
              )}
              .
            </p>
            {byeValue.mine && (
              <p className="mt-1 text-muted-foreground">
                For you: {pct(byeValue.mine.withBye)} with a bye, {pct(byeValue.mine.without)}{" "}
                without (as a 3-6 seed). With your {pct(byeValue.mine.bye)} chance of a bye, it
                accounts for {pct(byeValue.mine.shareOfTitle)} of your title odds.
              </p>
            )}
          </div>
        </section>
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
            <OddsChart points={o.history} now={nowMs()} />
          </div>
        </section>
      )}

      <Suspense fallback={null}>
        <ImpactfulMoves
          moves={mostImpactfulMoves(v.sp)}
          teams={v.teams.map((t) => ({ id: t.team.id, name: t.team.name, mine: t.mine }))}
        />
      </Suspense>

      <section className="space-y-1.5">
        <SectionTitle aside="Tap a team for its roster">Standings</SectionTitle>

        <StandingsTable rows={rows} initialSort={sort} showOdds={!!shown} />
        <p className="px-1 text-xs text-muted-foreground">
          PF = points scored. Pts/wk = projected starting-lineup points per regular-season week from
          today (each day&apos;s best lineup from the players with a game); # is its power rank.
          Average strength: {fmtPts(v.teams.reduce((a, t) => a + t.perWeek, 0) / v.teams.length)}{" "}
          pts/wk.
          {shown &&
            " Odds: a Monte Carlo of the rest of the season on the real NBA and league schedules (daily lineups, streaky injuries, form swings, and each manager's lineup and waiver habits). 6-team playoffs in weeks 20-22; completed weeks keep their real results. Active = the share of days the simulation expects the manager to set a lineup, from this season's lineup moves (last season's only when the same ESPN owner returns; a new owner starts at 70%). Bye = a top-2 seed, which skips the first playoff round. Title bars are scaled to the favorite. Tap a column to sort; tap again to flip."}
        </p>
      </section>
    </>
  );
}

/**
 * Title odds with a first-round bye vs as a 3-6 seed, league-wide and for one team (shown only
 * when each side has at least 200 of the simulated seasons behind it). Null on runs from before
 * byes were counted.
 */
function byeEffect(results: OutlookTeam[], seasons: number, myId: number) {
  if (results.some((r) => r.bye == null || r.champBye == null)) return null;
  const champBye = results.reduce((a, r) => a + r.champBye!, 0);
  // Two byes and four other playoff spots a season; every title goes to one of them.
  const league = { withBye: champBye / 2, without: (1 - champBye) / 4 };
  const me = results.find((r) => r.teamId === myId);
  const enough = (share: number) => share * seasons >= 200;
  const mine =
    me && enough(me.bye!) && enough(me.playoffs - me.bye!)
      ? {
          bye: me.bye!,
          withBye: me.champBye! / me.bye!,
          without: (me.champ - me.champBye!) / (me.playoffs - me.bye!),
          shareOfTitle: me.champ > 0 ? me.champBye! / me.champ : 0,
        }
      : null;
  return { seasons, league, mine };
}
