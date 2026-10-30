// Walk-forward test of the availability model (MODEL_CARD pre-registration 2026-10-29): the
// chance a player on the NBA's official injury report plays, by his listed status, fitted on
// one season and scored (Brier) on the next. Read-only (no ESPN writes). Each prediction uses
// the latest report published before its cutoff and games finished before tip.
//
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/backtest-availability.ts
//   TEST_SEASON=2025 ... tests 2024-25 (fit on 2023-24). DATA_ONLY=1 prints coverage only.
//
// Reports (parsed) and game logs are cached in data/local/ (gitignored).

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  buildMatcher,
  easternToIso,
  fetchGameLog,
  fetchInjuryReport,
  injuryReportFiles,
  toEspnTeam,
  type GameLogEntry,
  type OfficialInjuryReport,
  type OfficialStatus,
} from "@fantasy-copilot/nba-data";
import { etDate } from "../lib/nba/calendar";
import { loadFreeAgents, loadLeague } from "../lib/nba/data";

const TEST = Number(process.env.TEST_SEASON || 2026);
const FIT = TEST - 1;
const LOGS = new URL("../data/local/backtest/", import.meta.url);
const REPORTS = new URL("../data/local/injury-reports/", import.meta.url);
mkdirSync(LOGS, { recursive: true });
mkdirSync(REPORTS, { recursive: true });

async function gameLog(id: number, season: number): Promise<GameLogEntry[]> {
  const file = new URL(`${id}-${season}.json`, LOGS);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const log = await fetchGameLog(id, season).catch(() => []);
  writeFileSync(file, JSON.stringify(log));
  return log;
}

// The league's CDN blocks bursts (a first version probing every quarter hour got this machine
// refused). Requests are serialized and spaced, and misses are only remembered in memory (a block
// looks like a missing file). After a streak of misses (All-Star break has no reports) a known
// report is fetched: if it's refused too, the run stops.
const SPACING_MS = 2000;
const MAX_MISS_STREAK = 6;
const KNOWN_GOOD = "Injury-Report_2025-01-15_06PM.pdf";
let queue: Promise<unknown> = Promise.resolve();
let missStreak = 0;
const missing = new Set<string>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One request; network failures are retried, never taken for a missing report. */
async function fetchSpaced(file: string): Promise<OfficialInjuryReport | null> {
  for (let attempt = 1; ; attempt++) {
    await sleep(SPACING_MS);
    try {
      return await fetchInjuryReport(file);
    } catch (e) {
      const msg = (e as Error).message;
      if (/HTTP/.test(msg) || attempt >= 4) throw e;
      if (!/fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(msg)) {
        console.warn(`unreadable report ${file}: ${msg}`);
        return null;
      }
      await sleep(10_000 * attempt);
    }
  }
}

async function report(file: string): Promise<OfficialInjuryReport | null> {
  const cached = new URL(file.replace(/\.pdf$/, ".json"), REPORTS);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8")).report;
  if (missing.has(file)) return null;
  const run = queue.then(async () => {
    if (missStreak >= MAX_MISS_STREAK) {
      if (!(await fetchSpaced(KNOWN_GOOD)))
        throw new Error(`refused a known report; stopping at ${file}`);
      missStreak = 0;
    }
    return fetchSpaced(file);
  });
  queue = run.catch(() => {});
  const r = await run;
  if (!r) {
    missing.add(file);
    missStreak++;
    return null;
  }
  missStreak = 0;
  writeFileSync(cached, JSON.stringify({ report: r }));
  return r;
}

/** Reports were hourly (at :30) through this date and every 15 minutes after it. */
const LAST_HOURLY = process.env.LAST_HOURLY || "2025-12-21";

/** The latest report published at or before an ET time (minutes after midnight), up to 3 h back. */
async function latestReport(date: string, cutoff: number): Promise<OfficialInjuryReport | null> {
  const limit = Date.parse(easternToIso(date, Math.floor(cutoff / 60), cutoff % 60));
  const hourly = date <= LAST_HOURLY;
  // Hourly: the :30 slots at or before the cutoff; quarter-hourly: every quarter hour.
  const step = hourly ? 60 : 15;
  let t = hourly ? Math.floor((cutoff - 30) / 60) * 60 + 30 : Math.floor(cutoff / 15) * 15;
  for (; t >= 0 && cutoff - t <= 180; t -= step) {
    const files = injuryReportFiles(date, Math.floor(t / 60), t % 60);
    const r = await report(hourly ? files.at(-1)! : files[0]!);
    if (r && Date.parse(r.publishedAt) <= limit) return r;
  }
  return null;
}

async function inBatches<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** ET minutes after midnight of an ISO time. */
const etMinutes = (iso: string) => {
  const [h, m] = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(iso))
    .split(":")
    .map(Number);
  return h! * 60 + m!;
};
const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

