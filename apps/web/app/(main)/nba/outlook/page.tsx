import { after } from "next/server";
import { RefreshCw } from "lucide-react";
import { PageHeader, ProbBar, SectionTitle, StatTile } from "@/components/fc/bits";
import { LiveRefresh } from "@/components/live-refresh";
import { OddsChart } from "@/components/odds-chart";
import { RunOutlook } from "@/components/run-outlook";
import { ErrorNotice } from "@/components/setup-notice";
import { dbConfigured } from "@/lib/db";
import { DISPLAY_TZ } from "@/lib/env";
import { fmtTip } from "@/lib/format";
import { dateForScoringPeriod, shortDay } from "@/lib/nba/calendar";
import { leagueMovesBetween, type TeamMove } from "@/lib/nba/changes";
import {
  isStale,
  outlookRunning,
  recentLeagueMoves,
  refreshLogged,
} from "@/lib/nba/outlook-refresh";
import { latestOutlooks, outlookHistory, type OutlookTeam } from "@/lib/nba/outlook-run";
import { cn } from "@/lib/utils";

// A visit can start a re-run in the background (after the response), which takes ~30 s.
export const maxDuration = 120;

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
const pts = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString("en-US")}`;
const names = (ps: { name: string }[]) => ps.map((p) => p.name).join(", ");

function MoveLine({ m }: { m: TeamMove }) {
  const verb =
    m.type === "TRADE" ? (
      <>
        traded {names(m.drops)} for {names(m.adds)}
      </>
    ) : (
      <>
        {m.adds.length > 0 && <>added {names(m.adds)}</>}
        {m.adds.length > 0 && m.drops.length > 0 && ", "}
        {m.drops.length > 0 && <>dropped {names(m.drops)}</>}
      </>
    );
  return (
    <li className="text-xs text-muted-foreground">
      {verb}{" "}
      <span className={cn("tabular-nums", m.net > 0 ? "text-success" : m.net < 0 && "text-danger")}>
        ({pts(m.net)} rest-of-season pts)
      </span>
    </li>
  );
}

/** Teams whose odds moved, next to the roster moves behind them. */
function WhatChanged({
  latest,
  previous,
  moves,
  myId,
}: {
  latest: OutlookTeam[];
  previous: OutlookTeam[];
  moves: TeamMove[] | null;
  myId: number;
}) {
  const before = new Map(previous.map((t) => [t.teamId, t]));
  const rows = latest
    .map((t) => ({
      t,
      d: t.champ - (before.get(t.teamId)?.champ ?? t.champ),
      dp: t.playoffs - (before.get(t.teamId)?.playoffs ?? t.playoffs),
      moves: (moves ?? []).filter((m) => m.teamId === t.teamId),
    }))
    .filter((r) => r.moves.length > 0 || Math.abs(r.d) >= 0.01)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  if (!rows.length) {
    return (
      <p className="rounded-xl border bg-card px-3 py-3 text-sm text-muted-foreground">
        No team&apos;s title odds moved a full point, and no rosters changed.
      </p>
    );
  }
  return (
    <div className="divide-y overflow-hidden rounded-xl border bg-card">
      {rows.map(({ t, d, dp, moves: ms }) => (
        <div key={t.teamId} className="px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span
              className={cn("truncate text-sm font-medium", t.teamId === myId && "text-primary")}
            >
              {t.name}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              title {pct(before.get(t.teamId)?.champ ?? t.champ)} → {pct(t.champ)}{" "}
              <span
                className={cn("font-semibold", d > 0 ? "text-success" : d < 0 && "text-danger")}
              >
                ({d >= 0 ? "+" : ""}
                {Math.round(d * 100)})
              </span>
              <span className="hidden sm:inline">
                {" "}
                · playoffs {dp >= 0 ? "+" : ""}
                {Math.round(dp * 100)}
              </span>
            </span>
          </div>
          {ms.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {ms.map((m) => (
                <MoveLine key={`${m.at}-${m.adds.join()}-${m.drops.join()}`} m={m} />
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

export default async function OutlookPage() {
  if (!dbConfigured()) {
    return <ErrorNotice title="Outlook needs the database" message="Set DATABASE_URL." />;
  }
  const myId = Number(process.env.ESPN_TEAM_ID);
  const [runs, history, leagueMoves, running] = await Promise.all([
    latestOutlooks(),
    outlookHistory(myId),
    recentLeagueMoves().catch(() => []),
    outlookRunning(),
  ]);
  const [latest, previous] = runs;
  // A roster move newer than the latest run: update now, in the background.
  const stale = isStale(leagueMoves.at(-1)?.at ?? null, latest?.run_at.getTime() ?? null);
  if (stale && !running) after(() => refreshLogged());
  const updating = stale || running;
  const me = latest?.results.find((t) => t.teamId === myId);
  const before = previous?.results.find((t) => t.teamId === myId);
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

  return (
    <>
      <PageHeader
        title="Season outlook"
        subtitle={
          latest
            ? `${latest.seasons.toLocaleString("en-US")} simulated seasons from ${shortDay(dateForScoringPeriod(latest.scoring_period))} · updated ${when(latest.run_at)}${latest.trigger ? ` after: ${latest.trigger}` : ""}`
            : "No simulation yet. Run one to get your odds."
        }
      >
        <RunOutlook />
      </PageHeader>

      {updating && (
        <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm">
          <RefreshCw className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
          <span>
            Updating for the latest roster move. This page refreshes itself when it&apos;s done
            (about 30 seconds).
          </span>
          <LiveRefresh active seconds={10} />
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

      {latest && previous && (
        <section className="space-y-1.5">
          <SectionTitle aside={`since ${when(previous.run_at)}`}>What changed</SectionTitle>
          <WhatChanged
            latest={latest.results}
            previous={previous.results}
            moves={moves}
            myId={myId}
          />
          <p className="px-1 text-xs text-muted-foreground">
            Shows teams whose title odds moved a point or more, or who changed their roster. Each
            run plays out {latest.seasons.toLocaleString("en-US")} seasons with the same random
            draws for the same players, so moves mostly reflect real changes (rosters, results,
            projections, injuries). Runs before Oct 21 used 800 seasons and could swing ±3-4 points
            from chance alone.
          </p>
        </section>
      )}

      {history.length > 1 && (
        <section className="space-y-1.5">
          <SectionTitle>Your odds over time</SectionTitle>
          <div className="rounded-xl border bg-card p-3 sm:p-4">
            <OddsChart points={history} />
          </div>
        </section>
      )}

      {latest && (
        <section className="space-y-1.5">
          <SectionTitle aside="Active = share of days the manager sets a lineup">
            League
          </SectionTitle>

          {/* Phones: ranked cards. */}
          <div className="divide-y overflow-hidden rounded-xl border bg-card md:hidden">
            {latest.results.map((t, i) => (
              <TeamCard key={t.teamId} t={t} rank={i + 1} mine={t.teamId === myId} />
            ))}
          </div>

          {/* Desktop: table with inline odds bars. */}
          <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="w-10 px-3 py-2.5 text-left font-medium">#</th>
                  <th className="px-3 py-2.5 text-left font-medium">Team</th>
                  <th className="px-3 py-2.5 text-right font-medium">Record</th>
                  <th className="px-3 py-2.5 text-right font-medium">Exp. W</th>
                  <th className="w-40 px-3 py-2.5 text-left font-medium">Playoffs</th>
                  <th className="px-3 py-2.5 text-right font-medium">#1</th>
                  <th className="px-3 py-2.5 text-right font-medium">Final</th>
                  <th className="w-40 px-3 py-2.5 text-left font-medium">Title</th>
                  <th className="px-3 py-2.5 text-right font-medium">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {latest.results.map((t, i) => (
                  <tr key={t.teamId} className={cn(t.teamId === myId && "bg-primary/5")}>
                    <td className="px-3 py-2.5 text-muted-foreground tabular-nums">{i + 1}</td>
                    <td
                      className={cn(
                        "max-w-56 truncate px-3 py-2.5",
                        t.teamId === myId && "font-semibold",
                      )}
                    >
                      {t.name}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {t.wins}-{t.losses}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{t.expWins.toFixed(1)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <ProbBar value={t.playoffs} tone="info" />
                        <span className="w-9 text-right tabular-nums">{pct(t.playoffs)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{pct(t.seed1)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{pct(t.final)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <ProbBar
                          value={t.champ / Math.max(...latest.results.map((r) => r.champ))}
                        />
                        <span className="w-9 text-right font-semibold tabular-nums">
                          {pct(t.champ)}
                        </span>
                      </div>
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2.5 text-right tabular-nums",
                        t.act < 0.4 ? "text-danger" : "text-muted-foreground",
                      )}
                    >
                      {Math.round(t.act * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="px-1 text-xs text-muted-foreground">
        Monte Carlo of the rest of the season on the real NBA and league schedules: daily lineups,
        streaky injuries, form swings, and each manager&apos;s lineup and waiver habits (this season
        blended with last season&apos;s for returning owners). 6-team playoffs in weeks 20-22;
        completed weeks keep their real results. Title bars are scaled to the favorite.
      </p>
    </>
  );
}

function TeamCard({ t, rank, mine }: { t: OutlookTeam; rank: number; mine: boolean }) {
  return (
    <div className={cn("flex items-center gap-3 px-3 py-3", mine && "bg-primary/5")}>
      <span className="w-5 text-center text-sm text-muted-foreground tabular-nums">{rank}</span>
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-sm", mine && "font-semibold")}>{t.name}</div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
          <span>
            {t.wins}-{t.losses}
          </span>
          <span>·</span>
          <span>{t.expWins.toFixed(1)} exp W</span>
          <span>·</span>
          <span>PO {pct(t.playoffs)}</span>
          <span className={cn(t.act < 0.4 && "text-danger")}>
            · {Math.round(t.act * 100)}% active
          </span>
        </div>
        <ProbBar value={t.playoffs} tone="info" className="mt-1.5" />
      </div>
      <div className="w-14 text-right">
        <div className="text-lg font-semibold tabular-nums">{pct(t.champ)}</div>
        <div className="text-[10px] text-muted-foreground">title</div>
      </div>
    </div>
  );
}
