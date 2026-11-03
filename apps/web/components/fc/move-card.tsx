"use client";

// One recommended add on the Waivers page: what it does to the title odds, playoffs, #1 seed,
// expected wins and this week's matchup, with exact numbers. The drop can be swapped for any
// other player on the roster; the numbers follow the choice.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AddDropButton } from "@/components/add-drop-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface MoveOption {
  /** addId:dropId:ilId (lib/nba/move-checks.ts moveKey). */
  key: string;
  dropId: number | null;
  dropName: string | null;
  /** Moved to IL instead of a drop. */
  ilId: number | null;
  ilName: string | null;
  /** This week: projected lineup points and change in win chance (null on a bye). */
  deltaPts: number;
  deltaWin: number | null;
  /** After this week: lineup points (playoff days count double) and their worth in wins. */
  laterPts: number;
  laterWins: number;
  /** This week's win-chance change plus laterWins. */
  netWins: number;
  addStarts: number | null;
  addGames: number | null;
  dropStarts: number | null;
  /** Rest-of-season points given up, for the confirm dialog. */
  rosCost: number;
}

export interface Delta {
  d: number;
  se: number;
}

export interface MoveSim {
  title: Delta;
  playoffs: Delta;
  seed1: Delta;
  wins: Delta;
  seasons: number;
  /** From the worker's deep check (thousands of seasons). */
  deep?: boolean;
  /** Chance the move raises the title odds at all. */
  pBetter?: number;
  /** Chance it's the best of the moves checked. */
  pBest?: number | null;
  /** Still getting seasons. */
  refining?: boolean;
  /** Stopped early: clearly worse than doing nothing. */
  dropped?: boolean;
}

export interface Outlook {
  title: number;
  playoffs: number;
  seed1: number;
  wins: number;
}

