import { PlayerCardButton } from "@/components/fc/player-card";
import { IlPlanNote } from "@/components/fc/il-plan-note";
import { ilReturnPlan } from "@/lib/nba/il-plan";
import { Callout, SectionTitle } from "@/components/fc/bits";
import { ProtectedPlayers } from "@/components/fc/protected-players";
import { PlayerAvatar } from "@/components/fc/player-avatar";
import { Pill, StatusPill } from "@/components/fc/status-pill";
import { TeamLogo } from "@/components/fc/team-logo";
import { ErrorNotice, SetupNotice } from "@/components/setup-notice";
import { SetupError } from "@/lib/env";
import { fmtPts, fmtTip } from "@/lib/format";
import { dateForScoringPeriod } from "@/lib/nba/calendar";
import { loadWaiverView } from "@/lib/nba/waivers-view";
import { moveChecks, moveKey, rosterKey, type MoveChecks } from "@/lib/nba/move-checks";
import type { MoveEffect } from "@/lib/nba/move-sim";
import { DeepBanner, DeepLive } from "@/components/fc/deep-live";
import { RefreshAt } from "@/components/refresh-at";
import { MoveCard, type MoveOption, type MoveSim } from "@/components/fc/move-card";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { DeepTrade } from "@/components/fc/deep-trade";
import { WorkerSearch } from "@/components/fc/worker-search";
import { tradeKey } from "@/lib/nba/sim-moves";
import { interestTargets, tradeForPackages, tradeHref } from "@/lib/nba/trade-view";
import type { TradeIdea } from "@/lib/nba/trade";
import { latestOutlook } from "@/lib/nba/outlook-run";
import { deepView } from "@/lib/nba/move-shown";
import { workerEnabled } from "@/lib/nba/outlook-refresh";
import { deepChecksFor, liveJob, settledResults } from "@/lib/nba/sim-jobs";
import { dbConfigured } from "@/lib/db";
import { winChanceLabel } from "@/lib/nba/week";
import { shownMoves, type StreamOption, type WaiverCandidate } from "@/lib/nba/waivers";

const clearsAt = (ms: number) =>
  `${new Date(ms).toLocaleDateString("en-US", { weekday: "short", timeZone: process.env.DISPLAY_TZ || "America/Phoenix" })} ${fmtTip(new Date(ms).toISOString())}`;

function Who({ c, interested = false }: { c: WaiverCandidate; interested?: boolean }) {
  return (
    <PlayerCardButton id={c.player.id} className="flex min-w-0 items-center gap-2.5 rounded-md">
      <PlayerAvatar id={c.player.id} name={c.player.name} size={40} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 font-medium break-words">{c.player.name}</span>
          <StatusPill status={c.player.injuryStatus ?? "ACTIVE"} />
          {c.status === "WAIVERS" && <Pill tone="info">Waivers</Pill>}
          {interested && <Pill tone="info">Interested</Pill>}
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
          played out with and without the move on the same random draws; each season&apos;s playoffs
          are replayed 10 times so the title odds aren&apos;t swamped by playoff luck.
          &ldquo;Now&rdquo; is your latest Outlook; &ldquo;With move&rdquo; adds the simulated
          change. ± is the margin of error (two standard errors): a change smaller than it could be
          chance. The <b className="text-foreground">deep check</b> runs on a separate machine after
          any roster move in the league (and nightly): it plays thousands of seasons for every drop
          of every add here until each title change is known to ±0.5 points, and says how likely the
          move is to help at all and to be the best one. While it re-checks, a card keeps the last
          numbers with a spinner, or shows a loader after your own roster changed. More seasons
          remove the simulation&apos;s own randomness, not the projections&apos; error.
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
          <b className="text-foreground">When they disagree, trust the table.</b> The two answer
          different questions. The quick estimate counts lineup points as if you kept this roster
          all season. The season sim plays the season the way it goes: every team, yours included,
          keeps streaming free agents, players get hurt, and the title is decided in the playoff
          weeks. So a pickup that helps this week but is weak later (&ldquo;this week +27 · rest of
          season −75&rdquo;) can still be fine: you&apos;d swap him out again. Changes are colored
          only when they&apos;re bigger than their ± margin; grey means the simulation can&apos;t
          tell the move from doing nothing.
        </li>
        <li>
          <b className="text-foreground">Drop</b>: the best drop is picked for you; choose another
          player to see that move&apos;s numbers. The number after each name is its simulated title
          change (or, before it&apos;s checked, its points estimate in wins).
          <b className="text-foreground">Compare</b> puts the two players side by side: projections,
          this season, where their points come from and advanced stats with league percentiles.
        </li>
      </ul>
    </details>
  );
}

