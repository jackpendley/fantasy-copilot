import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { FantasyTeam, RosterPlayer } from "@fantasy-copilot/espn";
import { Callout, PageHeader, SectionTitle } from "@/components/fc/bits";
import { ProtectedPlayers } from "@/components/fc/protected-players";
import { PlayerAvatar } from "@/components/fc/player-avatar";
import { Pill, StatusPill } from "@/components/fc/status-pill";
import { LiveRefresh } from "@/components/live-refresh";
import { SimulateTrade } from "@/components/simulate-trade";
import { Button } from "@/components/ui/button";
import { ErrorNotice, SetupNotice } from "@/components/setup-notice";
import { SetupError } from "@/lib/env";
import { fmtDayTime, fmtPts } from "@/lib/format";
import { loadLeagueView } from "@/lib/nba/league-view";
import { marketValue, type MarketContext, type Realism } from "@/lib/nba/market";
import { perGameProjection } from "@/lib/nba/projection";
import {
  evaluateTrade,
  tradeSize,
  type RosterMoves,
  type TradeEval,
  type TradeIdea,
} from "@/lib/nba/trade";
import { tradeHref, tradeTargets, tradesWith } from "@/lib/nba/trade-view";
import { askPending } from "@/lib/nba/asked-trades";
import { WorkerSearch } from "@/components/fc/worker-search";
import { rosterKeyOf } from "@/lib/nba/move-checks";
import type { ShownSim, ShownState } from "@/lib/nba/move-shown";
import { DeepTrade, pts } from "@/components/fc/deep-trade";
import { deepChecksFor } from "@/lib/nba/sim-jobs";
import { tradeKey } from "@/lib/nba/sim-moves";
import { matchupPeriodOf } from "@/lib/nba/calendar";
import { cn } from "@/lib/utils";

