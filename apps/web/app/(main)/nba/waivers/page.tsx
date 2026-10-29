import Link from "next/link";
import { PlayerCardButton } from "@/components/fc/player-card";
import { IlPlanNote } from "@/components/fc/il-plan-note";
import { ilReturnPlan } from "@/lib/nba/il-plan";
import { AddDropButton } from "@/components/add-drop-button";
import { Callout, PageHeader, SectionTitle } from "@/components/fc/bits";
import { PlayerAvatar } from "@/components/fc/player-avatar";
import { Pill, StatusPill } from "@/components/fc/status-pill";
import { TeamLogo } from "@/components/fc/team-logo";
import { ErrorNotice, SetupNotice } from "@/components/setup-notice";
import { SetupError } from "@/lib/env";
import { fmtPts, fmtTip } from "@/lib/format";
import { loadWaiverView } from "@/lib/nba/waivers-view";
import { LiveRefresh } from "@/components/live-refresh";
import { moveChecks, moveKey, type MoveChecks } from "@/lib/nba/move-checks";
import type { Delta, MoveEffect } from "@/lib/nba/move-sim";
import { winChanceLabel } from "@/lib/nba/week";
import type { StreamOption, WaiverCandidate } from "@/lib/nba/waivers";
import { cn } from "@/lib/utils";

