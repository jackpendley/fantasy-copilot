// Position-aware streaming in the season simulator (MODEL_CARD pre-registration 2026-11-16):
// checks 2-5 on the league as it stands, the calibrated raw-value rule vs `fitStreams`, same
// seed, 4,000 seasons each; plus the reported Paul Reed moves. Check 1 is a test
// (packages/fantasy-core/test/sim.test.ts). Read-only (ESPN reads; no database writes). Teams
// print as their ESPN ids; Jack's is 13.
//
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/experiment-fit-streams.ts

import { simulateSeason, type SimInput } from "@fantasy-copilot/fantasy-core";
import type { RosterPlayer } from "@fantasy-copilot/espn";
import { matchupPeriodOf } from "../lib/nba/calendar";
import { buildOutlookInput } from "../lib/nba/outlook";
import { outlookSetup } from "../lib/nba/outlook-run";

const SEASONS = 4000;
const JACK = 13;

async function main() {
  const setup = await outlookSetup();
  const { data } = setup;
  const inputFor = (teams = data.teams, freeAgents = setup.freeAgents) =>
    buildOutlookInput({
      teams,
      previousTeams: setup.previousTeams,
      freeAgents,
      games: data.games,
      matchups: data.matchups,
      slotCounts: data.settings.slotCounts,
      addCapPerWeek: data.settings.addsPerWeek ?? 3,
      regularWeeks: data.settings.regularSeasonWeeks,
      fromDay: setup.fromDay,
      bankedNow: setup.bankedNow,
      injured: setup.injured,
      seasons: SEASONS,
    }).input;

  const current = matchupPeriodOf(setup.fromDay);
  const regular = data.settings.regularSeasonWeeks;
  const weeksLeft = regular - current + 1;

  const run = (input: SimInput, fitStreams: boolean) => {
    const n = input.teams.length;
    const adds = new Array<number>(n).fill(0);
    // Weekly points in the weeks still wholly ahead (the current one has banked points).
    const sum = new Array<number>(n).fill(0);
    const sumsq = new Array<number>(n).fill(0);
    let weeks = 0;
    const t0 = process.cpuUsage();
    const results = simulateSeason({
      ...input,
      fitStreams,
      inspect: (_, o) => {
        o.adds.forEach((a, i) => (adds[i]! += a));
        for (let w = current + 1; w <= regular; w++) {
          if (o.points[0]![w] == null) continue;
          o.points.forEach((p, i) => {
            sum[i]! += p[w]!;
            sumsq[i]! += p[w]! ** 2;
          });
          weeks++;
        }
      },
    });
    const cpu = process.cpuUsage(t0);
    // Weeks counted once per season for all teams together.
    const perTeamWeeks = weeks;
    const teams = input.teams.map((t, i) => {
      const mean = sum[i]! / perTeamWeeks;
      const sd = Math.sqrt(Math.max(0, sumsq[i]! / perTeamWeeks - mean * mean));
      return {
        id: t.id,
        act: t.act,
        addsPerWeek: t.addsPerWeek,
        simAddsPerWeek: adds[i]! / SEASONS / weeksLeft,
        meanWeek: mean,
        cv: sd / mean,
        title: results.find((r) => r.teamId === t.id)!.champ,
      };
    });
    return { teams, msPerSeason: (cpu.user + cpu.system) / 1000 / SEASONS };
  };

  const base = inputFor();
  console.log(`From day ${setup.fromDay} (week ${current}); ${weeksLeft} regular weeks left.`);
  const raw = run(base, false);
  const fit = run(base, true);

  console.log(
    "\n| team | act | adds/wk input | adds/wk raw | adds/wk fit | check 2 | CV raw | CV fit | check 3 | title raw | title fit |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|---|---|");
  let pass2 = true;
  let pass3 = true;
  raw.teams.forEach((r, i) => {
    const f = fit.teams[i]!;
    const c2 =
      r.addsPerWeek < 0.25 ||
      Math.abs(f.simAddsPerWeek - r.simAddsPerWeek) <= Math.max(0.15 * r.simAddsPerWeek, 0.15);
    const c3 = r.act < 0.7 || Math.abs(f.cv - r.cv) <= 0.01;
    pass2 &&= c2;
    pass3 &&= c3;
    console.log(
      `| ${r.id === JACK ? "13 (Jack)" : r.id} | ${r.act.toFixed(2)} | ${r.addsPerWeek.toFixed(2)} | ${r.simAddsPerWeek.toFixed(2)} | ${f.simAddsPerWeek.toFixed(2)} | ${r.addsPerWeek < 0.25 ? "n/a" : c2 ? "pass" : "FAIL"} | ${r.cv.toFixed(3)} | ${f.cv.toFixed(3)} | ${r.act < 0.7 ? "n/a" : c3 ? "pass" : "FAIL"} | ${(100 * r.title).toFixed(1)}% | ${(100 * f.title).toFixed(1)}% |`,
    );
  });
  const league = (x: typeof raw) => x.teams.reduce((a, t) => a + t.meanWeek, 0) / x.teams.length;
  const pass4 = league(fit) >= league(raw) * 0.995;
  const pass5 = fit.msPerSeason <= raw.msPerSeason * 1.2;
  console.log(
    `\nCheck 2 (adds): ${pass2 ? "pass" : "FAIL"} · check 3 (CV): ${pass3 ? "pass" : "FAIL"}` +
      ` · check 4 (league points/week ${league(raw).toFixed(1)} → ${league(fit).toFixed(1)}): ${pass4 ? "pass" : "FAIL"}` +
      ` · check 5 (CPU/season ${raw.msPerSeason.toFixed(1)} → ${fit.msPerSeason.toFixed(1)} ms): ${pass5 ? "pass" : "FAIL"}`,
  );

  // Reported: the Nov 16 Paul Reed moves, Jack's title odds under each rule.
  const byName = (list: RosterPlayer[], name: string) => list.find((p) => p.name === name);
  const me = data.teams.find((t) => t.id === JACK)!;
  const reed = byName(setup.freeAgents, "Paul Reed");
  for (const dropName of ["Naz Reid", "Kris Dunn"]) {
    const drop = byName(me.roster, dropName);
    if (!reed || !drop) {
      console.log(`(skipped Reed for ${dropName}: a player isn't where he was)`);
      continue;
    }
    const teams = data.teams.map((t) =>
      t.id === JACK
        ? { ...t, roster: [...t.roster.filter((p) => p !== drop), { ...reed, slot: "BE" }] }
        : t,
    );
    const pool = [...setup.freeAgents.filter((p) => p !== reed), drop];
    const moved = inputFor(teams, pool);
    for (const fitStreams of [false, true]) {
      const before = (fitStreams ? fit : raw).teams.find((t) => t.id === JACK)!.title;
      const after = run(moved, fitStreams).teams.find((t) => t.id === JACK)!.title;
      console.log(
        `Reed for ${dropName}, ${fitStreams ? "fit" : "raw"}: title ${(100 * before).toFixed(1)}% → ${(100 * after).toFixed(1)}% (${(100 * (after - before)).toFixed(1)})`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
