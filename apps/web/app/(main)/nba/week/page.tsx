import { PageHeader, SectionTitle } from "@/components/fc/bits";
import { MatchupDays, type MatchupDay } from "@/components/fc/matchup-days";
import { PendingMovesNote } from "@/components/fc/pending-moves";
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
import {
  cellFromFinal,
  cellFromLive,
  cellsAhead,
  dayTotal,
  gameOn,
  pairBySlot,
  startingSlots,
  type Placed,
} from "@/lib/nba/h2h";
import { liveRows } from "@/lib/nba/live";
import { absences, returnLabel } from "@/lib/nba/availability";
import { perGameProjection } from "@/lib/nba/projection";
import { matchupHistory } from "@/lib/nba/matchup-snapshots";
import { SetupError } from "@/lib/env";
import { fmtPts, fmtTip } from "@/lib/format";
import { matchupView } from "@/lib/nba/matchup";
import { winChanceLabel } from "@/lib/nba/week";
import { cn } from "@/lib/utils";
import { PRO_TEAM_BY_ID } from "@fantasy-copilot/espn";

const STARTING_SLOTS = 9;

/** The score at the top: points so far (big), projected finals, and the win chance. */
function Scoreboard({
  me,
  opp,
  myBanked,
  oppBanked,
  myFinal,
  oppFinal,
  pWin,
  live,
  decided,
}: {
  me: string;
  opp: string;
  myBanked: number;
  oppBanked: number;
  myFinal: number;
  oppFinal: number;
  pWin: number;
  live: boolean;
  /** Nothing left to play this week. */
  decided: boolean;
}) {
  const side = (name: string, pts: number, final: number, right: boolean) => (
    <div className={cn("min-w-0", right && "text-right")}>
      <div className="truncate text-xs font-medium text-muted-foreground sm:text-sm">{name}</div>
      <div className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
        {fmtPts(pts)}
      </div>
      <div className="text-xs text-muted-foreground tabular-nums sm:text-sm">
        proj {fmtPts(final)}
      </div>
    </div>
  );
  return (
    <div className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        {side(me, myBanked, myFinal, false)}
        <div className="flex flex-col items-center gap-1">
          <span className="text-xs font-semibold text-muted-foreground">VS</span>
          {live && <Pill tone="success">Live</Pill>}
        </div>
        {side(opp, oppBanked, oppFinal, true)}
      </div>
      <div className="mt-4">
        <div className="mb-1.5 flex justify-between text-xs font-semibold tabular-nums sm:text-sm">
          <span className="text-primary">{winChanceLabel(pWin, decided)} to win</span>
          <span className="text-muted-foreground">{winChanceLabel(1 - pWin, decided)}</span>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
          <div className="bg-primary" style={{ width: `${pWin * 100}%` }} />
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Big numbers are points so far{live ? " (updating every minute)" : ""}. Projected finals
        assume both teams set their best lineup every day; the win chance uses 2025-26 weekly
        volatility.
      </p>
    </div>
  );
}

