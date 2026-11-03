"use client";

// League standings with the season odds, sortable by any column (tap a header; tap again to
// flip). Phones get one card per team and a sort menu. The URL keeps ?sort= for refresh and
// sharing.

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ProbBar } from "@/components/fc/bits";
import type { StandingsSort } from "@/lib/standings";
import { cn } from "@/lib/utils";

export interface StandingsRow {
  id: number;
  /** Place in the standings (wins, then points for). */
  rank: number;
  name: string;
  mine: boolean;
  wins: number;
  losses: number;
  pf: number;
  perWeek: number;
  power: number;
  odds: {
    expWins: number;
    playoffs: number;
    seed1: number;
    /** Null on runs from before byes were counted. */
    bye: number | null;
    final: number;
    champ: number;
    act: number;
  } | null;
}

const COLUMNS = [
  { key: "rank", label: "#", odds: false },
  { key: "name", label: "Team", odds: false },
  { key: "record", label: "W-L", odds: false },
  { key: "pf", label: "PF", odds: false },
  { key: "perWeek", label: "Pts/wk", odds: false },
  { key: "expWins", label: "Exp. W", odds: true },
  { key: "playoffs", label: "Playoffs", odds: true },
  { key: "bye", label: "Bye", odds: true },
  { key: "seed1", label: "#1", odds: true },
  { key: "final", label: "Final", odds: true },
  { key: "champ", label: "Title", odds: true },
  { key: "act", label: "Active", odds: true },
] as const;

/** Biggest first, except rank and name (A-Z / 1st first). */
function value(r: StandingsRow, key: StandingsSort): number | string {
  switch (key) {
    case "rank":
      return -r.rank;
    case "name":
      return r.name.toLowerCase();
    case "record":
      return r.wins - r.losses + r.pf / 1e7;
    case "pf":
      return r.pf;
    case "perWeek":
      return r.perWeek;
    default:
      return r.odds?.[key] ?? -1;
  }
}

export function sortStandings(rows: StandingsRow[], key: StandingsSort, flipped: boolean) {
  return [...rows].sort((a, b) => {
    const va = value(a, key);
    const vb = value(b, key);
    const c =
      typeof va === "string" ? va.localeCompare(vb as string) : (vb as number) - (va as number);
    return (flipped ? -c : c) || a.rank - b.rank;
  });
}

const pct = (v: number | null | undefined) =>
  v == null ? "—" : v < 0.005 && v > 0 ? "<1%" : `${Math.round(v * 100)}%`;

