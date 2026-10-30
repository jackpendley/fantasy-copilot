import { Lock } from "lucide-react";
import type { DayRow } from "@/lib/nba/day";
import { statSummary, type LiveRow } from "@/lib/nba/live";
import { compactClock, keepStatsTogether, shortName } from "@/lib/display";
import { fmtPts, fmtTip } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SlotChip } from "./bits";
import { TrendMark } from "./trend-mark";
import { PlayerAvatar } from "./player-avatar";
import { PlayerCardButton } from "./player-card";
import { Pill, StatusPill } from "./status-pill";
import { TeamLogo } from "./team-logo";

/**
 * "vs [logo] PHI 4:00 PM", "@ [logo] DET Final 113-121"; live, "vs [logo] BOS Q3 5:12 60-55" on
 * desktop and the compact "vs [logo] BOS 60-55 Q3 5:12" on phones.
 */
function GameLine({ row, live }: { row: DayRow; live?: LiveRow }) {
  const g = row.game;
  if (!g) return <>No game</>;
  const score = live?.score ? `${live.score.us}-${live.score.them}` : "";
  const when =
    g.state === "pre" ? fmtTip(g.tip) : g.state === "post" ? "Final" : g.detail || "Live";
  const inGame = g.state === "in";
  return (
    <>
      {g.home ? "vs" : "@"} <TeamLogo abbr={g.opponent} size={14} className="align-[-3px]" />{" "}
      {g.opponent}{" "}
      {inGame ? (
        <>
          <span className="sm:hidden">
            {score} {compactClock(g.detail || "Live")}
          </span>
          <span className="hidden sm:inline">
            {when} {score}
          </span>
        </>
      ) : (
        `${when} ${score}`
      )}
    </>
  );
}

/**
 * One roster player for a day, ESPN-app style, in a fixed-height row: slot, photo, then team
 * logo, name and positions; the day's game; and (once his game starts) a one-line stat summary. On the right: points,
 * and under them his projection, unlabeled (pregame before tip and after the final; points so
 * far plus the rest of it while live) with ▲/▼ when he's well off it. Tap for his card.
 * `showMoves`: show the optimizer's slot change (your team); off for an opponent's lineup.
 */
export function PlayerRow({
  row,
  live,
  showMoves = true,
}: {
  row: DayRow;
  live?: LiveRow;
  showMoves?: boolean;
}) {
  const moved = showMoves && row.recommendedSlot !== row.currentSlot;
  // A ruled-out player whose team is playing has nothing to score or project.
  const out = row.playProb === 0 && (live?.points ?? 0) === 0;
  const started = !out && Boolean(live && row.game && row.game.state !== "pre");
  const inProgress = row.game?.state === "in" && started;
  const final = row.game?.state === "post";
  const stats = started ? keepStatsTogether(statSummary(live!.line)) : null;
  const below = started
    ? final
      ? live!.pregame
      : live!.projected
    : row.game && !out
      ? row.value
      : null;
  return (
    <div
      className={cn(
        "flex h-[76px] items-center gap-2 pr-3 pl-2 sm:gap-3",
        moved && "bg-primary/5",
        inProgress && "bg-success/5",
        !row.game && "opacity-55",
      )}
    >
      <div className="w-11 shrink-0 text-center">
        <SlotChip
          slot={showMoves ? row.currentSlot : (live?.slot ?? row.currentSlot)}
          to={moved ? row.recommendedSlot : undefined}
        />
      </div>
      <PlayerCardButton
        id={row.player.id}
        className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-md"
      >
        <PlayerAvatar id={row.player.id} name={row.player.name} size={44} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 sm:gap-1.5">
            <TeamLogo abbr={row.player.proTeam} size={14} />
            <span className="truncate text-sm font-medium sm:text-base">
              <span className="sm:hidden">{shortName(row.player.name)}</span>
              <span className="hidden sm:inline">{row.player.name}</span>
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground sm:text-[11px]">
              {row.player.positions.join("/")}
            </span>
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
          <div
            className={cn(
              "truncate text-xs text-muted-foreground",
              inProgress && "font-medium text-success",
            )}
          >
            {row.back ?? <GameLine row={row} live={live} />}
          </div>
          {stats ? (
            // Wraps to a second line on phones rather than being cut off.
            <div className="line-clamp-2 text-[11px] leading-[14px] text-foreground/80 tabular-nums sm:line-clamp-1 sm:text-xs sm:leading-4">
              {stats}
            </div>
          ) : (
            row.injuryNote && (
              <div className="hidden truncate text-xs text-muted-foreground sm:block">
                {row.injuryNote}
              </div>
            )
          )}
        </div>
        <div className="w-16 shrink-0 text-right">
          <div
            className={cn(
              "text-lg leading-tight font-semibold tabular-nums",
              inProgress && "text-success",
              !started && "text-muted-foreground",
            )}
          >
            {started ? fmtPts(live!.points) : row.game && !out ? "–" : ""}
          </div>
          {below != null && (
            <div
              className="flex items-center justify-end gap-0.5 text-xs text-muted-foreground tabular-nums"
              title={
                !started
                  ? "Projection"
                  : final
                    ? "Pregame projection"
                    : "Projected final: points so far plus the rest of his projection"
              }
            >
              {started && <TrendMark trend={live!.trend} className="size-3" />}
              {fmtPts(below)}
            </div>
          )}
        </div>
      </PlayerCardButton>
    </div>
  );
}
