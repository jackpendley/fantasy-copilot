"use client";

// The week's days as tabs over the head-to-head board. Every day is rendered with the page,
// so switching is instant and the board keeps its size; the URL keeps ?day= for refresh,
// sharing and the back button.

import { useState } from "react";
import { fmtPts } from "@/lib/display";
import type { Trend } from "@/lib/nba/live";
import { cn } from "@/lib/utils";
import { FitGroup } from "./fit-text";
import { H2HBoard, type BoardData } from "./h2h-board";
import { TrendMark } from "./trend-mark";

export interface MatchupDay {
  sp: number;
  label: string;
  today: boolean;
  score: { mine: number; theirs: number };
  /** ▲/▼ against the day's pregame projection, once its games have started. */
  trend?: { mine: Trend; theirs: Trend } | null;
  board: BoardData;
  note: string;
}

export function MatchupDays({
  days,
  initial,
  benchSlots,
  irSlots,
}: {
  days: MatchupDay[];
  initial: number;
  benchSlots: number;
  irSlots: number;
}) {
  const [selected, setSelected] = useState(initial);
  // Same number of bench and IL rows every day (this league's bench is unlimited), so the board
  // never changes size when switching days.
  const rows = (pick: (b: MatchupDay["board"]) => number, slots: number) =>
    Math.max(slots, ...days.map((d) => pick(d.board)));
  const benchRows = rows((b) => Math.max(b.bench.mine.length, b.bench.theirs.length), benchSlots);
  const irRows = rows((b) => Math.max(b.ir.mine.length, b.ir.theirs.length), irSlots);
  const day = days.find((d) => d.sp === selected) ?? days[0]!;
  const pick = (d: MatchupDay) => {
    setSelected(d.sp);
    const url = new URL(window.location.href);
    if (d.today) url.searchParams.delete("day");
    else url.searchParams.set("day", String(d.sp));
    window.history.replaceState(window.history.state, "", url);
  };
  return (
    <section className="space-y-2">
      <nav
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
        aria-label="Day of the matchup"
      >
        {days.map((d) => (
          <button
            key={d.sp}
            type="button"
            onClick={() => pick(d)}
            aria-pressed={d.sp === day.sp}
            className={cn(
              "rounded-lg border bg-card px-1 py-1.5 text-center transition-colors",
              d.sp === day.sp ? "border-primary ring-1 ring-primary" : "hover:bg-muted/50",
            )}
          >
            <div
              className={cn(
                "text-xs font-semibold",
                d.today ? "text-primary" : "text-muted-foreground",
              )}
            >
              {d.label}
            </div>
            <div className="text-[11px] leading-tight tabular-nums">
              <div className="flex items-center justify-center gap-px font-medium">
                {fmtPts(d.score.mine)}
                <TrendMark trend={d.trend?.mine ?? null} className="size-2" />
              </div>
              <div className="flex items-center justify-center gap-px text-muted-foreground">
                {fmtPts(d.score.theirs)}
                <TrendMark trend={d.trend?.theirs ?? null} className="size-2" />
              </div>
            </div>
          </button>
        ))}
      </nav>
      {/* One text scale for the whole week: the other days are laid out invisibly beside the
          one shown, so a long line on any day shrinks every day's text alike. */}
      <FitGroup className="relative">
        <H2HBoard board={day.board} benchSlots={benchRows} irSlots={irRows} />
        <div
          inert
          aria-hidden
          className="invisible absolute inset-x-0 top-0 h-0 overflow-hidden sm:hidden"
        >
          {days
            .filter((d) => d !== day)
            .map((d) => (
              <H2HBoard key={d.sp} board={d.board} benchSlots={benchRows} irSlots={irRows} />
            ))}
        </div>
      </FitGroup>
      <p className="px-1 text-xs text-muted-foreground">{day.note}</p>
    </section>
  );
}
