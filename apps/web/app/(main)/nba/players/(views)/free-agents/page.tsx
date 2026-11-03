// Players → Free agents: the whole free-agent pool, filtered by position and sorted by any
// column in the browser (components/fc/free-agent-table.tsx).

import { SectionTitle } from "@/components/fc/bits";
import { FreeAgentTable } from "@/components/fc/free-agent-table";
import { ErrorNotice, SetupNotice } from "@/components/setup-notice";
import { SetupError } from "@/lib/env";
import { POSITIONS, type FreeAgentRow, type SortKey } from "@/lib/free-agents";
import { loadFreeAgentPool } from "@/lib/nba/waivers-view";

const SORTS = ["name", "fppg", "last7", "games", "owned", "change", "season"] as const;

export default async function FreeAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ pos?: string; sort?: string }>;
}) {
  const { pos: posParam, sort: sortParam } = await searchParams;
  const pos = POSITIONS.includes(posParam as (typeof POSITIONS)[number]) ? posParam! : "All";
  const sort: SortKey = SORTS.includes(sortParam as SortKey) ? (sortParam as SortKey) : "fppg";

  let candidates;
  try {
    candidates = await loadFreeAgentPool();
  } catch (e) {
    if (e instanceof SetupError) return <SetupNotice message={e.message} />;
    return <ErrorNotice title="Couldn't load free agents" message={(e as Error).message} />;
  }
  const pool: FreeAgentRow[] = candidates.map((c) => ({
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
      <p className="px-1 text-sm text-muted-foreground">{`${pool.length} free agents and waiver players`}</p>
      <section className="space-y-1.5">
        <SectionTitle>Free agents</SectionTitle>
        <FreeAgentTable rows={pool} initialPos={pos} initialSort={sort} />
        <p className="px-1 text-xs text-muted-foreground">
          FP/G = projected fantasy points per game (league scoring). Last 7 = his average over the
          last 7 days. Wk G = games he can still play this week. Owned = share of ESPN leagues
          rostering him; +/− = its change over the last week. Season = projected points from games
          after this week. Tap a column to sort; tap again to flip. Moves has the best add for each,
          with whom to drop.
        </p>
      </section>
    </>
  );
}
