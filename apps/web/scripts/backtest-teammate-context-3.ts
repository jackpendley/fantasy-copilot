// Two changes to the context-aware projection (MODEL_CARD pre-registration 2026-11-20, before
// any run): (1) last season's games, a player's last-10 window reaching back into his games for
// the same team last season, so a regular with few games this season (back from injury, or not
// back yet) counts; (2) opponents' absences, a factor from the opponent's regulars out. Each is
// judged once on 2019-20 to 2024-25 against the shipped stack (the context model with game
// environment and opponent defense, scripts/backtest-teammate-context-2.ts). The opponent
// factor's k and same-position weight are fitted first on the exploration seasons (2017-18,
// 2018-19, 2025-26) and frozen. Read-only; league scoring from the anonymized fixture.
//
//   CHECK=1 node --conditions=react-server --import tsx scripts/backtest-teammate-context-3.ts  (reproduces #208 / #211 on 2019-25)
//   FIT=1   ...   (exploration seasons: the opponent grid)
//   DRY=1   ...   (test seasons: counts only)
//   K_OPP=… S_OPP=… node … scripts/backtest-teammate-context-3.ts   (the one evaluation)

import { existsSync, readFileSync } from "node:fs";
import { parseSettings } from "@fantasy-copilot/espn";
import type { ScoringMap } from "@fantasy-copilot/fantasy-core";
import { impliedTeamTotal, type GameOdds } from "@fantasy-copilot/nba-data";
import { FLOOR } from "../lib/nba/context";
import {
  mean,
  opponentFactor,
  playerGames,
  predict,
  REGULAR_MIN,
  STAR,
  type PlayerGame,
} from "./teammate-context";

/** Judged (end years): 2019-20 to 2024-25. Fitting: the exploration seasons. */
const TEST = [2020, 2021, 2022, 2023, 2024, 2025];
const EXPLORE = [2018, 2019, 2026];
const CACHE = new URL("../data/local/backtest/", import.meta.url);
const ENV_EXP = 0.75;
const LEAGUE_MIN = 40;
const DEF_K = 200;
/** Gates (counts only): affected player-games for each test, or that test isn't evaluated. */
const GATE_1 = 10_000;
const GATE_2 = 20_000;
/** The opponent grid. */
const K_GRID = Array.from({ length: 21 }, (_, i) => Math.round((i * 0.05 - 0.5) * 100) / 100);
const S_GRID = [1, 2];

/** A season's player-games, both ways (without and with last season's games), paired. */
interface Season {
  rows: PlayerGame[];
  prior: PlayerGame[];
  env: number[];
  /** Days (ET) and the order by tip, for the defense table. */
  days: string[];
  order: number[];
  hasLine: boolean[];
}

/** The ET day of a tip (tips are evening ET, so five hours back is the right date). */
const dayOf = (t: number) => new Date(t - 5 * 3600_000).toISOString().slice(0, 10);

function load(end: number, scoring: ScoringMap): Season {
  const rows = playerGames(end, scoring, CACHE);
  const prior = playerGames(end, scoring, CACHE, true);
  rows.forEach((r, i) => {
    if (prior[i]?.player !== r.player || prior[i]?.gameId !== r.gameId)
      throw new Error(`${end}: rows don't pair at ${i}`);
  });
  const oddsFile = new URL(`odds-${end}.json`, CACHE);
  const odds = new Map<number, GameOdds | null>(
    existsSync(oddsFile)
      ? Object.entries(
          JSON.parse(readFileSync(oddsFile, "utf8")) as Record<string, GameOdds | null>,
        ).map(([id, o]) => [Number(id), o])
      : [],
  );
  const days = rows.map((r) => dayOf(r.t));
  // The league's mean implied team total before each day (point in time), as #211.
  const totals = new Map<string, number[]>();
  const seen = new Set<number>();
  rows.forEach((r, i) => {
    const o = odds.get(r.gameId);
    if (!o || seen.has(r.gameId)) return;
    seen.add(r.gameId);
    totals.set(days[i]!, [
      ...(totals.get(days[i]!) ?? []),
      impliedTeamTotal(o, true),
      impliedTeamTotal(o, false),
    ]);
  });
  const leagueBefore = new Map<string, number | null>();
  let sum = 0;
  let n = 0;
  for (const d of [...new Set(days)].sort()) {
    leagueBefore.set(d, n >= LEAGUE_MIN ? sum / n : null);
    for (const x of totals.get(d) ?? []) {
      sum += x;
      n++;
    }
  }
  const env = rows.map((r, i) => {
    const o = odds.get(r.gameId);
    const league = leagueBefore.get(days[i]!);
    return o && league ? (impliedTeamTotal(o, r.home) / league) ** ENV_EXP : 1;
  });
  const order = rows.map((_, i) => i).sort((a, b) => rows[a]!.t - rows[b]!.t);
  return { rows, prior, env, days, order, hasLine: rows.map((r) => !!odds.get(r.gameId)) };
}

