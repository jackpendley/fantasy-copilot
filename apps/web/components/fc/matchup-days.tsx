"use client";

// The week's days as tabs over the head-to-head board. Every day is rendered with the page,
// so switching is instant and the board keeps its size; the URL keeps ?day= for refresh,
// sharing and the back button.

import { useState } from "react";
import { fmtPts } from "@/lib/display";
import { cn } from "@/lib/utils";
import { H2HBoard, type BoardData } from "./h2h-board";

export interface MatchupDay {
  sp: number;
  label: string;
  today: boolean;
  score: { mine: number; theirs: number };
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
              <div className="font-medium">{fmtPts(d.score.mine)}</div>
              <div className="text-muted-foreground">{fmtPts(d.score.theirs)}</div>
            </div>
          </button>
        ))}
      </nav>
      <H2HBoard board={day.board} benchSlots={benchRows} irSlots={irRows} />
      <p className="px-1 text-xs text-muted-foreground">{day.note}</p>
    </section>
  );
}
