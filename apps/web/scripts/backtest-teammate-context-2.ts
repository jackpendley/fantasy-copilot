// Teammate absences by impact, re-run on the full shipped stack (MODEL_CARD pre-registration
// 2026-11-20, before any run on these seasons): with game environment and opponent defense on
// both sides, does the context model (unchanged, scripts/teammate-context.ts) still beat
// today's projection? Judged once on 2010-11 to 2016-17 (box scores,
// scripts/fetch-history-boxscores.ts; lines, scripts/fetch-history-odds.ts), seasons no
// game-level test has used. Read-only; league scoring from the anonymized fixture.
//
// Environment: (his team's implied total ÷ the mean of earlier days' implied totals)^0.75, the
// mean once 40+ team-games have a line; 1 without a line. Opponent defense: per opponent and
// position group, f = (n·r + 200) / (n + 200) from earlier days' player-games, r = actual ÷
// predicted before defense. Each side learns its own table from its own predictions, as
// production would once the model ships.
//
//   CHECK=1 node --conditions=react-server --import tsx scripts/backtest-teammate-context-2.ts  (#208's seasons, no layers)
//   DRY=1 node --conditions=react-server --import tsx scripts/backtest-teammate-context-2.ts
//   node --conditions=react-server --import tsx scripts/backtest-teammate-context-2.ts

import { existsSync, readFileSync } from "node:fs";
import { parseSettings } from "@fantasy-copilot/espn";
import type { ScoringMap } from "@fantasy-copilot/fantasy-core";
import { impliedTeamTotal, type GameOdds } from "@fantasy-copilot/nba-data";
import {
  mean,
  playerGames,
  predict,
  REGULAR_MIN,
  STAR,
  starBack,
  starOut,
} from "./teammate-context";

/** Judged: 2010-11 to 2016-17 (box-score cache). Described: 2019-20 to 2024-25 (#208's). */
const UNSEEN = [2011, 2012, 2013, 2014, 2015, 2016, 2017];
const USED = [2020, 2021, 2022, 2023, 2024, 2025];
const BOX = new URL("../data/local/backtest-boxscores/", import.meta.url);
const MODERN = new URL("../data/local/backtest/", import.meta.url);
const ENV_EXP = 0.75;
const LEAGUE_MIN = 40;
const DEF_K = 200;
/** The gate: fewer player-games than this and nothing is evaluated. */
const MIN_GAMES = 60_000;

const LAYERS = ["none", "env", "def", "both"] as const;
type Layer = (typeof LAYERS)[number];

/** One player-game, kept small: what the comparisons need. */
interface Rec {
  season: number;
  player: number;
  fp: number;
  hasLine: boolean;
  starBack: boolean;
  starOut13: boolean;
  starSame: boolean;
  noRegular: boolean;
  ongoing: boolean;
  center: boolean;
  /** Today's projection and the context model, under each set of layers. */
  base: Record<Layer, number>;
  cand: Record<Layer, number>;
}

/** The ET day of a tip (tips are evening ET, so five hours back is the right date). */
const dayOf = (t: number) => new Date(t - 5 * 3600_000).toISOString().slice(0, 10);

function season(end: number, cache: URL, scoring: ScoringMap): Rec[] {
  const rows = playerGames(end, scoring, cache);
  const oddsFile = new URL(`odds-${end}.json`, cache);
  const odds = new Map<number, GameOdds | null>(
    existsSync(oddsFile)
      ? Object.entries(
          JSON.parse(readFileSync(oddsFile, "utf8")) as Record<string, GameOdds | null>,
        ).map(([id, o]) => [Number(id), o])
      : [],
  );
  const days = rows.map((r) => dayOf(r.t));

  // The league's mean implied team total before each day (point in time).
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

  // Opponent defense learned day by day from one side's predictions before defense.
  const order = rows.map((_, i) => i).sort((a, b) => rows[a]!.t - rows[b]!.t);
  const defense = (pre: number[]) => {
    const f = new Array<number>(rows.length).fill(1);
    const acc = new Map<string, { actual: number; pred: number; n: number }>();
    const key = (i: number) => `${rows[i]!.opponent}|${rows[i]!.group}`;
    for (let i = 0; i < order.length;) {
      let j = i;
      while (j < order.length && days[order[j]!] === days[order[i]!]) j++;
      for (let x = i; x < j; x++) {
        const a = acc.get(key(order[x]!));
        if (a?.n) f[order[x]!] = (a.n * (a.actual / a.pred) + DEF_K) / (a.n + DEF_K);
      }
      for (let x = i; x < j; x++) {
        const k = order[x]!;
        const a = acc.get(key(k)) ?? { actual: 0, pred: 0, n: 0 };
        a.actual += rows[k]!.fp;
        a.pred += pre[k]!;
        a.n++;
        acc.set(key(k), a);
      }
      i = j;
    }
    return f;
  };

  const stack = (raw: number[]) => {
    const withEnv = raw.map((x, i) => x * env[i]!);
    const defRaw = defense(raw);
    const defEnv = defense(withEnv);
    return {
      none: raw,
      env: withEnv,
      def: raw.map((x, i) => x * defRaw[i]!),
      both: withEnv.map((x, i) => x * defEnv[i]!),
    } satisfies Record<Layer, number[]>;
  };
  const base = stack(rows.map((r) => r.base));
  const cand = stack(rows.map(predict));
  const pick = (s: Record<Layer, number[]>, i: number) =>
    Object.fromEntries(LAYERS.map((l) => [l, s[l][i]!])) as Record<Layer, number>;

  return rows.map((r, i) => ({
    season: end,
    player: r.player,
    fp: r.fp,
    hasLine: !!odds.get(r.gameId),
    starBack: starBack(r),
    starOut13: starOut(r, 1, 3),
    starSame: r.absent.some(
      (a) => a.min10 >= REGULAR_MIN && a.share >= STAR && a.group === r.group,
    ),
    noRegular: !r.absent.some((a) => a.min10 >= REGULAR_MIN),
    ongoing: r.absent.some((a) => a.min10 >= REGULAR_MIN && a.idx >= 2),
    center: r.group === "C",
    base: pick(base, i),
    cand: pick(cand, i),
  }));
}

