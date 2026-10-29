import "server-only";
// The Waivers page's best moves, checked with the season simulation (lib/nba/move-sim.ts) in
// the background and kept in view_cache. Simulating costs CPU (Vercel Hobby includes 4
// CPU-hours a month), so only a short list is checked, and only when it or Jack's roster
// changed: a new free agent in the short list waits up to COOLDOWN_MS while the roster and
// the players' injury news stay the same.

import { after } from "next/server";
import { dbConfigured } from "@/lib/db";
import { fingerprintOf, readView, writeView } from "@/lib/view-cache";
import { simulateMoves, type MoveEffect, type MoveSimResult, type MoveSpec } from "./move-sim";
import type { StreamOption } from "./waivers";
import { loadWaiverView } from "./waivers-view";

type WaiverView = Awaited<ReturnType<typeof loadWaiverView>>;

const KEY = "move-checks";
/** Moves checked: the top of the quick ranking. */
const SHORTLIST = 4;
const COOLDOWN_MS = 30 * 60_000;

export const moveKey = (o: Pick<StreamOption, "add" | "drop" | "il">) =>
  `${o.add.player.id}:${o.drop?.id ?? ""}:${o.il?.id ?? ""}`;

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
function rosterKey(v: WaiverView): string {
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

const spec = (o: StreamOption): MoveSpec => ({
  key: moveKey(o),
  add: o.add.player,
  drop: o.drop,
  il: o.il,
});

export interface MoveChecks {
  byKey: Map<string, MoveEffect>;
  seasons: number;
  /** False while the short list is being (re)checked. */
  fresh: boolean;
}

/** Stored checks for the page; schedules a re-check when they're out of date. */
export async function moveChecks(v: WaiverView): Promise<MoveChecks | null> {
  if (!dbConfigured()) return null;
  const moves = shortlist(v);
  if (!moves.length) return null;
  const row = await readView<Stored>(KEY).catch(() => null);
  const fresh = row?.fingerprint === fingerprint(v, moves);
  if (!fresh) after(() => refreshMoveChecks().catch(() => {}));
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
    const result = await simulateMoves(moves.map(spec));
    const value: Stored = { ...result, rosterKey: roster };
    await writeView(KEY, fp, value, performance.now() - t0);
    return true;
  })().finally(() => {
    running = null;
  });
  return running;
}
