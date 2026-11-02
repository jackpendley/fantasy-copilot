// Does the quick Waivers ranking (points estimate) pick the moves the season simulation likes?
// Simulates the top quick-ranked moves (any add, any drop) and compares the two orderings.
// Read-only (ESPN reads; no database writes). DECISIONS ADR-051.
//
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/experiment-quick-vs-sim.ts

import { loadWaiverView } from "../lib/nba/waivers-view";
import { moveKey } from "../lib/nba/move-checks";
import { simulateMoves } from "../lib/nba/move-sim";

const N = Number(process.env.MOVES || 15);

/** Spearman rank correlation. */
function spearman(a: number[], b: number[]) {
  const rank = (x: number[]) => {
    const order = x.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(x.length);
    order.forEach(([, i], k) => (r[i] = k));
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const d2 = ra.reduce((s, r, i) => s + (r - rb[i]!) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

async function main() {
  const v = await loadWaiverView();
  // Every evaluated (add, drop), best points estimate first.
  const all = [...v.analysis.dropOptions.values()].flat().sort((x, y) => y.netWins - x.netWins);
  const top = all.slice(0, N);
  const r = await simulateMoves(
    top.map((o) => ({ key: moveKey(o), add: o.add.player, drop: o.drop, il: o.il })),
    { maxBatches: 2 },
  );
  const rows = top.map((o, i) => ({ o, e: r.effects[i]! }));
  console.log("| quick rank | add | drop | points est. (wins) | sim wins ± | sim title ± |");
  rows.forEach(({ o, e }, i) =>
    console.log(
      `| ${i + 1} | ${o.add.player.name} | ${o.drop?.name ?? o.il?.name ?? "-"} | ${o.netWins.toFixed(2)} | ${e.wins.d.toFixed(2)} ±${(2 * e.wins.se).toFixed(2)} | ${(e.title.d * 100).toFixed(1)} ±${(2 * e.title.se * 100).toFixed(1)} |`,
    ),
  );
  const q = rows.map((x) => x.o.netWins);
  console.log(
    `Spearman(points estimate, sim wins) = ${spearman(
      q,
      rows.map((x) => x.e.wins.d),
    ).toFixed(2)}`,
  );
  console.log(
    `Spearman(points estimate, sim title) = ${spearman(
      q,
      rows.map((x) => x.e.title.d),
    ).toFixed(2)}`,
  );
  const bestTitle = rows.reduce((b, x) => (x.e.title.d > b.e.title.d ? x : b));
  const bestWins = rows.reduce((b, x) => (x.e.wins.d > b.e.wins.d ? x : b));
  console.log(
    `sim's best by title: quick rank ${rows.indexOf(bestTitle) + 1}; by wins: quick rank ${rows.indexOf(bestWins) + 1}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
