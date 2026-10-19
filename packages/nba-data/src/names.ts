// Name normalization for matching players across sources (NBA.com vs ESPN spellings).

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** Lowercase, strip accents, punctuation and generational suffixes, collapse whitespace. */
export function normalizeName(name: string | null | undefined): string {
  if (!name) return "";
  const cleaned = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // Jokić -> jokic
    .toLowerCase()
    .replace(/[.'’`]/g, "") // De'Aaron -> deaaron, P.J. -> pj
    .replace(/[-–—]/g, " ") // Gilgeous-Alexander -> gilgeous alexander
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned
    .split(" ")
    .filter((w) => !SUFFIXES.has(w))
    .join(" ");
}

export interface Matchable {
  id: number;
  name: string;
  /** ESPN team abbreviation. */
  team: string;
}

/**
 * Index ESPN players by normalized name + team, the only key that is unique in practice.
 * `overrides` maps "normalized source name|TEAM" -> ESPN id for known spelling gaps.
 */
export function buildMatcher(
  players: readonly Matchable[],
  overrides: Record<string, number> = {},
) {
  const byKey = new Map<string, number>();
  const byName = new Map<string, number[]>();
  for (const p of players) {
    const n = normalizeName(p.name);
    byKey.set(`${n}|${p.team}`, p.id);
    byName.set(n, [...(byName.get(n) ?? []), p.id]);
  }
  return (name: string, team: string): number | null => {
    const n = normalizeName(name);
    const key = `${n}|${team}`;
    if (overrides[key] != null) return overrides[key]!;
    if (byKey.has(key)) return byKey.get(key)!;
    // Traded since the ESPN pull: accept a unique name match on another team.
    const ids = byName.get(n) ?? [];
    return ids.length === 1 ? ids[0]! : null;
  };
}
