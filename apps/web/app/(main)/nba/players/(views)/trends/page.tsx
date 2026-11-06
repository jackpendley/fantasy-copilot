import Link from "next/link";
import { PlayerCardButton } from "@/components/fc/player-card";
import { PercentileBadge, PercentileText } from "@/components/fc/percentile";
import type { RosterPlayer } from "@fantasy-copilot/espn";
import { Callout, SectionTitle } from "@/components/fc/bits";
import { PlayerAvatar } from "@/components/fc/player-avatar";
import { Pill, StatusPill } from "@/components/fc/status-pill";
import { TeamLogo } from "@/components/fc/team-logo";
import { ErrorNotice, SetupNotice } from "@/components/setup-notice";
import { SetupError } from "@/lib/env";
import { fmtPts } from "@/lib/format";
import { loadPlayerPool } from "@/lib/nba/pool";
import { perGameProjection, rosteredPercentile } from "@/lib/nba/projection";
import { hotAndCold, injuryOpenings, ownershipRisers, type PoolPlayer } from "@/lib/nba/trends";
import { searchPlayers } from "@/lib/player-search";
import { nameKey, pbpUsages } from "@/lib/nba/advanced";
import { refreshSeasonBaselines, seasonBaselines } from "@/lib/nba/season-baselines";
import { dbConfigured } from "@/lib/db";
import { after } from "next/server";
import { vsLastSeason, type VsLastSeason } from "@/lib/nba/vs-last-season";
import { TeamTabs } from "@/components/fc/team-tabs";
import { cn } from "@/lib/utils";

/**
 * Projected FP/G in its percentile's color (among this league's rostered players), with the
 * percentile written under it.
 */
function ProjValue({ fppg, p }: { fppg: number; p: number | null }) {
  return (
    <>
      <PercentileText p={p} className="font-semibold">
        {fmtPts(fppg)}
      </PercentileText>
      <div className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
        <PercentileBadge
          p={p}
          colored={false}
          title="Percentile among this league's rostered players"
        />
        proj FP/G
      </div>
    </>
  );
}

const signed = (n: number) => `${n >= 0 ? "+" : ""}${fmtPts(n)}`;

/** A player link: headshot, name, status, team and owner, with a value on the right. */
function PlayerLink({
  player,
  owner,
  mine,
  available,
  right,
  sub,
}: {
  player: RosterPlayer;
  owner?: string;
  mine?: boolean;
  available?: boolean;
  right?: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <PlayerCardButton
      id={player.id}
      className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/50"
    >
      <PlayerAvatar id={player.id} name={player.name} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 font-medium break-words">{player.name}</span>
          <StatusPill status={player.injuryStatus ?? "ACTIVE"} />
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <TeamLogo abbr={player.proTeam} size={12} />
          <span className="min-w-0 break-words">
            {player.positions.join("/")}
            {owner && (
              <>
                {" · "}
                <span className={cn(mine && "font-medium text-success", available && "text-info")}>
                  {mine ? "Your team" : owner}
                </span>
              </>
            )}
            {sub && <> · {sub}</>}
          </span>
        </div>
      </div>
      {right && <div className="shrink-0 text-right tabular-nums">{right}</div>}
    </PlayerCardButton>
  );
}

const List = ({ children }: { children: React.ReactNode }) => (
  <div className="divide-y overflow-hidden rounded-xl border bg-card">{children}</div>
);

/** Running hot and running cold, side by side from tablet width. */
function Streaks({ hot, cold }: ReturnType<typeof hotAndCold>) {
  if (!hot.length && !cold.length)
    return (
      <Callout tone="info">
        Hot and cold streaks appear once players have 2+ games in the last 7 days.
      </Callout>
    );
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {[
        { title: "Running hot", rows: hot },
        { title: "Running cold", rows: cold },
      ].map(({ title, rows }) => (
        <div key={title} className="space-y-1">
          <div className="px-1 text-xs font-medium">{title}</div>
          <List>
            {rows.map((r) => (
              <PlayerLink
                key={r.entry.player.id}
                {...r.entry}
                right={
                  <>
                    <div
                      className={cn("font-semibold", r.delta > 0 ? "text-success" : "text-danger")}
                    >
                      {signed(r.delta)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {fmtPts(r.recent)} in {r.games} g
                    </div>
                  </>
                }
              />
            ))}
          </List>
        </div>
      ))}
    </div>
  );
}

/** "2025-26" for an ESPN season (its end year). */
const seasonLabel = (season: number) => `${season - 1}-${String(season).slice(2)}`;

const pct1 = (x: number | null | undefined) => (x == null ? "—" : `${(x * 100).toFixed(0)}%`);

/**
 * Risers and fallers against their last full season: FP/G then → now, with the minutes,
 * shooting, usage and per-36 behind it, and a role badge when the minutes moved a lot.
 */
