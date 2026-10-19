// Full-season Monte Carlo on the real 2026-27 NBA schedule (ESPN proTeamSchedules).
// Daily optimal lineups (individual-game lock: bench fills when a starter is off),
// streaky injuries, per-player projection error, 19-week H2H regular season, 6-team
// playoffs in weeks 20-22 (seeds 1-2 bye) scored on those weeks' actual schedule.
// Usage: node schedule-sim.mjs draft.json sched.json dataset.json out.json [SEASONS]
//        SRC=espn uses ESPN's own projections instead of the blend.
import { readFileSync, writeFileSync } from 'node:fs';

const [draftPath, schedPath, datasetPath, outPath, seasonsArg] = process.argv.slice(2);
const L = JSON.parse(readFileSync(draftPath, 'utf8'));
const SCHED = JSON.parse(readFileSync(schedPath, 'utf8'));
const ds = JSON.parse(readFileSync(datasetPath, 'utf8'));
const SEASONS = Number(seasonsArg || 1000);
const ESPN_ONLY = process.env.SRC === 'espn';
const byId = new Map(ds.players.map((p) => [p.espnId, p]));

// ---- calendar: scoring period (day) -> matchup week ---------------------------------
const LAST_DAY = L.status.finalScoringPeriod; // 160 = Sun Mar 28
const weekOf = (sp) => (sp <= 13 ? 1 : 2 + Math.floor((sp - 14) / 7)); // wk1 = Oct 20-Nov 1, then Mon-Sun
const NWEEKS = weekOf(LAST_DAY); // 22
const REG_WEEKS = L.settings.scheduleSettings.matchupPeriodCount; // 19
if (NWEEKS !== 22) throw new Error(`calendar mismatch: ${NWEEKS} weeks`);

// proTeamId -> Set(days with a game); Cup games still TBD get placed per simulated season.
const proDays = new Map();
for (const t of SCHED.settings.proTeams.filter((x) => x.id > 0)) {
  proDays.set(t.id, new Set(Object.keys(t.proGamesByScoringPeriod || {}).map(Number).filter((d) => d <= LAST_DAY)));
}
const CUP_WINDOW = [46, 47, 48, 49, 50, 51, 52, 53]; // Dec 4-11: no games scheduled yet
const proGamesTotal = (id) => [...proDays.get(id)].length + 2;

// ---- rosters ---------------------------------------------------------------------
const SLOTS = { PG: ['PG'], SG: ['SG'], SF: ['SF'], PF: ['PF'], C: ['C'], G: ['PG', 'SG'], F: ['SF', 'PF'], UTIL: ['PG', 'SG', 'SF', 'PF', 'C'] };
const OPEN = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'UTIL'];
const fits = (s, el) => SLOTS[s].some((p) => el.includes(p));
const members = new Map((L.members || []).map((m) => [m.id, `${m.firstName || ''} ${m.lastName || ''}`.trim()]));
const teams = L.teams.map((t) => ({
  id: t.id, name: (t.name || t.abbrev).trim(), owner: members.get(t.primaryOwner) || '',
  roster: t.roster.entries.map((e) => {
    const m = byId.get(e.playerId);
    const pl = e.playerPoolEntry.player;
    const ep = pl.stats.find((s) => s.id === '102027');
    const espn = ESPN_ONLY && ep?.appliedAverage;
    return {
      id: e.playerId, name: m.name, pro: pl.proTeamId, eligible: m.eligible,
      fppg: espn ? ep.appliedAverage : m.model.fppg,
      gp: espn ? ep.appliedTotal / ep.appliedAverage : m.model.proj.GP,
    };
  }),
}));

let seed = 20261020;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());

// Greedy by points is optimal here (transversal matroid): keep a player if a matching survives.
function bestLineup(players) {
  const owner = new Array(OPEN.length).fill(-1);
  const sorted = [...players].sort((a, b) => b.pts - a.pts);
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
    if (tryPlace(i, new Array(OPEN.length).fill(false))) seated.push(sorted[i]);
    else owner.splice(0, owner.length, ...snap);
  }
  return seated;
}

const n = teams.length;
const stats = teams.map((t) => ({
  weekPts: Array.from({ length: NWEEKS }, () => 0), wins: 0, playoffs: 0, seed1: 0, final: 0, champ: 0, pf: 0,
  benchWaste: 0, // a healthy rostered player had a game but no lineup slot
  starts: new Map(t.roster.map((p) => [p.id, 0])), games: new Map(t.roster.map((p) => [p.id, 0])),
}));
const weeklySamples = teams.map(() => []);