/** "today", "tomorrow" or the weekday ("Saturday") of a day this week, from today's. */
const dayWord = (day: number, today: number) =>
  day === today
    ? "today"
    : day === today + 1
      ? "tomorrow"
      : new Date(`${dateForScoringPeriod(day)}T12:00:00Z`).toLocaleDateString("en-US", {
          weekday: "long",
          timeZone: "UTC",
        });

/** "Make this after tomorrow's first tip (4:00 PM): …" for a move worth more made then. */
function waitNote(o: StreamOption, tips: Map<number, number> | undefined, today: number) {
  const tip = o.waitDay != null ? tips?.get(o.waitDay) : undefined;
  if (o.timing !== "afterTip" || tip == null || !o.drop) return null;
  const on = dayWord(o.waitDay!, today);
  const next = dayWord(o.waitDay! + 1, today);
  const starts =
    o.deltaStarts > 0 ? `, +${o.deltaStarts} start${o.deltaStarts > 1 ? "s" : ""} this week` : "";
  return `Make this after ${on}'s first tip (${fmtTip(new Date(tip).toISOString())}): ${o.drop.name} still plays ${on === "today" || on === "tomorrow" ? on : `on ${on}`} and ${o.add.player.name} starts ${next === "tomorrow" ? next : `on ${next}`}${starts}.`;
}

/** A move as the card shows it, from the analysis' option for one drop. */
function optionOf(o: StreamOption, note: string | null): MoveOption {
  return {
    key: moveKey(o),
    dropId: o.drop?.id ?? null,
    dropName: o.drop?.name ?? null,
    ilId: o.il?.id ?? null,
    ilName: o.il?.name ?? null,
    deltaPts: o.deltaPts,
    deltaWin: o.deltaWin,
    laterPts: o.laterPts,
    laterWins: o.laterWins,
    netWins: o.netWins,
    addStarts: o.addUsage?.starts ?? null,
    addGames: o.addUsage?.games ?? null,
    dropStarts: o.dropStarts,
    dropCutFor: o.dropCutFor,
    ilCuts: o.ilCuts,
    rosCost: Math.max(0, -o.rosDelta),
    waitNote: note,
  };
}

/** Players → Moves (was Waivers): the best adds, each checked with the season simulation. */
/** Watched players already on Jack's team. */
function OnMyRoster({ ids, roster }: { ids: number[]; roster: { id: number; name: string }[] }) {
  const mine = roster.filter((p) => ids.includes(p.id));
  if (!mine.length) return null;
  return (
    <p className="px-1 text-xs text-muted-foreground">
      On your roster: {mine.map((p) => p.name).join(", ")}
    </p>
  );
}

/**
 * "Trade for him": each watched player on another team, with the best packages that get him
 * (the same rules as Trades' ideas) once Jack asks for them, and each one's season simulation.
 * Nothing is searched until he asks (Nov 9: it used to run, and re-simulate, with every job).
 */
