// How precise the Waivers season-simulation checks are, and what playoff replays buy: for the
// current top moves, the title change and its standard error with and without replays, and the
// CPU time each took. Read-only (ESPN reads; no database writes).
//
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/measure-move-precision.ts

import { loadWaiverView } from "../lib/nba/waivers-view";
import { moveKey, shortlist } from "../lib/nba/move-checks";
import { simulateMoves } from "../lib/nba/move-sim";

async function main() {
  const v = await loadWaiverView();
  const moves = shortlist(v)
    .slice(0, 3)
    .map((o) => ({ key: moveKey(o), add: o.add.player, drop: o.drop, il: o.il }));
  console.log(moves.map((m) => `${m.add.name} for ${m.drop?.name ?? m.il?.name ?? "open"}`));
  const configs = [
    { seasons: 800, replays: 1 },
    { seasons: 2400, replays: 1 },
    { seasons: 400, replays: 10 },
    { seasons: 800, replays: 10 },
    { seasons: 400, replays: 20 },
  ];
  console.log("| seasons | replays | CPU s | title change ± 2 SE per move | wins ± 2 SE |");
  for (const c of configs) {
    const t0 = process.cpuUsage();
    const r = await simulateMoves(moves, { seasons: c.seasons, replays: c.replays });
    const cpu = process.cpuUsage(t0);
    const secs = (cpu.user + cpu.system) / 1e6;
    const title = r.effects
      .map((e) => `${(e.title.d * 100).toFixed(1)} ±${(2 * e.title.se * 100).toFixed(1)}`)
      .join(" / ");
    const wins = r.effects
      .map((e) => `${e.wins.d.toFixed(2)} ±${(2 * e.wins.se).toFixed(2)}`)
      .join(" / ");
    console.log(
      `| ${c.seasons} | ${c.replays} | ${secs.toFixed(1)} | ${title} | ${wins} | base title ${(r.base.title * 100).toFixed(1)}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
