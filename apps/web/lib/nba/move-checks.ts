import "server-only";
// The Waivers page's best moves, checked with the season simulation (lib/nba/move-sim.ts) in
// the background and kept in view_cache. Simulating costs CPU (Vercel Hobby includes 4
// CPU-hours a month), so only a short list is checked, and only when it or Jack's roster
// changed: a new free agent in the short list waits up to COOLDOWN_MS while the roster and
// the players' injury news stay the same.

import { dbConfigured } from "@/lib/db";
import { fingerprintOf, readView, writeView } from "@/lib/view-cache";
import {
  DAILY_CPU_BUDGET_S,
  moveCpuToday,
  simulateMoves,
  type MoveEffect,
  type MoveSimResult,
  type MoveSpec,
} from "./move-sim";
import { moveKey } from "./sim-moves";
import type { StreamOption } from "./waivers";
import { loadWaiverView } from "./waivers-view";

type WaiverView = Awaited<ReturnType<typeof loadWaiverView>>;

const KEY = "move-checks";
/** Moves checked: the top of the quick ranking. */
const SHORTLIST = 6;
const COOLDOWN_MS = 30 * 60_000;

export { moveKey };

interface Stored extends MoveSimResult {
  rosterKey: string;
}

export function shortlist(v: WaiverView): StreamOption[] {
  const seen = new Set<string>();
  return v.analysis.best
    .filter((o) => {
      const k = moveKey(o);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, SHORTLIST);
}

/** Jack's roster as the simulation sees it: players, slots and their injury news. */
export function rosterKey(v: WaiverView): string {
  const news = new Map(v.data.injuries.map((i) => [i.playerId, [i.status, i.returnDate ?? null]]));
  return fingerprintOf(
    v.data.ahead.me.roster
      .map((p) => [p.id, p.slot, p.injuryStatus ?? null, news.get(p.id) ?? null])
      .sort(),
  );
}

function fingerprint(v: WaiverView, moves: StreamOption[]): string {
  const news = new Map(v.data.injuries.map((i) => [i.playerId, [i.status, i.returnDate ?? null]]));
  return fingerprintOf({
    sp: v.sp,
    roster: rosterKey(v),
    moves: moves.map((o) => [moveKey(o), news.get(o.add.player.id) ?? null]),
  });
}

/** The short list and the roster it was checked against (changes when either does). */
export const waiverFingerprint = (v: WaiverView) => fingerprint(v, shortlist(v));

const spec = (o: StreamOption): MoveSpec => ({
  key: moveKey(o),
  add: o.add.player,
  drop: o.drop,
  il: o.il,
});

export interface MoveChecks {
  byKey: Map<string, MoveEffect>;
  seasons: number;
  /** False when rosters, injury news or the short list changed since the check. */
  fresh: boolean;
}

/** Stored checks for the page; schedules a re-check when they're out of date. */
export async function moveChecks(v: WaiverView): Promise<MoveChecks | null> {
  if (!dbConfigured()) return null;
  const moves = shortlist(v);
  if (!moves.length) return null;
  const row = await readView<Stored>(KEY).catch(() => null);
  // Page visits never start a simulation (CPU budget): stale checks are shown as such and
  // re-run by the nightly job.
  const fresh = row?.fingerprint === fingerprint(v, moves);
  if (!row) return { byKey: new Map(), seasons: 0, fresh: false };
  return {
    byKey: new Map(row.value.effects.map((e) => [e.key, e])),
    seasons: row.value.seasons,
    fresh,
  };
}

let running: Promise<boolean> | null = null;

/** Re-check the short list if it or the roster changed (true when it simulated). */
export function refreshMoveChecks(): Promise<boolean> {
  running ??= (async () => {
    const v = await loadWaiverView();
    const moves = shortlist(v);
    if (!moves.length) return false;
    const fp = fingerprint(v, moves);
    const roster = rosterKey(v);
    const row = await readView<Stored>(KEY).catch(() => null);
    if (row?.fingerprint === fp) return false;
    if (row?.value.rosterKey === roster && Date.now() - row.computedAt.getTime() < COOLDOWN_MS)
      return false;
    const t0 = performance.now();
    // Close calls get a second batch while the day's simulation budget lasts.
    const budget = (await moveCpuToday().catch(() => 0)) < DAILY_CPU_BUDGET_S;
    const result = await simulateMoves(moves.map(spec), {
      maxBatches: budget ? 2 : 1,
      label: "shortlist",
    });
    const value: Stored = { ...result, rosterKey: roster };
    await writeView(KEY, fp, value, performance.now() - t0);
    return true;
  })().finally(() => {
    running = null;
  });
  return running;
}

/**
 * One more move checked on request (a drop Jack picked instead): simulated, and kept with the
 * stored checks so the page shows it next time. Null when that move isn't available now.
 */
export async function checkMove(
  addId: number,
  dropId: number | null,
  ilId: number | null,
): Promise<MoveEffect | null> {
  const v = await loadWaiverView();
  const option = (v.analysis.dropOptions.get(addId) ?? []).find(
    (o) => (o.drop?.id ?? null) === dropId && (o.il?.id ?? null) === ilId,
  );
  if (!option) return null;
  const budget = (await moveCpuToday().catch(() => 0)) < DAILY_CPU_BUDGET_S;
  const t0 = performance.now();
  const result = await simulateMoves([spec(option)], {
    maxBatches: budget ? 2 : 1,
    label: "on request",
  });
  const effect = result.effects[0]!;
  const row = await readView<Stored>(KEY).catch(() => null);
  if (row) {
    const effects = [...row.value.effects.filter((e) => e.key !== effect.key), effect];
    await writeView(KEY, row.fingerprint, { ...row.value, effects }, performance.now() - t0).catch(
      () => {},
    );
  }
  return effect;
}