function VsSeason({
  rows,
  usage,
  current,
}: {
  rows: { risers: VsLastSeason<PoolPlayer>[]; fallers: VsLastSeason<PoolPlayer>[] };
  usage: Map<string, number>;
  current: number;
}) {
  if (!rows.risers.length && !rows.fallers.length)
    return (
      <Callout tone="info">
        Comparisons appear once players have 5+ games this season and a prior season of 40+ games.
      </Callout>
    );
  const usageOf = (r: VsLastSeason<PoolPlayer>, season: number) =>
    usage.get(`${season}|${nameKey(r.entry.player.name)}`);
  const line = (r: VsLastSeason<PoolPlayer>) => {
    const parts = [
      `MPG ${r.then.minutes.toFixed(0)}→${r.now.minutes.toFixed(0)}`,
      `TS ${pct1(r.then.ts)}→${pct1(r.now.ts)}`,
    ];
    const u0 = usageOf(r, r.then.season);
    const u1 = usageOf(r, current);
    if (u0 != null || u1 != null)
      parts.push(
        `USG ${u0 != null ? u0.toFixed(0) : "—"}→${u1 != null ? `${u1.toFixed(0)}%` : "—"}`,
      );
    if (r.then.per36 != null && r.now.per36 != null)
      parts.push(`/36 ${fmtPts(r.then.per36)}→${fmtPts(r.now.per36)}`);
    return parts.join(" · ");
  };
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {[
        { title: "Up on last season", list: rows.risers },
        { title: "Down on last season", list: rows.fallers },
      ].map(({ title, list }) => (
        <div key={title} className="space-y-1">
          <div className="px-1 text-xs font-medium">{title}</div>
          <List>
            {list.map((r) => (
              <div key={r.entry.player.id}>
                <PlayerLink
                  {...r.entry}
                  sub={
                    r.role && (
                      <Pill tone={r.role === "bigger" ? "success" : "warning"}>{r.role} role</Pill>
                    )
                  }
                  right={
                    <>
                      <div
                        className={cn(
                          "font-semibold",
                          r.delta > 0 ? "text-success" : "text-danger",
                        )}
                      >
                        {signed(r.delta)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {fmtPts(r.then.fppg)} → {fmtPts(r.now.fppg)}
                      </div>
                    </>
                  }
                />
                <p className="-mt-1.5 px-3 pb-2 pl-[58px] text-[11px] text-muted-foreground tabular-nums">
                  {line(r)}
                  {r.then.season !== current - 1 &&
                    ` · vs ${seasonLabel(r.then.season)} (${r.then.games} games)`}
                </p>
              </div>
            ))}
          </List>
        </div>
      ))}
    </div>
  );
}

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = ((await searchParams).q ?? "").trim();

  let v;
  try {
    v = await loadPlayerPool();
  } catch (e) {
    if (e instanceof SetupError) return <SetupNotice message={e.message} />;
    return <ErrorNotice title="Couldn't load players" message={(e as Error).message} />;
  }
  const { data, freeAgents, pool } = v;
  // ?q= (the search box without JavaScript, or Enter): the same ranking as search as you type.
  const byId = new Map(pool.map((e) => [e.player.id, e]));
  const results: PoolPlayer[] = q
    ? searchPlayers(
        pool.map((e) => ({
          id: e.player.id,
          name: e.player.name,
          team: e.player.proTeam,
          positions: e.player.positions,
          owner: e.owner,
          mine: e.mine,
          available: e.available,
          status: e.player.injuryStatus ?? "ACTIVE",
          fppg: perGameProjection(e.player).fppg,
          owned: e.player.percentOwned ?? 0,
        })),
        q,
        25,
      ).map((h) => byId.get(h.player.id)!)
    : [];
  const streaks = hotAndCold(pool);
  const freeStreaks = hotAndCold(pool.filter((e) => e.available));
  const risers = ownershipRisers(freeAgents, 8);
  const openings = injuryOpenings(
    pool.map((e) => e.player),
    data.injuries,
    freeAgents,
  ).slice(0, 6);
  const rank = rosteredPercentile(data.teams.flatMap((t) => t.roster));
  // Vs last season: scored with this season's rules (the league changed them), from the stored
  // prior seasons (nightly); usage from the stored PBP Stats seasons.
  const current = Number(process.env.ESPN_SEASON || 2027);
  const baselines = q ? [] : await seasonBaselines(current).catch(() => []);
  // Not stored yet (before the first nightly run): fetch them once, after this response.
  if (!q && !baselines.length && dbConfigured())
    after(() => refreshSeasonBaselines(current).catch(() => {}));
  const scoring = data.settings.scoring;
  const vsAll = vsLastSeason(pool, baselines, scoring, current);
  const vsFree = vsLastSeason(
    pool.filter((e) => e.available),
    baselines,
    scoring,
    current,
  );
  const vsMine = vsLastSeason(
    pool.filter((e) => e.mine),
    baselines,
    scoring,
    current,
    15,
  );
  const shownVs = [vsAll, vsFree, vsMine].flatMap((x) => [...x.risers, ...x.fallers]);
  const usage = await pbpUsages(
    [...new Set(shownVs.map((r) => r.entry.player.name))],
    [current, current - 1],
  ).catch(() => new Map<string, number>());
  const mine = [...data.me.roster].sort(
    (a, b) => perGameProjection(b).fppg - perGameProjection(a).fppg,
  );

  return (
    <>
      <p className="px-1 text-sm text-muted-foreground">
        Hot and cold players, minutes opening up, free agents being added
      </p>

      {q ? (
        <section className="space-y-1.5">
          <SectionTitle aside={`${results.length} found`}>Results</SectionTitle>
          {results.length ? (
            <List>
              {results.map((e) => (
                <PlayerLink
                  key={e.player.id}
                  {...e}
                  right={
                    <>
                      <ProjValue
                        fppg={perGameProjection(e.player).fppg}
                        p={rank(perGameProjection(e.player).fppg)}
                      />
                    </>
                  }
                />
              ))}
            </List>
          ) : (
            <Callout tone="info">
              No player matching &ldquo;{q}&rdquo; is rostered or among the 250 most-owned free
              agents. Type in the search box to search every player.
            </Callout>
          )}
        </section>
      ) : (
        <>
          <section className="space-y-1.5">
            <SectionTitle aside="Last 7 days vs projection">Hot & cold</SectionTitle>
            <TeamTabs
              tabs={[
                { label: "All players", content: <Streaks {...streaks} /> },
                { label: "Free agents", content: <Streaks {...freeStreaks} /> },
              ]}
            />
          </section>

          {baselines.length > 0 && (
            <section className="space-y-1.5">
              <SectionTitle aside="FP/G vs his last full season, this season's scoring">
                Vs last season
              </SectionTitle>
              <TeamTabs
                tabs={[
                  {
                    label: "All players",
                    content: <VsSeason rows={vsAll} usage={usage} current={current} />,
                  },
                  {
                    label: "Free agents",
                    content: <VsSeason rows={vsFree} usage={usage} current={current} />,
                  },
                  {
                    label: "Your roster",
                    content: <VsSeason rows={vsMine} usage={usage} current={current} />,
                  },
                ]}
              />
            </section>
          )}

          {openings.length > 0 && (
            <section className="space-y-1.5">
              <SectionTitle aside="Free agents behind a key player who's out">
                Minutes opening up
              </SectionTitle>
              <List>
                {openings.map((o) => (
                  <div key={o.proTeam} className="px-3 py-2.5">
                    <div className="space-y-1">
                      {o.outs.map(({ player: out, note }) => (
                        <div
                          key={out.id}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground"
                        >
                          <TeamLogo abbr={out.proTeam} size={14} />
                          <Link
                            href={`/nba/players/${out.id}`}
                            className="shrink-0 font-medium text-foreground hover:underline"
                          >
                            {out.name}
                          </Link>
                          <Pill tone="danger">Out</Pill>
                          {note && <span className="min-w-0 break-words">{note}</span>}
                        </div>
                      ))}
                    </div>
                    <div className="mt-1.5 -mx-3 divide-y">
                      {o.beneficiaries.map((f) => (
                        <PlayerLink
                          key={f.player.id}
                          player={f.player}
                          owner={f.status === "WAIVERS" ? "Waivers" : "Free agent"}
                          available
                          right={
                            <>
                              <ProjValue
                                fppg={perGameProjection(f.player).fppg}
                                p={rank(perGameProjection(f.player).fppg)}
                              />
                            </>
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </List>
            </section>
          )}

          {risers.length > 0 && (
            <section className="space-y-1.5">
              <SectionTitle aside="Ownership change across ESPN, last 7 days">
                Free agents being added
              </SectionTitle>
              <List>
                {risers.map((f) => (
                  <PlayerLink
                    key={f.player.id}
                    player={f.player}
                    owner={f.status === "WAIVERS" ? "Waivers" : "Free agent"}
                    available
                    sub={`${fmtPts(perGameProjection(f.player).fppg)} proj FP/G`}
                    right={
                      <>
                        <div className="font-semibold text-success">
                          +{fmtPts(f.player.percentChange ?? 0)}%
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {Math.round(f.player.percentOwned ?? 0)}% owned
                        </div>
                      </>
                    }
                  />
                ))}
              </List>
            </section>
          )}

          <section className="space-y-1.5">
            <SectionTitle>Your roster</SectionTitle>
            <List>
              {mine.map((p) => (
                <PlayerLink
                  key={p.id}
                  player={p}
                  right={
                    <>
                      <ProjValue
                        fppg={perGameProjection(p).fppg}
                        p={rank(perGameProjection(p).fppg)}
                      />
                    </>
                  }
                />
              ))}
            </List>
          </section>
        </>
      )}
    </>
  );
}
