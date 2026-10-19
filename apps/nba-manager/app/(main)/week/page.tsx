import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorNotice, SetupNotice } from "@/components/setup-notice";
import { StatusBadge } from "@/components/status-badge";
import {
  LAST_SCORING_PERIOD,
  dateForScoringPeriod,
  etDate,
  matchupPeriodOf,
  scoringPeriodForDate,
  scoringPeriodsOf,
  shortDay,
} from "@/lib/calendar";
import { loadLeague } from "@/lib/data";
import { buildDayBoard } from "@/lib/day";
import { SetupError } from "@/lib/env";
import { fmtPts } from "@/lib/format";
import { projectTeamWeek, winProbability } from "@/lib/week";
import { PRO_TEAM_BY_ID, type FantasyTeam } from "@fantasy-copilot/espn";

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

  const matchup = data.matchups.find(
    (m) => m.period === mp && (m.homeTeamId === data.me.id || m.awayTeamId === data.me.id),
  );
  const iAmHome = matchup?.homeTeamId === data.me.id;
  const oppId = matchup ? (iAmHome ? matchup.awayTeamId : matchup.homeTeamId) : null;
  const opp: FantasyTeam | undefined = data.teams.find((t) => t.id === oppId);
  const myBanked = matchup ? (iAmHome ? matchup.homePoints : (matchup.awayPoints ?? 0)) : 0;
  const oppBanked = matchup ? (iAmHome ? (matchup.awayPoints ?? 0) : matchup.homePoints) : 0;

  const todayGames = data.games.filter((g) => g.scoringPeriodId === sp);
  // Today's remaining = best lineup among players whose games haven't started.
  const remainingToday = (team: FantasyTeam) => {
    const board = buildDayBoard({
      roster: team.roster,
      slotCounts: data.settings.slotCounts,
      games: todayGames,
      scoreboard: data.scoreboard,
      injuries: data.injuries,
      lineups: data.lineups,
    });
    return board.rows
      .filter((r) => !r.locked && r.recommendedSlot !== "BE" && r.recommendedSlot !== "IR")
      .reduce((a, r) => a + r.value, 0);
  };
  const common = {
    periods,
    fromPeriod: sp,
    games: data.games,
    slotCounts: data.settings.slotCounts,
    injuries: data.injuries,
  };
  const mine = projectTeamWeek(data.me.roster, {
    ...common,
    todayRemaining: remainingToday(data.me),
  });
  const theirs = opp
    ? projectTeamWeek(opp.roster, { ...common, todayRemaining: remainingToday(opp) })
    : null;
  const pWin = theirs
    ? winProbability(myBanked, mine.remaining, oppBanked, theirs.remaining)
    : null;

  const days = periods.map((p) => ({ sp: p, date: dateForScoringPeriod(p) }));
  const opponentOf = (proTeamId: number, p: number) => {
    const g = data.games.find(
      (x) =>
        x.scoringPeriodId === p && (x.homeProTeamId === proTeamId || x.awayProTeamId === proTeamId),
    );
    if (!g) return null;
    return g.homeProTeamId === proTeamId
      ? PRO_TEAM_BY_ID[g.awayProTeamId]
      : `@${PRO_TEAM_BY_ID[g.homeProTeamId]}`;
  };
  const statusOf = new Map(data.injuries.map((i) => [i.playerId, i]));
  const starts = (id: number) => [...mine.startsByDay.values()].filter((s) => s.has(id)).length;
  const rows = [...data.me.roster].sort((a, b) => starts(b.id) - starts(a.id));

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Week {mp}</h1>
        <p className="text-sm text-muted-foreground">
          {shortDay(days[0]!.date)} – {shortDay(days.at(-1)!.date)}
          {opp ? ` · vs ${opp.name}` : " · no matchup (bye week)"}
        </p>
      </div>

      {opp && theirs && (
        <Card>
          <CardHeader>
            <CardTitle>
              Projected {fmtPts(myBanked + mine.remaining)} – {fmtPts(oppBanked + theirs.remaining)}
              {pWin != null && (
                <span className="ml-2 text-base font-normal text-muted-foreground">
                  {Math.round(pWin * 100)}% to win
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <div className="font-medium">You</div>
              <div className="text-muted-foreground">
                {fmtPts(myBanked)} banked + {fmtPts(mine.remaining)} to come
              </div>
            </div>
            <div>
              <div className="font-medium">{opp.name}</div>
              <div className="text-muted-foreground">
                {fmtPts(oppBanked)} banked + {fmtPts(theirs.remaining)} to come
              </div>
            </div>
            <p className="col-span-2 text-xs text-muted-foreground">
              Assumes both teams set their best lineup every day. The win chance is a rough normal
              approximation with 2025-26 weekly volatility.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Player</TableHead>
              {days.map((d) => (
                <TableHead
                  key={d.sp}
                  className={`text-center text-xs ${d.sp === sp ? "font-bold text-foreground" : ""}`}
                >
                  {shortDay(d.date).split(" ")[0]}
                  <div className="font-normal">{shortDay(d.date).split(" ")[1]}</div>
                </TableHead>
              ))}
              <TableHead className="text-right">Starts</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="whitespace-nowrap">
                  <span className="font-medium">{p.name}</span>{" "}
                  <StatusBadge status={statusOf.get(p.id)?.status ?? p.injuryStatus ?? "ACTIVE"} />
                  <div className="text-xs text-muted-foreground">{p.positions.join("/")}</div>
                </TableCell>
                {days.map((d) => {
                  const opp = opponentOf(p.proTeamId, d.sp);
                  const starting = mine.startsByDay.get(d.sp)?.has(p.id);
                  const past = d.sp < sp;
                  return (
                    <TableCell
                      key={d.sp}
                      className={`text-center text-xs ${starting ? "bg-primary/10 font-medium" : ""} ${past ? "opacity-40" : ""}`}
                    >
                      {opp ?? ""}
                    </TableCell>
                  );
                })}
                <TableCell className="text-right tabular-nums">{starts(p.id)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="text-xs text-muted-foreground">Projected starts</TableCell>
              {days.map((d) => (
                <TableCell key={d.sp} className="text-center text-xs tabular-nums">
                  {d.sp < sp ? "" : (mine.startsByDay.get(d.sp)?.size ?? 0)}
                </TableCell>
              ))}
              <TableCell className="text-right tabular-nums">
                {[...mine.startsByDay.values()].reduce((a, s) => a + s.size, 0)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Shaded = projected to start. Days with more than 9 of your players playing are where bench
        games are lost; days with open slots are where a streamer helps.
      </p>
    </>
  );
}
