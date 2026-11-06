// The worker's season simulation of a trade (thousands of seasons, ADR-058/059): Trades'
// evaluation and the Interested list's "Trade for him" packages.

import type { ShownSim, ShownState } from "@/lib/nba/move-shown";
import { cn } from "@/lib/utils";

/** A title or playoff change in percentage points ("+1.2"). */
export const pts = (d: number) => `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}`;

/** The worker's season simulation of a trade idea (thousands of seasons, ADR-058/059). */
export function DeepTrade({ sim, state }: { sim: ShownSim; state: ShownState | undefined }) {
  const row = (label: string, d: { d: number; se: number }, wins = false) => (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">
        <span
          className={cn(
            "font-semibold",
            Math.abs(d.d) <= 2 * d.se
              ? "text-muted-foreground"
              : d.d > 0
                ? "text-success"
                : "text-danger",
          )}
        >
          {wins ? `${d.d >= 0 ? "+" : ""}${d.d.toFixed(2)}` : pts(d.d)}
        </span>
        <span className="ml-1 text-xs text-muted-foreground">
          ±{wins ? (2 * d.se).toFixed(2) : (2 * d.se * 100).toFixed(1)}
        </span>
      </span>
    </div>
  );
  return (
    <div className="space-y-1 rounded-lg border p-3 text-sm">
      <p className="text-xs text-muted-foreground">
        Your season, simulated with and without it ({sim.seasons.toLocaleString("en-US")} seasons
        {sim.refining ? ", refining" : ""}
        {state === "updating" ? "; updating after the latest roster news or moves" : ""})
      </p>
      {row("Title odds", sim.title)}
      {row("Playoff odds", sim.playoffs)}
      {row("Expected wins", sim.wins, true)}
      <p className="text-xs text-muted-foreground">
        Chance it raises your title odds: {Math.round(sim.pBetter * 100)}%
      </p>
    </div>
  );
}
