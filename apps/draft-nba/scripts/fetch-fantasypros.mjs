#!/usr/bin/env node
// Pulls FantasyPros' consensus season projections (season totals) into data/cache/fantasypros.json.
// It is a second opinion blended with ESPN's projections in build-projections.mjs.

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeTeam } from '../src/core/espn-constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data/cache/fantasypros.json');
const URL = 'https://www.fantasypros.com/nba/projections/overall.php';

const num = (s) => {
  const v = Number(String(s).replace(/,/g, '').trim());
  return Number.isFinite(v) ? v : null;
};

export function parseFantasyPros(html) {
  const head = html.match(/<thead>[\s\S]*?<\/thead>/)?.[0] || '';
  const cols = [...head.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1].trim()).slice(1);
  if (!cols.includes('PTS') || !cols.includes('GP')) throw new Error(`Unexpected columns: ${cols.join(',')}`);
  const body = html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0] || '';
  const rows = [];
  for (const tr of body.split('</tr>')) {
    const name = tr.match(/fp-player-name="([^"]+)"/)?.[1];
    if (!name) continue;
    const meta = tr.match(/<small>\(([^)]*)\)<\/small>/)?.[1] || '';
    const [team, pos] = meta.split(' - ').map((s) => s.trim());
    const cells = [...tr.matchAll(/<td class="center">([^<]*)<\/td>/g)].map((m) => num(m[1]));
    const totals = Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
    rows.push({ name, team: normalizeTeam(team), pos: (pos || '').split(','), totals });
  }
  return rows;
}

async function main() {
  const res = await fetch(URL, { headers: { 'user-agent': 'Mozilla/5.0 espn-hoops-copilot/0.1' } });
  if (!res.ok) throw new Error(`FantasyPros returned HTTP ${res.status}`);
  const html = await res.text();
  const players = parseFantasyPros(html);
  const updated = html.match(/Consensus last updated ([^<]+)/)?.[1]?.trim() || null;
  if (players.length < 150) throw new Error(`Only parsed ${players.length} players; page layout may have changed`);
  await mkdir(join(ROOT, 'data/cache'), { recursive: true });
  await writeFile(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), updated, count: players.length, players }, null, 2));
  process.stdout.write(`Wrote ${players.length} FantasyPros projections (updated ${updated}) to ${OUT}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
