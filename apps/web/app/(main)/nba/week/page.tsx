import Link from "next/link";
import { DateNav, PageHeader, SectionTitle } from "@/components/fc/bits";
import { TeamTabs } from "@/components/fc/team-tabs";
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
  matchupPeriodOf,
  scoringPeriodForDate,
  scoringPeriodsOf,
  shortDay,
  gameDate,
} from "@/lib/nba/calendar";
import { loadLeague, loadLiveRosters, loadPlayersById } from "@/lib/nba/data";
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
import { isStarting, liveRows } from "@/lib/nba/live";
import { absences, returnLabel } from "@/lib/nba/availability";
import { perGameProjection } from "@/lib/nba/projection";
import { matchupHistory, matchupStatesHistory } from "@/lib/nba/matchup-snapshots";
import { SetupError } from "@/lib/env";
import { fmtPts, fmtTip } from "@/lib/format";
import { bestPerGame } from "@/lib/nba/best";
import { asTeam, leagueMatchups, matchupView, type LeagueMatchup } from "@/lib/nba/matchup";
import { winChanceLabel } from "@/lib/nba/week";
import { cn } from "@/lib/utils";
import { PRO_TEAM_BY_ID, type FantasyTeam, type RosterPlayer } from "@fantasy-copilot/espn";

const STARTING_SLOTS = 9;

/** The score at the top: points so far (big), projected finals, and the win chance. */
type Mode = "past" | "now" | "later";

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
  mode,
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
  /** A past week shows its final; a later week its projection. */
  mode: Mode;
}) {
  const side = (name: string, pts: number, final: number, right: boolean) => (
    <div className={cn("min-w-0", right && "text-right")}>
      <div className="text-xs font-medium break-words text-muted-foreground sm:text-sm">{name}</div>
      <div className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
        {fmtPts(mode === "later" ? final : pts)}
      </div>
      <div className="text-xs text-muted-foreground tabular-nums sm:text-sm">
        {mode === "now" ? `proj ${fmtPts(final)}` : mode === "past" ? "final" : "projected"}
      </div>
    </div>
  );
  const result = (p: number) => (p > 0.5 ? "Won" : p < 0.5 ? "Lost" : "Tied");
  return (
    <div className="rounded-xl border bg-card p-4 sm:p-5">
      {/* A long team name wraps rather than shrinking; the scores line up along the bottom. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3">
        {side(me, myBanked, myFinal, false)}
        <div className="flex flex-col items-center gap-1 self-center">
          <span className="text-xs font-semibold text-muted-foreground">VS</span>
          {live && <Pill tone="success">Live</Pill>}
        </div>
        {side(opp, oppBanked, oppFinal, true)}
      </div>
      <div className="mt-4">
        <div className="mb-1.5 flex justify-between text-xs font-semibold tabular-nums sm:text-sm">
          <span className="text-primary">
            {mode === "past" ? result(pWin) : `${winChanceLabel(pWin, decided)} to win`}
          </span>
          <span className="text-muted-foreground">
            {mode === "past" ? result(1 - pWin) : winChanceLabel(1 - pWin, decided)}
          </span>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
          <div className="bg-primary" style={{ width: `${pWin * 100}%` }} />
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {mode === "past"
          ? "Final scores."
          : mode === "later"
            ? "Projected from today's rosters: each team's best lineup every day, injured players back from their estimated returns. The win chance uses 2025-26 weekly volatility."
            : `Big numbers are points so far${live ? " (updating every minute)" : ""}. Projected finals assume both teams set their best lineup every day; the win chance uses 2025-26 weekly volatility.`}
      </p>
    </div>
  );
}

/** Every matchup of the week: score (or projection) and win chance; tap one to open it. */
function LeagueStrip({
  matchups,
  names,
  viewed,
  mode,
  href,
  jack,
}: {
  matchups: LeagueMatchup[];
  names: Map<number, string>;
  viewed: number;
  mode: Mode;
  href: (teamId: number) => string;
  /** Jack's team: his matchup always opens from his side. */
  jack: number;
}) {
  // Which side a matchup opens from: Jack's, else the team being viewed, else the home team.
  const side = (m: LeagueMatchup) =>
    [jack, viewed].find((id) => id === m.homeId || id === m.awayId) ?? m.homeId;
  const isOpen = (m: LeagueMatchup) => m.homeId === viewed || m.awayId === viewed;
  const line = (id: number, pts: number, final: number, p: number | null, won: boolean) => (
    <div className="flex items-baseline gap-2">
      <span
        className={cn(
          "min-w-0 flex-1 text-xs leading-tight break-words",
          won ? "font-semibold" : "font-medium",
        )}
      >
        {names.get(id) ?? `Team ${id}`}
      </span>
      <span className="text-xs font-semibold tabular-nums">
        {fmtPts(mode === "later" ? final : pts)}
      </span>
      {mode !== "past" && p != null && (
        <span className="w-8 text-right text-[11px] text-muted-foreground tabular-nums">
          {winChanceLabel(p, false)}
        </span>
      )}
    </div>
  );
  return (
    <section className="space-y-1.5">
      <SectionTitle
        aside={mode === "past" ? "Finals" : mode === "later" ? "Projected" : "Score · win chance"}
      >
        League matchups
      </SectionTitle>
      {/* A swipeable row on phones (the open matchup first), a grid from tablet width. */}
      <div className="-mx-3 flex snap-x gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0">
        {[...matchups]
          .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)))
          .map((m) => {
            const open = isOpen(m);
            const homeWon = mode === "past" && m.home > m.away;
            const awayWon = mode === "past" && m.away > m.home;
            return (
              <Link
                key={m.id}
                href={href(side(m))}
                aria-current={open ? "true" : undefined}
                className={cn(
                  "w-44 shrink-0 snap-start space-y-1 rounded-lg border bg-card px-2.5 py-2 transition-colors sm:w-auto",
                  open ? "border-primary ring-1 ring-primary" : "hover:bg-muted/50",
                )}
              >
                {line(m.homeId, m.home, m.homeFinal, m.pHome, homeWon)}
                {line(m.awayId, m.away, m.awayFinal, m.pHome == null ? null : 1 - m.pHome, awayWon)}
              </Link>
            );
          })}
      </div>
    </section>
  );
}

