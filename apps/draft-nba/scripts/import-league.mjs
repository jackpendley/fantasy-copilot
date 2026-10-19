#!/usr/bin/env node
// Converts a saved ESPN league response (view=mSettings&view=mTeam&view=mDraftDetail, saved
// from a signed-in browser because the league is private) into data/local/league-rules.json.
// House rules from the group chat are layered on top in that file's `house` section by hand;
// re-importing keeps them.
//
//   node scripts/import-league.mjs ~/Downloads/league-322514556.json

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { STAT_BY_ID, SLOT_BY_ID } from '../src/core/espn-constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data/local/league-rules.json');

export function rulesFromLeague(data) {
  const s = data.settings || {};
  const sc = s.scoringSettings || {};
  const items = sc.scoringItems || [];
  const isPoints = /POINTS/.test(sc.scoringType || '');
  const statName = (id) => STAT_BY_ID[id] || `STAT${id}`;

  const roster = {};
  for (const [id, n] of Object.entries(s.rosterSettings?.lineupSlotCounts || {})) {
    if (n > 0) roster[SLOT_BY_ID[id] || `SLOT${id}`] = n;
  }
  const rounds = Object.entries(roster).filter(([k]) => k !== 'IR').reduce((a, [, n]) => a + n, 0);
  const d = s.draftSettings || {};
  return {
    source: { leagueId: data.id, season: data.seasonId, name: s.name, importedAt: new Date().toISOString() },
    teams: (data.teams || []).length || s.size,
    roster,
    rounds,
    scoringType: sc.scoringType,
    scoring: isPoints
      ? { type: 'points', points: Object.fromEntries(items.map((i) => [statName(i.statId), i.points])) }
      : {
        type: 'categories',
        categories: items.map((i) => statName(i.statId)),
        reverse: items.filter((i) => i.isReverseItem).map((i) => statName(i.statId)),
        punt: [],
      },
    draft: {
      type: d.type, date: d.date ? new Date(d.date).toISOString() : null,
      keeperCount: d.keeperCount ?? 0, auctionBudget: d.auctionBudget ?? null, pickOrder: d.pickOrder || [],
      orderType: d.orderType,
    },
    auction: d.type === 'AUCTION' ? { budget: d.auctionBudget } : undefined,
    acquisition: s.acquisitionSettings || null,
    schedule: { matchupPeriodCount: s.scheduleSettings?.matchupPeriodCount, playoffTeamCount: s.scheduleSettings?.playoffTeamCount },
    lineupLimits: { maxGamesPerMatchup: s.rosterSettings?.positionLimits ?? null, raw: s.rosterSettings || null },
    basis: 'season',
    teamsById: Object.fromEntries((data.teams || []).map((t) => [t.id, t.name || `${t.location || ''} ${t.nickname || ''}`.trim()])),
  };
}

function main() {
  const file = process.argv[2];
  if (!file || !existsSync(file)) { console.error('usage: import-league.mjs <saved league json>'); process.exit(1); }
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (data.messages) { console.error(`ESPN error in file: ${data.messages.join('; ')}`); process.exit(1); }
  const rules = rulesFromLeague(data);
  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
  if (prev.house) rules.house = prev.house;
  if (prev.basis) rules.basis = prev.basis;
  if (prev.scoring?.punt && rules.scoring.type === 'categories') rules.scoring.punt = prev.scoring.punt;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(rules, null, 2)}\n`);
  console.log(`Wrote ${OUT}`);
  console.log(`  ${rules.teams} teams, ${rules.rounds} rounds, ${rules.scoringType}, draft ${rules.draft.type} ${rules.draft.date || ''}`);
  console.log(`  roster ${JSON.stringify(rules.roster)}`);
  console.log(`  scoring ${JSON.stringify(rules.scoring.points || rules.scoring.categories)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
