// CPU per step of the background work (docs/COMPUTE.md): what each piece costs Vercel when it
// runs. Read-only: ESPN and NBA reads, database reads at most; nothing is written anywhere.
// Network waits don't count as CPU, so "cold" figures are parse plus compute.
//
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/profile-cpu.ts

import { toWire } from "@fantasy-copilot/fantasy-core";
import { absences } from "../lib/nba/availability";
import { bestPerGame } from "../lib/nba/best";
import { gameDate, scoringPeriodForDate } from "../lib/nba/calendar";
import { loadLeague } from "../lib/nba/data";
import { loadLeagueView } from "../lib/nba/league-view";
import { leagueMatchups } from "../lib/nba/matchup";
import { buildOutlookInput } from "../lib/nba/outlook";
import { recentLeagueMoves } from "../lib/nba/outlook-refresh";
import { outlookSetup } from "../lib/nba/outlook-run";
import { loadPlayerCard } from "../lib/nba/player-card";
import { buildWireMoves, jobMoveOptions } from "../lib/nba/sim-moves";
import { findTradeTargets } from "../lib/nba/trade";
import { loadWaiverView } from "../lib/nba/waivers-view";

const rows: [string, number][] = [];
async function time<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
  const t0 = process.cpuUsage();
  const out = await fn();
  const u = process.cpuUsage(t0);
  rows.push([label, Math.round((u.user + u.system) / 1000)]);
  return out;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const date = gameDate();
  const sp = scoringPeriodForDate(date);

  await time("watch: transaction log (today + tomorrow)", () => recentLeagueMoves());
  const data = await time("league: fetch + parse (cold)", () => loadLeague(sp, date));
  // Past the parsed-league memo (15 s) but within the response memo (20 s): parsing only.
  await sleep(16_000);
  await time("league: parse only (responses remembered)", () => loadLeague(sp, date));
  await time("league fingerprint check", () =>
    JSON.stringify(data.teams.map((t) => t.roster.map((p) => [p.id, p.slot, p.injuryStatus]))),
  );

  await time("timeline: projections + every matchup", async () => {
    const perGame = await bestPerGame(
      data.teams.flatMap((t) => t.roster),
      data,
      sp,
    );
    return leagueMatchups(data, sp, Math.ceil(sp / 7), perGame);
  });

  const v = await time("waiver view (Moves page, sim job input)", () => loadWaiverView());
  const setup = await time("outlook setup (sim job input)", () => outlookSetup());
  await time("sim job: base season + ~300 move patches", () => {
    const d = setup.data;
    const base = buildOutlookInput({
      teams: d.teams,
      previousTeams: setup.previousTeams,
      freeAgents: setup.freeAgents,
      games: d.games,
      matchups: d.matchups,
      slotCounts: d.settings.slotCounts,
      addCapPerWeek: d.settings.addsPerWeek ?? 3,
      regularWeeks: d.settings.regularSeasonWeeks,
      fromDay: setup.fromDay,
      bankedNow: setup.bankedNow,
      injured: setup.injured,
      seasons: 0,
    });
    const wire = toWire(base.input);
    const { options } = jobMoveOptions(v.analysis);
    const injured = new Map(setup.injured);
    const extra = absences(
      options.map((o) => o.add.player),
      d.injuries,
      setup.fromDay,
    );
    for (const [id, a] of extra) injured.set(id, a);
    const moves = buildWireMoves(
      {
        base: wire,
        teamId: d.me.id,
        roster: d.me.roster,
        freeAgents: setup.freeAgents,
        games: d.games,
        slotCounts: d.settings.slotCounts,
        fromDay: setup.fromDay,
        regularWeeks: d.settings.regularSeasonWeeks,
        injured,
      },
      options,
    );
    console.log(`  (${moves.length} moves, ${(JSON.stringify(moves).length / 1e6).toFixed(2)} MB)`);
  });

  const lv = await time("league view (League page, trade input)", () => loadLeagueView());
  await time("trade idea search", () =>
    findTradeTargets(
      { teamId: lv.data.me.id, roster: lv.data.me.roster },
      lv.data.teams
        .filter((t) => t.id !== lv.data.me.id)
        .map((t) => ({ teamId: t.id, roster: t.roster })),
      lv.ctx,
      lv.market,
      lv.freeAgents,
    ),
  );

  const someone = data.me.roster[0]!.id;
  // The card schedules a PBP Stats backfill with after() when its numbers are missing, which
  // needs a request: count what ran up to there.
  await time("player card (warm league)", () => loadPlayerCard(someone).catch(() => null));

  console.log("| Step | CPU ms |\n|---|---|");
  for (const [label, ms] of rows) console.log(`| ${label} | ${ms} |`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
