// FOX Champions League 2026-27 season Monte Carlo, v3.
//  - Real NBA schedule (ESPN proTeamSchedules), real league H2H schedule (mMatchup), week 8 = Cup bye.
//  - League calendar fit to 2025-26 scores: week 1 = 6 days, Mon-Sun after, All-Star weeks merged.
//  - Daily lineups with individual-game lock; each manager checks in on a given day with
//    probability `act` (from last season's lineup-move counts); off days keep a standing lineup.
//  - Waiver streaming + IR within the 3-adds-per-week cap, at each manager's historical add rate,
//    from a shared free-agent pool (one team per player).
//  - Injuries: streaky (mix of 2-game and 15-game spells), more rest on 2nd night of back-to-backs
//    for load-managed players. Projection error per player: wider for rookies, players coming
//    back from a lost season, and where ESPN and FantasyPros disagree.
// Usage: node league-sim.mjs <dir with draft.json f1.json sched.json meta.json> <dataset.json> <out.json> [SEASONS] [scenario]
//   scenario: history (default) | active (every manager perfect and streaming ~1 add/week)
//   SRC=espn uses ESPN-only per-game projections.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, datasetPath, outPath, seasonsArg, scenario = 'history'] = process.argv.slice(2);
const J = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const L = J('draft.json'); const SCH = J('f1.json'); const PRO = J('sched.json'); const META = J('meta.json');
const ds = JSON.parse(readFileSync(datasetPath, 'utf8'));
const SEASONS = Number(seasonsArg || 2000);
const ESPN_ONLY = process.env.SRC === 'espn';
const NOISE = Number(process.env.NOISE ?? 0.5); // per-game sd as a share of fppg (calibrated below)
const FORM = Number(process.env.FORM ?? 0.28); // weekly form sd (calibrated)

// ---- calendar ---------------------------------------------------------------------
const LAST_DAY = L.status.finalScoringPeriod; // 160 = Sun Mar 28
const calWeek = (d) => (d <= 6 ? 1 : 2 + Math.floor((d - 7) / 7));
const periodOf = (d) => { const c = calWeek(d); return c >= 19 ? c - 1 : c; }; // All-Star weeks 18+19 merged
const NP = periodOf(LAST_DAY);
if (NP !== 22) throw new Error(`calendar gives ${NP} periods`);
const REG = L.settings.scheduleSettings.matchupPeriodCount; // 19
const matchups = Array.from({ length: REG + 1 }, () => []);
for (const m of SCH.schedule) if (m.home && m.away && m.matchupPeriodId <= REG) matchups[m.matchupPeriodId].push([m.home.teamId, m.away.teamId]);
const BYE_WEEKS = matchups.map((x, i) => (i && !x.length ? i : null)).filter(Boolean);

const proDays = new Map(PRO.settings.proTeams.filter((t) => t.id > 0)
  .map((t) => [t.id, new Set(Object.keys(t.proGamesByScoringPeriod || {}).map(Number))]));
const proAbbrevToId = new Map(PRO.settings.proTeams.map((t) => [t.abbrev, t.id]));
const CUP = [46, 47, 48, 49, 50, 51, 52, 53]; // 2 TBD NBA Cup games per team land here

// ---- players -------------------------------------------------------------------------
const byId = new Map(ds.players.map((p) => [p.espnId, p]));
const projSd = (id) => {
  const m = META[id]; if (!m) return 0.15;
  const mean = (m.e + (m.f ?? m.e)) / 2;
  const disagree = m.f != null && mean > 0 ? Math.abs(m.e - m.f) / mean : 0.06;
  const rookie = m.rookie ? 0.12 : 0;
  const comeback = !m.rookie && m.lastGp < 35 ? 0.08 : 0;
  return Math.sqrt(0.12 ** 2 + disagree ** 2 + rookie ** 2 + comeback ** 2);
};
const mkPlayer = (id, pro) => {
  const m = byId.get(id);
  const meta = META[id];
  return {
    id, name: m.name, eligible: m.eligible, pro: pro ?? proAbbrevToId.get(m.team) ?? meta?.proTeamId,
    fppg: ESPN_ONLY && meta ? meta.e : m.model.fppg, gp: m.model.proj.GP, sd: projSd(id),
  };
};
const members = new Map((L.members || []).map((m) => [m.id, `${m.firstName || ''} ${m.lastName || ''}`.trim()]));
// Manager activity: act = share of days the lineup gets set (last season's moveToActive / ~390
// for a daily manager); adds = waiver adds per week (last season's acquisitions / 22).
// New owners and autodrafters are judgment calls, noted in the report.
const ACTIVITY = scenario === 'active'
  ? null
  : {
    1: { act: 0.25, adds: 0.1, why: '93 lineup moves, 2 adds last year; autodrafted all 12 picks' },
    4: { act: 1.0, adds: 1.4, why: '400 moves, 30 adds; defending champ' },
    5: { act: 0.15, adds: 0.15, why: '24 moves, 3 adds last year; autodrafted 5 picks' },
    6: { act: 0.76, adds: 0.36, why: '298 moves, 8 adds' },
    7: { act: 0.6, adds: 0.5, why: 'new owner; queue-autodrafted 9 picks' },
    8: { act: 0.5, adds: 0.3, why: '65 moves, 1 add, abandoned at 2-17 last year; drafted live today' },
    9: { act: 1.0, adds: 0.95, why: '390 moves, 21 adds' },
    11: { act: 1.0, adds: 2.0, why: '398 moves, 45 adds' },
    12: { act: 1.0, adds: 1.5, why: '409 moves, 33 adds' },
    13: { act: 1.0, adds: 0.6, why: '400 moves, 13 adds' },
    14: { act: 0.8, adds: 0.8, why: 'new owner; drafted live' },
    15: { act: 0.88, adds: 1.1, why: '343 moves, 25 adds' },
  };
