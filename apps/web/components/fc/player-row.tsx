import { Lock } from "lucide-react";
import type { DayRow } from "@/lib/nba/day";
import { statSummary, type LiveRow } from "@/lib/nba/live";
import { compactClock, keepStatsTogether, shortName } from "@/lib/display";
import { fmtPts, fmtTip } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SlotChip } from "./bits";
import { TrendMark } from "./trend-mark";
import { FitText } from "./fit-text";
import { PlayerAvatar } from "./player-avatar";
import { PlayerCardButton } from "./player-card";
import { Pill, StatusPill } from "./status-pill";
import { TeamLogo } from "./team-logo";

/**
 * "vs [logo] PHI 4:00 PM", "@ [logo] DET 113-121 Final"; live, "vs [logo] BOS 60-55 Q3 5:12" on
 * desktop and the compact "vs [logo] BOS 60-55 Q3 5:12" on phones. The score comes first.
 */
function GameLine({ row, live }: { row: DayRow; live?: LiveRow }) {
  const g = row.game;
  if (!g) return null;
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
            {score} {when}
          </span>
        </>
      ) : (
        `${score} ${when}`.trim()
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
        // Phones narrower than 390 px get a smaller photo (none under 340 px) and tighter spacing, so
        // names keep their room.
        "flex h-[76px] items-center gap-2 pr-3 pl-2 max-[389px]:gap-1.5 max-[389px]:pr-2 max-[389px]:pl-1 sm:gap-3",
        moved && "bg-primary/5",
        inProgress && "bg-success/5",
        !row.game && "opacity-55",
      )}
    >
      <div className="w-11 shrink-0 text-center max-[389px]:w-9">
        <SlotChip
          slot={showMoves ? row.currentSlot : (live?.slot ?? row.currentSlot)}
          to={moved ? row.recommendedSlot : undefined}
        />
      </div>
      <PlayerCardButton
        id={row.player.id}
        className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-md max-[389px]:gap-2"
      >
        <PlayerAvatar
          id={row.player.id}
          name={row.player.name}
          size={44}
          className="shrink-0 max-[389px]:size-8! max-[339px]:hidden"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 sm:gap-1.5">
            <TeamLogo abbr={row.player.proTeam} size={14} />
            {/* Shrinks to fit rather than being cut (phones: the short name). */}
            <FitText className="text-[length:calc(14px*var(--fit,1))] font-medium sm:hidden">
              {shortName(row.player.name)}
            </FitText>
            <FitText className="hidden sm:text-[length:calc(16px*var(--fit,1))] font-medium sm:block">
              {row.player.name}
            </FitText>
            <span className="shrink-0 text-[length:calc(10px*var(--fit,1))] text-muted-foreground sm:text-[length:calc(11px*var(--fit,1))]">
              {row.player.positions.join("/")}
            </span>
            {/* Phones: short badges, so the name keeps its room. */}
            <StatusPill
              status={row.status}
              note={row.injuryNote}
              short
              className="h-4 px-1 text-[length:calc(9.5px*var(--fit,1))] sm:hidden"
            />
            <StatusPill
              status={row.status}
              note={row.injuryNote}
              className="hidden sm:inline-flex"
            />
            {!started && row.nba?.starter && (
              <Pill
                tone="success"
                title={
                  row.nba.confirmed ? "Confirmed starter (NBA.com)" : "Expected starter (NBA.com)"
                }
                className="h-4 px-1 text-[length:calc(9.5px*var(--fit,1))] sm:h-5 sm:px-1.5 sm:text-[length:calc(11px*var(--fit,1))]"
              >
                <span className="sm:hidden">{row.nba.confirmed ? "Start" : "Exp"}</span>
                <span className="hidden sm:inline">
                  {row.nba.confirmed ? "Starting" : "Exp. start"}
                </span>
              </Pill>
            )}
            {row.locked && (
              <Lock
                className="size-3 shrink-0 text-muted-foreground"
                aria-label="Locked: game started"
              />
            )}
          </div>
          <FitText
            className={cn(
              "min-h-[1lh] text-[length:calc(12px*var(--fit,1))] text-muted-foreground",
              inProgress && "font-medium text-success",
            )}
          >
            {/* Only with a game (blank without one, so who plays stands out). A ruled-out
                player keeps his game and has nothing under it. */}
            <GameLine row={row} live={live} />
          </FitText>
          {stats ? (
            // Wraps to a second line on phones rather than being cut off.
            <div className="line-clamp-2 text-[length:calc(11px*var(--fit,1))] leading-[14px] text-foreground/80 tabular-nums sm:line-clamp-1 sm:text-[length:calc(12px*var(--fit,1))] sm:leading-4">
              {stats}
            </div>
          ) : (
            // A readable size that never shrinks: long notes wrap to two lines and end in "…"
            // (the player card has the whole note). Not for a ruled-out player: his O says it.
            !out &&
            row.injuryNote && (
              <p className="line-clamp-2 text-xs leading-4 text-muted-foreground">
                {row.injuryNote}
              </p>
            )
          )}
        </div>
        <div className="w-12 shrink-0 text-right sm:w-16">
          <div
            className={cn(
              "text-[length:calc(18px*var(--fit,1))] leading-tight font-semibold tabular-nums",
              inProgress && "text-success",
              !started && "text-muted-foreground",
            )}
          >
            {started ? fmtPts(live!.points) : row.game && !out ? "–" : ""}
          </div>
          {below != null && (
            <div
              className="flex items-center justify-end gap-0.5 text-[length:calc(12px*var(--fit,1))] text-muted-foreground tabular-nums"
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
