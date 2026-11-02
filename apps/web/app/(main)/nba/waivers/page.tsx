import { PlayerCardButton } from "@/components/fc/player-card";
import { IlPlanNote } from "@/components/fc/il-plan-note";
import { ilReturnPlan } from "@/lib/nba/il-plan";
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
import type { MoveEffect } from "@/lib/nba/move-sim";
import { MoveCard, type MoveOption, type MoveSim } from "@/components/fc/move-card";
import { FreeAgentTable } from "@/components/fc/free-agent-table";
import { POSITIONS, type FreeAgentRow, type SortKey } from "@/lib/free-agents";
import { latestOutlook } from "@/lib/nba/outlook-run";
import { dbConfigured } from "@/lib/db";
import { winChanceLabel } from "@/lib/nba/week";
import type { StreamOption, WaiverCandidate } from "@/lib/nba/waivers";

const SORTS = ["name", "fppg", "last7", "games", "owned", "change", "season"] as const;
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

/** What each number on a move means (a disclosure, so phones see it too). */
function HowToRead({ winsPerPoint }: { winsPerPoint: number }) {
  return (
    <details className="group rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer list-none font-medium text-foreground [&::-webkit-details-marker]:hidden">
        How to read these numbers
        <span className="ml-1 inline-block transition-transform group-open:rotate-180">▾</span>
      </summary>
      <ul className="mt-2 list-disc space-y-1.5 pl-4">
        <li>
          <b className="text-foreground">Season sim</b>: the Outlook&apos;s season simulation,
          played out with and without the move on the same random draws. &ldquo;Now&rdquo; is your
          latest Outlook; &ldquo;With move&rdquo; adds the simulated change. ± is the margin of
          error (two standard errors): a change smaller than it could be chance.
        </li>
        <li>
          <b className="text-foreground">This week&apos;s matchup</b>: your win chance against this
          week&apos;s opponent, now and with the move (the Matchup page&apos;s model).
        </li>
        <li>
          <b className="text-foreground">Lineup points</b>: projected starting-lineup points gained
          or lost, this week and over the rest of the season (playoff days count double). Only
          starts count: a player who&apos;d sit on your bench adds nothing.
        </li>
        <li>
          <b className="text-foreground">Points estimate</b>: a fast estimate in expected wins: this
          week&apos;s change in win chance plus the rest of the season&apos;s points at ~
          {(winsPerPoint * 100).toFixed(2)} wins per 100. It ranks every add against every possible
          drop and picks which moves the simulation checks. Unlike the simulation, it assumes your
          roster stays as it is (no future pickups).
        </li>
        <li>
          <b className="text-foreground">Drop</b>: the best drop is picked for you; choose another
          player to see that move&apos;s numbers. The number after each name is its points estimate;
          ✓ marks drops the simulation has checked (it checks the top moves automatically).
        </li>
      </ul>
    </details>
  );
}

/** A move as the card shows it, from the analysis' option for one drop. */
function optionOf(o: StreamOption): MoveOption {
  return {
    key: moveKey(o),
    dropId: o.drop?.id ?? null,
    dropName: o.drop?.name ?? null,
    ilName: o.il?.name ?? null,
    deltaPts: o.deltaPts,
    deltaWin: o.deltaWin,
    laterPts: o.laterPts,
    laterWins: o.laterWins,
    netWins: o.netWins,
    addStarts: o.addUsage?.starts ?? null,
    addGames: o.addUsage?.games ?? null,
    dropStarts: o.dropStarts,
    rosCost: Math.max(0, -o.rosDelta),
  };
}

