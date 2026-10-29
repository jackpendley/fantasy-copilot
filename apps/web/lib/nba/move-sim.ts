import "server-only";
// Waiver moves checked with the season simulation: the same engine as the Outlook, so a move
// recommended here moves the Outlook the same way. Each move is simulated against the current
// roster with the same random draws (common random numbers), season by season, so the
// difference is mostly the move itself; the season-by-season differences also give its
// standard error. Title odds come first, but a title change smaller than twice its error is
// called even and expected wins (far more precise) decide.

import type { RosterPlayer } from "@fantasy-copilot/espn";
import { simulateSeasonAsync, type SimInput } from "@fantasy-copilot/fantasy-core";
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
}

export interface MoveSimResult {
  seasons: number;
  base: { title: number; playoffs: number; seed1: number; wins: number };
  effects: MoveEffect[];
}

/** Seasons per move: ~8 s of CPU each on Vercel, paired errors ~±1.4 title points. */
export const MOVE_SEASONS = 800;

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

export async function simulateMoves(
  moves: MoveSpec[],
  seasons = MOVE_SEASONS,
): Promise<MoveSimResult> {
  const setup = await outlookSetup();
  const { data } = setup;
  const myId = data.me.id;

  async function run(roster: RosterPlayer[], freeAgents: RosterPlayer[], extra: RosterPlayer[]) {
    const injured = new Map(setup.injured);
    for (const [id, a] of absences(extra, data.injuries, setup.fromDay)) injured.set(id, a);
    const { input } = buildOutlookInput({
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
    });
    const me = input.teams.findIndex((t) => t.id === myId);
    const o: Outcomes = {
      title: new Float64Array(seasons),
      playoffs: new Float64Array(seasons),
      seed1: new Float64Array(seasons),
      wins: new Float64Array(seasons),
    };
    const traced: SimInput = {
      ...input,
      inspect: (s, r) => {
        o.title[s] = r.champion === myId ? 1 : 0;
        o.playoffs[s] = r.playoffs.includes(myId) ? 1 : 0;
        o.seed1[s] = r.seed1 === myId ? 1 : 0;
        o.wins[s] = r.wins[me]!;
      },
    };
    await simulateSeasonAsync(traced);
    return o;
  }

  const base = await run(data.me.roster, setup.freeAgents, []);
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
    const o = await run(roster, pool, [m.add]);
    const title = paired(o.title, base.title);
    const wins = paired(o.wins, base.wins);
    effects.push({
      key: m.key,
      title,
      playoffs: paired(o.playoffs, base.playoffs),
      seed1: paired(o.seed1, base.seed1),
      wins,
      ...verdictOf(title, wins),
    });
  }
  return {
    seasons,
    base: {
      title: avg(base.title),
      playoffs: avg(base.playoffs),
      seed1: avg(base.seed1),
      wins: avg(base.wins),
    },
    effects,
  };
}
