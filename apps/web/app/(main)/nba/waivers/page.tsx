import Link from "next/link";
import { AddDropButton } from "@/components/add-drop-button";
import { Callout, PageHeader, SectionTitle } from "@/components/fc/bits";
import { PlayerAvatar } from "@/components/fc/player-avatar";
import { Pill, StatusPill } from "@/components/fc/status-pill";
import { TeamLogo } from "@/components/fc/team-logo";
import { ErrorNotice, SetupNotice } from "@/components/setup-notice";
import { SetupError } from "@/lib/env";
import { fmtPts, fmtTip } from "@/lib/format";
import { loadWaiverView } from "@/lib/nba/waivers-view";
import type { StreamOption, WaiverCandidate } from "@/lib/nba/waivers";
import { cn } from "@/lib/utils";

const POSITIONS = ["All", "PG", "SG", "SF", "PF", "C"] as const;
const signed = (n: number, digits = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
const clearsAt = (ms: number) =>
  `${new Date(ms).toLocaleDateString("en-US", { weekday: "short", timeZone: process.env.DISPLAY_TZ || "America/Phoenix" })} ${fmtTip(new Date(ms).toISOString())}`;

function Who({ c }: { c: WaiverCandidate }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <PlayerAvatar id={c.player.id} name={c.player.name} size={40} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{c.player.name}</span>
          <StatusPill status={c.player.injuryStatus ?? "ACTIVE"} />
          {c.status === "WAIVERS" && <Pill tone="info">Waivers</Pill>}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <TeamLogo abbr={c.player.proTeam} size={14} />
          {c.player.positions.join("/")} · {fmtPts(c.fppg)} FP/G · {c.weekGames} game
          {c.weekGames === 1 ? "" : "s"} left this week
        </div>
      </div>
    </div>
  );
}