export default async function WaiversPage({
  searchParams,
}: {
  searchParams: Promise<{ pos?: string; sort?: string }>;
}) {
  const { pos: posParam, sort: sortParam } = await searchParams;
  const pos = POSITIONS.includes(posParam as (typeof POSITIONS)[number]) ? posParam! : "All";
  const sort: SortKey = SORTS.includes(sortParam as SortKey) ? (sortParam as SortKey) : "fppg";

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
  const [checks, outlookRun] = await Promise.all([
    moveChecks(v).catch(() => null),
    dbConfigured() ? latestOutlook().catch(() => null) : Promise.resolve(null),
  ]);
  const myOutlook = outlookRun?.results.find((t) => t.teamId === v.data.me.id);
  const outlook = myOutlook
    ? {
        title: myOutlook.champ,
        playoffs: myOutlook.playoffs,
        seed1: myOutlook.seed1,
        wins: myOutlook.expWins,
      }
    : null;
  const sims: Record<string, MoveSim> = Object.fromEntries(
    [...(checks?.byKey ?? [])].map(([k, e]: [string, MoveEffect]) => [
      k,
      {
        title: e.title,
        playoffs: e.playoffs,
        seed1: e.seed1,
        wins: e.wins,
        seasons: checks!.seasons,
      },
    ]),
  );
  const card = (o: StreamOption) => {
    const options = (analysis.dropOptions.get(o.add.player.id) ?? [o]).map(optionOf);
    return (
      <MoveCard
        key={o.add.player.id}
        who={<Who c={o.add} />}
        addId={o.add.player.id}
        addName={o.add.player.name}
        claim={o.add.status === "WAIVERS"}
        claimNote={o.add.waiverUntil ? `Claims process ${clearsAt(o.add.waiverUntil)}.` : null}
        addsLeft={addsLeft}
        addsCap={addsCap}
        options={options}
        initialKey={moveKey(o)}
        sims={sims}
        outlook={outlook}
        weekWin={analysis.baseWin}
        checking={!!checks && !checks.fresh}
      />
    );
  };
  const best = rankByChecks(analysis.best.slice(0, 8), checks);
  const shown = new Set(best.map((o) => o.add.player.id));
  // Streams that help this week but cost more later than they gain now.
  const streams = analysis.thisWeek
    .filter((o) => !shown.has(o.add.player.id) && (o.deltaWin ?? 0) > 0.005)
    .slice(0, 5);
  const pool: FreeAgentRow[] = analysis.candidates.map((c) => ({
    id: c.player.id,
    name: c.player.name,
    status: c.player.injuryStatus ?? "ACTIVE",
    proTeam: c.player.proTeam,
    positions: c.player.positions,
    waivers: c.status === "WAIVERS",
    fppg: c.fppg,
    last7: c.player.last7?.avg != null && c.player.last7.total ? c.player.last7.avg : null,
    weekGames: c.weekGames,
    owned: c.player.percentOwned ?? null,
    change: c.player.percentChange ?? null,
    season: c.ros,
  }));

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
        <HowToRead winsPerPoint={analysis.winsPerPoint} />
        {checks && !checks.fresh && <LiveRefresh active seconds={15} />}
        {best.length ? (
          <div className="divide-y overflow-hidden rounded-xl border bg-card">{best.map(card)}</div>
        ) : (
          <Callout tone="info">
            No add improves your expected wins right now: every free agent either wouldn&apos;t
            crack your lineup or costs more later than it gains this week.
          </Callout>
        )}
      </section>

      {streams.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none px-1 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            This-week-only streams ({streams.length}): they help now but cost more later
            <span className="ml-1 inline-block transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div className="mt-1.5 divide-y overflow-hidden rounded-xl border bg-card">
            {streams.map(card)}
          </div>
        </details>
      )}

      <section className="space-y-1.5">
        <SectionTitle>Free agents</SectionTitle>
        <FreeAgentTable rows={pool} initialPos={pos} initialSort={sort} />
        <p className="px-1 text-xs text-muted-foreground">
          FP/G = projected fantasy points per game (league scoring). Last 7 = his average over the
          last 7 days. Wk G = games he can still play this week. Owned = share of ESPN leagues
          rostering him; +/− = its change over the last week. Season = projected points from games
          after this week. Tap a column to sort; tap again to flip.
        </p>
      </section>
    </>
  );
}