type Snapshot = "midday" | "pretip";

interface Row {
  date: string;
  snapshot: Snapshot;
  playerId: number;
  status: OfficialStatus;
  played: boolean;
  /** His team's previous games he missed in a row (0 if he played the last, or none yet). */
  missed: number;
}

/** Snapshot cutoffs for a tip (ET minutes): midday min(1 PM, tip - 3 h), pre-tip tip - 1 h. */
const CUTOFFS: Record<Snapshot, (tip: number) => number> = {
  midday: (tip) => Math.min(13 * 60, tip - 180),
  pretip: (tip) => tip - 60,
};

async function seasonRows(
  season: number,
  pool: { id: number; name: string; team: string }[],
): Promise<{ rows: Row[]; coverage: Record<string, number> }> {
  const logs = await inBatches(pool, 8, async (p) => ({
    id: p.id,
    games: (await gameLog(p.id, season)).filter((g) => g.part === "regular"),
  }));
  const playedOn = new Map<number, Set<string>>();
  for (const l of logs) {
    const days = l.games.filter((g) => (g.line.MIN ?? 0) > 0).map((g) => etDate(new Date(g.date)));
    playedOn.set(l.id, new Set(days));
  }
  // Team schedules and tip times: every game appears as some pool player's opponent.
  const schedule = new Map<string, Set<string>>();
  const tips = new Map<string, Set<number>>();
  for (const l of logs)
    for (const g of l.games) {
      const day = etDate(new Date(g.date));
      if (!schedule.has(g.opponent)) schedule.set(g.opponent, new Set());
      schedule.get(g.opponent)!.add(day);
      if (!tips.has(day)) tips.set(day, new Set());
      tips.get(day)!.add(etMinutes(g.date));
    }
  const teamDays = new Map([...schedule].map(([t, s]) => [t, [...s].sort()]));
  const match = buildMatcher(pool);

  const coverage = { days: tips.size, tipGroups: 0, midday: 0, pretip: 0, entries: 0, matched: 0 };
  const rows: Row[] = [];
  const days = [...tips.keys()].sort();
  await inBatches(days, 4, async (date) => {
    for (const tip of [...tips.get(date)!].sort((a, b) => a - b)) {
      coverage.tipGroups++;
      for (const snapshot of ["midday", "pretip"] as Snapshot[]) {
        const r = await latestReport(date, CUTOFFS[snapshot](tip));
        if (!r) continue;
        const entries = r.entries.filter((e) => e.gameDate === date && e.gameTime === hhmm(tip));
        if (entries.length) coverage[snapshot]++;
        for (const e of entries) {
          coverage.entries++;
          const team = toEspnTeam(e.teamAbbr);
          const id = match(e.name, team);
          if (id == null) continue;
          coverage.matched++;
          const played = playedOn.get(id)!;
          // Player-seasons with no logged games are left out (a failed log fetch looks the same).
          if (!played.size) continue;
          const before = (teamDays.get(team) ?? []).filter((d) => d < date);
          let missed = 0;
          for (let i = before.length - 1; i >= 0 && !played.has(before[i]!); i--) missed++;
          rows.push({
            date,
            snapshot,
            playerId: id,
            status: e.status,
            played: played.has(date),
            missed,
          });
        }
      }
    }
  });
  return { rows, coverage };
}

type Model = (r: Row) => number;

/** Today's app: ESPN shows probable/questionable/doubtful as day-to-day (0.75). */
const B0: Model = (r) =>
  ({ Available: 1, Probable: 0.75, Questionable: 0.75, Doubtful: 0.75, Out: 0 })[r.status];
/** The status priors in fantasy-core (PROBABLE 0.93, QUESTIONABLE 0.5, DOUBTFUL 0.12). */
const B1: Model = (r) =>
  ({ Available: 1, Probable: 0.93, Questionable: 0.5, Doubtful: 0.12, Out: 0 })[r.status];

const M = 10;
/** Play rate per cell on the fit season, smoothed toward the parent model with M rows. */
function fitted(train: Row[], key: (r: Row) => string, parent: Model): Model {
  const n = new Map<string, number>();
  const y = new Map<string, number>();
  for (const r of train) {
    const k = key(r);
    n.set(k, (n.get(k) ?? 0) + 1);
    y.set(k, (y.get(k) ?? 0) + (r.played ? 1 : 0));
  }
  return (r) => {
    const k = key(r);
    return ((y.get(k) ?? 0) + M * parent(r)) / ((n.get(k) ?? 0) + M);
  };
}

const streak = (missed: number) => (missed === 0 ? "0" : missed <= 2 ? "1-2" : "3+");

