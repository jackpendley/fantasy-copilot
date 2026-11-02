import "server-only";
// Waiver moves checked with the season simulation: the same engine as the Outlook, so a move
// recommended here moves the Outlook the same way. Each move is simulated against the current
// roster with the same random draws (common random numbers), season by season, so the
// difference is mostly the move itself; the season-by-season differences also give its
// standard error. Title odds come first, but a title change smaller than twice its error is
// called even and expected wins (far more precise) decide.
//
// Precision per CPU second (DECISIONS ADR-047): each season's playoffs are replayed 10 times
// (title odds become shares), seasons run in batches of 400, and a move whose title change is
// still within its margin gets a second batch while the day's simulation budget lasts.

import type { RosterPlayer } from "@fantasy-copilot/espn";
import { simulateSeasonAsync, type SimInput } from "@fantasy-copilot/fantasy-core";
import { db, dbConfigured } from "@/lib/db";
import { fingerprintOf } from "@/lib/view-cache";
import { absences } from "./availability";
import { buildOutlookInput } from "./outlook";
import { outlookSetup } from "./outlook-run";

export interface MoveSpec {
  key: string;
  add: RosterPlayer;
  /** Dropped to make room (null: an open spot or an IL move). */
  drop: RosterPlayer | null;
  /** Moved to the IR slot instead of a drop. */
  il: RosterPlayer | null;
}

/** A difference from the current roster, with its standard error (same units). */
export interface Delta {
  d: number;
  se: number;
}

export type Verdict = "better" | "worse" | "even";

export interface MoveEffect {
  key: string;
  title: Delta;
  playoffs: Delta;
  seed1: Delta;
  wins: Delta;
  /** Decided by title odds when that change is clear, otherwise by expected wins. */
  verdict: Verdict;
  decidedBy: "title" | "wins";
  /** Seasons simulated for this move (each with its playoffs replayed). */
  seasons?: number;
}

export interface MoveSimResult {
  seasons: number;
  base: { title: number; playoffs: number; seed1: number; wins: number };
  effects: MoveEffect[];
}

/** Seasons per batch. */
export const BATCH_SEASONS = 400;
/** Playoff replays per season: title ±1.9 per batch on Nov 2's moves (vs ±3.2 for 800 plain seasons at ~the same CPU). */
export const PLAYOFF_REPLAYS = 10;
const SEED = 20261018;
/** Simulation CPU a day for move checks before close calls stop getting a second batch. */
export const DAILY_CPU_BUDGET_S = 120;

interface Outcomes {
  title: Float64Array;
  playoffs: Float64Array;
  seed1: Float64Array;
  wins: Float64Array;
}

function paired(a: Float64Array, b: Float64Array): Delta {
  const n = a.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += a[i]! - b[i]!;
  mean /= n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (a[i]! - b[i]! - mean) ** 2;
  return { d: mean, se: Math.sqrt(v / Math.max(1, n - 1) / n) };
}

const avg = (a: Float64Array) => a.reduce((s, x) => s + x, 0) / a.length;

/** The verdict rule: a clear title change decides; otherwise a clear change in expected wins. */
export function verdictOf(title: Delta, wins: Delta): Pick<MoveEffect, "verdict" | "decidedBy"> {
  const clear = (x: Delta) => Math.abs(x.d) > 2 * x.se;
  if (clear(title)) return { verdict: title.d > 0 ? "better" : "worse", decidedBy: "title" };
  if (clear(wins)) return { verdict: wins.d > 0 ? "better" : "worse", decidedBy: "wins" };
  return { verdict: "even", decidedBy: "wins" };
}

/** Base runs by setup, so a check of one more move (a swapped drop) reuses them. */
const baseCache = new Map<string, Outcomes[]>();

const concat = (parts: Float64Array[]) => {
  const out = new Float64Array(parts.reduce((a, p) => a + p.length, 0));
  let k = 0;
  for (const p of parts) {
    out.set(p, k);
    k += p.length;
  }
  return out;
};
const joined = (parts: Outcomes[]): Outcomes => ({
  title: concat(parts.map((p) => p.title)),
  playoffs: concat(parts.map((p) => p.playoffs)),
  seed1: concat(parts.map((p) => p.seed1)),
  wins: concat(parts.map((p) => p.wins)),
});

/** Move-check CPU seconds in the last 24 hours (from refresh_log). */
export async function moveCpuToday(): Promise<number> {
  if (!dbConfigured()) return 0;
  const [r] = await db()<{ cpu: number | null }[]>`
    select sum((detail::jsonb->>'cpu')::float) as cpu from refresh_log
    where job = 'move-sim' and status = 'ok' and ran_at > now() - interval '24 hours'
  `;
  return r?.cpu ?? 0;
}

/**
 * The moves, each against the current roster on the same draws. `maxBatches`: batches a move
 * may get (a second only while its title change is within its margin).
 */
