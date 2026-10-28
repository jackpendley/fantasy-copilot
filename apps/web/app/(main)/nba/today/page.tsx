import { ArrowRight, CheckCircle2 } from "lucide-react";
import { IlPlanNote } from "@/components/fc/il-plan-note";
import { ilReturnPlan } from "@/lib/nba/il-plan";
import { ApplyMoves } from "@/components/apply-moves";
import { Callout, DateNav, PageHeader, SectionTitle } from "@/components/fc/bits";
import { PlayerRow } from "@/components/fc/player-row";
import { PendingMovesNote } from "@/components/fc/pending-moves";
import { LiveRefresh } from "@/components/live-refresh";
import { ErrorNotice, SetupNotice } from "@/components/setup-notice";
import {
  LAST_SCORING_PERIOD,
  addDays,
  etDate,
  longDay,
  matchupPeriodOf,
  scoringPeriodForDate,
} from "@/lib/nba/calendar";
import { loadLeague, loadLiveRosters } from "@/lib/nba/data";
import { liveRows, type LiveRow } from "@/lib/nba/live";
import { pendingMoves } from "@/lib/nba/roster";
import { buildDayBoard, type DayRow } from "@/lib/nba/day";
import { SetupError } from "@/lib/env";
import { fmtPts, fmtTip, slotRank } from "@/lib/format";

const isStarting = (slot: string) => slot !== "BE" && slot !== "IR";