function models(train: Row[]): Record<string, Model> {
  const a1 = fitted(train, (r) => `${r.status}|${r.snapshot}`, B1);
  return {
    "B0 today (day-to-day 0.75)": B0,
    "B1 status priors": B1,
    "A1 status x snapshot": a1,
    "A2 + played his team's last game": fitted(
      train,
      (r) => `${r.status}|${r.snapshot}|${r.missed === 0}`,
      a1,
    ),
    "A3 + games missed in a row (0, 1-2, 3+)": fitted(
      train,
      (r) => `${r.status}|${r.snapshot}|${streak(r.missed)}`,
      a1,
    ),
  };
}

const brier = (p: number, r: Row) => (p - (r.played ? 1 : 0)) ** 2;

/** Mean per-player difference in Brier score (model - base), with a 95% interval. */
function ci(rows: Row[], model: Model, base: Model): string {
  const by = new Map<number, number[]>();
  for (const r of rows) {
    const d = brier(model(r), r) - brier(base(r), r);
    by.set(r.playerId, [...(by.get(r.playerId) ?? []), d]);
  }
  const d = [...by.values()].map(mean);
  const m = mean(d);
  const sd = Math.sqrt(d.reduce((a, x) => a + (x - m) ** 2, 0) / (d.length - 1));
  const half = (1.96 * sd) / Math.sqrt(d.length);
  return `${m.toFixed(4)} [${(m - half).toFixed(4)}, ${(m + half).toFixed(4)}]`;
}

async function main() {
  // Player set: today's rostered players and top free agents (public ids), as in the projection test.
  const [league, fas] = await Promise.all([loadLeague(1, "2026-10-20"), loadFreeAgents(1)]);
  const seen = new Set<number>();
  const pool = [...league.teams.flatMap((t) => t.roster), ...fas.map((f) => f.player)]
    .filter((p) => !seen.has(p.id) && seen.add(p.id))
    .map((p) => ({ id: p.id, name: p.name, team: p.proTeam }));
  console.log(`players: ${pool.length}; reports cached in data/local/injury-reports/`);

  const fit = await seasonRows(FIT, pool);
  const test = await seasonRows(TEST, pool);
  for (const [label, s] of [
    [`fit ${FIT - 1}-${String(FIT).slice(2)}`, fit],
    [`test ${TEST - 1}-${String(TEST).slice(2)}`, test],
  ] as const) {
    const byStatus: Record<string, number> = {};
    for (const r of s.rows)
      byStatus[`${r.status} ${r.snapshot}`] = (byStatus[`${r.status} ${r.snapshot}`] ?? 0) + 1;
    console.log(
      label,
      JSON.stringify(s.coverage),
      `rows ${s.rows.length}`,
      JSON.stringify(byStatus),
    );
  }
  if (process.env.DATA_ONLY) return;

  const ms = models(fit.rows);
  const players = new Set(test.rows.map((r) => r.playerId)).size;
  console.log(
    `\nTest ${TEST - 1}-${String(TEST).slice(2)}: ${test.rows.length} rows, ${players} players`,
  );
  console.log("| Model | Brier | vs B0 (95% CI, by player) | vs B1 (95% CI, by player) |");
  console.log("| --- | ---: | --- | --- |");
  for (const [name, m] of Object.entries(ms)) {
    const b = mean(test.rows.map((r) => brier(m(r), r)));
    console.log(
      `| ${name} | ${b.toFixed(4)} | ${ci(test.rows, m, B0)} | ${ci(test.rows, m, B1)} |`,
    );
  }

  console.log("\n| Status | Snapshot | Rows | Played | B1 | A1 (fit) |");
  console.log("| --- | --- | ---: | ---: | ---: | ---: |");
  for (const status of ["Available", "Probable", "Questionable", "Doubtful", "Out"] as const)
    for (const snapshot of ["midday", "pretip"] as const) {
      const rs = test.rows.filter((r) => r.status === status && r.snapshot === snapshot);
      if (!rs.length) continue;
      console.log(
        `| ${status} | ${snapshot} | ${rs.length} | ${mean(rs.map((r) => (r.played ? 1 : 0))).toFixed(3)} | ${B1(rs[0]!).toFixed(2)} | ${ms["A1 status x snapshot"]!(rs[0]!).toFixed(3)} |`,
      );
    }

  // The table production would use: fitted on the test season (the most recent one).
  const prod = models(test.rows);
  console.log(`\nFitted on ${TEST - 1}-${String(TEST).slice(2)} (for production):`);
  for (const status of ["Available", "Probable", "Questionable", "Doubtful", "Out"] as const)
    for (const snapshot of ["midday", "pretip"] as const)
      for (const missed of [0, 1, 3]) {
        const r: Row = { date: "", snapshot, playerId: 0, status, played: false, missed };
        console.log(
          status,
          snapshot,
          streak(missed),
          Object.entries(prod)
            .slice(2)
            .map(([k, m]) => `${k.slice(0, 2)} ${m(r).toFixed(3)}`)
            .join("  "),
        );
      }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
