// NBA lineup slots and which positions each accepts (ESPN fantasy basketball).

export const NBA_POSITIONS = ["PG", "SG", "SF", "PF", "C"] as const;
export type Position = (typeof NBA_POSITIONS)[number];

export const BENCH = "BE";
export const IR = "IR";

export const SLOT_ACCEPTS: Record<string, readonly Position[]> = {
  PG: ["PG"],
  SG: ["SG"],
  SF: ["SF"],
  PF: ["PF"],
  C: ["C"],
  G: ["PG", "SG"],
  F: ["SF", "PF"],
  "SG/SF": ["SG", "SF"],
  "G/F": ["PG", "SG", "SF"],
  "PF/C": ["PF", "C"],
  "F/C": ["SF", "PF", "C"],
  UTIL: NBA_POSITIONS,
  [BENCH]: NBA_POSITIONS,
  [IR]: NBA_POSITIONS,
};

/** Starting slots score; bench and IR don't. */
export const isStartingSlot = (slot: string): boolean => slot !== BENCH && slot !== IR;

export function slotAccepts(slot: string, eligible: readonly Position[]): boolean {
  return (SLOT_ACCEPTS[slot] ?? []).some((p) => eligible.includes(p));
}

/** {"PG":1,"UTIL":2,...} -> ["PG","UTIL","UTIL",...], skipping slot types we don't model. */
export function expandSlots(counts: Record<string, number>): string[] {
  return Object.entries(counts).flatMap(([slot, n]) =>
    SLOT_ACCEPTS[slot] && n > 0 ? Array<string>(n).fill(slot) : [],
  );
}
