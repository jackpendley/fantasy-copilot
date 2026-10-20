// Daily lineup optimizer. Every rostered player gets a slot (starting, bench or IR):
// first maximize projected points in starting slots, then make as few moves as possible.
// Players whose game has started are locked in place, as ESPN enforces.

import { hungarian } from "./assignment";
import { BENCH, IR, expandSlots, isStartingSlot, slotAccepts, type Position } from "./slots";

export interface LineupPlayer {
  id: number;
  eligible: readonly Position[];
  /** Expected fantasy points today if he starts (0 when he has no game). */
  value: number;
  /** Slot type he occupies right now, e.g. "UTIL" or "BE". */
  currentSlot: string;
  /** His game has started: he cannot move. */
  locked?: boolean;
  /** ESPN allows him in the IR slot (ruled out / on injured reserve). */
  irEligible?: boolean;
}

export interface Move {
  playerId: number;
  from: string;
  to: string;
}

export interface LineupResult {
  slotOf: Map<number, string>;
  /** Projected points of the starting lineup. */
  points: number;
  moves: Move[];
}

// Points dominate: a move costs less than 0.001 projected points.
const POINT_SCALE = 1000;
const FORBIDDEN = 1e12;

function allowed(player: LineupPlayer, slot: string): boolean {
  if (player.locked) return slot === player.currentSlot;
  if (slot === IR) return Boolean(player.irEligible);
  return slotAccepts(slot, player.eligible);
}

export function optimizeLineup(
  players: readonly LineupPlayer[],
  slotCounts: Record<string, number>,
): LineupResult {
  // ESPN basketball benches are unlimited (`isBenchUnlimited`): a slot nobody can fill stays
  // empty and the extra player sits. Roster size is enforced on adds, not on lineups.
  const slots = [
    ...expandSlots({ ...slotCounts, [BENCH]: 0 }),
    ...Array<string>(players.length).fill(BENCH),
  ];
  // Pad to a square matrix with phantom players who fit anywhere at no cost.
  const cost = slots.map((_, row) =>
    slots.map((slot) => {
      const p = players[row];
      if (!p) return 0;
      if (!allowed(p, slot)) return FORBIDDEN;
      const points = isStartingSlot(slot) ? p.value * POINT_SCALE : 0;
      const move = slot === p.currentSlot ? 0 : 1;
      return move - points;
    }),
  );
  const colOfRow = hungarian(cost);

  const slotOf = new Map<number, string>();
  let points = 0;
  const moves: Move[] = [];
  players.forEach((p, row) => {
    const col = colOfRow[row]!;
    if (cost[row]![col]! >= FORBIDDEN) {
      throw new Error(`no legal slot for player ${p.id}`);
    }
    const slot = slots[col]!;
    slotOf.set(p.id, slot);
    if (isStartingSlot(slot)) points += p.value;
    if (slot !== p.currentSlot) moves.push({ playerId: p.id, from: p.currentSlot, to: slot });
  });
  return { slotOf, points, moves };
}

/** Points the lineup scores as currently set (locked or not). */
export function currentPoints(players: readonly LineupPlayer[]): number {
  return players.reduce((a, p) => a + (isStartingSlot(p.currentSlot) ? p.value : 0), 0);
}

/**
 * The best starting lineup's players, picked greedily by value. Greedy is exact here: players
 * and slot capacities form a transversal matroid, so adding the most valuable player that
 * still fits (via an augmenting path) never has to be undone. Much faster than `optimizeLineup`,
 * which also minimizes moves; use this when only the points matter.
 */
export function greedyStarters<T>(
  players: readonly T[],
  value: (p: T) => number,
  eligible: (p: T) => readonly Position[],
  openSlots: readonly string[],
): T[] {
  const owner = new Array<number>(openSlots.length).fill(-1);
  const sorted = [...players].sort((a, b) => value(b) - value(a));
  const seated: T[] = [];
  const tryPlace = (pi: number, seen: boolean[]): boolean => {
    for (let s = 0; s < openSlots.length; s++) {
      if (seen[s] || !slotAccepts(openSlots[s]!, eligible(sorted[pi]!))) continue;
      seen[s] = true;
      if (owner[s] === -1 || tryPlace(owner[s]!, seen)) {
        owner[s] = pi;
        return true;
      }
    }
    return false;
  };
  for (let i = 0; i < sorted.length && seated.length < openSlots.length; i++) {
    const snap = [...owner];
    if (tryPlace(i, new Array<boolean>(openSlots.length).fill(false))) seated.push(sorted[i]!);
    else owner.splice(0, owner.length, ...snap);
  }
  return seated;
}