/** One team's games this week, highlighted where it starts (projected, or actual for a past week). */
function ScheduleTable({
  rows,
  startsByDay,
  days,
  sp,
  dim,
  statusOf,
  opponentOf,
}: {
  rows: RosterPlayer[];
  startsByDay: Map<number, Set<number>>;
  days: { sp: number; date: string }[];
  sp: number;
  /** Fade days already played (this week only). */
  dim: boolean;
  statusOf: (p: RosterPlayer) => string;
  opponentOf: (proTeamId: number, day: number) => { abbr: string; home: boolean } | null;
}) {
  const starts = (id: number) => [...startsByDay.values()].filter((s) => s.has(id)).length;
  const sorted = [...rows].sort((a, b) => starts(b.id) - starts(a.id));
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium">Player</th>
            {days.map((d) => (
              <th
                key={d.sp}
                className={cn("px-1 py-2 text-center font-medium", d.sp === sp && "text-primary")}
              >
                {shortDay(d.date).split(" ")[0]}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-medium">Starts</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {sorted.map((p) => (
            <tr key={p.id}>
              <td className="sticky left-0 z-10 bg-card px-3 py-2">
                <div className="flex items-center gap-2">
                  <PlayerAvatar id={p.id} name={p.name} size={28} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="max-w-32 font-medium break-words sm:max-w-none">
                        {p.name}
                      </span>
                      <StatusPill status={statusOf(p)} />
                    </div>
                    <div className="text-[11px] text-muted-foreground">{p.positions.join("/")}</div>
                  </div>
                </div>
              </td>
              {days.map((d) => {
                const o = opponentOf(p.proTeamId, d.sp);
                const starting = startsByDay.get(d.sp)?.has(p.id);
                return (
                  <td
                    key={d.sp}
                    className={cn("px-1 py-1.5 text-center", dim && d.sp < sp && "opacity-40")}
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
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{starts(p.id)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function WeekPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; week?: string; team?: string }>;
}) {
  const today = gameDate();
  const sp = Math.min(Math.max(scoringPeriodForDate(today), 1), LAST_SCORING_PERIOD);
  const thisWeek = matchupPeriodOf(sp);

  let league;
  try {
    league = await loadLeague(sp, today);
  } catch (e) {
    if (e instanceof SetupError) return <SetupNotice message={e.message} />;
    return <ErrorNotice title="Couldn't load the league" message={(e as Error).message} />;
  }
  const params = await searchParams;

  // ?week= any matchup week (past: finals; later: projected); ?team= any team in it.
  const scheduled = league.matchups.filter((m) => m.awayTeamId != null);
  const lastWeek = Math.max(thisWeek, ...scheduled.map((m) => m.period));
  const mp = Math.min(Math.max(Number(params.week) || thisWeek, 1), lastWeek);
  const mode: Mode = mp < thisWeek ? "past" : mp > thisWeek ? "later" : "now";
  const periods = scoringPeriodsOf(mp);
  const inWeek = (id: number) =>
    league.matchups.some((m) => m.period === mp && (m.homeTeamId === id || m.awayTeamId === id));
  const viewedId =
    [Number(params.team), league.me.id].find(inWeek) ??
    scheduled.find((m) => m.period === mp)?.homeTeamId ??
    league.me.id;
  const mineIsJack = viewedId === league.me.id;
  // The league as the viewed team sees it: it's "me" below (Jack's own team by default).
  const data = asTeam(league, viewedId);
  const href = (week: number, team = viewedId) => {
    const q = new URLSearchParams();
    if (week !== thisWeek) q.set("week", String(week));
    if (team !== league.me.id) q.set("team", String(team));
    return `/nba/week${q.size ? `?${q}` : ""}`;
  };

  // The props blend for players with Vegas lines, once it has passed its test (else ours).
  const perGame = await bestPerGame([...data.teams.flatMap((t) => t.roster)], data, sp);
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
    oppWeekRoster,
  } = matchupView(data, sp, perGame, mp);
  const weekMatchups = leagueMatchups(league, sp, mp, perGame);
  const names = new Map(league.teams.map((t) => [t.id, t.name]));
  const matchup = data.matchups.find(
    (m) => m.period === mp && (m.homeTeamId === data.me.id || m.awayTeamId === data.me.id),
  );
  const iAmHome = matchup?.homeTeamId === data.me.id;
  // Win chances before each day: Jack's own snapshots for his matchups, the league-wide
  // morning log for the rest. Seen from the viewed team.
  const jackPlays =
    matchup && (matchup.homeTeamId === league.me.id || matchup.awayTeamId === league.me.id);
  const loadHistory = async () => {
    if (!dbConfigured() || !matchup || mode === "later") return [];
    if (jackPlays) {
      const rows = await matchupHistory(mp);
      return rows.map((h) => ({ sp: h.scoring_period, p: mineIsJack ? h.p_win : 1 - h.p_win }));
    }
    const rows = await matchupStatesHistory(mp, matchup.homeTeamId);
    return rows.map((h) => ({ sp: h.scoring_period, p: iAmHome ? h.p_home : 1 - h.p_home }));
  };
  const [live, history] = await Promise.all([
    mode === "now" ? loadLiveRosters(sp, mp).catch(() => null) : Promise.resolve(null),
    loadHistory().catch(() => []),
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
      label: shortDay(dateForScoringPeriod(h.sp)).split(" ")[0]!,
      pWin: h.p,
    })),
    ...(pWin != null && started ? [{ label: "Now", pWin }] : []),
  ];

  const days = periods.map((p) => ({ sp: p, date: dateForScoringPeriod(p) }));

  // Every day of the week head to head, rendered together so switching days is instant:
  // past days from ESPN's finals, today live, days ahead projected. ?day= picks the first one.
  const initialDay = periods.includes(Number(params.day))
    ? Number(params.day)
    : mode === "now"
      ? sp
      : periods[0]!;
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
        .map(async (d) => [d, await loadLiveRosters(d, mp, true).catch(() => null)] as const),
    ),
  );
  const notRostered = [
    ...new Set(
      [...pastFinals.values()]
        .flatMap((byTeam) => [...(byTeam?.values() ?? [])].flat())
        .map((e) => e.playerId)
        .filter((id) => !people.has(id)),
    ),
  ];
  const dropped = await loadPlayersById(notRostered, sp).catch(() => new Map<number, never>());
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
          // A player dropped since is on no roster now: look him up, or use the day's entry.
          const p = people.get(e.playerId) ?? dropped.get(e.playerId) ?? e.player ?? undefined;
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
    // A later week shows only who's ruled out: today's day-to-day tags don't reach it.
    const statusAhead = (p: Parameters<typeof perGameProjection>[0]) =>
      outThatDay(p) ? "OUT" : out.has(p.id) || mode === "later" ? "ACTIVE" : statusFor(p);
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
  // Each side's schedule: everyone who plays for it this week (moves that take effect tomorrow
  // included) and its projected starts; a past week's actual lineups and starts.
  const played = (team: FantasyTeam | undefined) => {
    const rows = new Map<number, RosterPlayer>();
    const startsByDay = new Map<number, Set<number>>();
    for (const [day, byTeam] of pastFinals) {
      const started = new Set<number>();
      for (const e of (team && byTeam?.get(team.id)) ?? []) {
        const p = people.get(e.playerId) ?? dropped.get(e.playerId) ?? e.player ?? undefined;
        if (!p) continue;
        rows.set(p.id, p);
        if (isStarting(e.slot) && opponentOf(p.proTeamId, day)) started.add(p.id);
      }
      startsByDay.set(day, started);
    }
    return { rows: [...rows.values()], startsByDay };
  };
  const schedules = [
    mode === "past"
      ? { team: data.me, ...played(data.me) }
      : { team: data.me, rows: myWeekRoster, startsByDay: mine.startsByDay },
    ...(opp
      ? [
          mode === "past"
            ? { team: opp, ...played(opp) }
            : {
                team: opp,
                rows: oppWeekRoster ?? [],
                startsByDay: theirs?.startsByDay ?? new Map(),
              },
        ]
      : []),
  ];
  // Badges: today's statuses this week; a later week only who's ruled out when it starts; none
  // for a past week (today's injuries say nothing about then).
  const scheduleStatus = (p: RosterPlayer) =>
    mode === "now"
      ? statusFor(p)
      : mode === "later" && (out.get(p.id)?.outUntil ?? 0) > periods[0]!
        ? "OUT"
        : "ACTIVE";
  const startsOn = (side: number, day: number) => schedules[side]?.startsByDay.get(day)?.size ?? 0;
  const totalStarts = periods.reduce((a, d) => a + startsOn(0, d), 0);

  return (
    <>
      <PageHeader
        title={`Week ${mp}`}
        subtitle={`${shortDay(days[0]!.date)} – ${shortDay(days.at(-1)!.date)}${opp ? "" : " · no matchup (bye week)"}`}
      >
        <DateNav
          unit="week"
          todayLabel="This week"
          prev={mp > 1 ? href(mp - 1) : undefined}
          next={mp < lastWeek ? href(mp + 1) : undefined}
          today={mode === "now" ? undefined : href(thisWeek)}
        />
      </PageHeader>

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
          decided={mode === "past" || (mode === "now" && mine.remaining + theirs.remaining < 0.5)}
          mode={mode}
        />
      )}

      {weekMatchups.length > 1 && (
        <LeagueStrip
          matchups={weekMatchups}
          names={names}
          viewed={viewedId}
          mode={mode}
          href={(team) => href(mp, team)}
          jack={league.me.id}
        />
      )}

      {mode === "now" && mineIsJack && (
        <PendingMovesNote mine={myPending} theirs={oppPending} opponent={opp?.name} />
      )}

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
          <SectionTitle
            aside={
              mode === "now" ? "Before each day's games, then live" : "Before each day's games"
            }
          >
            {mode === "now" ? "Win chance this week" : "Win chance during the week"}
          </SectionTitle>
          <div className="rounded-xl border bg-card p-3">
            <WinChart points={winPoints} />
          </div>
        </section>
      )}

      <section className="space-y-1.5">
        <SectionTitle aside={`${totalStarts} ${mode === "past" ? "starts" : "projected starts"}`}>
          Starts by day
        </SectionTitle>
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
        >
          {days.map((d) => {
            // This week's played days fade; a past week shows each day's actual starts.
            const past = mode === "now" && d.sp < sp;
            const done = mode === "past";
            const games = mine.gamesByDay.get(d.sp)?.size ?? 0;
            const s = startsOn(0, d.sp);
            const crunch = !done && games > STARTING_SLOTS;
            const open = !past && !done && s < STARTING_SLOTS;
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
                {opp && !past && (
                  <div className="text-[10px] text-muted-foreground tabular-nums">
                    opp {startsOn(1, d.sp)}
                  </div>
                )}
                <div
                  className={cn(
                    "text-[10px] font-medium",
                    crunch ? "text-warning" : open ? "text-info" : "text-muted-foreground",
                  )}
                >
                  {past || done
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
        <SectionTitle>Schedule</SectionTitle>
        <TeamTabs
          tabs={schedules.map((x) => ({
            label: x.team.id === league.me.id ? "Your team" : x.team.name,
            content: (
              <ScheduleTable
                rows={x.rows}
                startsByDay={x.startsByDay}
                days={days}
                sp={sp}
                dim={mode === "now"}
                statusOf={scheduleStatus}
                opponentOf={opponentOf}
              />
            ),
          }))}
        />
        <p className="px-1 text-xs text-muted-foreground">
          {mode === "past"
            ? "Highlighted = started that day."
            : "Highlighted = projected to start. “Sit” days have more players playing than slots; “open” days have empty slots a streamer could fill."}
        </p>
      </section>
    </>
  );
}