/**
 * The shipped stack on one side's predictions before the layers: × environment, then ×
 * opponent defense learned day by day from that side's own predictions (as #211).
 */
function stack(s: Season, raw: number[]): number[] {
  const pre = raw.map((x, i) => x * s.env[i]!);
  const f = new Array<number>(raw.length).fill(1);
  const acc = new Map<string, { actual: number; pred: number; n: number }>();
  const key = (i: number) => `${s.rows[i]!.opponent}|${s.rows[i]!.group}`;
  for (let i = 0; i < s.order.length;) {
    let j = i;
    while (j < s.order.length && s.days[s.order[j]!] === s.days[s.order[i]!]) j++;
    for (let x = i; x < j; x++) {
      const a = acc.get(key(s.order[x]!));
      if (a?.n) f[s.order[x]!] = (a.n * (a.actual / a.pred) + DEF_K) / (a.n + DEF_K);
    }
    for (let x = i; x < j; x++) {
      const k = s.order[x]!;
      const a = acc.get(key(k)) ?? { actual: 0, pred: 0, n: 0 };
      a.actual += s.rows[k]!.fp;
      a.pred += pre[k]!;
      a.n++;
      acc.set(key(k), a);
    }
    i = j;
  }
  return pre.map((x, i) => x * f[i]!);
}

/** An opponent's regular above the floor is out tonight. */
const oppOut = (r: PlayerGame) =>
  r.oppAbsent.some((a) => a.min10 >= REGULAR_MIN && a.share > FLOOR);

/** One player-game, kept small: what the comparisons need. */
interface Rec {
  season: number;
  player: number;
  fp: number;
  /** The shipped stack; test 1's candidate; test 2's; both changes. */
  base: number;
  t1: number;
  t2: number;
  both: number;
  /** Test 1 changes his raw projection; tonight's factor in particular. */
  affected1: boolean;
  tonight1: boolean;
  early: boolean;
  same1: boolean;
  /** Test 2: an opponent's regular above the floor is out; a star; in his group. */
  affected2: boolean;
  oppStar: boolean;
  oppSame: boolean;
}

function recs(s: Season, end: number, k: number, same: number): Rec[] {
  const raw0 = s.rows.map(predict);
  const raw1 = s.prior.map(predict);
  const opp = s.rows.map((r) => opponentFactor(r.oppAbsent, r.group, k, same));
  const base = stack(s, raw0);
  const t1 = stack(s, raw1);
  const t2 = stack(
    s,
    raw0.map((x, i) => x * opp[i]!),
  );
  const both = stack(
    s,
    raw1.map((x, i) => x * opp[i]!),
  );
  return s.rows.map((r, i) => {
    const p = s.prior[i]!;
    const tonight =
      p.absent.length !== r.absent.length ||
      p.absent.some((a, j) => a.share !== r.absent[j]?.share);
    return {
      season: end,
      player: r.player,
      fp: r.fp,
      base: base[i]!,
      t1: t1[i]!,
      t2: t2[i]!,
      both: both[i]!,
      affected1: Math.abs(raw1[i]! - raw0[i]!) > 1e-9,
      tonight1: tonight,
      early: r.past.length < 10,
      same1: p.absent.some((a) => a.group === r.group) && tonight,
      affected2: oppOut(r),
      oppStar: r.oppAbsent.some((a) => a.min10 >= REGULAR_MIN && a.share >= STAR),
      oppSame: r.oppAbsent.some(
        (a) => a.min10 >= REGULAR_MIN && a.share > FLOOR && a.group === r.group,
      ),
    };
  });
}

