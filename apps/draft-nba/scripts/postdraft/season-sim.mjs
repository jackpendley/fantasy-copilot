// Post-draft season sim: daily optimal lineups (individual-game lock, bench fills off days),
// weekly H2H points, all-play win odds, plus draft value vs pick.
import { readFileSync, writeFileSync } from 'node:fs';

const [draftPath, datasetPath, outPath] = process.argv.slice(2);
const L = JSON.parse(readFileSync(draftPath, 'utf8'));
const ds = JSON.parse(readFileSync(datasetPath, 'utf8'));
const byId = new Map(ds.players.map((p) => [p.espnId, p]));
const SLOTS = { PG: ['PG'], SG: ['SG'], SF: ['SF'], PF: ['PF'], C: ['C'], G: ['PG', 'SG'], F: ['SF', 'PF'], UTIL: ['PG', 'SG', 'SF', 'PF', 'C'] };
const OPEN = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'UTIL'];
const fits = (s, el) => SLOTS[s].some((p) => el.includes(p));

let seed = 20261018;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());

// Greedy by fppg is optimal for a transversal matroid: add a player if a matching still exists.
function bestLineup(players) {
  const owner = new Array(OPEN.length).fill(-1);
  const sorted = [...players].sort((a, b) => b.fppg - a.fppg);
  const seated = [];
  const tryPlace = (pi, seen) => {
    for (let s = 0; s < OPEN.length; s++) {
      if (seen[s] || !fits(OPEN[s], sorted[pi].eligible)) continue;
      seen[s] = true;
      if (owner[s] === -1 || tryPlace(owner[s], seen)) { owner[s] = pi; return true; }
    }
    return false;
  };
  for (let i = 0; i < sorted.length && seated.length < OPEN.length; i++) {
    const snap = [...owner];
    if (tryPlace(i, new Array(OPEN.length).fill(false))) seated.push(sorted[i]); else owner.splice(0, owner.length, ...snap);
  }
  return seated;
}

const teamName = (t) => (L.settings ? (t.name || t.abbrev) : t.abbrev).trim();
const members = new Map((L.members || []).map((m) => [m.id, `${m.firstName || ''} ${m.lastName || ''}`.trim()]));
const ESPN_ONLY = process.env.SRC === 'espn';
const espnProj = (e) => e.playerPoolEntry.player.stats.find((s) => s.id === '102027');
const teams = L.teams.map((t) => ({
  id: t.id, name: teamName(t), owner: members.get(t.primaryOwner) || '',
  roster: t.roster.entries.map((e) => {
    const m = byId.get(e.playerId);
    const el = m.eligible;
    const ep = espnProj(e);
    if (ESPN_ONLY && ep?.appliedAverage) {
      return { id: e.playerId, name: m.name, team: m.team, eligible: el, fppg: ep.appliedAverage, gp: ep.appliedTotal / ep.appliedAverage,
        raw: ep.appliedTotal, rank: m.model.rank, adp: m.espn.adp, inj: m.espn.injuryStatus };
    }
    return {
      id: e.playerId, name: m.name, team: m.team, eligible: el, fppg: m.model.fppg, gp: m.model.proj.GP,
      raw: m.model.raw, rank: m.model.rank, adp: m.espn.adp, inj: m.espn.injuryStatus,
    };
  }),
}));

// NBA schedule: each pro team plays a given day with p = 82/170; a player plays when his team
// does with p = GP/82. Game-to-game score noise: sd ~ 0.35 x fppg.
const PRO = [...new Set(teams.flatMap((t) => t.roster.map((p) => p.team)))];
const DAYS = 7; const WEEKS = 3000; const P_TEAM = 82 / 170;
const weekly = teams.map(() => []);
const usage = teams.map((t) => new Map(t.roster.map((p) => [p.id, 0])));
for (let w = 0; w < WEEKS; w++) {
  const tot = teams.map(() => 0);
  for (let d = 0; d < DAYS; d++) {
    const plays = new Map(PRO.map((x) => [x, rnd() < P_TEAM]));
    teams.forEach((t, ti) => {
      const avail = t.roster.filter((p) => plays.get(p.team) && rnd() < Math.min(1, p.gp / 82));
      for (const p of bestLineup(avail)) {
        tot[ti] += Math.max(-5, p.fppg + 0.35 * p.fppg * gauss());
        usage[ti].set(p.id, usage[ti].get(p.id) + 1);
      }
    });
  }
  tot.forEach((x, i) => weekly[i].push(x));
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

// All-play: P(team i beats team j) over paired simulated weeks.
const n = teams.length;
const winP = teams.map((_, i) => teams.map((__, j) => {
  if (i === j) return null;
  let w = 0;
  for (let k = 0; k < WEEKS; k++) w += weekly[i][k] > weekly[j][(k * 7 + 3) % WEEKS] ? 1 : 0;
  return w / WEEKS;
}));

// Season-long "starter strength": best 9 by season points with position constraints.
const out = teams.map((t, i) => {
  const lineup = bestLineup(t.roster.map((p) => ({ ...p, fppg: p.raw })));
  const ids = new Set(lineup.map((p) => p.id));
  const games = WEEKS;
  return {
    ...t,
    weeklyMean: mean(weekly[i]), weeklySd: sd(weekly[i]),
    winPct: mean(winP[i].filter((x) => x != null)),
    starterPts: lineup.reduce((a, p) => a + p.raw, 0),
    benchPts: t.roster.filter((p) => !ids.has(p.id)).reduce((a, p) => a + p.raw, 0),
    rosterPts: t.roster.reduce((a, p) => a + p.raw, 0),
    starters: lineup.map((p) => p.name),
    usage: t.roster.map((p) => ({ name: p.name, startsPerWeek: usage[i].get(p.id) / games })),
  };
}).sort((a, b) => b.weeklyMean - a.weeklyMean);

const picks = L.draftDetail.picks.map((p) => {
  const m = byId.get(p.playerId);
  return { overall: p.overallPickNumber, round: p.roundId, teamId: p.teamId, name: m.name, rank: m.model.rank, adp: m.espn.adp, eligible: m.eligible, fppg: m.model.fppg, raw: m.model.raw, gp: m.model.proj.GP };
});
const draftedIds = new Set(L.draftDetail.picks.map((p) => p.playerId));
const fa = ds.players.filter((p) => !draftedIds.has(p.espnId)).slice(0, 25)
  .map((p) => ({ name: p.name, team: p.team, eligible: p.eligible, rank: p.model.rank, fppg: p.model.fppg, gp: p.model.proj.GP, inj: p.espn.injuryStatus, own: p.espn.percentOwned }));

writeFileSync(outPath, JSON.stringify({ teams: out, winP: { ids: teams.map((t) => t.id), m: winP }, picks, fa }, null, 1));
for (const [i, t] of out.entries()) {
  console.log(`${String(i + 1).padStart(2)}. ${t.name.padEnd(28)} wk ${t.weeklyMean.toFixed(0)} ±${t.weeklySd.toFixed(0)}  allplay ${(t.winPct * 100).toFixed(1)}%  starters ${t.starterPts.toFixed(0)} bench ${t.benchPts.toFixed(0)}`);
}
