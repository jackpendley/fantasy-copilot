// Teammate returns, test 3 (MODEL_CARD pre-registration 2026-11-17): for a same-position backup
// whose minutes rose ≥ 6 while a regular teammate was out, does the halfway rule (C) predict his
// rest-of-season FP/G better than today's projection? Events and rules exactly as test 2
// (scripts/teammate-return-events.ts). Part 1 judges 2017-18 to 2020-21, unseen for this
// question; part 2 judges this season's returns from Nov 17, once, after the regular season.
// Read-only: the cached public ESPN game logs and positions (scripts/fetch-history.ts) and the
// league's scoring settings.
//
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/backtest-teammate-return-3.ts
//   DRY=1 ...       event counts only (checks the harness without looking at outcomes)
//   FORWARD=1 ...   part 2, 2026-27 (refuses to run before the regular season is over)

import { fetchLeague, parseSettings } from "@fantasy-copilot/espn";
import { espnConfig } from "../lib/env";
import { analyze, judge, mean, type Row } from "./teammate-return-events";

const FORWARD = Boolean(process.env.FORWARD);
/** Part 1: 2020-21, 2019-20, 2018-19, 2017-18 by end year; part 2: 2026-27. */
const SEASONS = FORWARD ? [2027] : [2021, 2020, 2019, 2018];
/** Part 2 counts only returns after the pre-registration. */
const FORWARD_FROM = Date.parse("2026-11-17T00:00:00-05:00");
/** Part 2 runs only once the regular season has ended. */
const FORWARD_RUN_AFTER = Date.parse("2027-04-20T00:00:00-04:00");
const MIN_SHIFT = 6;
/** One comparison in each of two parts: Bonferroni for 95% overall. */
const ALPHA = 0.05 / 2;
const SEED = FORWARD ? 20270420 : 20261118;

const signed = (rows: Row[], k: "base" | "C") => mean(rows.map((r) => r[k] - r.actual)).toFixed(2);

async function main() {
  if (FORWARD && Date.now() < FORWARD_RUN_AFTER)
    throw new Error("Part 2 runs once, after the 2026-27 regular season (from Apr 20, 2027).");
  const scoring = parseSettings(await fetchLeague(espnConfig(), ["mSettings"])).scoring;
  const all = SEASONS.flatMap((s) => analyze(s, scoring)).filter(
    (r) => !FORWARD || r.at >= FORWARD_FROM,
  );
  const set = all.filter((r) => r.sameGroup && r.minShift >= MIN_SHIFT);
  // DRY=1: check the harness without looking at any outcome (event counts and inputs only).
  if (process.env.DRY) {
    for (const s of SEASONS) {
      const rows = all.filter((r) => r.season === s);
      const inSet = set.filter((r) => r.season === s);
      console.log(
        `${s - 1}-${String(s).slice(2)}: ${rows.length} player-events, ` +
          `${inSet.length} same-position backups with minutes up ≥ ${MIN_SHIFT} ` +
          `(${inSet.filter((r) => r.group === "C").length} centers), ` +
          `${rows.filter((r) => r.group == null).length} without a position`,
      );
    }
    return;
  }
  const j = judge(set, "C", ALPHA, SEED);
  console.log("| Set | n | MAE today | MAE halfway | Halfway − today | 97.5% CI (by player) |");
  console.log("|---|---|---|---|---|---|");
  console.log(
    `| Same-position backups, minutes up ≥ ${MIN_SHIFT} | ${j.n} (${j.players} players) | ${j.base.toFixed(2)} | ${j.cand.toFixed(2)} | ${j.diff >= 0 ? "+" : ""}${j.diff.toFixed(3)} | [${j.lo.toFixed(3)}, ${j.hi.toFixed(3)}] |`,
  );
  console.log(`\n${j.hi < 0 ? "PASSED" : "Not passed"}`);
  // Described, not tested: the signed errors, and the centers among them (Paul Reed's case).
  const centers = set.filter((r) => r.group === "C");
  console.log(
    `\nSigned error (predicted − actual): today ${signed(set, "base")}, halfway ${signed(set, "C")}`,
  );
  console.log(
    `Centers, n ${centers.length}: today ${signed(centers, "base")}, halfway ${signed(centers, "C")}; ` +
      `MAE today ${mean(centers.map((r) => Math.abs(r.base - r.actual))).toFixed(2)}, ` +
      `halfway ${mean(centers.map((r) => Math.abs(r.C - r.actual))).toFixed(2)}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
