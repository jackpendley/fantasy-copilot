#!/usr/bin/env node
// Pulls the current-season ESPN fantasy player universe (public, no auth) into data/cache/espn-players.json.
// Run this again close to draft day so ADP is fresh.

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  PLAYER_UNIVERSE_URL, POSITION_BY_ID, PRO_TEAM_BY_ID, STAT_BY_ID, SLOT_BY_ID, POSITIONAL_SLOT_IDS, SEASON,
} from '../src/core/espn-constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data/cache/espn-players.json');
const LIMIT = 700; // every rostered-in-some-league NBA player

const filter = {
  players: {
    limit: LIMIT,
    // A sort key is mandatory; ESPN 400s without one.
    sortPercOwned: { sortAsc: false, sortPriority: 1 },
  },
};

// ESPN stat entry ids: `10${season}` = projected season (statSourceId 1),
// `00${season}` = actual season totals.
function statLine(p, id) {
  const e = (p.stats || []).find((s) => s.id === id);
  if (!e || !e.stats || !Object.keys(e.stats).length) return null;
  const named = (obj) => Object.fromEntries(
    Object.entries(obj || {}).filter(([k]) => STAT_BY_ID[k]).map(([k, v]) => [STAT_BY_ID[k], v]),
  );
  return { totals: named(e.stats), perGame: named(e.averageStats) };
}

async function main() {
  process.stdout.write(`Fetching up to ${LIMIT} players from ESPN...\n`);
  const res = await fetch(PLAYER_UNIVERSE_URL, {
    headers: {
      accept: 'application/json',
      'x-fantasy-filter': JSON.stringify(filter),
      // ESPN rejects requests with no UA from some networks.
      'user-agent': 'espn-hoops-copilot/0.1',
    },
  });
  if (!res.ok) throw new Error(`ESPN returned HTTP ${res.status} ${res.statusText}`);

  const body = await res.json();
  const raw = body.players || [];

  const players = raw.map((entry) => {
    const p = entry.player || {};
    const own = p.ownership || {};
    return {
      espnId: p.id,
      name: p.fullName,
      firstName: p.firstName,
      lastName: p.lastName,
      pos: POSITION_BY_ID[p.defaultPositionId] || `POS${p.defaultPositionId}`,
      team: PRO_TEAM_BY_ID[p.proTeamId] ?? 'FA',
      proTeamId: p.proTeamId,
      eligibleSlots: p.eligibleSlots || [],
      eligible: (p.eligibleSlots || []).filter((id) => POSITIONAL_SLOT_IDS.includes(id)).map((id) => SLOT_BY_ID[id]),
      injuryStatus: p.injuryStatus || null,
      injured: !!p.injured,
      adp: own.averageDraftPosition ?? null,
      adpChange: own.averageDraftPositionPercentChange ?? null,
      percentOwned: own.percentOwned ?? null,
      auctionValue: own.auctionValueAverage ?? null,
      espnPointsRank: p.draftRanksByRankType?.STANDARD?.rank ?? null,
      espnRotoRank: p.draftRanksByRankType?.ROTO?.rank ?? null,
      seasonOutlook: p.seasonOutlook || null,
      proj: statLine(p, `10${SEASON}`),
      last: statLine(p, `00${SEASON - 1}`),
    };
  })
  // Drop players with no ADP and no meaningful ownership: they are undraftable noise.
    .filter((p) => p.adp != null || (p.percentOwned ?? 0) > 0.5 || p.proj);

  await mkdir(join(ROOT, 'data/cache'), { recursive: true });
  await writeFile(OUT, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    count: players.length,
    players,
  }, null, 2));

  const byPos = players.reduce((acc, p) => { acc[p.pos] = (acc[p.pos] || 0) + 1; return acc; }, {});
  process.stdout.write(`Wrote ${players.length} players to ${OUT}\n`);
  process.stdout.write(`  ${Object.entries(byPos).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ')}\n`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
