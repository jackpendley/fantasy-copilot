// Chance a player suits up given his listed injury status. Rough priors for the MVP;
// the availability model (ROADMAP phase 5) replaces them with fitted probabilities.

const PLAY_PROBABILITY: Record<string, number> = {
  ACTIVE: 1,
  PROBABLE: 0.93,
  DAY_TO_DAY: 0.75,
  QUESTIONABLE: 0.5,
  DOUBTFUL: 0.12,
  OUT: 0,
  INJURY_RESERVE: 0,
  SUSPENSION: 0,
};

/** "Day-To-Day", "day_to_day", "DAY_TO_DAY" -> "DAY_TO_DAY". */
export function normalizeStatus(status: string | null | undefined): string {
  if (!status) return "ACTIVE";
  return status
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

export function playProbability(status: string | null | undefined): number {
  return PLAY_PROBABILITY[normalizeStatus(status)] ?? 1;
}

/** ESPN only lets ruled-out players into the IR slot. */
export function irEligible(status: string | null | undefined): boolean {
  const s = normalizeStatus(status);
  return s === "OUT" || s === "INJURY_RESERVE";
}