/** Mean of per-player-season mean differences, with a normal 95% interval. */
function judge(recs: Rec[], d: (r: Rec) => number) {
  const by = new Map<string, number[]>();
  for (const r of recs) {
    const k = `${r.season}:${r.player}`;
    by.set(k, [...(by.get(k) ?? []), d(r)]);
  }
  const per = [...by.values()].map(mean);
  const m = mean(per);
  const half = (1.96 * Math.sqrt(mean(per.map((x) => (x - m) ** 2)))) / Math.sqrt(per.length);
  return { n: recs.length, players: per.length, mean: m, lo: m - half, hi: m + half };
}

const abs = (l: Layer) => (r: Rec) => Math.abs(r.cand[l] - r.fp) - Math.abs(r.base[l] - r.fp);
const sq = (l: Layer) => (r: Rec) => (r.cand[l] - r.fp) ** 2 - (r.base[l] - r.fp) ** 2;
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
    // Harness check on #208's seasons: with no layers it must reproduce #208's comparison 1.
    const j = judge(
      USED.flatMap((s) => season(s, MODERN, scoring)),
      abs("none"),
    );
    return console.log(
      `#208 check: ${j.n} (${j.players}) ${sign(j.mean)} [${sign(j.lo)}, ${sign(j.hi)}]`,
    );
  }
  const unseen = UNSEEN.flatMap((s) => season(s, BOX, scoring));

  if (process.env.DRY) {
    // Counts only: no outcome is computed or printed.
    for (const s of UNSEEN) {
      const rs = unseen.filter((r) => r.season === s);
      console.log(
        `${label(s)}: ${rs.length} player-games, ${new Set(rs.map((r) => r.player)).size} players, ` +
          `${rs.filter((r) => r.hasLine).length} with a line; star out ${rs.filter((r) => r.starOut13).length} (games 1-3), star back ${rs.filter((r) => r.starBack).length}`,
      );
    }
    console.log(`Total ${unseen.length}: gate ${unseen.length >= MIN_GAMES ? "met" : "NOT met"}.`);
    return;
  }
  if (unseen.length < MIN_GAMES)
    throw new Error(`${unseen.length} player-games: below the gate of ${MIN_GAMES}`);

  console.log(
    "| Comparison (2010-11 to 2016-17, environment + defense) | n (player-seasons) | Model − today | 95% CI |",
  );
  console.log("|---|---|---|---|");
  const steps: [string, Rec[], (r: Rec) => number][] = [
    ["1. Absolute error, every player-game", unseen, abs("both")],
    ["2. Squared error, every player-game", unseen, sq("both")],
    [
      "3. Absolute error, games after a star's return",
      unseen.filter((r) => r.starBack),
      abs("both"),
    ],
  ];
  for (const [name, rs, d] of steps) {
    const j = judge(rs, d);
    console.log(
      `| ${name} | ${j.n} (${j.players}) | ${sign(j.mean)} | [${sign(j.lo)}, ${sign(j.hi)}] |`,
    );
    if (j.hi >= 0) {
      console.log(`\n${name.slice(0, 2)} not passed; later comparisons are not tested.`);
      break;
    }
  }

  // Described, not tested.
  const describe = (name: string, rs: Rec[], l: Layer = "both") => {
    if (!rs.length) return console.log(`- ${name}: none`);
    const j = judge(rs, abs(l));
    console.log(
      `- ${name}: n ${rs.length}; MAE ${sign(j.mean)} [${sign(j.lo)}, ${sign(j.hi)}]; ` +
        `signed today ${sign(mean(rs.map((r) => r.base[l] - r.fp)), 2)} → model ${sign(mean(rs.map((r) => r.cand[l] - r.fp)), 2)}; ` +
        `MAE today ${mean(rs.map((r) => Math.abs(r.base[l] - r.fp))).toFixed(2)}`,
    );
  };
  console.log("\nDescribed (not tested), 2010-11 to 2016-17:");
  for (const l of LAYERS) describe(`layers: ${l}`, unseen, l);
  for (const s of UNSEEN)
    describe(
      label(s),
      unseen.filter((r) => r.season === s),
    );
  describe(
    "Games with a line",
    unseen.filter((r) => r.hasLine),
  );
  describe(
    "Star out, his games 1–3",
    unseen.filter((r) => r.starOut13),
  );
  describe(
    "Star out, same position group",
    unseen.filter((r) => r.starSame),
  );
  describe(
    "No regular out",
    unseen.filter((r) => r.noRegular),
  );
  describe(
    "Only absences already ongoing (known the day before)",
    unseen.filter((r) => r.ongoing),
  );
  describe(
    "Centers after a star's return",
    unseen.filter((r) => r.center && r.starBack),
  );

  console.log("\nDescribed, 2019-20 to 2024-25 (already used by #208):");
  const used = USED.flatMap((s) => season(s, MODERN, scoring));
  for (const l of LAYERS) describe(`layers: ${l}`, used, l);
  describe(
    "Games after a star's return",
    used.filter((r) => r.starBack),
  );
}

main();