function Group({
  title,
  rows,
  aside,
  live,
}: {
  title: string;
  rows: DayRow[];
  aside?: string;
  live: Map<number, LiveRow>;
}) {
  if (!rows.length) return null;
  return (
    <section className="space-y-1.5">
      <SectionTitle aside={aside}>{title}</SectionTitle>
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {rows.map((r) => (
          <PlayerRow key={r.player.id} row={r} live={live.get(r.player.id)} />
        ))}
      </div>
    </section>
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

  let data, liveRosters;
  try {
    [data, liveRosters] = await Promise.all([
      loadLeague(sp, date),
      // Live box scores are a bonus: the page works without them.
      loadLiveRosters(sp, matchupPeriodOf(sp)).catch(() => null),
    ]);
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
    lineups: data.lineups,
  });
  const live = new Map(
    liveRows(board.rows, liveRosters?.get(data.me.id), data.scoreboard).map((r) => [
      r.row.player.id,
      r,
    ]),
  );
  // Once games start: points in the slots that count, and the projected final for the day
  // (locked starters' live projection + the best lineup among players still to play).
  const counting = board.rows.filter((r) =>
    r.locked
      ? isStarting(live.get(r.player.id)?.slot ?? r.currentSlot)
      : isStarting(r.recommendedSlot),
  );
  const anyStarted = board.rows.some((r) => r.locked);
  const scored = counting.reduce(
    (a, r) => a + (r.locked ? (live.get(r.player.id)?.points ?? 0) : 0),
    0,
  );
  const projectedFinal = counting.reduce(
    (a, r) => a + (r.locked ? (live.get(r.player.id)?.projected ?? 0) : r.value),
    0,
  );
  const gamesLive = board.rows.some((r) => r.game?.state === "in");
  const order = (a: DayRow, b: DayRow) =>
    slotRank(a.recommendedSlot) - slotRank(b.recommendedSlot) || b.value - a.value;
  const starters = board.rows.filter((r) => isStarting(r.recommendedSlot)).sort(order);
  const bench = board.rows.filter((r) => r.recommendedSlot === "BE").sort(order);
  const ir = board.rows.filter((r) => r.recommendedSlot === "IR");
  const gain = board.optimalPoints - board.currentPoints;
  const playing = board.rows.filter((r) => r.game).length;
  const outStarters = board.rows.filter(
    (r) => isStarting(r.currentSlot) && r.game && r.playProb === 0 && !r.locked,
  );

  return (
    <>
      <PageHeader
        title={longDay(date)}
        subtitle={`Week ${matchupPeriodOf(sp)} · ${games.length} NBA games · ${playing} of your players play`}
      >
        <DateNav
          prev={`/nba/today?date=${addDays(date, -1)}`}
          next={`/nba/today?date=${addDays(date, 1)}`}
          today={date !== today ? "/nba/today" : undefined}
        />
      </PageHeader>

      {date === today && (
        <PendingMovesNote mine={pendingMoves(data.me.roster, data.ahead.me.roster)} />
      )}
      {date === today && <IlPlanNote plan={ilReturnPlan(data.ahead.me, data, sp)} />}

      {data.warnings.map((w) => (
        <Callout key={w} tone="warning">
          {w}
        </Callout>
      ))}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="space-y-4 lg:order-2 lg:sticky lg:top-20">
          {/* Summary: the number that matters today and the one action to take. */}
          <div className="rounded-xl border bg-card p-4">
            {anyStarted ? (
              <>
                <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {gamesLive ? "Scored so far" : "Scored today"}
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-4xl font-semibold tracking-tight tabular-nums">
                    {fmtPts(scored)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    pts · proj {fmtPts(projectedFinal)}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Projected today
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-4xl font-semibold tracking-tight tabular-nums">
                    {fmtPts(board.moves.length ? board.optimalPoints : board.currentPoints)}
                  </span>
                  <span className="text-sm text-muted-foreground">pts</span>
                </div>
              </>
            )}
            {board.moves.length === 0 ? (
              <div className="mt-3 flex items-center gap-1.5 text-sm font-medium text-success">
                <CheckCircle2 className="size-4" /> Lineup is optimal
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="text-sm">
                  <span className="font-semibold text-primary">+{fmtPts(gain)} pts</span>{" "}
                  <span className="text-muted-foreground">
                    with {board.moves.length} move{board.moves.length > 1 ? "s" : ""} (as set:{" "}
                    {fmtPts(board.currentPoints)})
                  </span>
                </div>
                <ul className="space-y-1.5 text-sm">
                  {board.moves.map((m) => (
                    <li key={m.playerId} className="flex items-center gap-2">
                      <span className="truncate font-medium">{m.name}</span>
                      <span className="ml-auto font-mono text-xs text-muted-foreground">
                        {m.from}
                      </span>
                      <ArrowRight className="size-3 text-muted-foreground" />
                      <span className="font-mono text-xs font-semibold text-primary">{m.to}</span>
                    </li>
                  ))}
                </ul>
                <ApplyMoves date={date} moves={board.moves} />
              </div>
            )}
          </div>

          {(outStarters.length > 0 || board.hedges.length > 0 || board.idleStarters.length > 0) && (
            <div className="space-y-2">
              {outStarters.map((r) => (
                <Callout key={r.player.id} tone="danger">
                  <span className="font-medium">{r.player.name}</span> is starting but ruled out.
                </Callout>
              ))}
              {board.hedges.map((h) => (
                <Callout key={h.playerId} tone="warning">
                  <span className="font-medium">{h.name}</span> is{" "}
                  {h.status.toLowerCase().replace(/_/g, "-")} ({fmtTip(h.tip)}).{" "}
                  {h.backup ? (
                    <>
                      If he sits, swap in <span className="font-medium">{h.backup.name}</span> (tips{" "}
                      {fmtTip(h.backup.tip)}).
                    </>
                  ) : (
                    "No later-tipping bench option today."
                  )}
                </Callout>
              ))}
              {board.idleStarters.length > 0 && (
                <Callout tone="info">No game today: {board.idleStarters.join(", ")}</Callout>
              )}
            </div>
          )}
        </div>

        <div className="space-y-4 lg:order-1">
          <Group
            title="Starters"
            rows={starters}
            aside={`${fmtPts(board.optimalPoints)} proj`}
            live={live}
          />
          <Group title="Bench" rows={bench} live={live} />
          <Group title="IR" rows={ir} live={live} />
          <p className="px-1 text-xs text-muted-foreground">
            Under each score: his projection, the most accurate source we have for that game (our
            model until the Vegas blend passes its accuracy test). Before tip and after the final
            it&apos;s the pregame number; while he&apos;s playing it&apos;s points so far plus the
            rest of it. ▲/▼ = 5+ points and 20%+ off. Tap a player for his card: our model, Vegas
            and ESPN side by side, recent games, and rest-of-season value.
          </p>
        </div>
      </div>
      <LiveRefresh active={gamesLive} />
    </>
  );
}
