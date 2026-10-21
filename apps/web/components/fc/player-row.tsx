import { Lock } from "lucide-react";
import type { DayRow } from "@/lib/nba/day";
import type { LiveRow } from "@/lib/nba/live";
import { fmtPts, fmtTip } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SlotChip } from "./bits";
import { BoxScore, TrendMark } from "./box-score";
import { PlayerAvatar } from "./player-avatar";
import { Pill, StatusPill } from "./status-pill";
import { TeamLogo } from "./team-logo";

function GameLine({ row, live }: { row: DayRow; live?: LiveRow }) {
  const g = row.game;
  if (!g) return <span className="text-muted-foreground">No game</span>;
  const when =
    g.state === "pre" ? fmtTip(g.tip) : g.detail || (g.state === "post" ? "Final" : "Live");
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 whitespace-nowrap">
      <span className="text-muted-foreground">{g.home ? "vs" : "@"}</span>
      <TeamLogo abbr={g.opponent} size={16} />
      <span className="font-medium">{g.opponent}</span>
      <span
        className={cn("text-muted-foreground", g.state === "in" && "font-semibold text-success")}
      >
        {when}
      </span>
      {live?.score && (
        <span className="text-muted-foreground tabular-nums">
          {live.score.us}-{live.score.them}
        </span>
      )}
    </span>
  );
}

/** Live/final: big points, then the projection with an arrow when he's well off it. */
function Points({ live }: { live: LiveRow }) {
  const final = live.row.game?.state === "post";
  return (
    <>
      <div
        className={cn(
          "text-lg leading-tight font-semibold tabular-nums",
          live.row.game?.state === "in" && "text-success",
        )}
      >
        {fmtPts(live.points)}
      </div>
      <div
        className="flex items-center justify-end gap-1 text-xs text-muted-foreground tabular-nums"
        title={
          final
            ? `Projected ${fmtPts(live.pregame)} before the game`
            : `Projected ${fmtPts(live.projected)} now (${fmtPts(live.pregame)} before the game)`
        }
      >
        <TrendMark trend={live.trend} />
        proj {fmtPts(final ? live.pregame : live.projected)}
      </div>
    </>
  );
}

/**
 * One roster player for a day: slot, headshot, status, game and projection. With live data
 * (his game has started) it shows his box score and points, ESPN-app style.
 * `showMoves`: show the optimizer's slot change (your team); off for an opponent's lineup.
 */
export function PlayerRow({
  row,
  live,
  vegas,
  showMoves = true,
}: {
  row: DayRow;
  live?: LiveRow;
  /** Tonight's projection implied by sportsbook props, when posted. */
  vegas?: number;
  showMoves?: boolean;
}) {
  const moved = showMoves && row.recommendedSlot !== row.currentSlot;
  const idle = !row.game;
  const started = Boolean(live && row.game && row.game.state !== "pre");
  const box = started ? live!.line : null;
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2.5",
        moved && "bg-primary/5",
        row.game?.state === "in" && started && "bg-success/5",
        idle && "opacity-55",
      )}
    >
      <div className="w-11 shrink-0 text-center">
        <SlotChip
          slot={showMoves ? row.currentSlot : (live?.slot ?? row.currentSlot)}
          to={moved ? row.recommendedSlot : undefined}
        />
      </div>
      <PlayerAvatar id={row.player.id} name={row.player.name} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{row.player.name}</span>
          <StatusPill status={row.status} note={row.injuryNote} />
          {!started && row.nba?.starter && (
            <Pill
              tone="success"
              title={
                row.nba.confirmed ? "Confirmed starter (NBA.com)" : "Expected starter (NBA.com)"
              }
            >
              {row.nba.confirmed ? "Starting" : "Exp. start"}
            </Pill>
          )}
          {row.locked && (
            <Lock
              className="size-3 shrink-0 text-muted-foreground"
              aria-label="Locked: game started"
            />
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {box ? (
            <BoxScore line={box} />
          ) : (
            <span className="inline-flex items-center gap-1">
              <TeamLogo abbr={row.player.proTeam} size={14} />
              {row.player.positions.join("/")}
            </span>
          )}
          <span className="sm:hidden">
            <GameLine row={row} live={live} />
          </span>
          {!box && row.injuryNote && (
            <span className="hidden max-w-sm truncate sm:inline" title={row.injuryNote}>
              {row.injuryNote}
            </span>
          )}
        </div>
      </div>
      <div className="hidden w-56 shrink-0 text-sm sm:block">
        <GameLine row={row} live={live} />
      </div>
      <div className="w-20 shrink-0 text-right">
        {started ? (
          <Points live={live!} />
        ) : row.game ? (
          <>
            <div className="text-lg leading-tight font-semibold tabular-nums">
              {fmtPts(row.value)}
            </div>
            {row.playProb < 1 && row.playProb > 0 && (
              <div className="text-xs text-muted-foreground tabular-nums">
                {Math.round(row.playProb * 100)}%×{fmtPts(row.projection.fppg)}
              </div>
            )}
            {vegas != null && (
              <div
                className="text-xs text-muted-foreground tabular-nums"
                title="Projection implied by DraftKings player props"
              >
                Vegas {fmtPts(vegas)}
              </div>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}
