import { PageHeader, SectionTitle } from "@/components/fc/bits";
import { PlayerRow } from "@/components/fc/player-row";
import { LiveRefresh } from "@/components/live-refresh";
import { WinChart } from "@/components/win-chart";
import { PlayerAvatar } from "@/components/fc/player-avatar";
import { Pill, StatusPill } from "@/components/fc/status-pill";
import { TeamLogo } from "@/components/fc/team-logo";
import { ErrorNotice, SetupNotice } from "@/components/setup-notice";
import {
  LAST_SCORING_PERIOD,
  dateForScoringPeriod,
  etDate,
  matchupPeriodOf,
  scoringPeriodForDate,
  scoringPeriodsOf,
  shortDay,
} from "@/lib/nba/calendar";
import { loadLeague, loadLiveRosters } from "@/lib/nba/data";
import { dbConfigured } from "@/lib/db";
import { liveRows, sortLive, type LiveRow } from "@/lib/nba/live";
import { matchupHistory } from "@/lib/nba/matchup-snapshots";
import { SetupError } from "@/lib/env";
import { fmtPts } from "@/lib/format";
import { matchupView } from "@/lib/nba/matchup";
import { cn } from "@/lib/utils";
import { PRO_TEAM_BY_ID } from "@fantasy-copilot/espn";

const STARTING_SLOTS = 9;

/** One side's players today: who's starting, live fantasy points, and what's still to come. */
function TodaySide({ title, rows }: { title: string; rows: LiveRow[] }) {
  const starters = sortLive(rows.filter((r) => r.starting));
  const benchPts = rows.filter((r) => !r.starting).reduce((a, r) => a + r.points, 0);
  const pts = starters.reduce((a, r) => a + r.points, 0);
  const toCome = starters.reduce((a, r) => a + r.toCome, 0);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between px-1 text-xs">
        <span className="truncate font-medium">{title}</span>
        <span className="text-muted-foreground tabular-nums">
          <span className="font-semibold text-foreground">{fmtPts(pts)}</span> today
          {toCome > 0.05 && <> · +{fmtPts(toCome)} to come</>}
        </span>
      </div>
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {starters.map((r) => (
          <PlayerRow key={r.row.player.id} row={r.row} live={r} showMoves={false} />
        ))}
        {benchPts !== 0 && (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            Bench and IR scored {fmtPts(benchPts)} (not counted)
          </div>
        )}
      </div>
    </div>
  );
}

function Side({
  label,
  name,
  banked,
  remaining,
  align,
}: {
  label: string;
  name: string;
  banked: number;
  remaining: number;
  align: "left" | "right";
}) {
  return (
    <div className={cn("min-w-0", align === "right" && "text-right")}>
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="truncate text-sm font-medium">{name}</div>
      <div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
        {fmtPts(banked + remaining)}
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">
        {fmtPts(banked)} scored · {fmtPts(remaining)} to come
      </div>
    </div>
  );
}

