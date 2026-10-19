import { Lock } from "lucide-react";
import type { DayRow } from "@/lib/nba/day";
import { fmtPts, fmtTip } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SlotChip } from "./bits";
import { PlayerAvatar } from "./player-avatar";
import { Pill, StatusPill } from "./status-pill";
import { TeamLogo } from "./team-logo";

function GameLine({ row }: { row: DayRow }) {
  const g = row.game;
  if (!g) return <span className="text-muted-foreground">No game</span>;
  const when =
    g.state === "pre" ? fmtTip(g.tip) : g.detail || (g.state === "post" ? "Final" : "Live");
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-muted-foreground">{g.home ? "vs" : "@"}</span>
      <TeamLogo abbr={g.opponent} size={16} />
      <span className="font-medium">{g.opponent}</span>
      <span
        className={cn("text-muted-foreground", g.state === "in" && "font-semibold text-success")}
      >
        {when}
      </span>
    </span>
  );
}

/** One roster player for a day: slot, headshot, status, game and projection. */
export function PlayerRow({ row }: { row: DayRow }) {
  const moved = row.recommendedSlot !== row.currentSlot;
  const idle = !row.game;
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2.5",
        moved && "bg-primary/5",
        idle && "opacity-55",
      )}
    >
      <div className="w-11 shrink-0 text-center">
        <SlotChip slot={row.currentSlot} to={moved ? row.recommendedSlot : undefined} />
      </div>
      <PlayerAvatar id={row.player.id} name={row.player.name} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{row.player.name}</span>
          <StatusPill status={row.status} note={row.injuryNote} />
          {row.nba?.starter && (
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
          <span className="inline-flex items-center gap-1">
            <TeamLogo abbr={row.player.proTeam} size={14} />
            {row.player.positions.join("/")}
          </span>
          <span className="sm:hidden">
            <GameLine row={row} />
          </span>
          {row.injuryNote && (
            <span className="hidden max-w-sm truncate sm:inline" title={row.injuryNote}>
              {row.injuryNote}
            </span>
          )}
        </div>
      </div>
      <div className="hidden w-52 shrink-0 text-sm sm:block">
        <GameLine row={row} />
      </div>
      <div className="w-14 shrink-0 text-right">
        {row.game ? (
          <>
            <div className="text-base font-semibold tabular-nums">{fmtPts(row.value)}</div>
            {row.playProb < 1 && row.playProb > 0 && (
              <div className="text-[10px] text-muted-foreground tabular-nums">
                {Math.round(row.playProb * 100)}%×{fmtPts(row.projection.fppg)}
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
