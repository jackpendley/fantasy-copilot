// Per-player source split for uncertainty: fppg from ESPN-only and FantasyPros-weighted lines.
import { readFileSync, writeFileSync } from 'node:fs';
import { blendLine, fpPerGame } from '../../src/core/projections.js';
import { fantasyPointsPerGame } from '../../src/core/value.js';
import { normalizeName } from '../../src/core/names.js';
const R = new URL('../../', import.meta.url).pathname;
const espn = JSON.parse(readFileSync(R + 'data/cache/espn-players.json', 'utf8'));
const fp = JSON.parse(readFileSync(R + 'data/cache/fantasypros.json', 'utf8'));
const rules = JSON.parse(readFileSync(R + 'data/local/league-rules.json', 'utf8'));
const fpBy = new Map();
for (const f of fp.players) fpBy.set(`${normalizeName(f.name)}|${f.team}`, f);
const fpByName = new Map(); for (const f of fp.players) fpByName.set(normalizeName(f.name), f);
const out = {};
for (const p of espn.players.filter((x) => x.proj?.perGame?.GP)) {
  const f = fpBy.get(`${normalizeName(p.name)}|${p.team}`) || fpByName.get(normalizeName(p.name));
  const base = { perGame: p.proj.perGame, last: p.last?.perGame };
  const e = fantasyPointsPerGame(blendLine(base, null, 1), rules.scoring.points);
  const fl = f ? fantasyPointsPerGame(blendLine(base, fpPerGame(f.totals), 0), rules.scoring.points) : null;
  out[p.espnId] = { e, f: fl, rookie: !(p.last?.perGame?.GP > 0), lastGp: p.last?.perGame?.GP ?? 0, proTeamId: p.proTeamId };
}
writeFileSync(process.argv[2], JSON.stringify(out));
const vals = Object.values(out).filter((x) => x.f);
console.log('players', Object.keys(out).length, 'with FP', vals.length, 'rookies', Object.values(out).filter((x) => x.rookie).length);
