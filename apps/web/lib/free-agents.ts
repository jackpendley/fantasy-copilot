// The Waivers free-agent table's filters and sorting (pure; shared by the page and the table).

export interface FreeAgentRow {
  id: number;
  name: string;
  status: string;
  proTeam: string;
  positions: string[];
  waivers: boolean;
  fppg: number;
  /** Percentile of his FP/G among this league's rostered players. */
  fppgPct: number | null;
  last7: number | null;
  weekGames: number;
  owned: number | null;
  /** Change in % owned across ESPN over the last week. */
  change: number | null;
  /** Projected points from games after this week. */
  season: number;
}

export const POSITIONS = ["All", "PG", "SG", "SF", "PF", "C", "G", "F"] as const;
const GROUPS: Record<string, string[]> = { G: ["PG", "SG"], F: ["SF", "PF"] };

export function playsPosition(positions: string[], pos: string): boolean {
  if (pos === "All") return true;
  return (GROUPS[pos] ?? [pos]).some((p) => positions.includes(p));
}

export const COLUMNS = [
  { key: "name", label: "Player", value: (r: FreeAgentRow) => r.name },
  { key: "fppg", label: "FP/G", value: (r: FreeAgentRow) => r.fppg },
  { key: "last7", label: "Last 7", value: (r: FreeAgentRow) => r.last7 },
  { key: "games", label: "Wk G", value: (r: FreeAgentRow) => r.weekGames },
  { key: "owned", label: "Owned", value: (r: FreeAgentRow) => r.owned },
  { key: "change", label: "+/−", value: (r: FreeAgentRow) => r.change },
  { key: "season", label: "Season", value: (r: FreeAgentRow) => r.season },
] as const;
export type SortKey = (typeof COLUMNS)[number]["key"];

/** Sort rows by a column: numbers high to low (names A-Z) unless flipped; missing values last. */
export function sortRows(rows: FreeAgentRow[], key: SortKey, flipped = false): FreeAgentRow[] {
  const col = COLUMNS.find((c) => c.key === key)!;
  const dir = (key === "name" ? 1 : -1) * (flipped ? -1 : 1);
  return [...rows].sort((a, b) => {
    const x = col.value(a);
    const y = col.value(b);
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
    const c = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
    return c * dir || b.fppg - a.fppg;
  });
}