const signed = (n: number, digits = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
/** A probability for reading: never a flat 0% or 100% from a finite simulation. */
const chance = (p: number) =>
  p >= 0.995 ? ">99%" : p <= 0.005 ? "<1%" : `${Math.round(p * 100)}%`;
const tone = (n: number, eps: number) =>
  n > eps ? "text-success" : n < -eps ? "text-danger" : "text-muted-foreground";

export function MoveCard({
  who,
  addId,
  addName,
  claim,
  claimNote,
  addsLeft,
  addsCap,
  options,
  initialKey,
  sims,
  outlook,
  weekWin,
  stale,
}: {
  who: React.ReactNode;
  addId: number;
  addName: string;
  claim: boolean;
  claimNote: string | null;
  addsLeft: number;
  addsCap: number;
  /** Every way to make room for him, best first. */
  options: MoveOption[];
  initialKey: string;
  /** Season-simulation results by move key (the moves checked so far). */
  sims: Record<string, MoveSim>;
  /** The latest Outlook for Jack's team ("Now"); null before the first run. */
  outlook: Outlook | null;
  /** This week's win chance now (null on a bye). */
  weekWin: number | null;
  /** The stored checks predate a roster or injury change (re-checked overnight). */
  stale: boolean;
}) {
  const [key, setKey] = useState(initialKey);
  // Checks run from this card (a swapped drop), on top of the page's.
  const [mine, setMine] = useState<Record<string, MoveSim>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const o = options.find((x) => x.key === key) ?? options[0]!;
  const sim = mine[o.key] ?? sims[o.key];
  // A check run from this card is current; the page's stored ones may predate a change.
  const old = stale && !mine[o.key];

  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);

  async function simulate() {
    const k = o.key;
    setRunning(k);
    setElapsed(0);
    try {
      const res = await fetch("/api/waivers/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addId, dropId: o.dropId, ilId: o.ilId }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
      const e = out.effect;
      if (out.deep)
        toast.info("Quick check done. A deep check (thousands of seasons) follows within minutes.");
      setMine((m) => ({
        ...m,
        [k]: {
          title: e.title,
          playoffs: e.playoffs,
          seed1: e.seed1,
          wins: e.wins,
          seasons: e.seasons ?? 0,
        },
      }));
    } catch (err) {
      toast.error(`Simulation failed: ${(err as Error).message}`);
    } finally {
      setRunning(null);
    }
  }
  const last = (name: string) => name.split(" ").at(-1);

  // Season rows: Outlook now, with the move (now + the simulated change), the change ± margin.
  const seasonRow = (
    label: string,
    now: number | undefined,
    d: Delta | undefined,
    wins = false,
  ) => {
    const fmt = (x: number) => (wins ? x.toFixed(2) : pct(x));
    const k = wins ? 1 : 100;
    return (
      <tr key={label}>
        <th className="py-1 pr-2 text-left font-normal text-muted-foreground">{label}</th>
        <td className="px-1 py-1 text-right tabular-nums">{now != null ? fmt(now) : "—"}</td>
        <td className="px-1 py-1 text-right font-medium tabular-nums">
          {now != null && d ? fmt(now + d.d) : "—"}
        </td>
        <td className="py-1 pl-1 text-right tabular-nums">
          {d ? (
            <>
              <span
                className={cn(
                  "font-semibold",
                  // Green or red only when the change is bigger than its margin: inside it, the
                  // simulation can't tell it from no change.
                  Math.abs(d.d) > 2 * d.se
                    ? tone(d.d * k, wins ? 0.005 : 0.05)
                    : "text-muted-foreground",
                )}
              >
                {signed(d.d * k, wins ? 2 : 1)}
              </span>
              <span className="ml-1 text-[11px] text-muted-foreground">
                ±{(2 * d.se * k).toFixed(wins ? 2 : 1)}
              </span>
            </>
          ) : (
            "—"
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-2.5 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">{who}</div>
        {o.ilName ? (
          <p className="max-w-40 text-right text-xs text-muted-foreground">
            Move {last(o.ilName)} to IL in the ESPN app first, then add here.
          </p>
        ) : (
          <AddDropButton
            move={{
              addId,
              addName,
              dropId: o.dropId,
              dropName: o.dropName,
              claim,
              claimNote,
              addsLeft,
              addsCap,
              rosCost: o.rosCost,
            }}
          />
        )}
      </div>

      <label className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-[50px] text-xs">
        <span className={cn("font-medium", o.ilName ? "text-warning" : "text-danger")}>
          {o.ilName ? "Move to IL" : "Drop"}
        </span>
        <select
          value={o.key}
          onChange={(e) => setKey(e.target.value)}
          className="min-w-0 max-w-full rounded-md border bg-background px-2 py-1 text-xs text-foreground"
          aria-label={`Who to drop for ${addName} (points estimate in wins; ✓ = simulated)`}
        >
          {options.map((x) => (
            <option key={x.key} value={x.key}>
              {x.ilName ? `${x.ilName} to IL` : (x.dropName ?? "Nobody (open spot)")}
              {` · ${signed(x.netWins, 2)}`}
              {(mine[x.key] ?? sims[x.key]) ? " ✓" : ""}
            </option>
          ))}
        </select>
      </label>

      {o.addStarts != null && o.addGames != null && (
        <p className="pl-[50px] text-xs text-muted-foreground">
          Starts ~{o.addStarts} of his {o.addGames} games left for you
          {o.dropName && o.dropStarts != null && (
            <>
              {" "}
              · {last(o.dropName)} would have started {o.dropStarts}
            </>
          )}
        </p>
      )}

      <div className="ml-[50px] overflow-hidden rounded-lg border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/40 text-[11px] text-muted-foreground">
              <th className="py-1 pr-2 pl-2 text-left font-medium">
                {sim
                  ? `${sim.deep ? "Deep check" : "Season sim"} (${sim.seasons.toLocaleString("en-US")}${sim.refining ? ", refining" : ""})`
                  : "Season"}
              </th>
              <th className="px-1 py-1 text-right font-medium">Now</th>
              <th className="px-1 py-1 text-right font-medium">With move</th>
              <th className="py-1 pr-2 pl-1 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody className="[&_td:last-child]:pr-2 [&_th:first-child]:pl-2">
            {seasonRow("Title", outlook?.title, sim?.title)}
            {seasonRow("Playoffs", outlook?.playoffs, sim?.playoffs)}
            {seasonRow("#1 seed", outlook?.seed1, sim?.seed1)}
            {seasonRow("Expected wins", outlook?.wins, sim?.wins, true)}
            <tr className="border-t">
              <th className="py-1 pr-2 text-left font-normal text-muted-foreground">
                This week&apos;s matchup
              </th>
              <td className="px-1 py-1 text-right tabular-nums">
                {weekWin != null ? pct(weekWin) : "—"}
              </td>
              <td className="px-1 py-1 text-right font-medium tabular-nums">
                {weekWin != null && o.deltaWin != null ? pct(weekWin + o.deltaWin) : "—"}
              </td>
              <td className="py-1 pl-1 text-right tabular-nums">
                {o.deltaWin != null ? (
                  <span className={cn("font-semibold", tone(o.deltaWin * 100, 0.05))}>
                    {signed(o.deltaWin * 100)}
                  </span>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          </tbody>
        </table>
        {sim?.deep && sim.pBetter != null && (
          <p className="border-t px-2 py-1.5 text-[11px] text-muted-foreground tabular-nums">
            {sim.dropped
              ? "Clearly worse than doing nothing; the deep check stopped early."
              : `Chance it raises your title odds: ${chance(sim.pBetter)}${
                  sim.pBest != null
                    ? ` · chance it's the best of the moves checked: ${chance(sim.pBest)}`
                    : ""
                }`}
          </p>
        )}
        {sim && old && (
          <p className="border-t px-2 py-1.5 text-[11px] text-muted-foreground">
            Simulated before your latest roster or injury news; re-checked overnight, or simulate it
            again now below.
          </p>
        )}
        {(!sim || old) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-2 py-1.5 text-[11px] text-muted-foreground">
            <span>
              {running === o.key
                ? `Simulating… ${elapsed}s (usually 10–30 s)`
                : sim
                  ? "Re-run with the latest rosters."
                  : "Not simulated yet for this drop."}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={running != null}
              onClick={simulate}
            >
              Simulate this drop
            </Button>
          </div>
        )}
      </div>

      <p className="pl-[50px] text-xs text-muted-foreground tabular-nums">
        {sim ? "Quick estimate, if you kept him all season: " : "Lineup points: "}this week{" "}
        <span className={cn(!sim && tone(o.deltaPts, 0.5))}>{signed(o.deltaPts, 0)}</span> · rest of
        season <span className={cn(!sim && tone(o.laterPts, 0.5))}>{signed(o.laterPts, 0)}</span>
        {" · "}
        {sim ? "≈" : "points estimate "}
        <span className={cn("font-medium", !sim && tone(o.netWins, 0.005))}>
          {signed(o.netWins, 2)} wins
        </span>
        {sim && o.deltaPts > 0.5 && o.laterPts < -0.5 && (
          <>
            {" "}
            · helps now, costs later if kept. The season sim lets you swap him out again, as you
            usually do, so it doesn&apos;t charge the later points in full.
          </>
        )}
        {sim && o.deltaPts < -0.5 && o.laterPts > 0.5 && (
          <> · costs this week, pays off over the rest of the season.</>
        )}
      </p>
    </div>
  );
}
