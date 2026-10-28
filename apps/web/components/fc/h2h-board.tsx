import { fmtPts, fmtTip } from "@/lib/format";
import type { H2HCell, H2HGame, H2HRow } from "@/lib/nba/h2h";
import { cn } from "@/lib/utils";
import { SlotChip } from "./bits";
import { BoxScore, TrendMark } from "./box-score";
import { PlayerAvatar } from "./player-avatar";
import { StatusPill } from "./status-pill";
import { TeamLogo } from "./team-logo";

/** "J. Duren" for tight phone columns. */
const shortName = (name: string) => {
  const [first, ...rest] = name.split(" ");
  return rest.length ? `${first![0]}. ${rest.join(" ")}` : name;
};

function GameText({ game }: { game: H2HGame | null }) {
  if (!game) return <span>No game</span>;
  const when =
    game.state === "pre"
      ? fmtTip(game.tip)
      : game.state === "post"
        ? "Final"
        : game.detail || "Live";
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <TeamLogo abbr={game.opponent} size={12} />
      <span>
        {game.home ? "" : "@"}
        {game.opponent}
      </span>
      <span className={cn(game.state === "in" && "font-semibold text-success")}>{when}</span>
      {game.score && (
        <span className="tabular-nums">
          {game.score.us}-{game.score.them}
        </span>
      )}
    </span>
  );
}

/**
 * One player in one slot, stacked so it fits half a phone screen:
 *   name ............ points        (the projection instead of points before tip)
 *   game status ..... ▼ proj 34.0
 *   22 PTS 9 REB 1 AST ▾            (tap for the full box score)
 * The opponent's side mirrors it, so both teams' points sit next to the slot.
 */
function Cell({ c, side }: { c: H2HCell | null; side: "mine" | "theirs" }) {
  const right = side === "theirs";
  if (!c) {
    return (
      <div
        className={cn(
          "flex min-h-14 items-center px-2 text-xs text-muted-foreground sm:px-3",
          !right && "justify-end",
        )}
      >
        Empty
      </div>
    );
  }
  const live = c.game?.state === "in";
  const main = c.points ?? c.proj;
  const projLine =
    c.points != null && c.proj != null ? (
      <span
        className="inline-flex shrink-0 items-center gap-0.5 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums sm:text-xs"
        title={
          live ? "Points so far plus the rest of his pregame projection" : "Pregame projection"
        }
      >
        <TrendMark trend={c.trend} />
        proj {fmtPts(c.proj)}
      </span>
    ) : null;
  return (
    <div
      className={cn(
        "min-w-0 space-y-0.5 px-2 py-2 sm:px-3",
        !c.game && "opacity-55",
        live && "bg-success/5",
      )}
    >
      <div className={cn("flex items-center gap-1.5", right && "flex-row-reverse")}>
        <PlayerAvatar
          id={c.player.id}
          name={c.player.name}
          size={28}
          className="hidden shrink-0 sm:block"
        />
        <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", right && "text-right")}>
          <span className="sm:hidden">{shortName(c.player.name)}</span>
          <span className="hidden sm:inline">{c.player.name}</span>
        </span>
        <StatusPill status={c.status} />
        {c.back && (
          <span className="hidden shrink-0 text-[11px] whitespace-nowrap text-muted-foreground sm:inline">
            {c.back}
          </span>
        )}
        <span
          className={cn(
            "shrink-0 text-lg leading-tight font-semibold tabular-nums",
            live && "text-success",
            c.points == null && "text-muted-foreground",
          )}
          title={c.points == null && c.proj != null ? "Projected" : undefined}
        >
          {main != null ? fmtPts(main) : "—"}
        </span>
      </div>
      {projLine && (
        // Phones: the projection on its own line under the points.
        <div className={cn("flex sm:hidden", right ? "justify-start" : "justify-end")}>
          {projLine}
        </div>
      )}
      <div
        className={cn(
          "flex items-start gap-1.5 text-[11px] text-muted-foreground",
          right && "flex-row-reverse",
        )}
      >
        <span className={cn("min-w-0 flex-1", right && "text-right")}>
          <GameText game={c.game} />
        </span>
        {projLine && <span className="hidden sm:inline-flex">{projLine}</span>}
        {c.points == null && c.proj != null && <span className="shrink-0">proj</span>}
      </div>
      {c.line && <BoxScore line={c.line} className={cn("text-[11px]", right && "text-right")} />}
    </div>
  );
}

function Row({ r }: { r: H2HRow }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_2.75rem_minmax(0,1fr)] items-stretch">
      <Cell c={r.mine} side="mine" />
      <div className="flex items-center justify-center border-x bg-muted/30">
        <SlotChip slot={r.slot} />
      </div>
      <Cell c={r.theirs} side="theirs" />
    </div>
  );
}

/** Pair two lists into rows under one label (bench, IR). */
function listRows(slot: string, mine: H2HCell[], theirs: H2HCell[]): H2HRow[] {
  return Array.from({ length: Math.max(mine.length, theirs.length) }, (_, i) => ({
    slot,
    mine: mine[i] ?? null,
    theirs: theirs[i] ?? null,
  }));
}

export function H2HBoard({
  rows,
  bench,
  ir,
  totals,
  ahead,
}: {
  rows: H2HRow[];
  bench: { mine: H2HCell[]; theirs: H2HCell[] };
  ir: { mine: H2HCell[]; theirs: H2HCell[] };
  totals: { mine: number; theirs: number };
  /** A day ahead: totals are projections. */
  ahead: boolean;
}) {
  const reserves = [
    ...listRows("BE", bench.mine, bench.theirs),
    ...listRows("IR", ir.mine, ir.theirs),
  ];
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="grid grid-cols-[minmax(0,1fr)_2.75rem_minmax(0,1fr)] border-b bg-muted/40 text-xs font-medium text-muted-foreground">
        <div className="px-2 py-2 text-right tabular-nums sm:px-3">
          <span className="text-base font-semibold text-foreground">{fmtPts(totals.mine)}</span>
          {ahead && " proj"}
        </div>
        <div className="flex items-center justify-center border-x">Slot</div>
        <div className="px-2 py-2 tabular-nums sm:px-3">
          <span className="text-base font-semibold text-foreground">{fmtPts(totals.theirs)}</span>
          {ahead && " proj"}
        </div>
      </div>
      <div className="divide-y">
        {rows.map((r, i) => (
          <Row key={`${r.slot}-${i}`} r={r} />
        ))}
      </div>
      {reserves.length > 0 && (
        <details className="group border-t">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            Bench and IL ({bench.mine.length + ir.mine.length} /{" "}
            {bench.theirs.length + ir.theirs.length})
            <span className="ml-1 inline-block transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div className="divide-y border-t">
            {reserves.map((r, i) => (
              <Row key={`${r.slot}-${i}`} r={r} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