for (let s = 0; s < SEASONS; s++) {
  // This season's Cup games: 2 per pro team on random distinct window days.
  const cup = new Map([...proDays.keys()].map((id) => {
    const days = [...CUP_WINDOW].sort(() => rnd() - 0.5).slice(0, 2);
    return [id, new Set(days)];
  }));
  const plays = (pro, d) => proDays.get(pro)?.has(d) || cup.get(pro)?.has(d);
  // Per-player season state: projection error and a streaky injury chain
  // (out-spells average 5 games; long-run miss rate = 1 - GP/82).
  const state = teams.map((t) => t.roster.map((p) => {
    const miss = Math.min(0.9, Math.max(0, 1 - p.gp / 82));
    const r = 0.2; const q = miss >= 1 ? 1 : (r * miss) / (1 - miss);
    return { p, mult: Math.max(0.6, 1 + 0.1 * gauss()), q, r, out: rnd() < miss };
  }));
  const week = teams.map(() => new Array(NWEEKS).fill(0));
  for (let d = 1; d <= LAST_DAY; d++) {
    const w = weekOf(d) - 1;
    teams.forEach((t, ti) => {
      const avail = [];
      for (const st of state[ti]) {
        if (!plays(st.p.pro, d)) continue;
        st.out = st.out ? rnd() >= st.r : rnd() < st.q;
        if (st.out) continue;
        avail.push({ id: st.p.id, eligible: st.p.eligible, pts: st.p.fppg * st.mult });
      }
      const lineup = bestLineup(avail);
      stats[ti].benchWaste += avail.length - lineup.length;
      for (const a of avail) stats[ti].games.set(a.id, stats[ti].games.get(a.id) + 1);
      for (const a of lineup) {
        week[ti][w] += Math.max(-5, a.pts + 0.35 * a.pts * gauss());
        stats[ti].starts.set(a.id, stats[ti].starts.get(a.id) + 1);
      }
    });
  }
  teams.forEach((_, ti) => week[ti].forEach((x, w) => { stats[ti].weekPts[w] += x; if (w < REG_WEEKS) weeklySamples[ti].push(x); }));

  // Regular season: circle-method round robin over a random team order.
  const order = [...Array(n).keys()].sort(() => rnd() - 0.5);
  const wins = new Array(n).fill(0); const pf = new Array(n).fill(0);
  for (let w = 0; w < REG_WEEKS; w++) {
    const rot = [order[0], ...order.slice(1).map((_, k) => order[1 + ((k + w) % (n - 1))])];
    for (let k = 0; k < n / 2; k++) {
      const a = rot[k]; const b = rot[n - 1 - k];
      pf[a] += week[a][w]; pf[b] += week[b][w];
      if (week[a][w] > week[b][w]) wins[a]++; else wins[b]++;
    }
  }
  const seeds = [...Array(n).keys()].sort((a, b) => wins[b] - wins[a] || pf[b] - pf[a]).slice(0, 6);
  wins.forEach((x, i) => { stats[i].wins += x; stats[i].pf += pf[i]; });
  seeds.forEach((t) => { stats[t].playoffs++; });
  stats[seeds[0]].seed1++;
  const m = (a, b, w) => (week[a][w] > week[b][w] ? a : b);
  const q1 = m(seeds[2], seeds[5], 19); const q2 = m(seeds[3], seeds[4], 19);
  const s1 = m(seeds[0], q2, 20); const s2 = m(seeds[1], q1, 20);
  stats[s1].final++; stats[s2].final++;
  stats[m(s1, s2, 21)].champ++;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const mu = mean(a); return Math.sqrt(mean(a.map((x) => (x - mu) ** 2))); };
// All-play win% on regular-season weeks: compare same-week totals across teams.
const allPlay = teams.map((_, i) => {
  let w = 0; let c = 0;
  for (let k = 0; k < weeklySamples[i].length; k++) {
    for (let j = 0; j < n; j++) if (j !== i) { c++; if (weeklySamples[i][k] > weeklySamples[j][k]) w++; }
  }
  return w / c;
});

const out = teams.map((t, i) => {
  const st = stats[i];
  return {
    id: t.id, name: t.name, owner: t.owner,
    weeklyMean: mean(weeklySamples[i]), weeklySd: sd(weeklySamples[i]), allPlay: allPlay[i],
    wins: st.wins / SEASONS, pf: st.pf / SEASONS,
    playoffs: st.playoffs / SEASONS, seed1: st.seed1 / SEASONS, final: st.final / SEASONS, champ: st.champ / SEASONS,
    playoffWeeks: [19, 20, 21].map((w) => st.weekPts[w] / SEASONS),
    benchWastePerWeek: st.benchWaste / SEASONS / NWEEKS,
    players: t.roster.map((p) => ({
      name: p.name, eligible: p.eligible, fppg: p.fppg,
      proGames: proGamesTotal(p.pro), playoffGames: [...proDays.get(p.pro)].filter((d) => weekOf(d) > REG_WEEKS && d <= LAST_DAY).length,
      healthyGames: st.games.get(p.id) / SEASONS, starts: st.starts.get(p.id) / SEASONS,
    })),
  };
}).sort((a, b) => b.allPlay - a.allPlay);

writeFileSync(outPath, JSON.stringify({ seasons: SEASONS, src: ESPN_ONLY ? 'espn' : 'blend', teams: out }, null, 1));
console.log(`${SEASONS} seasons, ${ESPN_ONLY ? 'ESPN-only' : 'blend'} projections`);
out.forEach((t, i) => console.log(
  `${String(i + 1).padStart(2)}. ${t.name.padEnd(28)} wk ${t.weeklyMean.toFixed(0)} ±${t.weeklySd.toFixed(0)}  allplay ${(t.allPlay * 100).toFixed(1)}%  `
  + `W ${t.wins.toFixed(1)}  PO ${(t.playoffs * 100).toFixed(0)}%  #1 ${(t.seed1 * 100).toFixed(0)}%  final ${(t.final * 100).toFixed(0)}%  title ${(t.champ * 100).toFixed(1)}%  `
  + `benched-healthy/wk ${t.benchWastePerWeek.toFixed(1)}  playoff wks ${t.playoffWeeks.map((x) => x.toFixed(0)).join('/')}`,
));
