import test from 'node:test';
import assert from 'node:assert/strict';
import { fantasyPointsPerGame, valuePlayers, categoryScores, assignTiers, replacementLevels } from '../src/core/value.js';
import { blendLine, fpPerGame } from '../src/core/projections.js';
import { applyHouseRules } from '../src/core/house.js';
import { rulesFromLeague } from '../scripts/import-league.mjs';
import { readFileSync } from 'node:fs';

const ESPN_POINTS = { PTS: 1, '3PM': 1, FGA: -1, FGM: 2, FTA: -1, FTM: 1, REB: 1, AST: 2, STL: 4, BLK: 4, TO: -2 };

test('fantasy points per game applies every scoring weight', () => {
  const line = { PTS: 20, '3PM': 2, FGA: 15, FGM: 8, FTA: 4, FTM: 3, REB: 5, AST: 4, STL: 1, BLK: 1, TO: 2 };
  // 20 + 2 - 15 + 16 - 4 + 3 + 5 + 8 + 4 + 4 - 4
  assert.equal(fantasyPointsPerGame(line, ESPN_POINTS), 39);
});

const P = (id, eligible, line) => ({ id, name: `P${id}`, pos: eligible[0], eligible, line: { GP: 70, MIN: 30, ...line } });

test('points league: value is over the best non-starter at the best position', () => {
  const players = [
    P(1, ['C'], { PTS: 30 }), P(2, ['PG'], { PTS: 25 }), P(3, ['PG'], { PTS: 20 }),
    P(4, ['C'], { PTS: 10 }), P(5, ['PG'], { PTS: 18 }),
  ];
  const rules = { teams: 1, rounds: 3, roster: { PG: 1, C: 1, BE: 1 }, scoring: { type: 'points', points: { PTS: 1 } } };
  const { players: out, replacement } = valuePlayers(players, rules);
  // One team, one PG and one C slot: P2 and P1 start; P3 is the best PG left out.
  assert.equal(replacement.PG, 20 * 70);
  assert.equal(replacement.C, 10 * 70);
  // P1 is a C: 30*70 - 10*70
  assert.equal(out.find((p) => p.id === 1).vorp, 20 * 70);
  assert.deepEqual(out.map((p) => p.rank), [1, 2, 3, 4, 5]);
});

test('lineup-aware replacement: centers beyond the C and UTIL slots set the C level', async () => {
  const { slotReplacementLevels } = await import('../src/core/value.js');
  const ps = [
    { id: 1, eligible: ['C'], raw: 100 }, { id: 2, eligible: ['C'], raw: 90 }, { id: 3, eligible: ['C'], raw: 80 },
    { id: 4, eligible: ['PG'], raw: 50 }, { id: 5, eligible: ['PG'], raw: 30 },
  ];
  // 1 team: C + UTIL + PG. Two centers start (C, UTIL); the third is the C replacement.
  const level = slotReplacementLevels(ps, 1, { C: 1, UTIL: 1, PG: 1, BE: 2 });
  assert.equal(level.C, 80);
  assert.equal(level.PG, 30);
});

test('a multi-position player is measured against his cheapest replacement', () => {
  const players = [P(1, ['PG', 'C'], { PTS: 20 }), P(2, ['PG'], { PTS: 15 }), P(3, ['C'], { PTS: 5 })];
  const level = replacementLevels(players.map((p) => ({ ...p, raw: p.line.PTS })), 1);
  assert.deepEqual([level.PG, level.C], [15, 5]);
  const { players: out } = valuePlayers(players, { teams: 1, rounds: 1, roster: { UTIL: 1 }, scoring: { type: 'points', points: { PTS: 1 } }, basis: 'perGame' });
  assert.equal(out[0].vorp, 15); // 20 - min(15, 5)
});

test('season basis rewards availability; per-game basis ignores it', () => {
  const players = [P(1, ['PG'], { PTS: 20, GP: 80 }), P(2, ['PG'], { PTS: 22, GP: 50 }), P(3, ['PG'], { PTS: 5 })];
  const rules = { teams: 1, rounds: 2, roster: { PG: 1, BE: 1 }, scoring: { type: 'points', points: { PTS: 1 } } };
  assert.equal(valuePlayers(players, { ...rules, basis: 'season' }).players[0].id, 1);
  assert.equal(valuePlayers(players, { ...rules, basis: 'perGame' }).players[0].id, 2);
});

