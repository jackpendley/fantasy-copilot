"use client";

// ESPN-style head-to-head board: one fixed-height row per lineup slot (your player left, theirs
// right, both scores next to the slot), then the bench and IL, padded to the league's slot
// counts so the board is the same size every day. Tap a player for his card.

import { compactStatus, fmtPts, shortName } from "@/lib/display";
import type { H2HCell, H2HGame, H2HRow } from "@/lib/nba/h2h";
import { statSummary } from "@/lib/nba/live";
import { cn } from "@/lib/utils";
import { TrendMark } from "./trend-mark";
import { PlayerAvatar } from "./player-avatar";
import { PlayerCardButton } from "./player-card";
import { StatusPill } from "./status-pill";
import { TeamLogo } from "./team-logo";

// Phones stack four lines (name, positions, game, stats up to two lines); desktop three.
const ROW = "h-[92px] sm:h-[76px]";

function GameText({ game }: { game: H2HGame | null }) {
  if (!game) return <span>No game</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap">
      <span>{game.home ? "vs" : "@"}</span>
      <TeamLogo abbr={game.opponent} size={14} />
      <span>{game.opponent}</span>
      <span className={cn(game.state === "in" && "font-semibold text-success")}>
        {game.when ?? (game.state === "post" ? "Final" : game.detail)}
      </span>
      {game.score && (
        <span className="tabular-nums">
          {game.score.us}-{game.score.them}
        </span>
      )}
    </span>
  );
}

/** Points (or "–" before tip), and under them the projection, unlabeled, with ▲/▼. */
function Score({ c, right }: { c: H2HCell; right: boolean }) {
  const live = c.game?.state === "in";
  return (
    <div className={cn("w-9 shrink-0 sm:w-16", right ? "text-left" : "text-right")}>
      <div
        className={cn(
          "text-[15px] leading-tight font-semibold tabular-nums sm:text-lg",
          live && "text-success",
          c.points == null && "text-muted-foreground",
        )}
      >
        {c.points != null ? fmtPts(c.points) : c.game ? "–" : ""}
      </div>
      {c.proj != null && (
        <div
          className={cn(
            "mt-0.5 flex items-center gap-0.5 text-[11px] text-muted-foreground tabular-nums sm:text-xs",
            right ? "justify-start" : "justify-end",
          )}
          title={
            c.points == null
              ? "Projection"
              : live
                ? "Projected final: points so far plus the rest of his projection"
                : "Pregame projection"
          }
        >
          {!right && <TrendMark trend={c.trend} className="size-3" />}
          {fmtPts(c.proj)}
          {right && <TrendMark trend={c.trend} className="size-3" />}
        </div>
      )}
    </div>
  );
}

function Cell({ c, side }: { c: H2HCell | null; side: "mine" | "theirs" }) {
  const right = side === "theirs";
  if (!c) {
    return (
      <div
        className={cn(
          ROW,
          "flex items-center px-2 text-xs text-muted-foreground sm:px-3",
          !right && "justify-end",
        )}
      >
        Empty
      </div>
    );
  }
  const stats = c.line ? statSummary(c.line) : null;
  const name = (
    <div className={cn("flex min-w-0 items-center gap-1", right && "flex-row-reverse")}>
      <TeamLogo abbr={c.player.proTeam} size={14} />
      <span className="min-w-0 truncate text-[13px] font-medium sm:text-sm">
        <span className="sm:hidden">{shortName(c.player.name)}</span>
        <span className="hidden sm:inline">{c.player.name}</span>
      </span>
      <span className="shrink-0">
        <StatusPill status={c.status} />
      </span>
    </div>
  );
  return (
    <PlayerCardButton
      id={c.player.id}
      className={cn(
        ROW,
        "flex items-center px-1 hover:bg-muted/40 sm:gap-2 sm:px-3",
        right && "flex-row-reverse",
        !c.game && "opacity-55",
        c.game?.state === "in" && "bg-success/5",
      )}
    >
      {/* Phones: name and positions beside the score, then the game and his stats across the
          whole cell (labeled as on desktop, wrapping to a second line rather than cut off). */}
      <div
        className={cn(
          "grid min-w-0 flex-1 gap-x-1 sm:hidden",
          right ? "grid-cols-[auto_minmax(0,1fr)] text-right" : "grid-cols-[minmax(0,1fr)_auto]",
        )}
      >
        <div className={cn("row-span-2 row-start-1", right ? "col-start-1" : "col-start-2")}>
          <Score c={c} right={right} />
        </div>
        <div className={cn("row-start-1 min-w-0", right ? "col-start-2" : "col-start-1")}>
          {name}
        </div>
        <div
          className={cn(
            "row-start-2 truncate text-[10.5px] text-muted-foreground",
            right ? "col-start-2" : "col-start-1",
          )}
        >
          {c.player.positions.join("/")}
        </div>
        <div className="col-span-2 row-start-3 truncate text-[10px] whitespace-nowrap text-muted-foreground tabular-nums">
          {c.back ?? <PhoneGame game={c.game} />}
        </div>
        {stats && (
          <div className="col-span-2 row-start-4 line-clamp-2 text-[10.5px] leading-[13px] text-foreground/80 tabular-nums">
            {stats}
          </div>
        )}
      </div>
      <PlayerAvatar
        id={c.player.id}
        name={c.player.name}
        size={44}
        className="hidden shrink-0 sm:block"
      />
      <div className={cn("hidden min-w-0 flex-1 sm:block", right && "text-right")}>
        {name}
        <div className="truncate text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">
          {c.back ? (
            c.back
          ) : (
            <>
              {c.player.positions.join("/")} · <GameText game={c.game} />
            </>
          )}
        </div>
        {stats && (
          <div className="truncate text-[11px] text-foreground/80 tabular-nums">{stats}</div>
        )}
      </div>
      <div className="hidden sm:block">
        <Score c={c} right={right} />
      </div>
    </PlayerCardButton>
  );
}

