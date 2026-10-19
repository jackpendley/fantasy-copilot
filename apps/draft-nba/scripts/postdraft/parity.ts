// One-off parity check: the TypeScript sim (packages/fantasy-core) on the draft-day league files,
// with the same inputs as league-sim.mjs's "history" scenario. Prints title odds for comparison.
import { readFileSync } from "node:fs";
import { simulateSeason, type SimPlayer } from "../../../../packages/fantasy-core/src/index";
import { matchupPeriodOf } from "../../../web/lib/nba/calendar";

const dir = new URL("../../data/local/postdraft/", import.meta.url);
const J = (f: string) => JSON.parse(readFileSync(new URL(f, dir), "utf8"));
const L = J("draft.json"), SCH = J("f1.json"), PRO = J("sched.json"), META = J("meta.json");
const ds = JSON.parse(readFileSync(new URL("../../dist/dataset.json", import.meta.url), "utf8"));
const byId = new Map<number, any>(ds.players.map((p: any) => [p.espnId, p]));
const abbr = new Map<string, number>(PRO.settings.proTeams.map((t: any) => [t.abbrev, t.id]));
const sd = (id: number) => {
  const m = META[id]; if (!m) return 0.15;
  const mean = (m.e + (m.f ?? m.e)) / 2;
  const dis = m.f != null && mean > 0 ? Math.abs(m.e - m.f) / mean : 0.06;
  return Math.sqrt(0.12 ** 2 + dis ** 2 + (m.rookie ? 0.12 : 0) ** 2 + (!m.rookie && m.lastGp < 35 ? 0.08 : 0) ** 2);
};
const P = (id: number, pro?: number): SimPlayer => {
  const m = byId.get(id);
  return { id, eligible: m.eligible, proTeamId: pro ?? abbr.get(m.team)!, fppg: m.model.fppg, gp: m.model.proj.GP, sd: sd(id) };
};
const ACT: Record<number, [number, number]> = { 1: [0.25, 0.1], 4: [1, 1.4], 5: [0.15, 0.15], 6: [0.76, 0.36], 7: [0.6, 0.5], 8: [0.5, 0.3], 9: [1, 0.95], 11: [1, 2], 12: [1, 1.5], 13: [1, 0.6], 14: [0.8, 0.8], 15: [0.88, 1.1] };
const teams = L.teams.map((t: any) => ({
  id: t.id, act: ACT[t.id]![0], addsPerWeek: ACT[t.id]![1],
  roster: t.roster.entries.map((e: any) => P(e.playerId, e.playerPoolEntry.player.proTeamId)),
}));
const drafted = new Set(teams.flatMap((t: any) => t.roster.map((p: SimPlayer) => p.id)));
const freeAgents = ds.players.filter((p: any) => !drafted.has(p.espnId) && p.model.proj.GP >= 35)
  .sort((a: any, b: any) => b.model.fppg - a.model.fppg).slice(0, 80).map((p: any) => P(p.espnId));
const gameDays = new Map<number, Set<number>>(PRO.settings.proTeams.filter((t: any) => t.id > 0)
  .map((t: any) => [t.id, new Set(Object.keys(t.proGamesByScoringPeriod).map(Number))]));
const matchups = SCH.schedule.filter((m: any) => m.home && m.away && m.matchupPeriodId <= 19)
  .map((m: any) => ({ period: m.matchupPeriodId, home: m.home.teamId, away: m.away.teamId, winner: null }));
const t0 = Date.now();
const res = simulateSeason({
  teams, freeAgents, slotCounts: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 2, BE: 3, IR: 1 },
  gameDays, periodOf: matchupPeriodOf, fromDay: 1, lastDay: 160, matchups, regularWeeks: 19,
  banked: new Map(), playoffWeeks: [20, 21, 22], addCapPerWeek: 3, seasons: Number(process.argv[2] ?? 1000), seed: 20261018,
});
const name = new Map<number, string>(L.teams.map((t: any) => [t.id, t.id === 13 ? "Jack" : `team ${t.id}`]));
for (const r of res.sort((a, b) => b.champ - a.champ))
  console.log(`${name.get(r.teamId)!.padEnd(8)} wins ${r.expWins.toFixed(1)}  PO ${(r.playoffs * 100).toFixed(0)}%  #1 ${(r.seed1 * 100).toFixed(0)}%  title ${(r.champ * 100).toFixed(1)}%`);
console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`);
