import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  addDays,
  etDate,
  matchupPeriodOf,
  scoringPeriodForDate,
  shortDay,
} from "@/lib/calendar";
import { loadLeague } from "@/lib/data";
import { buildDayBoard, type DayRow } from "@/lib/day";
import { SetupError } from "@/lib/env";
import { fmtPts, fmtTip, slotRank } from "@/lib/format";

const isStarting = (slot: string) => slot !== "BE" && slot !== "IR";

function GameCell({ row }: { row: DayRow }) {
  const g = row.game;
  if (!g) return <span className="text-muted-foreground">—</span>;
  const opp = `${g.home ? "vs" : "@"} ${g.opponent}`;
  return (
    <span className="whitespace-nowrap">
      {opp}{" "}
      <span className="text-muted-foreground">
        {g.state === "pre" ? fmtTip(g.tip) : g.detail || (g.state === "post" ? "Final" : "Live")}
      </span>
    </span>
  );
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: requested } = await searchParams;
  const today = etDate();
  const date = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : today;
  const sp = Math.min(Math.max(scoringPeriodForDate(date), 1), LAST_SCORING_PERIOD);

  let data;
  try {
    data = await loadLeague(sp, date);
  } catch (e) {
    if (e instanceof SetupError) return <SetupNotice message={e.message} />;
    return <ErrorNotice title="Couldn't load the league" message={(e as Error).message} />;
  }

  const games = data.games.filter((g) => g.scoringPeriodId === sp);
  const board = buildDayBoard({
    roster: data.me.roster,
    slotCounts: data.settings.slotCounts,
    games,
    scoreboard: data.scoreboard,
    injuries: data.injuries,
  });
  const rows = [...board.rows].sort(
    (a, b) => slotRank(a.recommendedSlot) - slotRank(b.recommendedSlot) || b.value - a.value,
  );
  const gain = board.optimalPoints - board.currentPoints;
  const outStarters = board.rows.filter(
    (r) => isStarting(r.currentSlot) && r.game && r.playProb === 0 && !r.locked,
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">
            {shortDay(date)}
            {date === today && <span className="text-muted-foreground"> · today</span>}
          </h1>
          <p className="text-sm text-muted-foreground">
            Week {matchupPeriodOf(sp)} · {games.length} NBA games ·{" "}
            {board.rows.filter((r) => r.game).length} of your players play
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link className="rounded border px-2 py-1" href={`/today?date=${addDays(date, -1)}`}>
            ← Prev
          </Link>
          {date !== today && (
            <Link className="rounded border px-2 py-1" href="/today">
              Today
            </Link>
          )}
          <Link className="rounded border px-2 py-1" href={`/today?date=${addDays(date, 1)}`}>
            Next →
          </Link>
        </div>
      </div>

      {data.warnings.map((w) => (
        <p key={w} className="text-sm text-amber-600">
          {w}
        </p>
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-baseline gap-2">
            {board.moves.length === 0 ? "Lineup is optimal" : `${board.moves.length} moves to make`}
            {gain > 0.05 && <Badge>+{fmtPts(gain)} pts</Badge>}
          </CardTitle>
          <CardDescription>
            Projected {fmtPts(board.currentPoints)} as set · {fmtPts(board.optimalPoints)} optimal.
            Make the moves in the ESPN app (one-click apply comes next).
          </CardDescription>
        </CardHeader>
        {(board.moves.length > 0 || outStarters.length > 0 || board.idleStarters.length > 0) && (
          <CardContent className="space-y-2 text-sm">
            {board.moves.map((m) => (
              <div key={m.playerId} className="flex items-center gap-2">
                <span className="font-medium">{m.name}</span>
                <span className="text-muted-foreground">{m.from}</span>
                <ArrowRight className="size-3" />
                <span className="font-medium">{m.to}</span>
              </div>
            ))}
            {outStarters.length > 0 && (
              <p className="text-destructive">
                Starting but ruled out: {outStarters.map((r) => r.player.name).join(", ")}
              </p>
            )}
            {board.idleStarters.length > 0 && (
              <p className="text-muted-foreground">
                No game today: {board.idleStarters.join(", ")}
              </p>
            )}
          </CardContent>
        )}
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Slot</TableHead>
            <TableHead>Player</TableHead>
            <TableHead>Game</TableHead>
            <TableHead className="text-right">Proj</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const moved = r.recommendedSlot !== r.currentSlot;
            return (
              <TableRow key={r.player.id} className={r.game ? "" : "opacity-60"}>
                <TableCell className="whitespace-nowrap font-mono text-xs">
                  {moved ? (
                    <>
                      <span className="text-muted-foreground line-through">{r.currentSlot}</span>{" "}
                      <span className="font-semibold">{r.recommendedSlot}</span>
                    </>
                  ) : (
                    r.currentSlot
                  )}
                  {r.locked && <Lock className="ml-1 inline size-3" aria-label="locked" />}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{r.player.name}</span>
                    <StatusBadge status={r.status} note={r.injuryNote} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.player.positions.join("/")} · {r.player.proTeam}
                    {r.injuryNote && <span className="hidden sm:inline"> · {r.injuryNote}</span>}
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  <GameCell row={r} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.game ? fmtPts(r.value) : ""}
                  {r.game && r.playProb < 1 && r.playProb > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {Math.round(r.playProb * 100)}% × {fmtPts(r.projection.fppg)}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        Projection: ESPN&apos;s league-scored preseason projection, blended toward this
        season&apos;s average as games are played. Injury chances are rough priors until the
        availability model ships.
      </p>
    </>
  );
}
