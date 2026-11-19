// Whether a player is active for tonight's game, from every source the app reads, strongest
// first: NBA.com's inactive list (filed by the teams before tip, late scratches included), the
// official injury report's Out, then ESPN's status (its injury feed, else the fantasy status).
// Only a definite Out overrides ESPN: the official report's finer statuses wait for their
// forward test (ADR-038). Pure.

export interface ActiveInput {
  /** ESPN's status (normalized) and its short note. */
  espn: string;
  espnNote: string | null;
  /** NBA.com lists him inactive tonight. */
  nbaInactive: boolean;
  /** The official report's latest status for him tonight, if it lists him. */
  official: string | null;
}

export interface Active {
  status: string;
  source: "NBA.com" | "official report" | "ESPN";
  note: string | null;
}

export function activeStatus(i: ActiveInput): Active {
  const also = (note: string) => (i.espnNote ? `${note} · ${i.espnNote}` : note);
  if (i.nbaInactive) return { status: "OUT", source: "NBA.com", note: also("Inactive (NBA.com)") };
  if (i.official === "Out" && i.espn !== "OUT")
    return { status: "OUT", source: "official report", note: also("Out (official report)") };
  return { status: i.espn, source: "ESPN", note: i.espnNote };
}