function OptionRow({
  o,
  addsLeft,
  addsCap,
}: {
  o: StreamOption;
  addsLeft: number;
  addsCap: number;
}) {
  return (
    <div className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <Who c={o.add} />
        <div className="mt-2 flex items-center gap-1.5 pl-[50px] text-xs text-muted-foreground">
          {o.drop ? (
            <>
              <span className="font-medium text-danger">Drop</span>
              <PlayerAvatar id={o.drop.id} name={o.drop.name} size={20} />
              <span className="truncate text-foreground">{o.drop.name}</span>
            </>
          ) : o.il ? (
            <>
              <span className="font-medium text-warning">Move to IL</span>
              <PlayerAvatar id={o.il.id} name={o.il.name} size={20} />
              <span className="truncate text-foreground">{o.il.name}</span>
              <span className="hidden sm:inline">· he&apos;s ruled out, so no drop needed</span>
            </>
          ) : (
            <span>Open roster spot: no drop needed</span>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 pl-[50px] sm:pl-0">
        <div className="text-right">
          {o.deltaWin != null && (
            <div
              className={cn(
                "text-lg font-semibold tabular-nums",
                o.deltaWin > 0.0005 ? "text-success" : "text-muted-foreground",
              )}
            >
              {signed(o.deltaWin * 100)}% win
            </div>
          )}
          <div className="text-xs text-muted-foreground tabular-nums">
            {signed(o.deltaPts)} pts · {signed(o.deltaStarts, 0)} starts
          </div>
          <div
            className={cn(
              "text-xs tabular-nums",
              o.rosDelta < -20 ? "text-warning" : "text-muted-foreground",
            )}
            title="Rest-of-season value gained or lost (fantasy points)"
          >
            Season {signed(o.rosDelta, 0)}
          </div>
        </div>
        {o.il ? (
          <p className="max-w-40 text-right text-xs text-muted-foreground">
            Move {o.il.name.split(" ").at(-1)} to IL in the ESPN app first, then add here. When
            he&apos;s healthy, someone has to be dropped.
          </p>
        ) : (
          <AddDropButton
            move={{
              addId: o.add.player.id,
              addName: o.add.player.name,
              dropId: o.drop?.id ?? null,
              dropName: o.drop?.name ?? null,
              claim: o.add.status === "WAIVERS",
              claimNote: o.add.waiverUntil
                ? `Claims process ${clearsAt(o.add.waiverUntil)}.`
                : null,
              addsLeft,
              addsCap,
              rosCost: Math.max(0, -o.rosDelta),
            }}
          />
        )}
      </div>
    </div>
  );
}

export default async function WaiversPage({
  searchParams,
}: {
  searchParams: Promise<{ pos?: string }>;
}) {
  const { pos: posParam } = await searchParams;
  const pos = POSITIONS.includes(posParam as (typeof POSITIONS)[number]) ? posParam! : "All";

  let v;
  try {
    v = await loadWaiverView();
  } catch (e) {
    if (e instanceof SetupError) return <SetupNotice message={e.message} />;
    return <ErrorNotice title="Couldn't load waivers" message={(e as Error).message} />;
  }
  const { analysis, view, addsCap, addsUsed } = v;
  const addsLeft = Math.max(0, addsCap - addsUsed);
  const onWaivers = v.freeAgents.filter((f) => f.status === "WAIVERS");
  const nextClear = onWaivers
    .map((f) => f.waiverUntil ?? 0)
    .filter(Boolean)
    .sort((a, b) => a - b)[0];
  const best = analysis.thisWeek
    .filter((o) => o.deltaWin == null || o.deltaWin > 0.0005)
    .slice(0, 6);
  const shown = new Set(best.map((o) => o.add.player.id));
  const longTerm = analysis.longTerm.filter((o) => !shown.has(o.add.player.id)).slice(0, 5);
  const pool = analysis.candidates
    .filter((c) => pos === "All" || c.player.positions.includes(pos))
    .slice(0, 40);

  return (
    <>
      <PageHeader
        title="Waivers & streaming"
        subtitle={`Week ${view.mp} · ${addsLeft} of ${addsCap} adds left${
          analysis.baseWin != null ? ` · ${Math.round(analysis.baseWin * 100)}% to win now` : ""
        }`}
      />

      {onWaivers.length > 0 && nextClear && (
        <Callout tone="info">
          {onWaivers.length === v.freeAgents.length
            ? "Every available player is"
            : `${onWaivers.length} players are`}{" "}
          on waivers until {clearsAt(nextClear)}. Claims process then (in waiver order); after that,
          free agents can be added instantly.
        </Callout>
      )}

      <section className="space-y-1.5">
        <SectionTitle aside="Ranked by change in this week's win chance">
          Best moves this week
        </SectionTitle>
        {best.length ? (
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {best.map((o) => (
              <OptionRow key={o.add.player.id} o={o} addsLeft={addsLeft} addsCap={addsCap} />
            ))}
          </div>
        ) : (
          <Callout tone="info">No add raises your chance of winning this week right now.</Callout>
        )}
      </section>

      {longTerm.length > 0 && (
        <section className="space-y-1.5">
          <SectionTitle aside="Ranked by rest-of-season value; this week's cost shown">
            Best long-term adds
          </SectionTitle>
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {longTerm.map((o) => (
              <OptionRow key={o.add.player.id} o={o} addsLeft={addsLeft} addsCap={addsCap} />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-1.5">
        <SectionTitle>Free agents</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {POSITIONS.map((p) => (
            <Link
              key={p}
              href={p === "All" ? "/nba/waivers" : `/nba/waivers?pos=${p}`}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs font-medium",
                p === pos
                  ? "border-primary bg-primary/10 text-primary"
                  : "bg-card text-muted-foreground",
              )}
            >
              {p}
            </Link>
          ))}
        </div>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-3 py-2.5 text-left font-medium">Player</th>
                <th className="px-3 py-2.5 text-right font-medium">FP/G</th>
                <th className="hidden px-3 py-2.5 text-right font-medium sm:table-cell">Last 7</th>
                <th className="px-3 py-2.5 text-right font-medium">Wk G</th>
                <th className="hidden px-3 py-2.5 text-right font-medium sm:table-cell">Owned</th>
                <th className="px-3 py-2.5 text-right font-medium" title="Rest-of-season value">
                  Season
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pool.map((c) => (
                <tr key={c.player.id}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <PlayerAvatar id={c.player.id} name={c.player.name} size={28} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="max-w-36 truncate font-medium sm:max-w-none">
                            {c.player.name}
                          </span>
                          <StatusPill status={c.player.injuryStatus ?? "ACTIVE"} />
                        </div>
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <TeamLogo abbr={c.player.proTeam} size={12} />
                          {c.player.positions.join("/")}
                          {c.status === "WAIVERS" && <span>· waivers</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {fmtPts(c.fppg)}
                  </td>
                  <td className="hidden px-3 py-2 text-right text-muted-foreground tabular-nums sm:table-cell">
                    {c.player.last7?.avg != null && c.player.last7.total
                      ? fmtPts(c.player.last7.avg)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.weekGames}</td>
                  <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">
                    {c.player.percentOwned != null ? `${Math.round(c.player.percentOwned)}%` : "—"}
                    {c.player.percentChange != null && Math.abs(c.player.percentChange) >= 0.5 && (
                      <span
                        className={cn(
                          "ml-1 text-[11px]",
                          c.player.percentChange > 0 ? "text-success" : "text-danger",
                        )}
                      >
                        {signed(c.player.percentChange)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                    {Math.round(c.ros)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-1 text-xs text-muted-foreground">
          FP/G = projected fantasy points per game (league scoring). Wk G = games he can still play
          this week. Season = projected points from games after this week. Best moves re-run your
          daily lineups for the rest of the week with the add in place of the drop.
        </p>
      </section>
    </>
  );
}