export default async function WeekPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
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

  const {
    opp,
    myBanked,
    oppBanked,
    myToday,
    oppToday,
    mine,
    theirs,
    pWin,
    myPending,
    oppPending,
    myWeekRoster,
  } = matchupView(data, sp);
  const [live, history] = await Promise.all([
    loadLiveRosters(sp, mp).catch(() => null),
    dbConfigured() ? matchupHistory(mp).catch(() => []) : Promise.resolve([]),
  ]);
  const myLive = liveRows(myToday, live?.get(data.me.id), data.scoreboard);
  const oppLive = opp && oppToday ? liveRows(oppToday, live?.get(opp.id), data.scoreboard) : null;
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

  // Every day of the week head to head, rendered together so switching days is instant:
  // past days from ESPN's finals, today live, days ahead projected. ?day= picks the first one.
  const { day: dayParam } = await searchParams;
  const initialDay = periods.includes(Number(dayParam)) ? Number(dayParam) : sp;
  const statusOf = new Map(data.injuries.map((i) => [i.playerId, i]));
  const statusFor = (p: { id: number; injuryStatus?: string | null }) =>
    statusOf.get(p.id)?.status ?? p.injuryStatus ?? "ACTIVE";
  const oppAhead = opp ? data.ahead.teams.find((t) => t.id === opp.id) : undefined;
  const people = new Map(
    [...data.teams, ...data.ahead.teams].flatMap((t) => t.roster).map((p) => [p.id, p]),
  );
  const pastFinals = new Map(
    await Promise.all(
      periods
        .filter((d) => d < sp)
        .map(async (d) => [d, await loadLiveRosters(d, mp).catch(() => null)] as const),
    ),
  );
  // Ruled-out players: out until ESPN's estimated return, then back.
  const out = absences([...data.ahead.me.roster, ...(oppAhead?.roster ?? [])], data.injuries, sp);
  const slots = startingSlots(data.settings.slotCounts);
  const labeled = (placed: Placed[]): Placed[] =>
    placed.map((x) =>
      x.cell.game
        ? {
            ...x,
            cell: {
              ...x.cell,
              game: {
                ...x.cell.game,
                when:
                  x.cell.game.state === "pre"
                    ? fmtTip(x.cell.game.tip)
                    : x.cell.game.state === "post"
                      ? "Final"
                      : x.cell.game.detail || "Live",
              },
            },
          }
        : x,
    );
  const placedFor = (day: number): [Placed[], Placed[]] => {
    if (day === sp) return [myLive.map(cellFromLive), (oppLive ?? []).map(cellFromLive)];
    if (day < sp) {
      const past = pastFinals.get(day);
      const final = (teamId: number) =>
        (past?.get(teamId) ?? []).map((e) => {
          const p = people.get(e.playerId);
          return cellFromFinal(
            e,
            p,
            p ? gameOn(data.games, p.proTeamId, day, "post") : null,
            p ? perGameProjection(p, day).fppg : 0,
          );
        });
      return [final(data.me.id), opp ? final(opp.id) : []];
    }
    const outThatDay = (p: { id: number }) => (out.get(p.id)?.outUntil ?? 0) > day;
    const projAhead = (p: Parameters<typeof perGameProjection>[0]) =>
      outThatDay(p) ? 0 : perGameProjection(p, sp).fppg;
    const statusAhead = (p: Parameters<typeof perGameProjection>[0]) =>
      outThatDay(p) ? "OUT" : out.has(p.id) ? "ACTIVE" : statusFor(p);
    const backAhead = (p: { id: number }) => {
      const a = out.get(p.id);
      return a && outThatDay(p) ? returnLabel(a) : null;
    };
    const ahead = (roster: typeof data.me.roster, slotOf: Map<number, string> | undefined) =>
      cellsAhead(roster, slotOf, data.games, day, projAhead, statusAhead, backAhead, slots);
    return [
      ahead(data.ahead.me.roster, mine.slotsByDay.get(day)),
      oppAhead && theirs ? ahead(oppAhead.roster, theirs.slotsByDay.get(day)) : [],
    ];
  };
  const matchup = data.matchups.find(
    (m) => m.period === mp && (m.homeTeamId === data.me.id || m.awayTeamId === data.me.id),
  );
  const iAmHome = matchup?.homeTeamId === data.me.id;
  const dayBoards: MatchupDay[] = days.map((d) => {
    const [minePlaced, theirsPlaced] = placedFor(d.sp);
    const b = pairBySlot(slots, labeled(minePlaced), labeled(theirsPlaced));
    const ahead = d.sp > sp;
    const totals = {
      mine: dayTotal(b.rows, "mine", ahead),
      theirs: dayTotal(b.rows, "theirs", ahead),
    };
    // Tab scores: ESPN's per-day totals for past days, live today, projected ahead.
    const by = (home: boolean) =>
      (home ? matchup?.homeByPeriod : matchup?.awayByPeriod)?.[d.sp] ?? 0;
    const score =
      d.sp > sp
        ? {
            mine: mine.projectedByDay.get(d.sp) ?? 0,
            theirs: theirs?.projectedByDay.get(d.sp) ?? 0,
          }
        : d.sp === sp
          ? totals
          : { mine: by(iAmHome), theirs: by(!iAmHome) };
    return {
      sp: d.sp,
      label: d.sp === sp ? "Today" : shortDay(d.date).split(" ")[0]!,
      today: d.sp === sp,
      score,
      board: { ...b, totals, ahead },
      note:
        d.sp < sp
          ? "Final ESPN fantasy points in each slot. Under the points: his pregame projection, with ▲/▼ when he finished well above or below it."
          : d.sp > sp
            ? "Projected lineups (the best lineup each team can set that day), from rosters after pending moves. The number in each slot is his projection."
            : "ESPN fantasy points in each slot. Under the points: his projection (live: points so far plus the rest of his projection). ▲/▼ = 5+ points and 20%+ off. Tap a player for his card.",
    };
  });
  const opponentOf = (proTeamId: number, p: number) => {
    const g = data.games.find(
      (x) =>
        x.scoringPeriodId === p && (x.homeProTeamId === proTeamId || x.awayProTeamId === proTeamId),
    );
    if (!g) return null;
    const home = g.homeProTeamId === proTeamId;
    return { abbr: PRO_TEAM_BY_ID[home ? g.awayProTeamId : g.homeProTeamId] ?? "?", home };
  };
  const starts = (id: number) => [...mine.startsByDay.values()].filter((s) => s.has(id)).length;
  // Everyone who plays for you this week, including moves that take effect tomorrow.
  const rows = [...myWeekRoster].sort((a, b) => starts(b.id) - starts(a.id));
  const totalStarts = [...mine.startsByDay.values()].reduce((a, s) => a + s.size, 0);

  return (
    <>
      <PageHeader
        title={`Week ${mp}`}
        subtitle={`${shortDay(days[0]!.date)} – ${shortDay(days.at(-1)!.date)}${opp ? "" : " · no matchup (bye week)"}`}
      />

      {opp && theirs && pWin != null && (
        <Scoreboard
          me={data.me.name}
          opp={opp.name}
          myBanked={myBanked}
          oppBanked={oppBanked}
          myFinal={myBanked + mine.remaining}
          oppFinal={oppBanked + theirs.remaining}
          pWin={pWin}
          live={gamesLive}
          decided={mine.remaining + theirs.remaining < 0.5}
        />
      )}

      <PendingMovesNote mine={myPending} theirs={oppPending} opponent={opp?.name} />

      <LiveRefresh active={gamesLive} />

      {opp && (
        <MatchupDays
          days={dayBoards}
          initial={initialDay}
          benchSlots={data.settings.slotCounts.BE ?? 0}
          irSlots={data.settings.slotCounts.IR ?? 0}
        />
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
