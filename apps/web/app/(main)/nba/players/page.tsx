import Link from "next/link";
import { Search } from "lucide-react";
import type { RosterPlayer } from "@fantasy-copilot/espn";
import { normalizeName } from "@fantasy-copilot/nba-data";
import { Callout, PageHeader, SectionTitle } from "@/components/fc/bits";
import { PlayerAvatar } from "@/components/fc/player-avatar";
import { Pill, StatusPill } from "@/components/fc/status-pill";
import { TeamLogo } from "@/components/fc/team-logo";
import { ErrorNotice, SetupNotice } from "@/components/setup-notice";
import { SetupError } from "@/lib/env";
import { fmtPts } from "@/lib/format";
import { loadPlayerPool } from "@/lib/nba/pool";
import { perGameProjection } from "@/lib/nba/projection";
import { hotAndCold, injuryOpenings, ownershipRisers, type PoolPlayer } from "@/lib/nba/trends";
import { cn } from "@/lib/utils";

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
    <Link
      href={`/nba/players/${player.id}`}
      className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/50"
    >
      <PlayerAvatar id={player.id} name={player.name} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{player.name}</span>
          <StatusPill status={player.injuryStatus ?? "ACTIVE"} />
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <TeamLogo abbr={player.proTeam} size={12} />
          <span className="truncate">
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
    </Link>
  );
}

const List = ({ children }: { children: React.ReactNode }) => (
  <div className="divide-y overflow-hidden rounded-xl border bg-card">{children}</div>
);

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
  const needle = normalizeName(q);
  const results: PoolPlayer[] = q
    ? pool
        .filter((e) => normalizeName(e.player.name).includes(needle))
        .sort((a, b) => perGameProjection(b.player).fppg - perGameProjection(a.player).fppg)
        .slice(0, 25)
    : [];
  const { hot, cold } = hotAndCold(pool);
  const risers = ownershipRisers(freeAgents, 8);
  const openings = injuryOpenings(
    pool.map((e) => e.player),
    data.injuries,
    freeAgents,
  ).slice(0, 6);
  const mine = [...data.me.roster].sort(
    (a, b) => perGameProjection(b).fppg - perGameProjection(a).fppg,
  );

  return (
    <>
      <PageHeader
        title="Players & trends"
        subtitle="Every rostered player and free agent in your league"
      />

      <form action="/nba/players" className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          name="q"
          defaultValue={q}
          placeholder="Search players"
          autoComplete="off"
          className="h-10 w-full rounded-lg border bg-card pr-3 pl-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </form>

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
                      <div className="font-semibold">
                        {fmtPts(perGameProjection(e.player).fppg)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">proj FP/G</div>
                    </>
                  }
                />
              ))}
            </List>
          ) : (
            <Callout tone="info">
              No player matching &ldquo;{q}&rdquo; is rostered or among the top free agents.
            </Callout>
          )}
        </section>
      ) : (
        <>
          <section className="space-y-1.5">
            <SectionTitle aside="Last 7 days vs projection">Hot & cold</SectionTitle>
            {hot.length || cold.length ? (
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
                                className={cn(
                                  "font-semibold",
                                  r.delta > 0 ? "text-success" : "text-danger",
                                )}
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
            ) : (
              <Callout tone="info">
                Hot and cold streaks appear once players have 2+ games in the last 7 days. The
                season tips off Oct 20.
              </Callout>
            )}
          </section>

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
                          {note && <span className="truncate">{note}</span>}
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
                              <div className="font-semibold">
                                {fmtPts(perGameProjection(f.player).fppg)}
                              </div>
                              <div className="text-[11px] text-muted-foreground">proj FP/G</div>
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
                      <div className="font-semibold">{fmtPts(perGameProjection(p).fppg)}</div>
                      <div className="text-[11px] text-muted-foreground">proj FP/G</div>
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
