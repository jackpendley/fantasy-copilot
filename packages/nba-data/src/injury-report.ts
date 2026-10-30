// The NBA's official injury report: a PDF the league publishes through each game day (hourly at
// :30 until late 2025, every 15 minutes since), listing players as Available, Probable,
// Questionable, Doubtful or Out for the coming games. Each report prints its own publish time,
// so the history is point in time. Public files, read one at a time and cached by callers.

import { getDocumentProxy } from "unpdf";

const BASE = "https://ak-static.cms.nba.com/referee/injury/";

export const OFFICIAL_STATUSES = [
  "Available",
  "Probable",
  "Questionable",
  "Doubtful",
  "Out",
] as const;
export type OfficialStatus = (typeof OFFICIAL_STATUSES)[number];

export interface OfficialInjuryEntry {
  /** US/Eastern game date, YYYY-MM-DD. */
  gameDate: string;
  /** Tip-off, ET 24-hour "19:30" (printed "07:30 (ET)"), when given. */
  gameTime: string | null;
  /** "NYK@PHI" */
  matchup: string;
  /** "New York Knicks" */
  team: string;
  /** NBA.com abbreviation, "NYK" (map with `toEspnTeam`); "" if the name is unknown. */
  teamAbbr: string;
  /** "Jalen Brunson" (printed "Brunson, Jalen"). */
  name: string;
  status: OfficialStatus;
  reason: string;
}

export interface OfficialInjuryReport {
  /** The time printed on the report, ISO. */
  publishedAt: string;
  entries: OfficialInjuryEntry[];
}

