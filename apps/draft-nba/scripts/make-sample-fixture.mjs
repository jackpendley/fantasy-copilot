#!/usr/bin/env node
// Regenerates test/fixtures/sample-dataset.json: a small synthetic league run through the
// real value pipeline, so tests never need the network or real projections.

import { writeFileSync } from 'node:fs';
import { valuePlayers } from '../src/core/value.js';

const rules = {
  teams: 2, rounds: 4, roster: { PG: 1, C: 1, UTIL: 1, BE: 1 }, draft: { type: 'SNAKE', keeperCount: 0 },
  scoring: { type: 'points', points: { PTS: 1, REB: 1, AST: 2, STL: 4, BLK: 4, TO: -2, FGM: 2, FGA: -1, FTM: 1, FTA: -1, '3PM': 1 } },
  basis: 'season',
};
const L = (pts, reb, ast, stl, blk, to, fga, fgPct, fta, ftPct, tpm, gp, min = 32) => ({
  GP: gp, MIN: min, PTS: pts, REB: reb, AST: ast, STL: stl, BLK: blk, TO: to, '3PM': tpm, '3PA': tpm * 2.7,
  FGA: fga, FGM: fga * fgPct, 'FG%': fgPct, FTA: fta, FTM: fta * ftPct, 'FT%': ftPct, DD: 0, TD: 0,
});
const raw = [
  ['Cal Center', 'C', ['C'], 'AAA', L(26, 12, 8, 1.4, 1.0, 3, 18, 0.58, 6, 0.8, 1.5, 74)],
  ['Pat Point', 'PG', ['PG', 'SG'], 'BBB', L(28, 5, 6, 1.6, 0.8, 2.8, 19, 0.52, 8, 0.89, 2.2, 76)],
  ['Gus Glass', 'PF', ['PF', 'C'], 'AAA', L(18, 10, 3, 0.8, 1.5, 2, 13, 0.55, 5, 0.65, 0.5, 70)],
  ['Wes Wing', 'SF', ['SF', 'PF'], 'CCC', L(20, 6, 4, 1.2, 0.6, 2, 16, 0.47, 4, 0.82, 2.8, 72)],
  ['Sam Shooter', 'SG', ['SG'], 'BBB', L(16, 3, 3, 0.9, 0.3, 1.5, 13, 0.45, 3, 0.9, 3.0, 78)],
  ['Ike Injured', 'PG', ['PG'], 'CCC', L(24, 4, 9, 1.5, 0.4, 3.5, 18, 0.47, 6, 0.86, 2.5, 40)],
  ['Ben Bench', 'C', ['C'], 'AAA', L(9, 8, 1, 0.5, 1.2, 1, 7, 0.6, 2, 0.6, 0, 70, 22)],
  ['Rip Rookie', 'SF', ['SF'], 'BBB', L(12, 4, 2, 0.8, 0.5, 1.6, 10, 0.44, 3, 0.75, 1.5, 70, 26)],
  ['Lou Late', 'SG', ['SG', 'SF'], 'CCC', L(8, 3, 2, 0.6, 0.2, 1, 7, 0.43, 1.5, 0.8, 1.2, 65, 20)],
  ['Zed Zero', 'PF', ['PF'], 'AAA', L(5, 3, 1, 0.3, 0.3, 0.6, 4, 0.48, 1, 0.7, 0.3, 60, 14)],
];
const pool = raw.map(([name, pos, eligible, team, line], i) => ({ id: 9000001 + i, name, pos, eligible, team, line }));
const valued = valuePlayers(pool, rules);
const adps = { 'Cal Center': 1.2, 'Pat Point': 2.4, 'Gus Glass': 5.5, 'Wes Wing': 3.6, 'Sam Shooter': 6.8, 'Ike Injured': 4.0, 'Ben Bench': 9.5, 'Rip Rookie': 7.5, 'Lou Late': 12, 'Zed Zero': null };
const r1 = (n) => Math.round(n * 10) / 10;
const players = valued.players.map((v) => ({
  espnId: v.id, name: v.name, pos: v.pos, eligible: v.eligible, team: v.team,
  espn: { adp: adps[v.name], adpChange: 0, percentOwned: 90, auctionValue: 10, pointsRank: null, rotoRank: null,
    injuryStatus: v.name === 'Ike Injured' ? 'OUT' : 'ACTIVE', seasonOutlook: 'Synthetic test player.' },
  model: { rank: v.rank, posRank: v.posRank, tier: v.tier, value: r1(v.vorp), raw: r1(v.raw), fppg: v.fppg, z: null, dollars: null,
    sources: 'ESPN', notes: [], proj: v.line },
}));
writeFileSync(new URL('../test/fixtures/sample-dataset.json', import.meta.url), `${JSON.stringify({
  builtAt: '2000-01-01T00:00:00.000Z', espnFetchedAt: '2000-01-01T00:00:00.000Z', source: 'Synthetic test fixture',
  rules, replacement: valued.replacement, players,
}, null, 2)}\n`);
console.log(players.map((p) => `${p.model.rank} ${p.name} ${p.model.value}`).join('\n'));
