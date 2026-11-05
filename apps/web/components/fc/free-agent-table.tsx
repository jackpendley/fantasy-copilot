"use client";

// The free-agent pool: filter by position (G = PG or SG, F = SF or PF) and sort by any
// column. Everything happens in the browser; the URL keeps ?pos= and ?sort= for refresh and
// sharing.

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { PercentileBadge, PlayerCardButton } from "@/components/fc/player-card";
import { PlayerAvatar } from "@/components/fc/player-avatar";
import { StatusPill } from "@/components/fc/status-pill";
import { TeamLogo } from "@/components/fc/team-logo";
import { fmtPts } from "@/lib/display";
import { cn } from "@/lib/utils";
import {
  COLUMNS,
  playsPosition,
  POSITIONS,
  sortRows,
  type FreeAgentRow,
  type SortKey,
} from "@/lib/free-agents";

const PAGE = 40;
const RANK_TITLE = "Percentile among this league's rostered players";
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;

export function FreeAgentTable({
  rows,
  initialPos,
  initialSort,
}: {
  rows: FreeAgentRow[];
  initialPos: string;
  initialSort: SortKey;
}) {
  const [pos, setPos] = useState(initialPos);
  const [sort, setSort] = useState<{ key: SortKey; flipped: boolean }>({
    key: initialSort,
    flipped: false,
  });
  const [shown, setShown] = useState(PAGE);
  const remember = (next: { pos: string; sort: SortKey }) => {
    const url = new URL(window.location.href);
    if (next.pos === "All") url.searchParams.delete("pos");
    else url.searchParams.set("pos", next.pos);
    if (next.sort === "fppg") url.searchParams.delete("sort");
    else url.searchParams.set("sort", next.sort);
    window.history.replaceState(window.history.state, "", url);
  };
  const pick = (p: string) => {
    setPos(p);
    setShown(PAGE);
    remember({ pos: p, sort: sort.key });
  };
  const sortBy = (key: SortKey) => {
    const next = { key, flipped: sort.key === key ? !sort.flipped : false };
    setSort(next);
    remember({ pos, sort: key });
  };
  const list = sortRows(
    rows.filter((r) => playsPosition(r.positions, pos)),
    sort.key,
    sort.flipped,
  );

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {POSITIONS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => pick(p)}
            aria-pressed={p === pos}
            className={cn(
              "rounded-lg border px-2.5 py-1 text-xs font-medium",
              p === pos
                ? "border-primary bg-primary/10 text-primary"
                : "bg-card text-muted-foreground",
            )}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              {COLUMNS.map((c, i) => {
                const on = sort.key === c.key;
                const down = c.key === "name" ? sort.flipped : !sort.flipped;
                return (
                  <th
                    key={c.key}
                    aria-sort={on ? (down ? "descending" : "ascending") : undefined}
                    className={cn(
                      "px-2 py-2 font-medium whitespace-nowrap",
                      i === 0 ? "sticky left-0 z-10 bg-card pl-3 text-left" : "text-right",
                      i === COLUMNS.length - 1 && "pr-3",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => sortBy(c.key)}
                      className={cn(
                        "inline-flex items-center gap-0.5",
                        on ? "text-foreground" : "hover:text-foreground",
                      )}
                    >
                      {c.label}
                      {on &&
                        (down ? (
                          <ChevronDown className="size-3" />
                        ) : (
                          <ChevronUp className="size-3" />
                        ))}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y">
            {list.slice(0, shown).map((r) => (
              <tr key={r.id}>
                <td className="sticky left-0 z-10 bg-card py-2 pr-2 pl-3">
                  <PlayerCardButton id={r.id} className="flex items-center gap-2">
                    <PlayerAvatar id={r.id} name={r.name} size={28} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="font-medium break-words">{r.name}</span>
                        <StatusPill status={r.status} />
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <TeamLogo abbr={r.proTeam} size={12} />
                        {r.positions.join("/")}
                        {r.waivers && <span>· waivers</span>}
                      </div>
                    </div>
                  </PlayerCardButton>
                </td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums">
                  <div className="flex items-center justify-end gap-1.5">
                    {fmtPts(r.fppg)}
                    <PercentileBadge p={r.fppgPct} title={RANK_TITLE} />
                  </div>
                </td>
                <td className="px-2 py-2 text-right text-muted-foreground tabular-nums">
                  {r.last7 != null ? fmtPts(r.last7) : "—"}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{r.weekGames}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {r.owned != null ? `${Math.round(r.owned)}%` : "—"}
                </td>
                <td
                  className={cn(
                    "px-2 py-2 text-right text-xs tabular-nums",
                    r.change == null || Math.abs(r.change) < 0.05
                      ? "text-muted-foreground"
                      : r.change > 0
                        ? "text-success"
                        : "text-danger",
                  )}
                >
                  {r.change != null ? signed(r.change) : "—"}
                </td>
                <td className="px-2 py-2 text-right text-muted-foreground tabular-nums">
                  {Math.round(r.season)}
                </td>
                <td
                  className="py-2 pr-3 pl-2 text-right text-xs whitespace-nowrap tabular-nums"
                  title={
                    r.title
                      ? `${r.title.drop ? `Dropping ${r.title.drop}` : "Best checked move"}${r.title.updating ? " (updating)" : ""}`
                      : "Not checked by the deep check"
                  }
                >
                  {r.title ? (
                    <>
                      <span
                        className={cn(
                          "font-semibold",
                          Math.abs(r.title.d) <= 2 * r.title.se
                            ? "text-muted-foreground"
                            : r.title.d > 0
                              ? "text-success"
                              : "text-danger",
                        )}
                      >
                        {signed(r.title.d * 100)}
                      </span>
                      <span className="ml-0.5 text-[10px] text-muted-foreground">
                        ±{(2 * r.title.se * 100).toFixed(1)}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length > shown && (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE)}
          className="w-full rounded-lg border bg-card py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Show more ({list.length - shown} left)
        </button>
      )}
    </div>
  );
}
