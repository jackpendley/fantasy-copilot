// Teammate absences by impact (MODEL_CARD pre-registration 2026-11-19, before any held-out
// run): does a projection that knows who's missing predict every player-game better than
// today's? Each of the player's earlier games is divided by its context factor (who was out
// then), the projection is made from those full-strength games, and tonight's factor
// multiplies it. Factor = 1 + k × min(0.6, Σ over absent regulars of
// max(0, share − floor) × (s if same position group, else 1)), set on the exploration seasons.
// Judged once on 2019-20 to 2024-25. Read-only; league scoring from the anonymized fixture.
//
//   DRY=1 node --conditions=react-server --import tsx scripts/backtest-teammate-context.ts
//   node --conditions=react-server --import tsx scripts/backtest-teammate-context.ts

import { readFileSync } from "node:fs";
import { parseSettings } from "@fantasy-copilot/espn";
import {
  judge,
  mean,
  playerGames,
  predict,
  REGULAR_MIN,
  STAR,
  starBack,
  starOut,
  type PlayerGame,
} from "./teammate-context";

/** Held-out seasons by end year (explored: 2017-18, 2018-19, 2025-26). */
const SEASONS = [2020, 2021, 2022, 2023, 2024, 2025];
function main() {
  const scoring = parseSettings(
    JSON.parse(
      readFileSync(
        new URL("../../../packages/espn/test/fixtures/league.json", import.meta.url),
        "utf8",
      ),
    ),
  ).scoring;
  const rows = SEASONS.flatMap((s) => playerGames(s, scoring));
  if (process.env.DRY) {
    // Counts only: no outcome is computed or printed.
    for (const s of SEASONS) {
      const rs = rows.filter((r) => r.season === s);
      console.log(
        `${s - 1}-${String(s).slice(2)}: ${rs.length} player-games, ${new Set(rs.map((r) => r.player)).size} players; ` +
          `star out ${rs.filter((r) => starOut(r, 1, Infinity)).length}, star back ${rs.filter(starBack).length}`,
      );
    }
    return;
  }
  const pred = new Map(rows.map((r) => [r, predict(r)]));
  const abs = (p: number, r: PlayerGame) => Math.abs(p - r.fp) - Math.abs(r.base - r.fp);
  const sq = (p: number, r: PlayerGame) => (p - r.fp) ** 2 - (r.base - r.fp) ** 2;
  const sign = (x: number, d = 3) => `${x >= 0 ? "+" : ""}${x.toFixed(d)}`;
  const line = (label: string, j: ReturnType<typeof judge>) =>
    `| ${label} | ${j.n} (${j.players}) | ${sign(j.mean)} | [${sign(j.lo)}, ${sign(j.hi)}] |`;

  console.log("| Comparison | n (player-seasons) | Model − today | 95% CI |");
  console.log("|---|---|---|---|");
  const steps: [string, PlayerGame[], typeof abs][] = [
    ["1. Absolute error, every player-game", rows, abs],
    ["2. Squared error, every player-game", rows, sq],
    ["3. Absolute error, games after a star's return", rows.filter(starBack), abs],
  ];
  for (const [label, rs, d] of steps) {
    const j = judge(rs, pred, d);
    console.log(line(label, j));
    if (j.hi >= 0) {
      console.log(`\n${label.slice(0, 2)} not passed; later comparisons are not tested.`);
      break;
    }
  }

  // Described, not tested.
  const describe = (label: string, rs: PlayerGame[]) => {
    if (!rs.length) return console.log(`- ${label}: none`);
    const j = judge(rs, pred, abs);
    console.log(
      `- ${label}: n ${rs.length}; MAE ${sign(j.mean)} [${sign(j.lo)}, ${sign(j.hi)}]; ` +
        `signed today ${sign(mean(rs.map((r) => r.base - r.fp)), 2)} → model ${sign(mean(rs.map((r) => pred.get(r)! - r.fp)), 2)}`,
    );
  };
  console.log("\nDescribed (not tested):");
  for (const s of SEASONS)
    describe(
      `${s - 1}-${String(s).slice(2)}`,
      rows.filter((r) => r.season === s),
    );
  describe(
    "Star out, his games 1–3",
    rows.filter((r) => starOut(r, 1, 3)),
  );
  describe(
    "Star out, games 4+",
    rows.filter((r) => starOut(r, 4, Infinity)),
  );
  describe(
    "Star out, same position group",
    rows.filter((r) =>
      r.absent.some((a) => a.min10 >= REGULAR_MIN && a.share >= STAR && a.group === r.group),
    ),
  );
  describe(
    "No regular out",
    rows.filter((r) => !r.absent.some((a) => a.min10 >= REGULAR_MIN)),
  );
  describe(
    "Only absences already ongoing (known the day before)",
    rows.filter((r) => r.absent.some((a) => a.min10 >= REGULAR_MIN && a.idx >= 2)),
  );
  describe(
    "Centers after a star's return",
    rows.filter((r) => r.group === "C" && starBack(r)),
  );
}

main();