export default async function WeekPage() {
  const today = etDate();
  const sp = Math.min(Math.max(scoringPeriodForDate(today), 1), LAST_SCORING_PERIOD);
  const mp = matchupPeriodOf(sp);
  const periods = scoringPeriodsOf(mp);

  let data;
  try {
    data = await loadLeague(sp, today);
  } catch (e) {
    if (e instanceof SetupError) return <SetupNotice message={e.message} />;
    return <ErrorNotice title="Couldn't load the league" message={(e as Error).message} />;
  }

  const { opp, myBanked, oppBanked, myToday, oppToday, mine, theirs, pWin } = matchupView(data, sp);
  const [live, history] = await Promise.all([
    loadLiveRosters(sp, mp).catch(() => null),
    dbConfigured() ? matchupHistory(mp).catch(() => []) : Promise.resolve([]),
  ]);
  const myLive = liveRows(myToday, live?.get(data.me.id), data.scoreboard);
  const oppLive = opp && oppToday ? liveRows(oppToday, live?.get(opp.id), data.scoreboard) : null;
  const playing = (rows: LiveRow[] | null) => (rows ?? []).some((r) => r.starting && r.row.game);
  const gamesLive = [...myLive, ...(oppLive ?? [])].some((r) => r.row.game?.state === "in");
  // Snapshots are taken before each day's games; "Now" is added once today's games start.
  const started = [...myLive, ...(oppLive ?? [])].some(
    (r) => r.row.game && r.row.game.state !== "pre",
  );
  const winPoints = [
    ...history.map((h) => ({
      label: shortDay(dateForScoringPeriod(h.scoring_period)).split(" ")[0]!,
      pWin: h.p_win,
    })),
    ...(pWin != null && started ? [{ label: "Now", pWin }] : []),
  ];

  const days = periods.map((p) => ({ sp: p, date: dateForScoringPeriod(p) }));
  const opponentOf = (proTeamId: number, p: number) => {
    const g = data.games.find(
      (x) =>
        x.scoringPeriodId === p && (x.homeProTeamId === proTeamId || x.awayProTeamId === proTeamId),
    );
    if (!g) return null;
    const home = g.homeProTeamId === proTeamId;
    return { abbr: PRO_TEAM_BY_ID[home ? g.awayProTeamId : g.homeProTeamId] ?? "?", home };
  };
  const statusOf = new Map(data.injuries.map((i) => [i.playerId, i]));
  const starts = (id: number) => [...mine.startsByDay.values()].filter((s) => s.has(id)).length;
  const rows = [...data.me.roster].sort((a, b) => starts(b.id) - starts(a.id));
  const totalStarts = [...mine.startsByDay.values()].reduce((a, s) => a + s.size, 0);

  return (
    <>
      <PageHeader
        title={`Week ${mp}`}
        subtitle={`${shortDay(days[0]!.date)} – ${shortDay(days.at(-1)!.date)}${opp ? "" : " · no matchup (bye week)"}`}
      />

      {opp && theirs && pWin != null && (
        <div className="rounded-xl border bg-card p-4 sm:p-5">
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
            <Side
              label="You"
              name={data.me.name}
              banked={myBanked}
              remaining={mine.remaining}
              align="left"
            />
            <div className="pb-2 text-xs font-semibold text-muted-foreground">VS</div>
            <Side
              label="Opponent"
              name={opp.name}
              banked={oppBanked}
              remaining={theirs.remaining}
              align="right"
            />
          </div>
          {gamesLive && (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Pill tone="success">Live</Pill>
              Updates every minute while games are on.
            </div>
          )}
          <div className="mt-4">
            <div className="mb-1.5 flex justify-between text-xs font-semibold tabular-nums">
              <span className="text-primary">{Math.round(pWin * 100)}% to win</span>
              <span className="text-muted-foreground">{Math.round((1 - pWin) * 100)}%</span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-muted">
              <div className="bg-primary" style={{ width: `${pWin * 100}%` }} />
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Assumes both teams set their best lineup every day; the win chance uses 2025-26 weekly
            volatility.
          </p>
        </div>
      )}

      <LiveRefresh active={gamesLive} />

      {opp && oppLive && (playing(myLive) || playing(oppLive)) && (
        <section className="space-y-1.5">
          <SectionTitle aside="ESPN fantasy points; + is projected still to come">
            Today
          </SectionTitle>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <TodaySide title={data.me.name} rows={myLive} />
            <TodaySide title={opp.name} rows={oppLive} />
          </div>
        </section>
      )}

      {winPoints.length > 1 && (
        <section className="space-y-1.5">
          <SectionTitle aside="Before each day's games, then live">
            Win chance this week
          </SectionTitle>
          <div className="rounded-xl border bg-card p-3">
            <WinChart points={winPoints} />
          </div>
        </section>
      )}

      <section className="space-y-1.5">
        <SectionTitle aside={`${totalStarts} projected starts`}>Starts by day</SectionTitle>
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
        >
          {days.map((d) => {
            const past = d.sp < sp;
            const games = mine.gamesByDay.get(d.sp)?.size ?? 0;
            const s = mine.startsByDay.get(d.sp)?.size ?? 0;
            const crunch = games > STARTING_SLOTS;
            const open = !past && s < STARTING_SLOTS;
            return (
              <div
                key={d.sp}
                className={cn(
                  "rounded-lg border bg-card px-1 py-2 text-center",
                  d.sp === sp && "ring-2 ring-primary",
                  past && "opacity-45",
                )}
              >
                <div className="text-[11px] font-medium text-muted-foreground">
                  {shortDay(d.date).split(" ")[0]}
                </div>
                <div className="text-lg font-semibold tabular-nums">{past ? "–" : s}</div>
                {theirs && !past && (
                  <div className="text-[10px] text-muted-foreground tabular-nums">
                    opp {theirs.startsByDay.get(d.sp)?.size ?? 0}
                  </div>
                )}
                <div
                  className={cn(
                    "text-[10px] font-medium",
                    crunch ? "text-warning" : open ? "text-info" : "text-muted-foreground",
                  )}
                >
                  {past
                    ? ""
                    : crunch
                      ? `${games - STARTING_SLOTS} sit`
                      : open
                        ? `${STARTING_SLOTS - s} open`
                        : "full"}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-1.5">
        <SectionTitle>Your schedule</SectionTitle>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium">
                  Player
                </th>
                {days.map((d) => (
                  <th
                    key={d.sp}
                    className={cn(
                      "px-1 py-2 text-center font-medium",
                      d.sp === sp && "text-primary",
                    )}
                  >
                    {shortDay(d.date).split(" ")[0]}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">Starts</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="sticky left-0 z-10 bg-card px-3 py-2">
                    <div className="flex items-center gap-2">
                      <PlayerAvatar id={p.id} name={p.name} size={28} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="max-w-32 truncate font-medium sm:max-w-none">
                            {p.name}
                          </span>
                          <StatusPill
                            status={statusOf.get(p.id)?.status ?? p.injuryStatus ?? "ACTIVE"}
                          />
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {p.positions.join("/")}
                        </div>
                      </div>
                    </div>
                  </td>
                  {days.map((d) => {
                    const o = opponentOf(p.proTeamId, d.sp);
                    const starting = mine.startsByDay.get(d.sp)?.has(p.id);
                    const past = d.sp < sp;
                    return (
                      <td
                        key={d.sp}
                        className={cn("px-1 py-1.5 text-center", past && "opacity-40")}
                      >
                        {o && (
                          <span
                            className={cn(
                              "inline-flex flex-col items-center gap-0.5 rounded-md px-1 py-0.5 text-[10px] font-medium",
                              starting ? "bg-primary/15 text-foreground" : "text-muted-foreground",
                            )}
                          >
                            <TeamLogo abbr={o.abbr} size={16} />
                            {o.home ? "" : "@"}
                            {o.abbr}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {starts(p.id)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-1 text-xs text-muted-foreground">
          Highlighted = projected to start. “Sit” days have more of your players playing than slots;
          “open” days have empty slots a streamer could fill.
        </p>
      </section>
    </>
  );
}
