// League calendar: US/Eastern game dates <-> ESPN scoring periods <-> matchup weeks.
// Scoring period 1 is Tue Oct 20, 2026, and periods advance one per calendar day.
// Matchup weeks were fitted to 2025-26 results (docs/LEAGUE.md): week 1 is 6 days,
// then Monday-Sunday weeks, with the two All-Star calendar weeks merged into one matchup.

export const FIRST_DAY_ET = "2026-10-20";
export const LAST_SCORING_PERIOD = 160; // Sun Mar 28, 2027
const MERGED_CALENDAR_WEEK = 18; // calendar weeks 18 + 19 (Feb 15-28) are one matchup

const DAY_MS = 86_400_000;
const utcMidnight = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);

/** Calendar date in US/Eastern ("2026-10-20") for an instant. ESPN groups games by it. */
export function etDate(at: Date | number = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export function scoringPeriodForDate(ymd: string): number {
  return Math.round((utcMidnight(ymd) - utcMidnight(FIRST_DAY_ET)) / DAY_MS) + 1;
}

export function dateForScoringPeriod(sp: number): string {
  return new Date(utcMidnight(FIRST_DAY_ET) + (sp - 1) * DAY_MS).toISOString().slice(0, 10);
}

export const addDays = (ymd: string, n: number) =>
  new Date(utcMidnight(ymd) + n * DAY_MS).toISOString().slice(0, 10);

const calendarWeek = (sp: number) => (sp <= 6 ? 1 : 2 + Math.floor((sp - 7) / 7));

/** Matchup week (1-22) for a scoring period. */
export function matchupPeriodOf(sp: number): number {
  const w = calendarWeek(sp);
  return w > MERGED_CALENDAR_WEEK ? w - 1 : w;
}

/** Scoring periods that make up a matchup week, in order. */
export function scoringPeriodsOf(matchupPeriod: number): number[] {
  const out: number[] = [];
  for (let sp = 1; sp <= LAST_SCORING_PERIOD; sp++) {
    if (matchupPeriodOf(sp) === matchupPeriod) out.push(sp);
  }
  return out;
}

/** "Tue 10/20" for an ET date. */
export function shortDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  const wd = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${wd} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
