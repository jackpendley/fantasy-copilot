// Player search as you type (pure; runs in the browser on every keystroke). Names are compared
// without accents, case or punctuation ("doncic" finds Dončić, "deaaron" finds De'Aaron), and
// results rank by how they match: the whole name, the start of any word, several words,
// anywhere in the name, initials ("sga"), then one typo
// (5+ letters). Ties go to the more-owned player.

export interface SearchPlayer {
  id: number;
  name: string;
  /** NBA team abbreviation. */
  team: string;
  positions: string[];
  /** "Your team", a fantasy team's name, "Free agent" or "Waivers". */
  owner: string;
  mine: boolean;
  available: boolean;
  status: string;
  fppg: number;
  /** % of ESPN leagues rostering him. */
  owned: number;
}

export interface SearchHit {
  player: SearchPlayer;
  score: number;
  /** Characters of `player.name` to highlight, [start, end). */
  highlight: [number, number] | null;
}

/** One character as the search sees it: no accents, lower case; punctuation becomes nothing. */
function foldChar(c: string): string {
  const base = c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/^[a-z0-9]+$/.test(base)) return base;
  return /[\s\-–—]/.test(c) ? " " : "";
}

/** The folded name and, for each folded character, the original character it came from. */
function fold(name: string): { text: string; from: number[] } {
  let text = "";
  const from: number[] = [];
  [...name].forEach((c, i) => {
    for (const f of foldChar(c)) {
      if (f === " " && (text === "" || text.endsWith(" "))) continue;
      text += f;
      from.push(i);
    }
  });
  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    from.pop();
  }
  return { text, from };
}

export const foldQuery = (q: string) => fold(q).text;

/** Within one edit (insert, delete, substitute or swap two neighbors)? */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** How well a folded query matches a name (0 = no match), and where. */
function match(name: string, q: string): { score: number; at: [number, number] | null } {
  const { text, from } = fold(name);
  const span = (start: number, len: number): [number, number] => [
    from[start]!,
    from[start + len - 1]! + 1,
  ];
  if (text === q) return { score: 100, at: span(0, q.length) };
  // The start of the name and the start of any later word rank alike ("mark": Markkanen and
  // Mark Williams), so the better-known player comes first.
  if (text.startsWith(q)) return { score: 80, at: span(0, q.length) };
  const words: { w: string; at: number }[] = [];
  let pos = 0;
  for (const w of text.split(" ")) {
    words.push({ w, at: pos });
    pos += w.length + 1;
  }
  const parts = q.split(" ");
  if (parts.length === 1) {
    const hit = words.find((x) => x.w.startsWith(q));
    if (hit) return { score: 80, at: span(hit.at, q.length) };
  } else {
    // Several words: each one starts a word of the name, in order ("lebron ja").
    let k = 0;
    let first = -1;
    for (const x of words) {
      if (k < parts.length && x.w.startsWith(parts[k]!)) {
        if (first < 0) first = x.at;
        k++;
      }
    }
    if (k === parts.length) {
      const last = words.find((x) => x.w.startsWith(parts.at(-1)!) && x.at >= first)!;
      return { score: 75, at: [from[first]!, from[last.at + parts.at(-1)!.length - 1]! + 1] };
    }
  }
  const inside = text.indexOf(q);
  if (inside >= 0 && q.length >= 2) return { score: 60, at: span(inside, q.length) };
  const compact = q.replace(/ /g, "");
  if (compact.length >= 2 && compact === words.map((x) => x.w[0]).join(""))
    return { score: 55, at: null };
  if (compact.length >= 5) {
    // One typo, against the start of any word (or the whole name). Short queries would match
    // too much ("mark" ~ "marc").
    for (const x of words) {
      const head = x.w.slice(0, compact.length);
      if (withinOneEdit(head, compact) || withinOneEdit(x.w, compact))
        return { score: 40, at: span(x.at, Math.min(x.w.length, compact.length)) };
    }
  }
  return { score: 0, at: null };
}

/** The best `limit` matches for a query, best first. */
export function searchPlayers(players: SearchPlayer[], query: string, limit = 8): SearchHit[] {
  const q = foldQuery(query);
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const p of players) {
    const m = match(p.name, q);
    if (m.score > 0) hits.push({ player: p, score: m.score, highlight: m.at });
  }
  return hits
    .sort(
      (a, b) =>
        b.score - a.score || b.player.owned - a.player.owned || b.player.fppg - a.player.fppg,
    )
    .slice(0, limit);
}
