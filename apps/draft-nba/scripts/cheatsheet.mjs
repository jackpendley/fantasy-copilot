// Printable cheat sheet: the draft-day fallback if the extension misbehaves.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const one = (n) => (n == null ? '' : Number(n).toFixed(1));

export function renderCheatsheet(dataset, { top = 220 } = {}) {
  const { rules } = dataset;
  const points = rules.scoring.type === 'points';
  const cats = points ? [] : rules.scoring.categories.filter((c) => !(rules.scoring.punt || []).includes(c));
  const rows = dataset.players.slice(0, top).map((p) => {
    const diff = p.espn.adp != null ? p.espn.adp - p.model.rank : null;
    const cls = diff == null ? '' : diff >= 12 ? 'value' : diff <= -12 ? 'reach' : '';
    const pj = p.model.proj;
    const statCells = points
      ? `<td>${one(p.model.fppg)}</td>`
      : cats.map((c) => `<td class="${(p.model.z?.[c] ?? 0) >= 1 ? 'hi' : (p.model.z?.[c] ?? 0) <= -1 ? 'lo' : ''}">${one(p.model.z?.[c])}</td>`).join('');
    const inj = p.espn.injuryStatus && p.espn.injuryStatus !== 'ACTIVE' ? ` <span class="inj">${esc(p.espn.injuryStatus)}</span>` : '';
    return `<tr class="t${(p.model.tier ?? 0) % 2} ${cls}"><td>${p.model.rank}</td><td class="nm"><input type="checkbox"> ${esc(p.name)}${inj}</td>`
      + `<td>${esc(p.team)}</td><td>${esc(p.eligible.join('/'))}</td><td>${p.model.tier ?? ''}</td><td>${one(p.model.value)}</td>${statCells}`
      + `<td>${one(p.espn.adp)}</td><td>${diff == null ? '' : (diff > 0 ? '+' : '') + one(diff)}</td>`
      + `<td>${one(pj.GP)}</td><td>${one(pj.MIN)}</td><td>${one(pj.PTS)}</td><td>${one(pj.REB)}</td><td>${one(pj.AST)}</td><td>${one(pj.STL)}</td><td>${one(pj.BLK)}</td><td>${one(pj['3PM'])}</td><td>${one(pj.TO)}</td>`
      + `<td>${pj['FG%']?.toFixed(3) ?? ''}</td><td>${pj['FT%']?.toFixed(3) ?? ''}</td>${p.model.dollars != null ? `<td>$${p.model.dollars}</td>` : ''}</tr>`;
  }).join('\n');
  const statHead = points ? '<th>FP/G</th>' : cats.map((c) => `<th>z${esc(c)}</th>`).join('');
  const scoring = points
    ? Object.entries(rules.scoring.points).map(([k, v]) => `${esc(k)} ${v > 0 ? '+' : ''}${v}`).join(' · ')
    : `Categories: ${cats.map(esc).join(', ')}${rules.scoring.punt?.length ? ` (punting ${rules.scoring.punt.map(esc).join(', ')})` : ''}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Hoops Cheat Sheet</title><style>
body{font:11px/1.25 -apple-system,system-ui,sans-serif;margin:16px;color:#111;background:#fff}
h1{font-size:16px;margin:0 0 4px}.sub{color:#555;margin-bottom:8px}
table{border-collapse:collapse;width:100%}th,td{padding:2px 4px;text-align:right;white-space:nowrap}
th{position:sticky;top:0;background:#222;color:#fff}td.nm{text-align:left}td:nth-child(3),td:nth-child(4){text-align:left}
tr.t1{background:#f1f4f8}tr.value td:nth-child(2){color:#0a7a2f;font-weight:600}tr.reach td:nth-child(2){color:#b42318}
td.hi{color:#0a7a2f;font-weight:600}td.lo{color:#b42318}.inj{color:#b42318;font-size:9px}
@media print{body{margin:4mm}th{background:#ddd;color:#000}}
</style></head><body><h1>Draft cheat sheet: ${esc(rules.source?.name || 'league')} (${rules.teams} teams, ${rules.rounds} rounds)</h1>
<div class="sub">${scoring}. ${esc(dataset.source)}, built ${esc(dataset.builtAt.slice(0, 16).replace('T', ' '))}. Value is over replacement; green name = ESPN ADP 12+ picks later than our rank (value), red = 12+ earlier (we're lower). Shaded bands are tiers.</div>
<table><thead><tr><th>#</th><th style="text-align:left">Player</th><th>Tm</th><th>Pos</th><th>Tier</th><th>Value</th>${statHead}<th>ADP</th><th>ADP−#</th><th>GP</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>3PM</th><th>TO</th><th>FG%</th><th>FT%</th>${dataset.players[0]?.model.dollars != null ? '<th>$</th>' : ''}</tr></thead>
<tbody>${rows}</tbody></table></body></html>`;
}