const MAX_PER_SIDE = 3;
const ids = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v : v ? [v] : [])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, MAX_PER_SIDE);
const signed = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n)}`;
const tone = (n: number) =>
  n > 1 ? "text-success" : n < -1 ? "text-danger" : "text-muted-foreground";
const REALISM_TONE: Record<Realism, "success" | "info" | "warning"> = {
  likely: "success",
  fair: "info",
  "long shot": "warning",
};
const SIZE_ORDER = [
  "1-for-1",
  "2-for-1",
  "1-for-2",
  "2-for-2",
  "3-for-2",
  "2-for-3",
  "3-for-3",
  "3-for-1",
  "1-for-3",
];

function Names({ players }: { players: RosterPlayer[] }) {
  return <>{players.map((p) => p.name).join(" + ")}</>;
}

function RealismPill({ realism }: { realism: Realism }) {
  return (
    <Pill tone={REALISM_TONE[realism]}>
      {realism === "long shot" ? "Long shot" : realism === "likely" ? "Likely" : "Fair"}
    </Pill>
  );
}

function PickList({
  name,
  players,
  picked,
  market,
}: {
  name: "give" | "get";
  players: RosterPlayer[];
  picked: number[];
  market: MarketContext;
}) {
  const sorted = [...players].sort((a, b) => perGameProjection(b).fppg - perGameProjection(a).fppg);
  return (
    <div className="divide-y overflow-hidden rounded-xl border bg-card">
      {sorted.map((p) => (
        <label
          key={p.id}
          className={cn(
            "flex cursor-pointer items-center gap-2.5 px-3 py-2 has-checked:bg-primary/10",
            p.tradeLocked && "cursor-not-allowed opacity-50",
          )}
        >
          <input
            type="checkbox"
            name={name}
            value={p.id}
            defaultChecked={picked.includes(p.id)}
            disabled={p.tradeLocked}
            className="size-4 accent-[var(--primary)]"
          />
          <PlayerAvatar id={p.id} name={p.name} size={28} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 text-sm font-medium break-words">{p.name}</span>
              <StatusPill status={p.injuryStatus ?? "ACTIVE"} />
            </div>
            <div className="text-[11px] text-muted-foreground">
              {p.positions.join("/")} · ${Math.round(marketValue(p, market))} market
            </div>
          </div>
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {fmtPts(perGameProjection(p).fppg)}
          </span>
        </label>
      ))}
    </div>
  );
}

function Moves({ who, m }: { who: string; m: RosterMoves }) {
  if (!m.dropped.length && !m.added.length && !m.toIL.length) return null;
  return (
    <>
      {m.toIL.length > 0 && (
        <li>
          {who} put <Names players={m.toIL} /> straight on IL (ruled out), so he doesn&apos;t take a
          roster spot until he&apos;s back.
        </li>
      )}
      {(m.dropped.length > 0 || m.added.length > 0) && (
        <li>
          {who}{" "}
          {m.dropped.length > 0 && (
            <>
              drop <Names players={m.dropped} /> (least missed in the lineup)
            </>
          )}
          {m.dropped.length > 0 && m.added.length > 0 && " and "}
          {m.added.length > 0 && (
            <>
              add <Names players={m.added} /> from free agency
            </>
          )}{" "}
          to stay at a full roster.
        </li>
      )}
    </>
  );
}

/** "+ Oso Ighodaro (FA) · cut Day'Ron Sharpe" for Jack's side of an idea in the list. */
function MovesBrief({ m }: { m: RosterMoves }) {
  const parts = [
    ...m.added.map((p) => `+ ${p.name} (free agent)`),
    ...m.dropped.map((p) => `cut ${p.name}`),
    ...m.toIL.map((p) => `${p.name} to IL`),
  ];
  return parts.length ? <span>· you: {parts.join(", ")}</span> : null;
}

function Evaluation({
  e,
  partner,
  addsLeft,
  deep,
  pending,
}: {
  e: TradeEval;
  partner: FantasyTeam;
  /** Jack's adds left this matchup week (null when unknown). */
  addsLeft: number | null;
  /** The worker's simulation of this trade, when it has one (an idea, or asked for). */
  deep: { sim: ShownSim; state: ShownState | undefined } | null;
  /** Jack asked to simulate it and the result is still coming. */
  pending: boolean;
}) {
  const rows = [
    { who: "You", d: e.mine },
    { who: partner.name, d: e.theirs },
  ];
  const me = e.mine.regular + e.mine.playoffs;
  return (
    <section className="space-y-1.5">
      <SectionTitle>Evaluation</SectionTitle>
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            <span className="text-danger">Send</span> <Names players={e.give} />{" "}
            <span className="text-muted-foreground">·</span>{" "}
            <span className="text-success">Get</span> <Names players={e.get} />
          </span>
          {e.acceptance && <RealismPill realism={e.acceptance.realism} />}
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Starting points</th>
                <th className="px-3 py-2 text-right font-medium">Regular season</th>
                <th className="px-3 py-2 text-right font-medium">Playoff weeks</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.who}>
                  <td className="px-3 py-2 font-medium break-words">{r.who}</td>
                  <td className={cn("px-3 py-2 text-right font-semibold", tone(r.d.regular))}>
                    {signed(r.d.regular)}
                  </td>
                  <td className={cn("px-3 py-2 text-right font-semibold", tone(r.d.playoffs))}>
                    {signed(r.d.playoffs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="space-y-1 text-sm">
          <li>
            {me > 1 ? (
              <span className="font-medium text-success">Helps your lineup.</span>
            ) : (
              <span className="font-medium text-danger">Doesn&apos;t help your lineup.</span>
            )}
          </li>
          {e.acceptance && <li className="text-muted-foreground">{e.acceptance.reason}</li>}
          <Moves who="You'd" m={e.moves.mine} />
          {addsLeft != null && e.moves.mine.added.length > addsLeft && (
            <li className="text-warning">
              You have {addsLeft} add{addsLeft === 1 ? "" : "s"} left this week, so the free-agent
              pickup would wait until next week&apos;s adds reset (the numbers assume it happens
              now).
            </li>
          )}
          <Moves who="They'd" m={e.moves.theirs} />
        </ul>
        {deep ? (
          <DeepTrade sim={deep.sim} state={deep.state} />
        ) : (
          <SimulateTrade
            partnerId={partner.id}
            give={e.give.map((p) => p.id)}
            get={e.get.map((p) => p.id)}
            pending={pending}
          />
        )}
      </div>
    </section>
  );
}

/** One trade idea: a link that opens it in the evaluator (where it can be simulated). */
function IdeaRow({ i, partner, sim }: { i: TradeIdea; partner?: string; sim?: ShownSim }) {
  return (
    <Link
      href={tradeHref(
        i.partnerId,
        i.give.map((p) => p.id),
        i.get.map((p) => p.id),
      )}
      className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50"
    >
      <div className="hidden shrink-0 -space-x-2 sm:flex">
        {[...i.give, ...i.get].slice(0, 4).map((p) => (
          <PlayerAvatar key={p.id} id={p.id} name={p.name} size={28} />
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm">
          <span className="text-muted-foreground">Send</span> <Names players={i.give} />{" "}
          <span className="text-muted-foreground">for</span>{" "}
          <span className="font-medium">
            <Names players={i.get} />
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {i.acceptance && <RealismPill realism={i.acceptance.realism} />}
          <span>{tradeSize(i)}</span>
          <span className="min-w-0 break-words">
            · {partner} · their lineup {signed(i.theirs.regular + i.theirs.playoffs)}
          </span>
          <MovesBrief m={i.moves.mine} />
        </div>
      </div>
      <div className="shrink-0 text-right tabular-nums">
        <div className={cn("font-semibold", tone(i.mine.regular))}>{signed(i.mine.regular)}</div>
        <div className="text-[11px] text-muted-foreground">{signed(i.mine.playoffs)} playoffs</div>
        {sim && <div className="text-[11px] text-muted-foreground">title {pts(sim.title.d)}</div>}
      </div>
    </Link>
  );
}

/**
 * Trades with the team Jack opened: that team's own search when he asked for one ("Find trades
 * with {team}", on the worker), else the league-wide ideas with that team.
 */
async function WithTeam({
  view,
  partner,
}: {
  view: Awaited<ReturnType<typeof loadLeagueView>>;
  partner: FantasyTeam;
}) {
  const { ideas: leagueWide } = await tradeTargets(view);
  const { ideas, foundAt, asking } = await tradesWith(view, partner.id, leagueWide);
  const keyOf = (i: TradeIdea) =>
    tradeKey(
      i.partnerId,
      i.give.map((p) => p.id),
      i.get.map((p) => p.id),
    );
  const deep = await deepChecksFor(
    ideas.map(keyOf),
    rosterKeyOf(view.data.me.roster, view.data.injuries),
  ).catch(() => null);
  return (
    <section className="space-y-1.5">
      <SectionTitle aside="Ranked by your gain; tap one to evaluate or simulate it">
        Best trades with {partner.name}
      </SectionTitle>
      {ideas.length ? (
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {ideas.map((i) => (
            <IdeaRow key={keyOf(i)} i={i} partner={partner.name} sim={deep?.sims[keyOf(i)]} />
          ))}
        </div>
      ) : (
        <Callout tone="info">
          {foundAt
            ? "No trade with this team raises your lineup and passes their manager's market check right now."
            : "None of the league-wide ideas is with this team. Search this team's roster for more."}
        </Callout>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
        <WorkerSearch
          url="/api/trades/with"
          body={{ partnerId: partner.id }}
          statusUrl={`/api/trades/with?team=${partner.id}`}
          searching={asking}
          label={foundAt ? "Search again" : `Find more trades with ${partner.name}`}
          busyText="Searching their roster (usually a minute or two)…"
        />
        <span className="text-xs text-muted-foreground">
          {foundAt ? `Searched ${fmtDayTime(foundAt)}.` : "From the league-wide search."}
        </span>
      </div>
    </section>
  );
}

/** Streamed in after the rest of the page: the search takes a second or two. */
async function Targets({
  view,
  others,
  size,
}: {
  view: Awaited<ReturnType<typeof loadLeagueView>>;
  others: FantasyTeam[];
  size: string | null;
}) {
  const { ideas, fresh, updating, computedAt } = await tradeTargets(view);
  const name = new Map(others.map((t) => [t.id, t.name]));
  const count = (s: string) => ideas.filter((i) => tradeSize(i) === s).length;
  const shown = ideas.filter((i) => !size || tradeSize(i) === size).slice(0, 15);
  const keyOf = (i: (typeof ideas)[number]) =>
    tradeKey(
      i.partnerId,
      i.give.map((p) => p.id),
      i.get.map((p) => p.id),
    );
  const deep = await deepChecksFor(
    shown.map(keyOf),
    rosterKeyOf(view.data.me.roster, view.data.injuries),
  ).catch(() => null);
  return (
    <>
      {!fresh &&
        (updating ? (
          <p className="px-1 text-xs text-muted-foreground">
            Rosters changed: updating these ideas (usually within a minute)…
            <LiveRefresh active seconds={15} />
          </p>
        ) : (
          <p className="px-1 text-xs text-muted-foreground">
            Searched {fmtDayTime(computedAt)}. Ideas whose players have moved are hidden; the search
            reruns at most every 15 minutes, and right away after your own moves.
          </p>
        ))}
      <div className="flex flex-wrap gap-1.5">
        {["All", ...SIZE_ORDER].map((s) => {
          const active = (s === "All" && !size) || s === size;
          const n = s === "All" ? ideas.length : count(s);
          return (
            <Link
              key={s}
              href={s === "All" ? "/nba/league/trades" : `/nba/league/trades?size=${s}`}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs font-medium",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "bg-card text-muted-foreground",
                !n && !active && "opacity-50",
              )}
            >
              {s} <span className="tabular-nums opacity-70">{n}</span>
            </Link>
          );
        })}
      </div>
      {shown.length ? (
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {shown.map((i) => (
            <IdeaRow
              key={keyOf(i)}
              i={i}
              partner={name.get(i.partnerId)}
              sim={deep?.sims[keyOf(i)]}
            />
          ))}
        </div>
      ) : (
        <Callout tone="info">
          {size
            ? `No realistic ${size} helps you right now: every deal of this shape either lowers your lineup points or gives the other manager less market value than they send.`
            : "No deal clears the bar right now."}
        </Callout>
      )}
    </>
  );
}

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<{
    team?: string;
    give?: string | string[];
    get?: string | string[];
    size?: string;
  }>;
}) {
  const sp = await searchParams;
  let v;
  try {
    v = await loadLeagueView();
  } catch (e) {
    if (e instanceof SetupError) return <SetupNotice message={e.message} />;
    return <ErrorNotice title="Couldn't load the league" message={(e as Error).message} />;
  }
  const me = v.data.me;
  const others = v.data.teams.filter((t) => t.id !== me.id);
  const partner = others.find((t) => t.id === Number(sp.team)) ?? null;
  const give = me.roster.filter((p) => ids(sp.give).includes(p.id));
  const get = partner ? partner.roster.filter((p) => ids(sp.get).includes(p.id)) : [];
  const e =
    partner && give.length && get.length
      ? evaluateTrade(
          // His pick, so "not for trade" doesn't apply; "never drop" still keeps him from cuts.
          { teamId: me.id, roster: me.roster, noDrop: [...v.prefs.noDrop] },
          { teamId: partner.id, roster: partner.roster },
          give,
          get,
          v.ctx,
          { freeAgents: v.freeAgents, market: v.market },
        )
      : null;
  // The worker simulates the stored ideas: this trade's result, when it's one of them.
  const key =
    e && partner
      ? tradeKey(
          partner.id,
          give.map((p) => p.id),
          get.map((p) => p.id),
        )
      : null;
  const checked = key
    ? await deepChecksFor([key], rosterKeyOf(me.roster, v.data.injuries)).catch(() => null)
    : null;
  const pending = key ? await askPending(key).catch(() => false) : false;
  const deepTrade =
    key && checked?.sims[key] ? { sim: checked.sims[key]!, state: checked.states[key] } : null;
  const size = sp.size && SIZE_ORDER.includes(sp.size) ? sp.size : null;
  const cap = v.data.settings.addsPerWeek;
  const addsLeft =
    cap != null ? Math.max(0, cap - (me.activity?.addsByPeriod[matchupPeriodOf(v.sp)] ?? 0)) : null;

  return (
    <>
      <Link
        href="/nba/league"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> League
      </Link>
      <PageHeader
        title="Trades"
        subtitle="Your gain in starting-lineup points; their side judged by market value"
      />

      <section className="space-y-1.5">
        <SectionTitle>Trade with</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {others.map((t) => (
            <Link
              key={t.id}
              href={`/nba/league/trades?team=${t.id}`}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs font-medium break-words",
                partner?.id === t.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "bg-card text-muted-foreground",
              )}
            >
              {t.name}
            </Link>
          ))}
        </div>
      </section>

      {partner && (
        <form action="/nba/league/trades" className="space-y-3">
          <input type="hidden" name="team" value={partner.id} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <div className="px-1 text-xs font-medium">You send (up to 3)</div>
              <PickList
                name="give"
                players={me.roster}
                picked={give.map((p) => p.id)}
                market={v.market}
              />
            </div>
            <div className="space-y-1">
              <div className="px-1 text-xs font-medium break-words">
                You get from {partner.name} (up to 3)
              </div>
              <PickList
                name="get"
                players={partner.roster}
                picked={get.map((p) => p.id)}
                market={v.market}
              />
            </div>
          </div>
          <Button type="submit" className="w-full sm:w-auto">
            Evaluate trade
          </Button>
        </form>
      )}

      {partner && (give.length > 0 || get.length > 0) && !e && (
        <Callout tone="info">Pick at least one player on each side.</Callout>
      )}
      {e && partner && (
        <Evaluation
          e={e}
          partner={partner}
          addsLeft={addsLeft}
          deep={deepTrade}
          pending={pending}
        />
      )}

      {partner && (
        <Suspense
          fallback={
            <div className="rounded-xl border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
              Loading trades with {partner.name}…
            </div>
          }
        >
          <WithTeam view={v} partner={partner} />
        </Suspense>
      )}

      <section className="space-y-1.5">
        <SectionTitle aside="Up to 3-for-3, ranked by your gain">Trade targets</SectionTitle>
        <ProtectedPlayers
          field="noTrade"
          players={me.roster.map(({ id, name, positions }) => ({ id, name, positions }))}
          initial={[...v.prefs.noTrade]}
        />
        <Suspense
          fallback={
            <div className="rounded-xl border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
              Searching deals across the league…
            </div>
          }
        >
          <Targets view={v} others={others} size={size} />
        </Suspense>
        <p className="px-1 text-xs text-muted-foreground">
          A target must raise your starting points (playoff weeks count double) and pass the other
          manager&apos;s market check: they get back at least ~95% of the market value they send
          (ESPN auction prices and ranks, blended with where your league drafted each player), plus
          10% when they give up the best player for more bodies. You never send more than ~25% extra
          market value. Likely = they also gain market value and lineup points. Uneven trades
          include the drops or free-agent adds each side needs.
        </p>
      </section>
    </>
  );
}
