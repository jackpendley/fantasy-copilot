// Display helpers safe for client components (no server-only imports).

export const fmtPts = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

export const SLOT_ORDER = ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL", "BE", "IR"];
export const slotRank = (slot: string) => {
  const i = SLOT_ORDER.indexOf(slot);
  return i === -1 ? SLOT_ORDER.length : i;
};

/** "J. Duren" for tight phone columns. */
export const shortName = (name: string) => {
  const [first, ...rest] = name.split(" ");
  return rest.length ? `${first![0]}. ${rest.join(" ")}` : name;
};

/**
 * ESPN's short game status, compacted for phones: "5:12 - 3rd" -> "Q3 5:12",
 * "2:01 - OT" -> "OT 2:01", "End of 3rd" -> "End Q3", "Halftime" -> "Half", "7:00 PM" -> "7:00p".
 */
export function compactClock(detail: string): string {
  const d = detail.trim();
  let m = d.match(/^([\d:.]+) - (\d)(?:st|nd|rd|th)$/);
  if (m) return `Q${m[2]} ${m[1]}`;
  m = d.match(/^([\d:.]+) - (\d*)OT$/);
  if (m) return `OT${m[2]} ${m[1]}`;
  m = d.match(/^End of (\d)(?:st|nd|rd|th)$/);
  if (m) return `End Q${m[1]}`;
  if (/^halftime$/i.test(d)) return "Half";
  m = d.match(/^(\d{1,2}:\d{2}) ?([AP])M$/i);
  if (m) return `${m[1]}${m[2]!.toLowerCase()}`;
  return d;
}

interface GameLike {
  opponent: string;
  home: boolean;
  state: "pre" | "in" | "post";
  detail: string;
  when?: string;
  score: { us: number; them: number } | null;
}

/**
 * One short line for a phone row: "@BOS 7:00p", "@BOS 82-77 Q4 10:37", "vs PHI W 121-113".
 * 23 characters at most, so it fits a half-width cell at 375 px.
 */
export function compactGame(g: GameLike | null): string {
  if (!g) return "No game";
  const vs = `${g.home ? "vs " : "@"}${g.opponent}`;
  const score = g.score ? `${g.score.us}-${g.score.them}` : "";
  if (g.state === "pre") return `${vs} ${compactClock(g.when ?? g.detail)}`;
  if (g.state === "post") {
    const wl = g.score
      ? g.score.us > g.score.them
        ? "W "
        : g.score.us < g.score.them
          ? "L "
          : ""
      : "";
    return `${vs} ${wl}${score || "Final"}`.trim();
  }
  return `${vs} ${score} ${compactClock(g.detail || g.when || "")}`.replace(/\s+/g, " ").trim();
}

/** "22p 9r 4a 1s 2b" (nonzero only; "0p" for a scoreless line), or null without a line. */
export function compactStats(line: Record<string, number> | null): string | null {
  if (!line) return null;
  const parts = (
    [
      ["PTS", "p"],
      ["REB", "r"],
      ["AST", "a"],
      ["STL", "s"],
      ["BLK", "b"],
    ] as const
  )
    .filter(([k]) => (line[k] ?? 0) !== 0)
    .map(([k, s]) => `${line[k]}${s}`);
  return parts.length ? parts.join(" ") : "0p";
}