const POSITIONS = ["All", "PG", "SG", "SF", "PF", "C"] as const;
const signed = (n: number, digits = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
const clearsAt = (ms: number) =>
  `${new Date(ms).toLocaleDateString("en-US", { weekday: "short", timeZone: process.env.DISPLAY_TZ || "America/Phoenix" })} ${fmtTip(new Date(ms).toISOString())}`;

function Who({ c }: { c: WaiverCandidate }) {
  return (
    <PlayerCardButton id={c.player.id} className="flex min-w-0 items-center gap-2.5 rounded-md">
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
    </PlayerCardButton>
  );
}

const VERDICT: Record<MoveEffect["verdict"], { text: string; tone: string }> = {
  better: { text: "helps", tone: "text-success" },
  worse: { text: "hurts", tone: "text-danger" },
  even: { text: "about even", tone: "text-muted-foreground" },
};
const pts = (x: Delta) => `${signed(x.d * 100)}`;

/** What the season simulation says about this move (same engine as the Outlook). */
function SimCheck({ e, seasons }: { e: MoveEffect | undefined; seasons: number }) {
  if (!e)
    return (
      <div className="mt-1 pl-[50px] text-xs text-muted-foreground">
        Season simulation: checking this move…
      </div>
    );
  const v = VERDICT[e.verdict];
  return (
    <div
      className="mt-1 pl-[50px] text-xs text-muted-foreground"
      title={`${seasons.toLocaleString("en-US")} simulated seasons with and without the move, same random draws. ± is two standard errors.`}
    >
      Season sim: title {pts(e.title)} pts (±{(2 * e.title.se * 100).toFixed(1)}) · playoffs{" "}
      {pts(e.playoffs)} · {signed(e.wins.d, 2)} wins ·{" "}
      <span className={cn("font-medium", v.tone)}>{v.text}</span>
      {e.decidedBy === "wins" && e.verdict !== "even" && " (by expected wins)"}
    </div>
  );
}

/** Checked moves first: clear title gains, then clear win gains, even, unchecked, and losses. */
function rankByChecks(options: StreamOption[], checks: MoveChecks | null): StreamOption[] {
  if (!checks?.byKey.size) return options;
  const group = (e: MoveEffect | undefined) =>
    !e
      ? 3
      : e.verdict === "better"
        ? e.decidedBy === "title"
          ? 0
          : 1
        : e.verdict === "even"
          ? 2
          : 4;
  // Within "even" (and unchecked) the quick ranking's order stands: the differences are noise.
  const size = (e: MoveEffect | undefined) =>
    !e || e.verdict === "even" ? 0 : e.decidedBy === "title" ? e.title.d : e.wins.d;
  return [...options].sort((x, y) => {
    const ex = checks.byKey.get(moveKey(x));
    const ey = checks.byKey.get(moveKey(y));
    return group(ex) - group(ey) || size(ey) - size(ex);
  });
}

function OptionRow({
  o,
  addsLeft,
  addsCap,
  check,
}: {
  o: StreamOption;
  addsLeft: number;
  addsCap: number;
  /** The season simulation's verdict, for the moves it checks. */
  check?: { e: MoveEffect | undefined; seasons: number };
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
        {o.addUsage && (
          <div className="mt-1 pl-[50px] text-xs text-muted-foreground">
            Starts ~{o.addUsage.starts} of his {o.addUsage.games} games left for you
            {o.drop && o.dropStarts != null && (
              <>
                {" "}
                · {o.drop.name.split(" ").at(-1)} would have started {o.dropStarts}
              </>
            )}
          </div>
        )}
        {check && <SimCheck e={check.e} seasons={check.seasons} />}
      </div>
      <div className="flex items-center justify-between gap-4 pl-[50px] sm:pl-0">
        <div className="text-right">
          {check?.e ? (
            <div
              className={cn("text-lg font-semibold tabular-nums", VERDICT[check.e.verdict].tone)}
              title="Season simulation: change in expected wins (± two standard errors)"
            >
              {check.e.verdict === "even" && check.e.decidedBy === "wins"
                ? "≈ even"
                : `${signed(check.e.wins.d, 2)} wins`}
            </div>
          ) : (
            <div
              className={cn(
                "text-lg font-semibold tabular-nums",
                o.netWins > 0.01 ? "text-success" : o.netWins < -0.01 && "text-danger",
              )}
              title="Expected wins: this week's change in win chance plus the rest of the season"
            >
              {signed(o.netWins, 2)} wins
            </div>
          )}
          {check?.e && (
            <div className="text-xs text-muted-foreground tabular-nums">
              Quick estimate {signed(o.netWins, 2)}
            </div>
          )}
          <div className="text-xs text-muted-foreground tabular-nums">
            This week {o.deltaWin != null ? `${signed(o.deltaWin * 100)}%` : "—"} (
            {signed(o.deltaPts, 0)} pts)
          </div>
          <div
            className={cn(
              "text-xs tabular-nums",
              o.laterWins < -0.05 ? "text-warning" : "text-muted-foreground",
            )}
            title="After this week: lineup points gained or lost, and what that's worth in wins"
          >
            Later {signed(o.laterWins, 2)} ({signed(o.rosDelta - o.deltaPts, 0)} pts)
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
  const checks = await moveChecks(v).catch(() => null);
  const checked = new Set(checks ? [...checks.byKey.keys()] : []);
  const best = rankByChecks(analysis.best.slice(0, 8), checks);
  const shown = new Set(best.map((o) => o.add.player.id));
  // Streams that help this week but cost more later than they gain now.
  const streams = analysis.thisWeek
    .filter((o) => !shown.has(o.add.player.id) && (o.deltaWin ?? 0) > 0.005)
    .slice(0, 5);
  const pool = analysis.candidates
    .filter((c) => pos === "All" || c.player.positions.includes(pos))
    .slice(0, 40);

  return (
    <>
      <PageHeader
        title="Waivers & streaming"
        subtitle={`Week ${view.mp} · ${addsLeft} of ${addsCap} adds left${
          analysis.baseWin != null ? ` · ${winChanceLabel(analysis.baseWin, false)} to win now` : ""
        }`}
      />

      <IlPlanNote plan={ilReturnPlan(v.data.ahead.me, v.data, v.sp)} />

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
        <SectionTitle aside="Checked with the season simulation: title odds first">
          Best moves
        </SectionTitle>
        {checks && !checks.fresh && <LiveRefresh active seconds={15} />}
        {best.length ? (
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {best.map((o, i) => (
              <OptionRow
                key={o.add.player.id}
                o={o}
                addsLeft={addsLeft}
                addsCap={addsCap}
                check={
                  checks && (checked.has(moveKey(o)) || i < 4)
                    ? { e: checks.byKey.get(moveKey(o)), seasons: checks.seasons }
                    : undefined
                }
              />
            ))}
          </div>
        ) : (
          <Callout tone="info">
            No add improves your expected wins right now: every free agent either wouldn&apos;t
            crack your lineup or costs more later than it gains this week.
          </Callout>
        )}
        <p className="px-1 text-xs text-muted-foreground">
          Every add is tried against every player you could drop, with your real lineup slots, each
          player&apos;s schedule, injuries and IL returns. &ldquo;Later&rdquo; turns the rest of the
          season&apos;s lineup points into wins (~{(analysis.winsPerPoint * 100).toFixed(2)} wins
          per 100 points; playoff weeks count double), so a stream that costs a useful player only
          shows up when it&apos;s worth it. The top moves are then played out in the season
          simulation that drives the Outlook (with and without the move, same random draws), so a
          move that helps here moves your Outlook the same way. A title change smaller than its
          margin (±) is called even, and expected wins decide.
        </p>
      </section>

      {streams.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none px-1 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            This-week-only streams ({streams.length}): they help now but cost more later
            <span className="ml-1 inline-block transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div className="mt-1.5 divide-y overflow-hidden rounded-xl border bg-card">
            {streams.map((o) => (
              <OptionRow key={o.add.player.id} o={o} addsLeft={addsLeft} addsCap={addsCap} />
            ))}
          </div>
        </details>
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
                    <PlayerCardButton id={c.player.id} className="flex items-center gap-2">
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
                    </PlayerCardButton>
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