export async function simulateMoves(
  moves: MoveSpec[],
  opts: { seasons?: number; replays?: number; maxBatches?: number; label?: string } = {},
): Promise<MoveSimResult> {
  const seasons = opts.seasons ?? BATCH_SEASONS;
  const replays = opts.replays ?? PLAYOFF_REPLAYS;
  const maxBatches = Math.max(1, opts.maxBatches ?? 1);
  const cpu0 = process.cpuUsage();
  let simulated = 0;
  const setup = await outlookSetup();
  const { data } = setup;
  const myId = data.me.id;

  const inputFor = (roster: RosterPlayer[], freeAgents: RosterPlayer[], extra: RosterPlayer[]) => {
    const injured = new Map(setup.injured);
    for (const [id, a] of absences(extra, data.injuries, setup.fromDay)) injured.set(id, a);
    return buildOutlookInput({
      teams: data.teams.map((t) => (t.id === myId ? { ...t, roster } : t)),
      previousTeams: setup.previousTeams,
      freeAgents,
      games: data.games,
      matchups: data.matchups,
      slotCounts: data.settings.slotCounts,
      addCapPerWeek: data.settings.addsPerWeek ?? 3,
      regularWeeks: data.settings.regularSeasonWeeks,
      fromDay: setup.fromDay,
      bankedNow: setup.bankedNow,
      injured,
      seasons,
    }).input;
  };

  /** One batch (its own seed) of a roster's seasons. */
  async function run(input: SimInput, batch: number) {
    const me = input.teams.findIndex((t) => t.id === myId);
    const o: Outcomes = {
      title: new Float64Array(seasons),
      playoffs: new Float64Array(seasons),
      seed1: new Float64Array(seasons),
      wins: new Float64Array(seasons),
    };
    await simulateSeasonAsync({
      ...input,
      seed: SEED + batch,
      playoffReplays: replays,
      inspect: (s, r) => {
        o.title[s] = r.titleShares[me]!;
        o.playoffs[s] = r.playoffs.includes(myId) ? 1 : 0;
        o.seed1[s] = r.seed1 === myId ? 1 : 0;
        o.wins[s] = r.wins[me]!;
      },
    });
    simulated += seasons;
    return o;
  }

  const baseInput = inputFor(data.me.roster, setup.freeAgents, []);
  const baseKey = fingerprintOf({
    teams: baseInput.teams,
    freeAgents: baseInput.freeAgents,
    fromDay: baseInput.fromDay,
    banked: [...baseInput.banked].map(([k, v]) => [k, [...v]]),
    seasons,
    replays,
  });
  const baseBatches = baseCache.get(baseKey) ?? [];
  baseCache.set(baseKey, baseBatches);
  if (baseCache.size > 4) baseCache.delete(baseCache.keys().next().value!);
  const baseBatch = async (b: number) => (baseBatches[b] ??= await run(baseInput, b));

  const effects: MoveEffect[] = [];
  for (const m of moves) {
    const roster = [
      ...data.me.roster
        .filter((p) => p.id !== m.drop?.id)
        .map((p) => (p.id === m.il?.id ? { ...p, slot: "IR" } : p)),
      { ...m.add, slot: "BE" },
    ];
    const pool = [
      ...setup.freeAgents.filter((p) => p.id !== m.add.id),
      ...(m.drop ? [m.drop] : []),
    ];
    const input = inputFor(roster, pool, [m.add]);
    const mine: Outcomes[] = [];
    const theirs: Outcomes[] = [];
    let o: Outcomes;
    let base: Outcomes;
    for (let b = 0; ; b++) {
      theirs.push(await baseBatch(b));
      mine.push(await run(input, b));
      o = joined(mine);
      base = joined(theirs);
      const t = paired(o.title, base.title);
      if (b + 1 >= maxBatches || Math.abs(t.d) > 2 * t.se) break;
    }
    const title = paired(o.title, base.title);
    const wins = paired(o.wins, base.wins);
    effects.push({
      key: m.key,
      title,
      playoffs: paired(o.playoffs, base.playoffs),
      seed1: paired(o.seed1, base.seed1),
      wins,
      ...verdictOf(title, wins),
      seasons: o.title.length,
    });
  }
  const used = process.cpuUsage(cpu0);
  const cpu = Math.round((used.user + used.system) / 1e5) / 10;
  if (dbConfigured()) {
    const detail = JSON.stringify({
      cpu,
      moves: moves.length,
      seasons: simulated,
      replays,
      label: opts.label ?? null,
    });
    await db()`insert into refresh_log (job, status, detail) values ('move-sim', 'ok', ${detail})`.catch(
      () => {},
    );
  }
  const base = joined(baseBatches.filter(Boolean));
  return {
    seasons: Math.max(seasons, ...effects.map((e) => e.seasons ?? 0)),
    base: {
      title: avg(base.title),
      playoffs: avg(base.playoffs),
      seed1: avg(base.seed1),
      wins: avg(base.wins),
    },
    effects,
  };
}