if (ACTIVITY && process.env.JACK_ADDS) ACTIVITY[13].adds = Number(process.env.JACK_ADDS);
const teams = L.teams.map((t) => ({
  id: t.id, name: (t.name || t.abbrev).trim(), owner: members.get(t.primaryOwner) || '',
  act: ACTIVITY ? ACTIVITY[t.id].act : 1, adds: ACTIVITY ? ACTIVITY[t.id].adds : 1.0, why: ACTIVITY?.[t.id]?.why || 'all-active scenario',
  core: t.roster.entries.map((e) => mkPlayer(e.playerId, e.playerPoolEntry.player.proTeamId)),
}));
const drafted = new Set(teams.flatMap((t) => t.core.map((p) => p.id)));
const FA_POOL = ds.players.filter((p) => !drafted.has(p.espnId) && p.model.proj.GP >= 35)
  .sort((a, b) => b.model.fppg - a.model.fppg).slice(0, 80).map((p) => mkPlayer(p.espnId));

// ---- lineup ------------------------------------------------------------------------
const SLOTS = { PG: ['PG'], SG: ['SG'], SF: ['SF'], PF: ['PF'], C: ['C'], G: ['PG', 'SG'], F: ['SF', 'PF'], UTIL: ['PG', 'SG', 'SF', 'PF', 'C'] };
const OPEN = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'UTIL'];
const fits = (s, el) => SLOTS[s].some((p) => el.includes(p));
function bestLineup(players, key) { // greedy by value is optimal on a transversal matroid
  const owner = new Array(OPEN.length).fill(-1);
  const sorted = [...players].sort((a, b) => key(b) - key(a));
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

let seed = Number(process.env.SEED ?? 20261018);
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const poisson = (lam) => { let k = 0; let p = Math.exp(-lam); let s = p; const u = rnd(); while (u > s && k < 10) { k++; p *= lam / k; s += p; } return k; };
const geom = (mean) => 1 + Math.floor(Math.log(1 - rnd()) / Math.log(1 - 1 / mean));

const n = teams.length; const tIndex = new Map(teams.map((t, i) => [t.id, i]));
const agg = teams.map(() => ({ wins: 0, ties: 0, pf: 0, po: 0, seed1: 0, final: 0, champ: 0, addsUsed: 0, lostToBench: 0, weekRatio: [], seasonRatio: [] }));
const allPlayW = new Array(n).fill(0); let allPlayN = 0;

for (let s = 0; s < SEASONS; s++) {
  // Season-level draws.
  const cup = new Map([...proDays.keys()].map((id) => [id, new Set([...CUP].sort(() => rnd() - 0.5).slice(0, 2))]));
  const plays = (pro, d) => proDays.get(pro)?.has(d) || cup.get(pro)?.has(d);
  const b2b = (pro, d) => plays(pro, d) && plays(pro, d - 1);
  const health = new Map(); // player id -> { mult, q, out (games left in spell) }
  const H = (p) => {
    let h = health.get(p.id);
    if (!h) {
      const miss = Math.min(0.85, Math.max(0.01, 1 - p.gp / 82));
      const Ls = 0.75 * 2 + 0.25 * 15;
      h = { mult: Math.max(0.5, 1 + p.sd * gauss()), form: 0, q: miss / (Ls * (1 - miss)), out: 0, loadMgd: p.gp < 72 };
      if (rnd() < miss) h.out = rnd() < 0.75 ? geom(2) : geom(15);
      health.set(p.id, h);
    }
    return h;
  };
  // Advance a player's injury chain on one of his team's game days; true if he plays.
  const healthyToday = (p, d) => {
    const h = H(p);
    if (h.out > 0) { h.out--; return false; }
    const bump = h.loadMgd ? (b2b(p.pro, d) ? 2 / 1.17 : 1 / 1.17) : 1;
    if (rnd() < h.q * bump) { h.out = (rnd() < 0.75 ? geom(2) : geom(15)) - 1; return false; }
    return true;
  };
  const faOwner = new Map(); // fa id -> team index
  const freeAgents = [...FA_POOL];
  const st = teams.map((t) => ({
    roster: [...t.core], ir: null, standing: [], budget: 0,
    streamer: t.adds >= 0.25,
  }));
  const weekPts = teams.map(() => new Array(NP + 1).fill(0));
  let curP = 0;
  for (let d = 1; d <= LAST_DAY; d++) {
    const p = periodOf(d);
    if (p !== curP) {
      curP = p;
      st.forEach((x, i) => { x.budget = Math.min(3, poisson(teams[i].adds * (p === 1 ? 6 / 7 : p === 18 ? 2 : 1))); });
      // Week-to-week form (role, minutes, slumps): AR(1), stationary sd 0.15.
      for (const h of health.values()) h.form = 0.8 * h.form + 0.6 * FORM * gauss();
    }
    // Health is drawn once per player per day (shared by rostered and free-agent players).
    const healthy = new Map();
    const isHealthy = (pl) => {
      if (!plays(pl.pro, d)) return false;
      if (!healthy.has(pl.id)) healthy.set(pl.id, healthyToday(pl, d));
      return healthy.get(pl.id);
    };
    for (const f of FA_POOL) if (!faOwner.has(f.id)) isHealthy(f); // keep free agents' injury chains moving
    const remainingGames = (pl) => { let g = 0; for (let k = d; k <= LAST_DAY && periodOf(k) === p; k++) if (plays(pl.pro, k)) g++; return g; };
    const order = [...Array(n).keys()].sort(() => rnd() - 0.5);
    for (const ti of order) {
      const t = teams[ti]; const x = st[ti];
      const checks = rnd() < t.act;
      if (checks) {
        // IR: return a healed player (dropping the IR fill-in), or stash a long-term injury.
        if (x.ir && H(x.ir.player).out === 0) {
          x.roster = x.roster.filter((r) => r !== x.ir.fill); faOwner.delete(x.ir.fill.id); freeAgents.push(x.ir.fill);
          x.roster.push(x.ir.player); x.ir = null;
        }
        if (!x.ir && x.budget > 0) {
          const hurt = x.roster.find((r) => H(r).out > 5);
          const fa = hurt && freeAgents.filter((f) => !faOwner.has(f.id)).sort((a, b) => b.fppg - a.fppg)[0];
          if (fa) {
            x.roster = x.roster.filter((r) => r !== hurt); x.roster.push(fa); faOwner.set(fa.id, ti);
            x.ir = { player: hurt, fill: fa }; x.budget--; agg[ti].addsUsed++;
          }
        }
        // Streaming / upgrades: the rotating spot is the weakest healthy player. Swap him for the
        // free agent worth more over the rest of this week plus a keep value (~3 games) for later.
        if (x.streamer && x.budget > 0) {
          const val = (pl) => (H(pl).out > 0 ? 0 : pl.fppg * remainingGames(pl)) + 3 * pl.fppg * (H(pl).out > 5 ? 0.3 : 1);
          const out = [...x.roster].sort((a, b) => val(a) - val(b))[0];
          if (H(out).out <= 5 || x.ir) {
            let best = null; let bestV = val(out) + 8;
            for (const f of freeAgents) { if (faOwner.has(f.id)) continue; const v = val(f); if (v > bestV) { best = f; bestV = v; } }
            if (best) {
              x.roster = x.roster.map((r) => (r === out ? best : r));
              faOwner.delete(out.id); if (!freeAgents.includes(out)) freeAgents.push(out);
              faOwner.set(best.id, ti); x.budget--; agg[ti].addsUsed++;
            }
          }
        }
        x.standing = bestLineup(x.roster.filter((r) => H(r).out === 0), (r) => r.fppg);
      }
      const avail = x.roster.filter(isHealthy);
      const lineup = checks ? bestLineup(avail, (r) => r.fppg) : x.standing.filter((r) => avail.includes(r));
      if (!checks) agg[ti].lostToBench += avail.filter((r) => !lineup.includes(r)).length;
      for (const r of lineup) {
        const h = H(r);
        weekPts[ti][p] += Math.max(-5, r.fppg * h.mult * Math.max(0.3, 1 + h.form) * (1 + NOISE * gauss()));
      }
    }
  }
  // Regular season on the real schedule.
  const wins = new Array(n).fill(0); const pf = new Array(n).fill(0);
  for (let w = 1; w <= REG; w++) {
    for (const [h, a] of matchups[w]) {
      const hi = tIndex.get(h); const ai = tIndex.get(a);
      pf[hi] += weekPts[hi][w]; pf[ai] += weekPts[ai][w];
      if (weekPts[hi][w] > weekPts[ai][w]) wins[hi]++; else wins[ai]++;
    }
    if (!matchups[w].length) continue;
    const mu = weekPts.reduce((acc, wp) => acc + wp[w], 0) / n;
    teams.forEach((_, i) => {
      agg[i].weekRatio.push(weekPts[i][w] / mu);
      for (let j = 0; j < n; j++) if (j !== i && weekPts[i][w] > weekPts[j][w]) allPlayW[i]++;
    });
    allPlayN += n - 1;
  }
  const muPf = pf.reduce((a, b) => a + b, 0) / n;
  pf.forEach((v, i) => { agg[i].wins += wins[i]; agg[i].pf += v; agg[i].seasonRatio.push(v / muPf); });
  const seeds = [...Array(n).keys()].sort((a, b) => wins[b] - wins[a] || pf[b] - pf[a]).slice(0, 6);
  seeds.forEach((i) => agg[i].po++); agg[seeds[0]].seed1++;
  const m = (a, b, w) => (weekPts[a][w] >= weekPts[b][w] ? a : b);
  const q1 = m(seeds[2], seeds[5], 20); const q2 = m(seeds[3], seeds[4], 20);
  const s1 = m(seeds[0], q2, 21); const s2 = m(seeds[1], q1, 21);
  agg[s1].final++; agg[s2].final++; agg[m(s1, s2, 22)].champ++;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sdv = (a) => { const mu = mean(a); return Math.sqrt(mean(a.map((x) => (x - mu) ** 2))); };
// Calibration: within-team weekly CV (week-normalised), comparable to 2025-26's 0.177.
const within = []; agg.forEach((g) => { const perSeason = REG - BYE_WEEKS.length; for (let s = 0; s < SEASONS; s++) { const r = g.weekRatio.slice(s * perSeason, (s + 1) * perSeason); const mu = mean(r); within.push(sdv(r.map((v) => v / mu))); } });
const seasonSpread = []; for (let s = 0; s < SEASONS; s++) seasonSpread.push(sdv(agg.map((g) => g.seasonRatio[s])));
const out = teams.map((t, i) => {
  const g = agg[i];
  return {
    id: t.id, name: t.name, owner: t.owner, act: t.act, adds: t.adds, why: t.why,
    allPlay: allPlayW[i] / (allPlayN / 1), wins: g.wins / SEASONS, pfRatio: mean(g.seasonRatio),
    po: g.po / SEASONS, seed1: g.seed1 / SEASONS, final: g.final / SEASONS, champ: g.champ / SEASONS,
    weeklyCV: (() => { const per = REG - BYE_WEEKS.length; const v = []; for (let s = 0; s < SEASONS; s++) { const r = g.weekRatio.slice(s * per, (s + 1) * per); const mu = mean(r); v.push(sdv(r.map((x) => x / mu))); } return mean(v); })(),
    addsPerSeason: g.addsUsed / SEASONS, lostToBenchPerSeason: g.lostToBench / SEASONS,
  };
}).sort((a, b) => b.champ - a.champ);
const calib = { withinTeamCV: mean(within), seasonSpreadSd: mean(seasonSpread), noise: NOISE, byeWeeks: BYE_WEEKS };
writeFileSync(outPath, JSON.stringify({ seasons: SEASONS, scenario, src: ESPN_ONLY ? 'espn' : 'blend', calib, teams: out }, null, 1));
console.log(`${SEASONS} seasons | ${scenario} | ${ESPN_ONLY ? 'ESPN-only' : 'blend'} | weekly CV ${calib.withinTeamCV.toFixed(3)} (2025-26: 0.177) | season spread sd ${calib.seasonSpreadSd.toFixed(3)} | bye ${BYE_WEEKS}`);
out.forEach((t, i) => console.log(`${String(i + 1).padStart(2)}. ${t.name.padEnd(28)} allplay ${(t.allPlay * 100).toFixed(1)}%  W ${t.wins.toFixed(1)}/18  PF ${t.pfRatio.toFixed(3)}  PO ${(t.po * 100).toFixed(0)}%  #1 ${(t.seed1 * 100).toFixed(0)}%  final ${(t.final * 100).toFixed(0)}%  title ${(t.champ * 100).toFixed(1)}%  adds ${t.addsPerSeason.toFixed(0)}  benched-lost ${t.lostToBenchPerSeason.toFixed(0)}`));