test('category z-scores: percentages are volume weighted and turnovers count against', () => {
  const players = [
    P(1, ['C'], { FGM: 10, FGA: 15, TO: 1 }),   // 66.7% on volume
    P(2, ['C'], { FGM: 2, FGA: 3, TO: 1 }),     // 66.7% on tiny volume
    P(3, ['PG'], { FGM: 8, FGA: 20, TO: 5 }),   // 40% on volume, sloppy
  ];
  const z = categoryScores(players, ['FG%', 'TO'], { poolSize: 3 });
  assert.ok(z.get(1).byCat['FG%'] > z.get(2).byCat['FG%']);
  assert.ok(z.get(3).byCat['FG%'] < 0);
  assert.ok(z.get(3).byCat.TO < 0);
  assert.ok(z.get(1).byCat.TO > 0);
});

test('punting a category removes it from the score', () => {
  const players = [P(1, ['C'], { BLK: 3, AST: 1 }), P(2, ['PG'], { BLK: 0, AST: 9 }), P(3, ['SF'], { BLK: 1, AST: 3 })];
  const z = categoryScores(players, ['BLK', 'AST'], { poolSize: 3, punt: ['AST'] });
  assert.equal(z.get(1).byCat.AST, undefined);
  assert.ok(z.get(1).total > z.get(2).total);
});

test('multi-double model: a 25/12 big is a likely double-double, a 12-point wing is not', async () => {
  const { multiDoubleRates } = await import('../src/core/projections.js');
  const big = multiDoubleRates({ PTS: 25, REB: 12, AST: 3, BLK: 1, STL: 1 });
  const wing = multiDoubleRates({ PTS: 12, REB: 4, AST: 2, BLK: 0.5, STL: 1 });
  assert.ok(big.dd > 0.6 && big.td < 0.05);
  assert.ok(wing.dd < 0.05);
});

test('tiers break at unusually large gaps', () => {
  assert.deepEqual(assignTiers([100, 99, 98, 97, 60, 59, 58, 57], { minSize: 2 }), [1, 1, 1, 1, 2, 2, 2, 2]);
});

test('blend averages shared stats and derives makes from the blended percentage', () => {
  const espn = { perGame: { GP: 70, PTS: 20, REB: 10, AST: 4, STL: 1, BLK: 1, '3PM': 2, '3PA': 5, TO: 2, MIN: 32, FGM: 8, FGA: 16, FTM: 2, FTA: 2.5, 'FG%': 0.5, 'FT%': 0.8 }, last: { REB: 10, OREB: 3, GP: 70, DD: 0.5 } };
  const fp = fpPerGame({ GP: 80, PTS: 1760, REB: 800, AST: 320, STL: 80, BLK: 80, '3PM': 160, TO: 160, MIN: 2560, 'FG%': 0.54, 'FT%': 0.8 });
  const b = blendLine(espn, fp, 0.5);
  assert.equal(b.GP, 75);
  assert.equal(b.PTS, 21);
  assert.equal(b['FG%'], 0.52);
  assert.equal(b.FGA, 16.8);
  assert.equal(b.FGM, 8.736);
  assert.equal(b.OREB, 3);
  assert.equal(b.FGMI, 8.064); // misses, for leagues that penalize them
  // DD rate: 70 games of last season's 0.5 weighted 70/100 against the modeled rate.
  assert.ok(b.DD > 0.35 && b.DD < 0.65, `DD ${b.DD}`);
  assert.equal(blendLine(espn, null).PTS, 20); // ESPN only
});

test('house rules: a stat bonus is layered onto points, GP caps apply', () => {
  const rules = { scoring: { type: 'points', points: { PTS: 1, DD: 0 } }, house: { statBonus: { DD: 5 }, gpCap: 70 } };
  const r = applyHouseRules([{ name: 'A', line: { GP: 78 } }], rules);
  assert.equal(r.rules.scoring.points.DD, 5);
  assert.equal(r.players[0].line.GP, 70);
  assert.equal(r.applied.length, 2);
});

test('ESPN league settings import into rules (real default-league payload)', () => {
  const data = JSON.parse(readFileSync(new URL('./fixtures/league-mSettings.json', import.meta.url), 'utf8'));
  const r = rulesFromLeague(data);
  assert.equal(r.teams, 10);
  assert.equal(r.rounds, 13);
  assert.equal(r.scoring.type, 'categories');
  assert.deepEqual(r.scoring.categories, ['PTS', 'BLK', 'STL', 'AST', 'REB', '3PM', 'FG%', 'FT%']);
  assert.equal(r.roster.UTIL, 3);
});
