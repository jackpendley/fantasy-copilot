"use client";

// ESPN-style head-to-head board: one fixed-height row per lineup slot (your player left, theirs
// right, both scores next to the slot), then the bench and IL, padded to the league's slot
// counts so the board is the same size every day. Tap a player for his card.

import { compactStatus, fmtPts, keepStatsTogether, shortName } from "@/lib/display";
import type { H2HCell, H2HGame, H2HRow } from "@/lib/nba/h2h";
import { statSummary } from "@/lib/nba/live";
import { cn } from "@/lib/utils";
import { TrendMark } from "./trend-mark";
import { FitText } from "./fit-text";
import { PlayerAvatar } from "./player-avatar";
import { PlayerCardButton } from "./player-card";
import { StatusPill } from "./status-pill";
import { TeamLogo } from "./team-logo";

// Each side is laid out like a Today row, mirrored: photo, then three lines (name with logo and
// positions, the day's game, his stats), then points over the projection by the slot column.
// Phones in portrait have no room for the photo, so they show the same thing without it. Every
// row has the same fixed height, each line on one line (shrunk to fit when it must).
const ROW = "h-[58px] sm:h-[76px]";

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

const projTitle = (c: H2HCell) =>
  c.points == null
    ? "Projection"
    : c.game?.state === "in"
      ? "Projected final: points so far plus the rest of his projection"
      : "Pregame projection";

/**
 * Points (or "–" before tip), and under them the projection, unlabeled, with ▲/▼. On phones the
 * two sit level with the name and game lines beside them.
 */
