"use client";

// The player page's season view: this season or last (toggle, kept in ?season=), with the
// card's numbers (fantasy splits, advanced stats with league percentiles, shot profile), every
// game's fantasy points as a chart and the full game log, colored like the card.

import { useState } from "react";
import { SectionTitle } from "@/components/fc/bits";
import { ContributionBars, SeasonNumbers } from "@/components/fc/player-card";
import { TeamLogo } from "@/components/fc/team-logo";
import { FitWidth } from "@/components/fc/fit-text";
import { FpChart } from "@/components/fp-chart";
import { fmtPts, fpTone, toneText } from "@/lib/display";
import type { LogGame, PlayerCardData } from "@/lib/nba/player-card";
import { cn } from "@/lib/utils";

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    timeZone: "America/New_York",
  });

const COLS = ["MIN", "PTS", "REB", "AST", "STL", "BLK", "3PM", "TO"];

export function PlayerSeasons({
  card,
  logs,
  initial,
}: {
  card: PlayerCardData;
  logs: { current: LogGame[]; last: LogGame[] };
  initial: "current" | "last";
}) {
  const [which, setWhich] = useState(initial);
  const pick = (k: "current" | "last") => {
    setWhich(k);
    const url = new URL(window.location.href);
    if (k === "current") url.searchParams.delete("season");
    else url.searchParams.set("season", "last");
    window.history.replaceState(window.history.state, "", url);
  };
  const season = card.seasons[which];
  const games = logs[which].filter((g) => !g.playoffs);
  const avg = season.split?.fppg ?? null;
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border bg-card p-0.5" role="tablist">
        {(["current", "last"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={which === k}
            onClick={() => pick(k)}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              which === k
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {card.seasons[k].label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border bg-card pt-4">
        <SeasonNumbers s={season} />
      </div>

      {games.length > 0 ? (
        <>
          <section className="space-y-1.5">
            <SectionTitle aside={season.label}>Fantasy points by game</SectionTitle>
            <div className="rounded-xl border bg-card p-3">
              <FpChart
                average={avg}
                projection={which === "current" ? card.projection.best : null}
                points={games.map((g) => ({
                  label: shortDate(g.date),
                  opponent: g.opponent,
                  fp: g.fp,
                  rolling: g.rolling,
                  minutes: g.line.MIN ?? null,
                }))}
              />
            </div>
            <p className="px-1 text-xs text-muted-foreground">
              Green bars: 25%+ above his average; red: 40%+ below. The line is his 5-game average;
              dashed lines his season average
              {which === "current" ? " and today's projection" : ""}.
            </p>
          </section>

          {which === "current" && card.contributions.length > 0 && (
            <section className="space-y-1.5">
              <SectionTitle>Where his points come from (per game)</SectionTitle>
              <div className="rounded-xl border bg-card p-3">
                <ContributionBars items={card.contributions} />
              </div>
            </section>
          )}

          <section className="space-y-1.5">
            <SectionTitle aside="League scoring">Game log</SectionTitle>
            <FitWidth className="rounded-xl border bg-card text-sm">
              <table className="w-full tabular-nums">
                <thead>
                  <tr className="border-b text-[0.86em] text-muted-foreground">
                    <th className="sticky left-0 z-10 bg-card pr-[0.35em] pl-[0.7em] sm:px-[1em] py-2.5 text-left font-medium">
                      Game
                    </th>
                    <th className="px-[0.35em] sm:px-[0.66em] py-2.5 text-right font-medium">FP</th>
                    {COLS.map((c) => (
                      <th
                        key={c}
                        className="px-[0.35em] sm:px-[0.66em] py-2.5 text-right font-medium"
                      >
                        {c}
                      </th>
                    ))}
                    <th className="px-[0.35em] sm:px-[0.66em] py-2.5 text-right font-medium">FG</th>
                    <th className="pr-[0.7em] pl-[0.35em] sm:px-[1em] py-2.5 text-right font-medium">
                      FT
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {[...logs[which]].reverse().map((g) => (
                    <tr key={g.gameId}>
                      <td className="sticky left-0 z-10 bg-card pr-[0.3em] pl-[0.6em] sm:px-[0.86em] py-2">
                        <div className="flex items-center gap-[0.4em] whitespace-nowrap">
                          <span className="w-[2.6em] text-muted-foreground">
                            {shortDate(g.date)}
                          </span>
                          <span className="text-muted-foreground">{g.home ? "vs" : "@"}</span>
                          <TeamLogo abbr={g.opponent} size={14} />
                          <span className="font-medium">{g.opponent}</span>
                          {g.playoffs && (
                            <span className="text-[10px] text-muted-foreground">playoffs</span>
                          )}
                        </div>
                      </td>
                      <td
                        className={cn(
                          "px-[0.3em] sm:px-[0.57em] py-2 text-right font-semibold",
                          toneText(fpTone(g.fp, avg, g.line.MIN)),
                        )}
                      >
                        {fmtPts(g.fp)}
                      </td>
                      {COLS.map((c) => (
                        <td key={c} className="px-[0.3em] sm:px-[0.57em] py-2 text-right">
                          {g.line[c] ?? 0}
                        </td>
                      ))}
                      <td className="px-[0.3em] sm:px-[0.57em] py-2 text-right text-muted-foreground">
                        {g.line.FGM ?? 0}-{g.line.FGA ?? 0}
                      </td>
                      <td className="pr-[0.6em] pl-[0.3em] sm:px-[0.86em] py-2 text-right text-muted-foreground">
                        {g.line.FTM ?? 0}-{g.line.FTA ?? 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </FitWidth>
            <p className="px-1 text-xs text-muted-foreground">
              Every game, newest first. Green: 25%+ above his average; red: 40%+ below; a game he
              didn&apos;t play is neither.
            </p>
          </section>
        </>
      ) : (
        <p className="rounded-xl border bg-card px-3 py-3 text-sm text-muted-foreground">
          No games in {season.label}.
        </p>
      )}
    </div>
  );
}