/** "@ [logo] BOS 82-77 Q4 10:37" for a phone row; the longest fits 140 px (375 px screen). */
function PhoneGame({ game }: { game: H2HGame | null }) {
  if (!game) return <span>No game</span>;
  return (
    <span className="inline-flex items-center gap-[2px]">
      <span>{game.home ? "vs" : "@"}</span>
      <TeamLogo abbr={game.opponent} size={12} />
      <span>{game.opponent}</span>
      <span className={cn(game.state === "in" && "font-semibold text-success")}>
        {compactStatus(game)}
      </span>
    </span>
  );
}

function Row({ r }: { r: H2HRow }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_1.875rem_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_2.75rem_minmax(0,1fr)] items-stretch">
      <Cell c={r.mine} side="mine" />
      <div className="flex items-center justify-center border-x bg-muted/30">
        <span className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground sm:text-[11px]">
          {r.slot}
        </span>
      </div>
      <Cell c={r.theirs} side="theirs" />
    </div>
  );
}

/** Rows under one label (bench, IL), at least `slots` of them so every day has the same size. */
function listRows(slot: string, mine: H2HCell[], theirs: H2HCell[], slots: number): H2HRow[] {
  return Array.from({ length: Math.max(slots, mine.length, theirs.length) }, (_, i) => ({
    slot,
    mine: mine[i] ?? null,
    theirs: theirs[i] ?? null,
  }));
}

export interface BoardData {
  rows: H2HRow[];
  bench: { mine: H2HCell[]; theirs: H2HCell[] };
  ir: { mine: H2HCell[]; theirs: H2HCell[] };
  totals: { mine: number; theirs: number };
  /** A day ahead: totals are projections. */
  ahead: boolean;
}

export function H2HBoard({
  board,
  benchSlots,
  irSlots,
}: {
  board: BoardData;
  benchSlots: number;
  irSlots: number;
}) {
  const reserves = [
    ...listRows("BE", board.bench.mine, board.bench.theirs, benchSlots),
    ...listRows("IR", board.ir.mine, board.ir.theirs, irSlots),
  ];
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="grid grid-cols-[minmax(0,1fr)_1.875rem_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_2.75rem_minmax(0,1fr)] border-b bg-muted/40 text-xs font-medium text-muted-foreground">
        <div className="px-2 py-2 text-right tabular-nums sm:px-3">
          <span className="text-base font-semibold text-foreground">
            {fmtPts(board.totals.mine)}
          </span>
          {board.ahead && " proj"}
        </div>
        <div className="flex items-center justify-center border-x">Slot</div>
        <div className="px-2 py-2 tabular-nums sm:px-3">
          <span className="text-base font-semibold text-foreground">
            {fmtPts(board.totals.theirs)}
          </span>
          {board.ahead && " proj"}
        </div>
      </div>
      <div className="divide-y">
        {board.rows.map((r, i) => (
          <Row key={`${r.slot}-${i}`} r={r} />
        ))}
      </div>
      <div className="border-t bg-muted/30 px-3 py-1 text-[11px] font-medium text-muted-foreground">
        Bench and IL
      </div>
      <div className="divide-y border-t">
        {reserves.map((r, i) => (
          <Row key={`${r.slot}-${i}`} r={r} />
        ))}
      </div>
    </div>
  );
}
