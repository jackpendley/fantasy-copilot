// The League standings' sort keys (shared by the page, which reads ?sort=, and the table).

export const STANDINGS_SORTS = [
  "rank",
  "name",
  "record",
  "pf",
  "perWeek",
  "expWins",
  "playoffs",
  "bye",
  "seed1",
  "final",
  "champ",
  "act",
] as const;

export type StandingsSort = (typeof STANDINGS_SORTS)[number];
