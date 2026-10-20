import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Callout, SectionTitle, StatTile } from "@/components/fc/bits";
import { PlayerAvatar } from "@/components/fc/player-avatar";
import { Pill, StatusPill } from "@/components/fc/status-pill";
import { TeamLogo } from "@/components/fc/team-logo";
import { FpChart } from "@/components/fp-chart";
import { ErrorNotice, SetupNotice } from "@/components/setup-notice";
import { SetupError } from "@/lib/env";
import { fmtPts } from "@/lib/format";
import { scoreGames, summarize } from "@/lib/nba/player";
import { loadPlayer } from "@/lib/nba/pool";
import { perGameProjection } from "@/lib/nba/projection";
import { cn } from "@/lib/utils";

const seasonLabel = (s: number) => `${s - 1}-${String(s).slice(2)}`;
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    timeZone: "America/New_York",
  });

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  let p;
  try {
    p = await loadPlayer(id);
  } catch (e) {
    if (e instanceof SetupError) return <SetupNotice message={e.message} />;
    return <ErrorNotice title="Couldn't load this player" message={(e as Error).message} />;
  }
  if (!p) notFound();

  const { entry, fa, injury } = p;
  const pl = entry.player;
  const rows = scoreGames(p.log, p.scoring);
  const sum = summarize(rows);
  const proj = perGameProjection(pl).fppg;
  const recent = [...rows].reverse().slice(0, 15);
  const fromLastSeason = p.logSeason !== p.season;

  return (
    <>
      <Link
        href="/nba/players"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> Players
      </Link>

      <div className="flex items-center gap-4">
        <PlayerAvatar id={pl.id} name={pl.name} size={72} />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{pl.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <TeamLogo abbr={pl.proTeam} size={18} />
            <span>
              {pl.proTeam} · {pl.positions.join("/")}
            </span>
            <StatusPill status={pl.injuryStatus ?? "ACTIVE"} note={injury?.short} />
            {entry.mine ? (
              <Pill tone="success">Your team</Pill>
            ) : entry.available ? (
              <Pill tone="info">{entry.owner}</Pill>
            ) : (
              <Pill>{entry.owner}</Pill>
            )}
          </div>
        </div>
      </div>

      {injury && (
        <Callout tone="warning">
          <span className="font-medium">{injury.status}:</span> {injury.long || injury.short}
        </Callout>
      )}
      {fa && (
        <Callout tone="info">
          {fa.status === "WAIVERS" ? "On waivers." : "Free agent."} See how he&apos;d fit your week
          on{" "}
          <Link
            href="/nba/waivers"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Waivers
          </Link>
          .
        </Callout>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          label="Projected FP/G"
          value={fmtPts(proj)}
          sub={`ESPN, ${seasonLabel(p.season)}`}
        />
        <StatTile
          label={fromLastSeason ? `FP/G ${seasonLabel(p.logSeason)}` : "FP/G this season"}
          value={sum.fppg != null ? fmtPts(sum.fppg) : "—"}
          sub={`${sum.games} regular-season game${sum.games === 1 ? "" : "s"}`}
        />
        <StatTile
          label="Last 5 games"
          value={sum.last5 != null ? fmtPts(sum.last5) : "—"}
          delta={
            sum.last5 != null && sum.fppg != null && Math.abs(sum.last5 - sum.fppg) >= 0.5
              ? {
                  text: `${sum.last5 >= sum.fppg ? "+" : ""}${fmtPts(sum.last5 - sum.fppg)} vs avg`,
                  up: sum.last5 >= sum.fppg,
                }
              : null
          }
        />
        <StatTile
          label="Minutes"
          value={sum.minutes != null ? sum.minutes.toFixed(1) : "—"}
          sub={sum.minutesLast5 != null ? `${sum.minutesLast5.toFixed(1)} last 5` : undefined}
        />
      </div>

      {rows.length > 0 ? (
        <>
          <section className="space-y-1.5">
            <SectionTitle
              aside={
                fromLastSeason
                  ? `${seasonLabel(p.logSeason)}: this season hasn't started`
                  : seasonLabel(p.logSeason)
              }
            >
              Fantasy points by game
            </SectionTitle>
            <div className="rounded-xl border bg-card p-3">
              <FpChart
                points={rows.map((r) => ({
                  label: shortDate(r.date),
                  opponent: r.opponent,
                  fp: Math.round(r.fp * 10) / 10,
                  rolling: r.rolling != null ? Math.round(r.rolling * 10) / 10 : null,
                }))}
              />
            </div>
          </section>

          <section className="space-y-1.5">
            <SectionTitle aside="League scoring">Game log</SectionTitle>
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="px-3 py-2.5 text-left font-medium">Game</th>
                    <th className="px-2 py-2.5 text-right font-medium">FP</th>
                    <th className="px-2 py-2.5 text-right font-medium">MIN</th>
                    <th className="px-2 py-2.5 text-right font-medium">PTS</th>
                    <th className="px-2 py-2.5 text-right font-medium">REB</th>
                    <th className="px-2 py-2.5 text-right font-medium">AST</th>
                    <th className="hidden px-2 py-2.5 text-right font-medium sm:table-cell">STL</th>
                    <th className="hidden px-2 py-2.5 text-right font-medium sm:table-cell">BLK</th>
                    <th className="hidden px-2 py-2.5 text-right font-medium sm:table-cell">TO</th>
                    <th className="hidden px-3 py-2.5 text-right font-medium sm:table-cell">FG</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {recent.map((r) => (
                    <tr key={r.gameId}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          <span className="w-9 text-muted-foreground">{shortDate(r.date)}</span>
                          <span className="text-muted-foreground">{r.home ? "vs" : "@"}</span>
                          <TeamLogo abbr={r.opponent} size={14} />
                          <span className="font-medium">{r.opponent}</span>
                          {r.part === "post" && (
                            <span className="hidden sm:inline">
                              <Pill tone="info">Playoffs</Pill>
                            </span>
                          )}
                        </div>
                      </td>
                      <td
                        className={cn(
                          "px-2 py-2 text-right font-semibold",
                          sum.fppg != null && r.fp >= sum.fppg * 1.25 && "text-success",
                          sum.fppg != null && r.fp <= sum.fppg * 0.6 && "text-danger",
                        )}
                      >
                        {fmtPts(r.fp)}
                      </td>
                      <td className="px-2 py-2 text-right">{r.line.MIN ?? 0}</td>
                      <td className="px-2 py-2 text-right">{r.line.PTS ?? 0}</td>
                      <td className="px-2 py-2 text-right">{r.line.REB ?? 0}</td>
                      <td className="px-2 py-2 text-right">{r.line.AST ?? 0}</td>
                      <td className="hidden px-2 py-2 text-right sm:table-cell">
                        {r.line.STL ?? 0}
                      </td>
                      <td className="hidden px-2 py-2 text-right sm:table-cell">
                        {r.line.BLK ?? 0}
                      </td>
                      <td className="hidden px-2 py-2 text-right sm:table-cell">
                        {r.line.TO ?? 0}
                      </td>
                      <td className="hidden px-3 py-2 text-right text-muted-foreground sm:table-cell">
                        {r.line.FGM ?? 0}-{r.line.FGA ?? 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-1 text-xs text-muted-foreground">
              Last {recent.length} games, newest first. Green: 25%+ above his average; red: 40%+
              below.
            </p>
          </section>
        </>
      ) : (
        <Callout tone="info">No NBA games on record for him yet.</Callout>
      )}
    </>
  );
}