/** Mean of per-player-season mean differences, with a normal 95% interval. */
function judge(rs: Rec[], d: (r: Rec) => number) {
  const by = new Map<string, number[]>();
  for (const r of rs) {
    const k = `${r.season}:${r.player}`;
    by.set(k, [...(by.get(k) ?? []), d(r)]);
  }
  const per = [...by.values()].map(mean);
  const m = mean(per);
  const half = (1.96 * Math.sqrt(mean(per.map((x) => (x - m) ** 2)))) / Math.sqrt(per.length);
  return { n: rs.length, players: per.length, mean: m, lo: m - half, hi: m + half };
}

type Side = "t1" | "t2" | "both";
const abs = (c: Side) => (r: Rec) => Math.abs(r[c] - r.fp) - Math.abs(r.base - r.fp);
const sq = (c: Side) => (r: Rec) => (r[c] - r.fp) ** 2 - (r.base - r.fp) ** 2;
const sign = (x: number, d = 3) => `${x >= 0 ? "+" : ""}${x.toFixed(d)}`;
const label = (end: number) => `${end - 1}-${String(end).slice(2)}`;

function main() {
  const scoring = parseSettings(
    JSON.parse(
      readFileSync(
        new URL("../../../packages/espn/test/fixtures/league.json", import.meta.url),
        "utf8",
      ),
    ),
  ).scoring;

  if (process.env.CHECK) {
    // Harness check: today vs the context model on 2019-25 must reproduce #208 (no layers) and
    // #211's described row (both layers), i.e. this harness's base against today's projection.
    const all: { fp: number; today: number; noLayer: number; base: number; key: string }[] = [];
    for (const end of TEST) {
      const s = load(end, scoring);
      const today = stack(
        s,
        s.rows.map((r) => r.base),
      );
      const base = stack(s, s.rows.map(predict));
      s.rows.forEach((r, i) =>
        all.push({
          fp: r.fp,
          today: today[i]!,
          noLayer: Math.abs(predict(r) - r.fp) - Math.abs(r.base - r.fp),
          base: base[i]!,
          key: `${end}:${r.player}`,
        }),
      );
    }
    const per = (d: (x: (typeof all)[number]) => number) => {
      const by = new Map<string, number[]>();
      for (const x of all) by.set(x.key, [...(by.get(x.key) ?? []), d(x)]);
      return mean([...by.values()].map(mean));
    };
    console.log(`#208 (no layers): ${sign(per((x) => x.noLayer))} (recorded −0.036)`);
    console.log(
      `#211 2019-25 both layers: ${sign(per((x) => Math.abs(x.base - x.fp) - Math.abs(x.today - x.fp)))} (recorded −0.045)`,
    );
    return;
  }

  if (process.env.FIT) {
    // The opponent grid on the exploration seasons: overall MAE of the shipped stack × the
    // opponent factor, each (k, same) learning its own defense table.
    const seasons = EXPLORE.map((end) => ({ end, s: load(end, scoring) }));
    const raw = seasons.map(({ s }) => s.rows.map(predict));
    const results: { k: number; same: number; mae: number }[] = [];
    for (const same of S_GRID)
      for (const k of K_GRID) {
        let err = 0;
        let n = 0;
        seasons.forEach(({ s }, si) => {
          const pred = stack(
            s,
            raw[si]!.map(
              (x, i) => x * opponentFactor(s.rows[i]!.oppAbsent, s.rows[i]!.group, k, same),
            ),
          );
          s.rows.forEach((r, i) => {
            err += Math.abs(pred[i]! - r.fp);
            n++;
          });
        });
        results.push({ k, same, mae: err / n });
      }
    const zero = results.find((r) => r.k === 0)!.mae;
    for (const r of results)
      console.log(
        `k ${sign(r.k, 2)} same ${r.same}: MAE ${r.mae.toFixed(4)} (${sign(r.mae - zero, 4)} vs k 0)`,
      );
    const best = results.reduce((a, b) => (b.mae < a.mae ? b : a));
    console.log(
      `\nBest: k ${best.k}, same ${best.same} (${seasons.map((x) => label(x.end)).join(", ")}; ${raw.flat().length} player-games)`,
    );
    return;
  }

  const k = Number(process.env.K_OPP);
  const same = Number(process.env.S_OPP);
  if (!process.env.DRY && !(Number.isFinite(k) && Number.isFinite(same)))
    throw new Error("K_OPP and S_OPP (the frozen fit) are required for the evaluation");
  const all = TEST.flatMap((end) => recs(load(end, scoring), end, k || 0, same || 1));

  if (process.env.DRY) {
    // Counts only: which games each change touches (predictions, never outcomes).
    for (const end of TEST) {
      const rs = all.filter((r) => r.season === end);
      console.log(
        `${label(end)}: ${rs.length} player-games; test 1 affected ${rs.filter((r) => r.affected1).length} (tonight ${rs.filter((r) => r.tonight1).length}); test 2 affected ${rs.filter((r) => r.affected2).length} (star ${rs.filter((r) => r.oppStar).length})`,
      );
    }
    const a1 = all.filter((r) => r.affected1).length;
    const a2 = all.filter((r) => r.affected2).length;
    console.log(
      `Test 1: ${a1}, gate ${a1 >= GATE_1 ? "met" : "NOT met"}. Test 2: ${a2}, gate ${a2 >= GATE_2 ? "met" : "NOT met"}.`,
    );
    return;
  }

  const row = (name: string, rs: Rec[], d: (r: Rec) => number) => {
    const j = judge(rs, d);
    console.log(
      `| ${name} | ${j.n} (${j.players}) | ${sign(j.mean)} | [${sign(j.lo)}, ${sign(j.hi)}] |`,
    );
    return j;
  };
  const test = (title: string, gate: number, rs: Rec[], c: Side) => {
    console.log(
      `\n${title}\n\n| Comparison (2019-20 to 2024-25, environment + defense) | n (player-seasons) | Change − shipped | 95% CI |\n|---|---|---|---|`,
    );
    if (rs.length < gate)
      return console.log(`Gate not met (${rs.length} < ${gate}); not evaluated.`);
    const one = row("1. Absolute error, affected player-games", rs, abs(c));
    if (one.hi >= 0) return console.log("\n1 not passed; 2 is not tested.");
    row("2. Squared error, affected player-games", rs, sq(c));
  };
  test(
    "Test 1: last season's games",
    GATE_1,
    all.filter((r) => r.affected1),
    "t1",
  );
  test(
    `Test 2: opponents' absences (k ${k}, same ${same})`,
    GATE_2,
    all.filter((r) => r.affected2),
    "t2",
  );

  // Described, not tested.
  const describe = (name: string, rs: Rec[], c: Side) => {
    if (!rs.length) return console.log(`- ${name}: none`);
    const j = judge(rs, abs(c));
    console.log(
      `- ${name}: n ${rs.length}; MAE ${sign(j.mean)} [${sign(j.lo)}, ${sign(j.hi)}]; ` +
        `signed shipped ${sign(mean(rs.map((r) => r.base - r.fp)), 2)} → change ${sign(mean(rs.map((r) => r[c] - r.fp)), 2)}`,
    );
  };
  console.log("\nDescribed, test 1:");
  describe("Every player-game", all, "t1");
  describe(
    "Tonight's factor changes",
    all.filter((r) => r.tonight1),
    "t1",
  );
  describe(
    "Only earlier games change (de-inflation; returns)",
    all.filter((r) => r.affected1 && !r.tonight1),
    "t1",
  );
  describe(
    "His first 10 games of the season",
    all.filter((r) => r.affected1 && r.early),
    "t1",
  );
  describe(
    "Same position group tonight",
    all.filter((r) => r.same1),
    "t1",
  );
  for (const end of TEST)
    describe(
      label(end),
      all.filter((r) => r.season === end && r.affected1),
      "t1",
    );
  console.log("\nDescribed, test 2:");
  describe("Every player-game", all, "t2");
  describe(
    "An opposing star out (share ≥ 0.18)",
    all.filter((r) => r.oppStar),
    "t2",
  );
  describe(
    "An opposing regular in his group out",
    all.filter((r) => r.oppSame),
    "t2",
  );
  for (const end of TEST)
    describe(
      label(end),
      all.filter((r) => r.season === end && r.affected2),
      "t2",
    );
  console.log("\nDescribed, both changes together:");
  describe("Every player-game", all, "both");
}

main();