async function TradeFor({
  rosters,
  rosterNow,
}: {
  rosters: Parameters<typeof tradeForPackages>[0];
  rosterNow: string;
}) {
  const targets = interestTargets(rosters);
  if (!targets.length) return null;
  const { packages, foundAt, asking } = await tradeForPackages(rosters);
  const keyOf = (i: TradeIdea) =>
    tradeKey(
      i.partnerId,
      i.give.map((p) => p.id),
      i.get.map((p) => p.id),
    );
  const deep = await deepChecksFor([...packages.values()].flat().map(keyOf), rosterNow).catch(
    () => null,
  );
  const owner = new Map(
    rosters.data.teams.flatMap((t) => t.roster.map((p) => [p.id, { team: t, player: p }])),
  );
  return (
    <div className="divide-y overflow-hidden rounded-xl border bg-card">
      {targets.map((id) => {
        const { team, player } = owner.get(id)!;
        const list = packages.get(id) ?? [];
        const found = foundAt.get(id);
        return (
          <div key={id} className="space-y-2 px-3 py-3">
            <div className="flex items-center gap-2">
              <PlayerCardButton id={player.id} className="flex min-w-0 items-center gap-2">
                <PlayerAvatar id={player.id} name={player.name} size={36} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{player.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {player.positions.join("/")} · on {team.name}
                  </span>
                </span>
              </PlayerCardButton>
              <Pill tone="info" className="ml-auto shrink-0">
                Trade for him
              </Pill>
            </div>
            {list.map((i, n) => {
              const k = keyOf(i);
              const sim = deep?.sims[k];
              return (
                <div key={k} className="space-y-1.5">
                  <Link
                    href={tradeHref(
                      i.partnerId,
                      i.give.map((p) => p.id),
                      i.get.map((p) => p.id),
                    )}
                    className="block text-sm hover:underline"
                  >
                    {n === 0 ? "Best package: " : "Or: "}
                    give {i.give.map((p) => p.name).join(" + ")} for{" "}
                    {i.get.map((p) => p.name).join(" + ")}
                    {i.acceptance && (
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        · {i.acceptance.realism}
                      </span>
                    )}
                  </Link>
                  {sim ? (
                    <DeepTrade sim={sim} state={deep?.states[k]} />
                  ) : (
                    <p className="text-xs text-muted-foreground">Season simulation: queued.</p>
                  )}
                </div>
              );
            })}
            {found && !list.length && (
              <p className="text-xs text-muted-foreground">
                No package that raises your lineup passes their manager&apos;s market check.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <WorkerSearch
                url="/api/trades/packages"
                body={{ playerId: id }}
                statusUrl={`/api/trades/packages?id=${id}`}
                searching={asking.has(id)}
                label={found ? "Search again" : "Find trade packages"}
                busyText="Searching packages (usually a minute or two). Their simulations follow."
              />
              {found && !asking.has(id) && (
                <span className="text-xs text-muted-foreground">
                  Searched {clearsAt(found.getTime())}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default async function MovesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  // Old links: /nba/players?q= searched here; search results live under Trends now.
  const { q } = await searchParams;
  if (q) redirect(`/nba/players/trends?q=${encodeURIComponent(q)}`);

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
  const worker = workerEnabled();
  const shownNow = shownMoves(analysis);
  const shownAdds = [
    ...shownNow.best,
    ...shownNow.streams,
    ...shownNow.moreStreams,
    ...analysis.watched,
  ];
  // Every drop of every add on the page: the worker checks them all (ADR-058).
  const keys = shownAdds.flatMap((o) =>
    (analysis.dropOptions.get(o.add.player.id) ?? [o]).map(moveKey),
  );
  const roster = rosterKey(v);
  const [checks, outlookRun, job, last] = await Promise.all([
    worker ? Promise.resolve(null) : moveChecks(v).catch(() => null),
    dbConfigured() ? latestOutlook().catch(() => null) : Promise.resolve(null),
    worker ? liveJob().catch(() => null) : Promise.resolve(null),
    worker ? settledResults(keys).catch(() => new Map()) : Promise.resolve(new Map()),
  ]);
  const deep = deepView(keys, job, last, roster);
  const myOutlook = outlookRun?.results.find((t) => t.teamId === v.data.me.id);
  const outlook = myOutlook
    ? {
        title: myOutlook.champ,
        playoffs: myOutlook.playoffs,
        seed1: myOutlook.seed1,
        wins: myOutlook.expWins,
      }
    : null;
  // Without the worker: the quick checks run on Vercel.
  const quick: Record<string, MoveSim> = Object.fromEntries(
    [...(checks?.byKey ?? [])].map(([k, e]: [string, MoveEffect]) => [
      k,
      {
        title: e.title,
        playoffs: e.playoffs,
        seed1: e.seed1,
        wins: e.wins,
        seasons: e.seasons ?? checks!.seasons,
      },
    ]),
  );
  // Each add opens on its best-simulated drop.
  const deepBest = (o: StreamOption) => {
    const checked = (analysis.dropOptions.get(o.add.player.id) ?? [])
      .map((x) => ({ x, e: deep.sims[moveKey(x)] }))
      .filter((y) => y.e && y.e.seasons > 0);
    return checked.sort((a, b) => b.e!.title.d - a.e!.title.d)[0] ?? null;
  };
  const watch = v.inputs.watch;
  /**
   * A move's card. It opens on its best-simulated drop, but a stream opens on the drop that
   * made it a stream (this week's win chance), so the card shows what put it in that list.
   */
  const card = (o: StreamOption, stream = false) => {
    const options = (analysis.dropOptions.get(o.add.player.id) ?? [o]).map((x) =>
      optionOf(x, waitNote(x, v.inputs.tips, v.sp)),
    );
    return (
      <MoveCard
        key={o.add.player.id}
        who={<Who c={o.add} interested={stream && Boolean(watch?.has(o.add.player.id))} />}
        addId={o.add.player.id}
        addName={o.add.player.name}
        claim={o.add.status === "WAIVERS"}
        claimNote={o.add.waiverUntil ? `Claims process ${clearsAt(o.add.waiverUntil)}.` : null}
        addsLeft={addsLeft}
        addsCap={addsCap}
        options={options}
        initialKey={moveKey(stream ? o : (deepBest(o)?.x ?? o))}
        sims={quick}
        outlook={outlook}
        weekWin={analysis.baseWin}
        canSimulate={!worker}
      />
    );
  };
  // Simulated adds first, by their best drop's title change; then the quick order.
  const quickOrder = rankByChecks(shownNow.best, checks);
  const best = [...quickOrder].sort((x, y) => {
    const ex = deepBest(x)?.e;
    const ey = deepBest(y)?.e;
    if (ex && ey) return ey.title.d - ex.title.d;
    return Number(!!ey) - Number(!!ex);
  });
  // This week's streams: the adds that raise this week's win chance most (not already above).
  const { streams, moreStreams } = shownNow;
  const streamCard = (o: StreamOption) => card(o, true);
  return (
    <>
      {/* At today's first tip moves start counting from tomorrow: re-run the analysis then. */}
      <RefreshAt at={v.firstTip} />
      <p className="px-1 text-sm text-muted-foreground">
        {`Week ${view.mp} · ${addsLeft} of ${addsCap} adds left${
          analysis.baseWin != null ? ` · ${winChanceLabel(analysis.baseWin, false)} to win now` : ""
        }`}
      </p>

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
        <ProtectedPlayers
          field="noDrop"
          players={v.data.ahead.me.roster.map(({ id, name, positions }) => ({
            id,
            name,
            positions,
          }))}
          initial={[...(v.inputs.noDrop ?? [])]}
        />
        <DeepLive initial={deep} roster={roster} keys={keys}>
          <DeepBanner />
          {best.length ? (
            <div className="divide-y overflow-hidden rounded-xl border bg-card">
              {best.map((o) => card(o))}
            </div>
          ) : (
            <Callout tone="info">
              No add improves your expected wins right now: every free agent either wouldn&apos;t
              crack your lineup or costs more later than it gains this week.
            </Callout>
          )}

          {/* This week only: the adds that raise this week's win chance the most. */}
          {streams.length > 0 && (
            <section className="space-y-1.5 pt-2">
              <SectionTitle aside="This week only: ranked by your win chance this week">
                Best streams this week
              </SectionTitle>
              <p className="px-1 text-xs text-muted-foreground">
                Adds that help most in this week&apos;s matchup. Some cost rest-of-season value
                later: each card shows the season simulation.
              </p>
              <div className="divide-y overflow-hidden rounded-xl border bg-card">
                {streams.map(streamCard)}
              </div>
              {moreStreams.length > 0 && (
                <details className="group">
                  <summary className="cursor-pointer list-none px-1 py-1 text-sm font-medium text-primary [&::-webkit-details-marker]:hidden">
                    Show {moreStreams.length} more stream{moreStreams.length > 1 ? "s" : ""}
                    <span className="ml-1 inline-block transition-transform group-open:rotate-180">
                      ▾
                    </span>
                  </summary>
                  <div className="mt-1.5 divide-y overflow-hidden rounded-xl border bg-card">
                    {moreStreams.map(streamCard)}
                  </div>
                </details>
              )}
            </section>
          )}

          {/* Jack's ESPN watch list: free agents get the usual card; players on other teams get
              the best packages that get him when he asks (the worker's targeted search). */}
          {v.data.me.watchList.length > 0 && (
            <section className="space-y-1.5 pt-2">
              <SectionTitle aside="Your ESPN watch list">Interested</SectionTitle>
              {analysis.watched.length > 0 && (
                <div className="divide-y overflow-hidden rounded-xl border bg-card">
                  {analysis.watched.map((o) => card(o))}
                </div>
              )}
              <Suspense
                fallback={
                  <div className="rounded-xl border bg-card px-3 py-4 text-sm text-muted-foreground">
                    Loading watched players on other teams…
                  </div>
                }
              >
                <TradeFor
                  rosters={{
                    data: { teams: v.data.ahead.teams, me: v.data.ahead.me },
                    freeAgents: v.freeAgents.map((f) => f.player),
                  }}
                  rosterNow={roster}
                />
              </Suspense>
              <OnMyRoster ids={v.data.me.watchList} roster={v.data.ahead.me.roster} />
            </section>
          )}
        </DeepLive>
      </section>
    </>
  );
}
