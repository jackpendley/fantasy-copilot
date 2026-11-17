// Teammate returns, test 2 (MODEL_CARD pre-registration 2026-11-16): as of the day a regular
// teammate comes back from 5+ missed games, does reverting a fill-in's projection (fully, after
// 10 games, or halfway) predict his rest-of-season FP/G better than today's? All affected
// teammates, and same-position backups whose minutes rose. Events exactly as test 1
// (scripts/backtest-teammate-return.ts); seasons 2021-22 to 2023-24, unseen for this question.
// Read-only: the cached public ESPN game logs and positions (scripts/fetch-history.ts) and the
// league's scoring settings.
//
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/backtest-teammate-return-2.ts
//   DRY=1 ...       event counts only (checks the harness without looking at outcomes)
//   EXPLORE=1 ...   after the evaluation: backup centers' signed errors (not a test)

import { fetchLeague, parseSettings } from "@fantasy-copilot/espn";
import { espnConfig } from "../lib/env";
import {
  analyze,
  CANDIDATES,
  judge,
  mean,
  type Candidate,
  type Row,
} from "./teammate-return-events";

// As recorded in MODEL_CARD: events with undefined values included (erratum, Nov 17).
const RECORDED = { includeUndefined: true };

const SEASONS = [2024, 2023, 2022]; // 2023-24, 2022-23, 2021-22, by end year; priors one year earlier
/** Six comparisons: Bonferroni for 95% overall. */
const ALPHA = 0.05 / 6;

async function main() {
  const scoring = parseSettings(await fetchLeague(espnConfig(), ["mSettings"])).scoring;
  const all = SEASONS.flatMap((s) => analyze(s, scoring, RECORDED));
  const sets: [string, Row[]][] = [
    ["1. All affected teammates", all],
    ["2. Same-position backups, minutes up ≥ 4", all.filter((r) => r.same)],
  ];
  // DRY=1: check the harness without looking at any outcome (event counts and inputs only).
  if (process.env.DRY) {
    for (const s of SEASONS) {
      const rows = all.filter((r) => r.season === s);
      console.log(
        `${s - 1}-${String(s).slice(2)}: ${rows.length} player-events, ` +
          `${new Set(rows.map((r) => r.player)).size} players, ` +
          `${rows.filter((r) => r.same).length} same-position backups, ` +
          `${rows.filter((r) => r.group == null).length} without a position`,
      );
    }
    return;
  }
  // EXPLORE=1 (after the one evaluation, not a test): backup centers whose minutes rose ≥ 6
  // (Paul Reed's case), each rule's signed error.
  if (process.env.EXPLORE) {
    const rows = all.filter((r) => r.same && r.group === "C" && r.minShift >= 6);
    const m = (k: "base" | Candidate) => mean(rows.map((r) => r[k] - r.actual)).toFixed(2);
    console.log(`Backup centers, minutes up ≥ 6: n ${rows.length}`);
    console.log(`today − actual ${m("base")} · A ${m("A")} · B ${m("B")} · C ${m("C")}`);
    return;
  }
  console.log(
    "| Set | Candidate | n | MAE today | MAE candidate | Candidate − today | 99.17% CI (by player) |",
  );
  console.log("|---|---|---|---|---|---|---|");
  const passed: string[] = [];
  for (const [label, rows] of sets)
    for (const k of CANDIDATES) {
      const j = judge(rows, k, ALPHA, 20261117);
      if (j.hi < 0) passed.push(`${label} ${k}`);
      console.log(
        `| ${label} | ${k} | ${j.n} (${j.players} players) | ${j.base.toFixed(2)} | ${j.cand.toFixed(2)} | ${j.diff >= 0 ? "+" : ""}${j.diff.toFixed(3)} | [${j.lo.toFixed(3)}, ${j.hi.toFixed(3)}] |`,
      );
    }
  console.log(`\nPassed: ${passed.length ? passed.join("; ") : "none"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