export function StandingsTable({
  rows,
  initialSort,
  showOdds,
}: {
  rows: StandingsRow[];
  initialSort: StandingsSort;
  showOdds: boolean;
}) {
  const [sort, setSort] = useState({ key: initialSort, flipped: false });
  const sortBy = (key: StandingsSort, flipped?: boolean) => {
    const next = { key, flipped: flipped ?? (sort.key === key ? !sort.flipped : false) };
    setSort(next);
    const url = new URL(window.location.href);
    if (key === "rank") url.searchParams.delete("sort");
    else url.searchParams.set("sort", key);
    window.history.replaceState(window.history.state, "", url);
  };
  const columns = COLUMNS.filter((c) => showOdds || !c.odds);
  const list = sortStandings(rows, sort.key, sort.flipped);
  const maxTitle = Math.max(0.0001, ...rows.map((r) => r.odds?.champ ?? 0));

  return (
    <>
      {/* Phones and tablets: a sort menu and one card per team. */}
      <div className="space-y-1.5 lg:hidden">
        <label className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          Sort by
          <select
            value={sort.key}
            onChange={(e) => sortBy(e.target.value as StandingsSort, false)}
            className="rounded-md border bg-card px-2 py-1 text-xs text-foreground"
          >
            {columns.map((c) => (
              <option key={c.key} value={c.key}>
                {c.key === "rank" ? "Standings" : c.label === "#1" ? "#1 seed" : c.label}
              </option>
            ))}
          </select>
        </label>
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {list.map((r) => (
            <TeamCard key={r.id} r={r} />
          ))}
        </div>
      </div>

      {/* Desktop: one table. */}
      <div className="hidden overflow-hidden rounded-xl border bg-card lg:block">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              {columns.map((c) => {
                const on = sort.key === c.key;
                const down = c.key === "name" || c.key === "rank" ? sort.flipped : !sort.flipped;
                const left = c.key === "name" || c.key === "playoffs" || c.key === "champ";
                return (
                  <th
                    key={c.key}
                    aria-sort={on ? (down ? "descending" : "ascending") : undefined}
                    className={cn(
                      "px-2 py-2.5 font-medium whitespace-nowrap",
                      left ? "text-left" : "text-right",
                      c.key === "rank" && "w-8 pl-3 text-left",
                      (c.key === "playoffs" || c.key === "champ") && "w-32",
                      c.key === "act" && "pr-3",
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
            {list.map((t) => {
              const r = t.odds;
              return (
                <tr key={t.id} className={cn(t.mine && "bg-primary/5")}>
                  <td className="py-2 pr-2 pl-3 text-muted-foreground">{t.rank}</td>
                  <td className="px-2 py-2">
                    <Link
                      href={`/nba/league/${t.id}`}
                      className={cn(
                        "break-words hover:underline",
                        t.mine && "font-semibold text-primary",
                      )}
                    >
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-right">
                    {t.wins}-{t.losses}
                  </td>
                  <td className="px-2 py-2 text-right text-muted-foreground">{Math.round(t.pf)}</td>
                  <td className="px-2 py-2 text-right">
                    <span className="font-semibold">{Math.round(t.perWeek)}</span>{" "}
                    <span className="text-xs text-muted-foreground">#{t.power}</span>
                  </td>
                  {showOdds && (
                    <>
                      <td className="px-2 py-2 text-right">{r ? r.expWins.toFixed(1) : "—"}</td>
                      <td className="px-2 py-2">
                        {r && (
                          <div className="flex items-center gap-2">
                            <ProbBar value={r.playoffs} tone="info" />
                            <span className="w-9 text-right">{pct(r.playoffs)}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">{pct(r?.bye)}</td>
                      <td className="px-2 py-2 text-right">{pct(r?.seed1)}</td>
                      <td className="px-2 py-2 text-right">{pct(r?.final)}</td>
                      <td className="px-2 py-2">
                        {r && (
                          <div className="flex items-center gap-2">
                            <ProbBar value={r.champ / maxTitle} />
                            <span className="w-9 text-right font-semibold">{pct(r.champ)}</span>
                          </div>
                        )}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right",
                          r && r.act < 0.4 ? "text-danger" : "text-muted-foreground",
                        )}
                      >
                        {r ? `${Math.round(r.act * 100)}%` : "—"}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TeamCard({ r }: { r: StandingsRow }) {
  const o = r.odds;
  return (
    <Link
      href={`/nba/league/${r.id}`}
      className={cn(
        "flex items-center gap-3 px-3 py-3 hover:bg-muted/50",
        r.mine && "bg-primary/5",
      )}
    >
      <span className="w-5 text-center text-sm text-muted-foreground tabular-nums">{r.rank}</span>
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm break-words", r.mine && "font-semibold text-primary")}>
          {r.name}
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
          <span className="font-medium text-foreground">
            {r.wins}-{r.losses}
          </span>
          {[
            `${Math.round(r.pf)} PF`,
            `${Math.round(r.perWeek)} pts/wk (#${r.power})`,
            ...(o
              ? [
                  `${o.expWins.toFixed(1)} exp W`,
                  `playoffs ${pct(o.playoffs)}`,
                  ...(o.bye != null ? [`bye ${pct(o.bye)}`] : []),
                  `#1 ${pct(o.seed1)}`,
                  `${Math.round(o.act * 100)}% active`,
                ]
              : []),
          ].map((x) => ` · ${x}`)}
        </div>
        {o && <ProbBar value={o.playoffs} tone="info" className="mt-1.5" />}
      </div>
      {o && (
        <div className="w-14 text-right">
          <div className="text-lg font-semibold tabular-nums">{pct(o.champ)}</div>
          <div className="text-[10px] text-muted-foreground">title</div>
        </div>
      )}
    </Link>
  );
}