/** A positioned piece of text on a page (PDF points; y grows upward). */
export interface TextItem {
  str: string;
  x: number;
  y: number;
  page: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ET wall time -> ISO (UTC), DST-aware. */
export function easternToIso(date: string, hour: number, minute: number): string {
  const guess = Date.parse(`${date}T${pad(hour)}:${pad(minute)}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess + (guess - shown)).toISOString();
}

/**
 * File names that could hold the report published at an ET time, newest naming first:
 * quarter-hourly "_05_15PM" and, for :30, the older hourly "_05PM" (which held the 5:30 report).
 */
export function injuryReportFiles(date: string, hour: number, minute: number): string[] {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? "AM" : "PM";
  const files = [`Injury-Report_${date}_${pad(h12)}_${pad(minute)}${ampm}.pdf`];
  if (minute === 30) files.push(`Injury-Report_${date}_${pad(h12)}${ampm}.pdf`);
  return files;
}

export const injuryReportUrl = (file: string) => BASE + file;

/** "07:30 (ET)" -> "19:30". Games tip between noon and 11 PM, so 1-11 are PM. */
function gameTime(s: string): string | null {
  const m = /(\d{1,2}):(\d{2})/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  return `${pad(h === 12 ? 12 : h + 12)}:${m[2]}`;
}

/** "Brunson, Jalen" -> "Jalen Brunson"; "McCullar Jr., Kevin" -> "Kevin McCullar Jr." */
const displayName = (s: string) => {
  const i = s.indexOf(",");
  return i < 0 ? s : `${s.slice(i + 1).trim()} ${s.slice(0, i).trim()}`;
};

/** Team nickname (the name's last word) -> NBA.com abbreviation. */
const NICKNAMES: Record<string, string> = {
  Hawks: "ATL",
  Celtics: "BOS",
  Nets: "BKN",
  Hornets: "CHA",
  Bulls: "CHI",
  Cavaliers: "CLE",
  Mavericks: "DAL",
  Nuggets: "DEN",
  Pistons: "DET",
  Warriors: "GSW",
  Rockets: "HOU",
  Pacers: "IND",
  Clippers: "LAC",
  Lakers: "LAL",
  Grizzlies: "MEM",
  Heat: "MIA",
  Bucks: "MIL",
  Timberwolves: "MIN",
  Pelicans: "NOP",
  Knicks: "NYK",
  Thunder: "OKC",
  Magic: "ORL",
  "76ers": "PHI",
  Suns: "PHX",
  Blazers: "POR",
  Kings: "SAC",
  Spurs: "SAS",
  Raptors: "TOR",
  Jazz: "UTA",
  Wizards: "WAS",
};

const COLUMNS = ["date", "time", "matchup", "team", "player", "status", "reason"] as const;
type Column = (typeof COLUMNS)[number];

/** Parse a report from its text items (pure; `fetchInjuryReport` extracts them). */
export function parseInjuryReport(items: TextItem[]): OfficialInjuryReport | null {
  const text = (xs: TextItem[]) =>
    xs
      .map((i) => i.str)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  // Lines: items on the same page and baseline, top to bottom.
  const lines: TextItem[][] = [];
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  for (const it of sorted) {
    const last = lines.at(-1);
    if (last && last[0]!.page === it.page && Math.abs(last[0]!.y - it.y) < 1.5) last.push(it);
    else lines.push([it]);
  }
  for (const l of lines) l.sort((a, b) => a.x - b.x);

  const title = lines
    .map(text)
    .map((t) => /Injury Report: (\d{2})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}) (AM|PM)/.exec(t))
    .find(Boolean);
  if (!title) return null;
  const [, mo, d, yy, hh, mi, ap] = title;
  const hour = (Number(hh) % 12) + (ap === "PM" ? 12 : 0);
  const publishedAt = easternToIso(`20${yy}-${mo}-${d}`, hour, Number(mi));

  // Column starts from the header row ("Game Date  Game Time  Matchup  Team  Player Name ...").
  const header = lines.find((l) => /Matchup/.test(text(l)) && /Current/.test(text(l)));
  if (!header) return null;
  const word = (w: string, nth = 0) => header.filter((i) => i.str === w)[nth]?.x;
  const starts = [
    word("Game"),
    word("Game", 1),
    word("Matchup"),
    word("Team"),
    word("Player"),
    word("Current"),
    word("Reason"),
  ];
  if (starts.some((x) => x == null)) return null;
  const columnOf = (x: number): Column => {
    let c = 0;
    for (let i = 0; i < starts.length; i++) if (starts[i]! <= x + 4) c = i;
    return COLUMNS[c]!;
  };

  type Row = { page: number; y: number; cells: Partial<Record<Column, string>> };
  const rows: Row[] = [];
  for (const l of lines) {
    if (l === header || /Injury Report:|^Page \d+ of \d+$/.test(text(l))) continue;
    const by: Partial<Record<Column, TextItem[]>> = {};
    for (const it of l) (by[columnOf(it.x)] ??= []).push(it);
    const cells: Row["cells"] = {};
    for (const c of COLUMNS) if (by[c]) cells[c] = text(by[c]);
    rows.push({ page: l[0]!.page, y: l[0]!.y, cells });
  }

  // A long reason wraps onto lines above and below its player's line: give each reason-only
  // line to the nearest player line on its page.
  const playerRows = rows.filter((r) => r.cells.status);
  const reasons = new Map<Row, { y: number; s: string }[]>();
  for (const r of rows) {
    if (r.cells.status || !r.cells.reason || Object.keys(r.cells).length > 1) continue;
    let best: Row | null = null;
    for (const p of playerRows)
      if (p.page === r.page && (!best || Math.abs(p.y - r.y) < Math.abs(best.y - r.y))) best = p;
    if (best && Math.abs(best.y - r.y) < 15)
      reasons.set(best, [...(reasons.get(best) ?? []), { y: r.y, s: r.cells.reason }]);
  }

  // Date, time, matchup and team print once per group; later rows inherit them.
  const entries: OfficialInjuryEntry[] = [];
  let date = "";
  let time: string | null = null;
  let matchup = "";
  let team = "";
  for (const r of rows) {
    const c = r.cells;
    if (c.date && /\d{2}\/\d{2}\/\d{4}/.test(c.date)) {
      const [m, dd, y] = c.date.split("/");
      date = `${y}-${m}-${dd}`;
    }
    if (c.time) time = gameTime(c.time);
    if (c.matchup) matchup = c.matchup;
    if (c.team) team = c.team;
    const status = OFFICIAL_STATUSES.find((s) => s === c.status);
    if (!status || !c.player || !date) continue;
    const parts = [...(reasons.get(r) ?? []), ...(c.reason ? [{ y: r.y, s: c.reason }] : [])];
    entries.push({
      gameDate: date,
      gameTime: time,
      matchup,
      team,
      teamAbbr: NICKNAMES[team.split(" ").at(-1) ?? ""] ?? "",
      name: displayName(c.player),
      status,
      reason: parts
        .sort((a, b) => b.y - a.y)
        .map((p) => p.s)
        .join(" "),
    });
  }
  return { publishedAt, entries };
}

/** Text items of a PDF, every page. */
export async function pdfTextItems(data: Uint8Array): Promise<TextItem[]> {
  const pdf = await getDocumentProxy(data, { verbosity: 0 });
  const out: TextItem[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    for (const it of content.items)
      if ("str" in it && it.str)
        out.push({
          str: it.str,
          x: it.transform[4] as number,
          y: it.transform[5] as number,
          page: n,
        });
  }
  return out;
}

/** One report file (from `injuryReportFiles`); null if the league didn't publish it. */
export async function fetchInjuryReport(
  file: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OfficialInjuryReport | null> {
  const res = await fetchImpl(injuryReportUrl(file));
  if (res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(`injury report ${file}: HTTP ${res.status}`);
  const data = new Uint8Array(await res.arrayBuffer());
  // A missing file is sometimes served as a page instead of a 403.
  if (new TextDecoder().decode(data.slice(0, 5)) !== "%PDF-") return null;
  return parseInjuryReport(await pdfTextItems(data));
}
