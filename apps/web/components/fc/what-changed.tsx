// The season outlook's "what changed" list: teams whose odds moved since the previous run,
// beside the roster moves behind them (League page).

import type { TeamMove } from "@/lib/nba/changes";
import type { OutlookTeam } from "@/lib/nba/outlook-run";
import { cn } from "@/lib/utils";

const pct = (v: number) => (v < 0.005 && v > 0 ? "<1%" : `${Math.round(v * 100)}%`);
const pts = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString("en-US")}`;
const names = (ps: { name: string }[]) => ps.map((p) => p.name).join(", ");

function MoveLine({ m }: { m: TeamMove }) {
  const verb =
    m.type === "TRADE" ? (
      <>
        traded {names(m.drops)} for {names(m.adds)}
      </>
    ) : (
      <>
        {m.adds.length > 0 && <>added {names(m.adds)}</>}
        {m.adds.length > 0 && m.drops.length > 0 && ", "}
        {m.drops.length > 0 && <>dropped {names(m.drops)}</>}
      </>
    );
  return (
    <li className="text-xs text-muted-foreground">
      {verb}{" "}
      <span className={cn("tabular-nums", m.net > 0 ? "text-success" : m.net < 0 && "text-danger")}>
        ({pts(m.net)} rest-of-season pts)
      </span>
    </li>
  );
}

/** Teams whose odds moved, next to the roster moves behind them. */
export function WhatChanged({
  latest,
  previous,
  moves,
  myId,
}: {
  latest: OutlookTeam[];
  previous: OutlookTeam[];
  moves: TeamMove[] | null;
  myId: number;
}) {
  const before = new Map(previous.map((t) => [t.teamId, t]));
  const rows = latest
    .map((t) => ({
      t,
      d: t.champ - (before.get(t.teamId)?.champ ?? t.champ),
      dp: t.playoffs - (before.get(t.teamId)?.playoffs ?? t.playoffs),
      moves: (moves ?? []).filter((m) => m.teamId === t.teamId),
    }))
    .filter((r) => r.moves.length > 0 || Math.abs(r.d) >= 0.01)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  if (!rows.length) {
    return (
      <p className="rounded-xl border bg-card px-3 py-3 text-sm text-muted-foreground">
        No team&apos;s title odds moved a full point, and no rosters changed.
      </p>
    );
  }
  return (
    <div className="divide-y overflow-hidden rounded-xl border bg-card">
      {rows.map(({ t, d, dp, moves: ms }) => (
        <div key={t.teamId} className="px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span
              className={cn(
                "min-w-0 text-sm font-medium break-words",
                t.teamId === myId && "text-primary",
              )}
            >
              {t.name}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              title {pct(before.get(t.teamId)?.champ ?? t.champ)} → {pct(t.champ)}{" "}
              <span
                className={cn("font-semibold", d > 0 ? "text-success" : d < 0 && "text-danger")}
              >
                ({d >= 0 ? "+" : ""}
                {Math.round(d * 100)})
              </span>
              <span className="hidden sm:inline">
                {" "}
                · playoffs {dp >= 0 ? "+" : ""}
                {Math.round(dp * 100)}
              </span>
            </span>
          </div>
          {ms.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {ms.map((m) => (
                <MoveLine key={`${m.at}-${m.adds.join()}-${m.drops.join()}`} m={m} />
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
