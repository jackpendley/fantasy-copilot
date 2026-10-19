#!/usr/bin/env node
// Blends the cached ESPN + FantasyPros projections, values every player under this league's
// rules (data/local/league-rules.json, else the example), and emits dist/dataset.json,
// dist/cheatsheet.html and dist/rankings.csv. Exits non-zero on structural problems.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildIndex, resolve, normalizeName } from '../src/core/names.js';
import { blendLine, fpPerGame } from '../src/core/projections.js';
import { valuePlayers, POSITIONS } from '../src/core/value.js';
import { applyHouseRules } from '../src/core/house.js';
import { renderCheatsheet } from './cheatsheet.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = (f) => join(ROOT, f);
const ESPN_CACHE = P('data/cache/espn-players.json');
const FP_CACHE = P('data/cache/fantasypros.json');
const RULES = existsSync(P('data/local/league-rules.json'))
  ? P('data/local/league-rules.json') : P('data/local/league-rules.example.json');
const ESPN_WEIGHT = Number(process.env.ESPN_WEIGHT ?? 0.5);

if (!existsSync(ESPN_CACHE)) { console.error('Missing ESPN cache -- run `npm run fetch:players`.'); process.exit(1); }
const espn = JSON.parse(readFileSync(ESPN_CACHE, 'utf8'));
const fp = existsSync(FP_CACHE) ? JSON.parse(readFileSync(FP_CACHE, 'utf8')) : { players: [] };
const rules = JSON.parse(readFileSync(RULES, 'utf8'));
const overrides = existsSync(P('data/overrides/projections.json'))
  ? JSON.parse(readFileSync(P('data/overrides/projections.json'), 'utf8')) : {};
const aliases = JSON.parse(readFileSync(P('data/overrides/aliases.json'), 'utf8')).aliases || {};

// ---- match FantasyPros -> ESPN -------------------------------------------------
const withProj = espn.players.filter((p) => p.proj?.perGame?.GP);
const index = buildIndex(withProj);
const fpById = new Map();
const unmatched = [];
const fuzzy = [];
for (const f of fp.players) {
  const sameTeam = (index.byName.get(normalizeName(aliases[normalizeName(f.name)] || f.name)) || [])
    .filter((p) => p.team === f.team);
  const r = sameTeam.length === 1 ? { player: sameTeam[0], how: 'name-team' } : resolve(index, f.name, null, aliases);
  if (!r.player) { unmatched.push(`${f.name} (${f.team})  ${r.candidates?.join(', ') || ''}`); continue; }
  if (r.fuzzy || r.how === 'name-most-owned') fuzzy.push(`${f.name} -> ${r.player.name} [${r.how}]`);
  fpById.set(r.player.espnId, f);
}

// ---- blend + value --------------------------------------------------------------
let pool = withProj.map((p) => {
  const f = fpById.get(p.espnId);
  let line = blendLine({ perGame: p.proj.perGame, last: p.last?.perGame }, f ? fpPerGame(f.totals) : null, ESPN_WEIGHT);
  const o = overrides[p.name];
  if (o) line = { ...line, ...o };
  return {
    id: p.espnId, name: p.name, pos: p.pos, team: p.team,
    eligible: p.eligible?.length ? p.eligible : [p.pos], line, sources: f ? 'ESPN+FP' : 'ESPN',
  };
});
const house = applyHouseRules(pool, rules);
pool = house.players;
const valued = valuePlayers(pool, house.rules);

// ---- assemble the dataset in the panel's shape -----------------------------------
const espnById = new Map(espn.players.map((p) => [p.espnId, p]));
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const players = valued.players.map((v) => {
  const e = espnById.get(v.id);
  return {
    espnId: v.id, name: v.name, pos: v.pos, eligible: v.eligible, team: v.team,
    espn: {
      adp: e.adp, adpChange: e.adpChange, percentOwned: e.percentOwned, auctionValue: e.auctionValue,
      pointsRank: e.espnPointsRank, rotoRank: e.espnRotoRank, injuryStatus: e.injuryStatus, seasonOutlook: e.seasonOutlook,
    },
    model: {
      rank: v.rank, posRank: v.posRank, tier: v.tier, value: r1(v.vorp), overFA: r1(v.overFA), raw: r1(v.raw),
      fppg: v.fppg ?? null, z: v.z ?? null, dollars: v.dollars ?? null, sources: v.sources,
      notes: v.houseNotes || [],
      proj: Object.fromEntries(['GP', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'TO', 'FG%', 'FT%', 'FGA', 'FTA', 'DD', 'TD']
        .map((k) => [k, k.endsWith('%') ? Math.round(v.line[k] * 1000) / 1000 : r1(v.line[k])])),
    },
  };
});

// Validation: contiguous ranks and every position represented in the draftable pool.
const problems = [];
players.forEach((p, i) => { if (p.model.rank !== i + 1) problems.push(`rank gap at ${p.name}`); });
for (const pos of POSITIONS) {
  if (!players.slice(0, valued.drafted).some((p) => p.eligible.includes(pos))) problems.push(`no ${pos} in the top ${valued.drafted}`);
}

const dataset = {
  builtAt: new Date().toISOString(),
  espnFetchedAt: espn.fetchedAt,
  fpFetchedAt: fp.fetchedAt || null,
  source: `Blend ESPN ${ESPN_WEIGHT} / FantasyPros ${1 - ESPN_WEIGHT}`,
  rulesFile: RULES.replace(`${ROOT}/`, ''),
  rules: house.rules,
  replacement: valued.replacement,
  freeAgent: valued.freeAgent,
  players,
};

mkdirSync(P('dist'), { recursive: true });
writeFileSync(P('dist/dataset.json'), JSON.stringify(dataset));
writeFileSync(P('dist/cheatsheet.html'), renderCheatsheet(dataset));
const csvCols = ['rank', 'name', 'team', 'pos', 'eligible', 'tier', 'value', 'fppg', 'espnAdp', 'adpDiff', ...Object.keys(players[0].model.proj)];
writeFileSync(P('dist/rankings.csv'), [csvCols.join(','), ...players.map((p) => [
  p.model.rank, `"${p.name}"`, p.team, p.pos, p.eligible.join('/'), p.model.tier ?? '', p.model.value, p.model.fppg ?? '',
  p.espn.adp != null ? r1(p.espn.adp) : '', p.espn.adp != null ? r1(p.espn.adp - p.model.rank) : '',
  ...Object.values(p.model.proj),
].join(','))].join('\n'));
writeFileSync(P('data/overrides/unmatched-report.txt'),
  `# FantasyPros names with no ESPN match\n${unmatched.join('\n')}\n\n# Fuzzy / ambiguous matches to eyeball\n${fuzzy.join('\n')}\n`);

console.log(`Rules: ${dataset.rulesFile} (${house.rules.scoring.type}, ${house.rules.teams} teams x ${house.rules.rounds} rounds)`);
console.log(`Players: ${players.length} valued, ${fpById.size}/${fp.players.length} FantasyPros matched, ${unmatched.length} unmatched, ${fuzzy.length} fuzzy`);
console.log(`Replacement: ${JSON.stringify(Object.fromEntries(Object.entries(valued.replacement).map(([k, v]) => [k, r1(v)])))}`);
for (const n of house.applied) console.log(`House rule: ${n}`);
if (problems.length) { console.error(`\nFAILED:\n  ${problems.join('\n  ')}`); process.exit(1); }
console.log('Wrote dist/dataset.json, dist/cheatsheet.html, dist/rankings.csv');
