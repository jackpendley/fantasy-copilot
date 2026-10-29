import { describe, expect, it } from "vitest";
import type { RosterPlayer } from "@fantasy-copilot/espn";
import { compact, hydrate, tradeFingerprint } from "@/lib/nba/trade-view";
import type { TradeIdea } from "@/lib/nba/trade";

// Synthetic league: Jack (team 1) and one partner (team 2), plus two free agents.
const p = (id: number, slot = "BE"): RosterPlayer => ({
  id,
  name: `P${id}`,
  proTeamId: id,
  proTeam: "X",
  positions: ["PG"],
  slot,
  injuryStatus: "ACTIVE",
  percentOwned: 0,
  percentChange: 0,
  projection: { avg: 20, total: 1400, stats: {} },
  season: null,
  last7: null,
  last15: null,
  last30: null,
});

type View = Parameters<typeof tradeFingerprint>[0];
function view(mine: RosterPlayer[], theirs: RosterPlayer[], free: RosterPlayer[]): View {
  const teams = [
    { id: 1, name: "Mine", roster: mine },
    { id: 2, name: "Theirs", roster: theirs },
  ];
  return {
    sp: 10,
    data: { teams, me: teams[0] },
    injured: new Map(),
    freeAgents: free,
  } as unknown as View;
}

const none = { dropped: [], added: [], toIL: [] };
const idea = (
  give: RosterPlayer[],
  get: RosterPlayer[],
  added: RosterPlayer[] = [],
): TradeIdea => ({
  partnerId: 2,
  give,
  get,
  mine: { regular: 50, playoffs: 10 },
  theirs: { regular: -5, playoffs: 0 },
  rawGap: 40,
  moves: { mine: { ...none, added }, theirs: none },
  acceptance: null,
  fits: true,
  score: 70,
});

describe("stored trade targets", () => {
  const mine = [p(1), p(2)];
  const theirs = [p(3), p(4)];
  const free = [p(9), p(10)];

  it("round-trips through the compact form with today's player objects", () => {
    const v = view(mine, theirs, free);
    const stored = [idea([mine[0]!, mine[1]!], [theirs[0]!], [free[0]!])].map(compact);
    expect(stored[0]!.give).toEqual([1, 2]);
    expect(stored[0]!.moves.mine.added).toEqual([9]);
    const [back] = hydrate(JSON.parse(JSON.stringify(stored)), v);
    expect(back!.give).toEqual([mine[0], mine[1]]);
    expect(back!.get).toEqual([theirs[0]]);
    expect(back!.moves.mine.added).toEqual([free[0]]);
    expect(back!.score).toBe(70);
  });

  it("drops ideas whose players moved: traded, dropped, or a free agent picked up", () => {
    const stored = [
      idea([mine[0]!], [theirs[0]!]),
      idea([mine[1]!], [theirs[1]!]),
      idea([mine[0]!, mine[1]!], [theirs[0]!], [free[0]!]),
    ].map(compact);
    // Player 2 was dropped and free agent 9 was picked up.
    const v = view([mine[0]!], theirs, [free[1]!]);
    expect(hydrate(stored, v).map((i) => i.give.map((x) => x.id))).toEqual([[1]]);
  });

  it("changes the fingerprint when a roster, slot, injury or the free-agent pool changes", () => {
    const base = tradeFingerprint(view(mine, theirs, free));
    expect(tradeFingerprint(view([...mine], [...theirs], [...free].reverse()))).toBe(base);
    expect(tradeFingerprint(view([mine[0]!], theirs, free))).not.toBe(base);
    expect(tradeFingerprint(view([mine[0]!, p(2, "IR")], theirs, free))).not.toBe(base);
    expect(
      tradeFingerprint(view([mine[0]!, { ...mine[1]!, injuryStatus: "OUT" }], theirs, free)),
    ).not.toBe(base);
    expect(tradeFingerprint(view(mine, theirs, [free[0]!]))).not.toBe(base);
  });
});