function Score({ c, right }: { c: H2HCell; right: boolean }) {
  const live = c.game?.state === "in";
  return (
    <div className={cn("w-8 shrink-0 sm:w-12 md:w-16", right ? "text-left" : "text-right")}>
      <div
        className={cn(
          "text-[length:calc(14px*var(--fit,1))] leading-4 font-semibold tabular-nums sm:text-lg sm:leading-tight",
          live && "text-success",
          c.points == null && "text-muted-foreground",
        )}
      >
        <span className="relative">
          {c.points != null ? fmtPts(c.points) : c.game ? "–" : ""}
          {/* While his game is on: green on the court, grey on the bench (outside the text, so
              nothing moves). */}
          {live && c.onCourt != null && (
            <span
              className={cn(
                "absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full",
                right ? "-right-2.5" : "-left-2.5",
                c.onCourt ? "bg-success" : "bg-muted-foreground/40",
              )}
              title={c.onCourt ? "On the court" : "On the bench"}
              aria-label={c.onCourt ? "On the court" : "On the bench"}
            />
          )}
        </span>
      </div>
      {c.proj != null && (
        <div
          className={cn(
            "flex items-center gap-0.5 text-[length:calc(10.5px*var(--fit,1))] leading-[13px] text-muted-foreground tabular-nums sm:mt-0.5 sm:text-xs sm:leading-normal",
            right ? "justify-start" : "justify-end",
          )}
          title={projTitle(c)}
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
          "flex items-center px-2 text-[length:calc(12px*var(--fit,1))] text-muted-foreground sm:px-3 sm:text-xs",
          !right && "justify-end",
        )}
      >
        Empty
      </div>
    );
  }
  const stats = c.line ? keepStatsTogether(statSummary(c.line)) : null;
  // Logo, name, positions and status. On phones the name shrinks to fit instead of being cut.
  const nameLine = (phone: boolean) => (
    <div className={cn("flex min-w-0 items-center gap-0.5 sm:gap-1", right && "flex-row-reverse")}>
      <TeamLogo abbr={c.player.proTeam} size={14} />
      {phone ? (
        <FitText className="text-[length:calc(12px*var(--fit,1))] leading-4 font-medium">
          {shortName(c.player.name)}
        </FitText>
      ) : (
        <span className="min-w-0 truncate text-[13px] font-medium md:text-sm">
          <span className="md:hidden">{shortName(c.player.name)}</span>
          <span className="hidden md:inline">{c.player.name}</span>
        </span>
      )}
      <span className="shrink-0 text-[length:calc(9px*var(--fit,1))] text-muted-foreground sm:text-[10px] md:text-[11px]">
        {c.player.positions.join("/")}
      </span>
      <StatusPill
        status={c.status}
        short={phone}
        className="h-4 px-1 text-[length:calc(9.5px*var(--fit,1))] md:h-5 md:px-1.5 md:text-[11px]"
      />
    </div>
  );
  return (
    <PlayerCardButton
      id={c.player.id}
      className={cn(
        ROW,
        "flex items-center px-0.5 hover:bg-muted/40 sm:gap-2 sm:px-3",
        right && "flex-row-reverse",
        !c.game && "opacity-55",
        c.game?.state === "in" && "bg-success/5",
      )}
    >
      {/* Phones in portrait: the Today row without the photo. Three single lines in a fixed
          height; when one is too wide, all the board's text shrinks together (FitGroup in
          matchup-days.tsx). The score sits in the corner beside the name and game, so the
          stats line gets the cell's full width. */}
      <div className={cn("relative h-full min-w-0 flex-1 py-2 sm:hidden", right && "text-right")}>
        <div className={cn(right ? "pl-[34px]" : "pr-[34px]")}>
          {nameLine(true)}
          <FitText className="text-[length:calc(10px*var(--fit,1))] leading-[13px] text-muted-foreground tabular-nums">
            {c.back ?? <PhoneGame game={c.game} />}
          </FitText>
        </div>
        {stats && (
          <FitText className="text-[length:calc(10.5px*var(--fit,1))] leading-[13px] tracking-tight text-foreground/80 tabular-nums">
            <PhoneStats line={c.line!} />
          </FitText>
        )}
        {(c.game || c.points != null || c.proj != null) && (
          <div className={cn("absolute top-2", right ? "left-0" : "right-0")}>
            <Score c={c} right={right} />
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
        {nameLine(false)}
        <div className="truncate text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">
          {c.back ?? <GameText game={c.game} />}
        </div>
        {stats && (
          <div className="line-clamp-2 text-[11px] leading-[14px] text-foreground/80 tabular-nums">
            {stats}
          </div>
        )}
      </div>
      <div className="hidden sm:block">
        <Score c={c} right={right} />
      </div>
    </PlayerCardButton>
  );
}

/** "19 PTS 7 REB 11 AST" with the labels a little smaller than the numbers, to fit more. */
function PhoneStats({ line }: { line: Record<string, number> }) {
  const parts = [...(statSummary(line) ?? "").matchAll(/(-?\d+) (\S+)/g)];
  return parts.map(([, n, label], i) => (
    <span key={label}>
      {i > 0 && " "}
      {n}
      <span className="text-[0.85em]">{`\u00a0${label}`}</span>
    </span>
  ));
}

/** "@ [logo] BOS 82-77 Q4 10:37" for a phone row. */
function PhoneGame({ game }: { game: H2HGame | null }) {
  if (!game) return <span>No game</span>;
  return (
    <>
      <span className="whitespace-nowrap">
        {game.home ? "vs" : "@"}{" "}
        <TeamLogo abbr={game.opponent} size={12} className="align-[-2px]" /> {game.opponent}
      </span>{" "}
      <span
        className={cn("whitespace-nowrap", game.state === "in" && "font-semibold text-success")}
      >
        {compactStatus(game)}
      </span>
    </>
  );
}

function Row({ r }: { r: H2HRow }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_1.625rem_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_2.75rem_minmax(0,1fr)] items-stretch">
      <Cell c={r.mine} side="mine" />
      <div className="flex items-center justify-center border-x bg-muted/30">
        <span className="rounded bg-muted px-0.5 py-0.5 font-mono text-[length:calc(9px*var(--fit,1))] font-semibold text-muted-foreground sm:px-1 sm:text-[11px]">
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
    // Wider than the page gutter on phones (4 px from the screen's edges), for the longest lines.
    <div className="-mx-3 overflow-hidden rounded-xl border bg-card sm:mx-0">
      <div className="grid grid-cols-[minmax(0,1fr)_1.625rem_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_2.75rem_minmax(0,1fr)] border-b bg-muted/40 text-xs font-medium text-muted-foreground">
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
