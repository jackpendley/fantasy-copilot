// Blend ESPN's and FantasyPros' season projections into one per-game line per player.
// Pure functions; build-projections.mjs does the IO.

export const SHARED = ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'TO', 'MIN'];
const r = (n) => Math.round(n * 1000) / 1000;

/** FantasyPros gives season totals; convert to per game. */
export function fpPerGame(totals) {
  const gp = totals.GP || 0;
  if (!gp) return null;
  const pg = { GP: gp, 'FG%': totals['FG%'], 'FT%': totals['FT%'] };
  for (const s of SHARED) if (totals[s] != null) pg[s] = totals[s] / gp;
  return pg;
}

/**
 * espn: { perGame, last? } (ESPN projected per-game line, last season's actual per-game line)
 * fp:   FantasyPros per-game line or null
 * w:    weight on ESPN for shared stats (1 = ESPN only)
 * Returns a per-game line with every stat a league could score, plus GP.
 */
export function blendLine(espn, fp, w = 0.5) {
  const e = espn.perGame;
  const out = {};
  const wf = fp ? 1 - w : 0;
  const we = fp ? w : 1;
  const mix = (a, b) => (b == null ? a : a == null ? b : we * a + wf * b);

  out.GP = mix(e.GP, fp?.GP);
  for (const s of SHARED) out[s] = mix(e[s] ?? 0, fp?.[s]);
  const fgPct = mix(e['FG%'] ?? (e.FGA ? e.FGM / e.FGA : 0), fp?.['FG%']);
  const ftPct = mix(e['FT%'] ?? (e.FTA ? e.FTM / e.FTA : 0), fp?.['FT%']);

  // Attempts scale with the blended scoring volume; makes follow from the blended percentages.
  const ptsScale = e.PTS ? out.PTS / e.PTS : 1;
  out.FGA = (e.FGA ?? 0) * ptsScale;
  out.FGM = fgPct * out.FGA;
  out.FTA = (e.FTA ?? 0) * ptsScale;
  out.FTM = ftPct * out.FTA;
  out['3PA'] = e['3PM'] ? (e['3PA'] ?? 0) * (out['3PM'] / e['3PM']) : (e['3PA'] ?? 0);
  out['FG%'] = fgPct;
  out['FT%'] = ftPct;
  out['3P%'] = out['3PA'] ? out['3PM'] / out['3PA'] : 0;

  // Misses, for leagues that penalize them directly.
  out.FGMI = out.FGA - out.FGM;
  out.FTMI = out.FTA - out.FTM;
  out['3PMI'] = out['3PA'] - out['3PM'];

  // ESPN does not project these; carry last season's rates.
  const last = espn.last || {};
  const orebShare = last.REB ? (last.OREB ?? 0) / last.REB : 0.25;
  out.OREB = out.REB * orebShare;
  out.DREB = out.REB - out.OREB;
  const lastGp = last.GP || 0;
  for (const s of ['PF', 'TF', 'EJ', 'FF', 'DQ', 'GS']) {
    out[s] = lastGp && last[s] != null ? last[s] : 0; // already per game in `last`
  }

  // Double/triple-doubles: modeled from this projected line, shrunk toward last season's
  // actual rate in proportion to how many games that rate is built on.
  const m = multiDoubleRates(out);
  const wLast = lastGp ? lastGp / (lastGp + 30) : 0;
  out.DD = wLast * (last.DD ?? 0) + (1 - wLast) * m.dd;
  out.TD = wLast * (last.TD ?? 0) + (1 - wLast) * m.td;
  out.QD = lastGp && last.QD != null ? last.QD : 0;
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, r(v)]));
}

// Standard normal CDF (Abramowitz & Stegun 7.1.26 erf).
function normalCdf(x) {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/**
 * Per-game chance of a double-double / triple-double from a per-game line. Each of
 * PTS/REB/AST/BLK/STL is treated as an independent normal with sd = 1.2 * sqrt(mean)
 * (fit to 2025-26 actuals: predicted league DD/game 26.0 vs 25.6 actual over 251 players).
 */
export function multiDoubleRates(line, k = 1.2) {
  const ps = ['PTS', 'REB', 'AST', 'BLK', 'STL'].map((s) => {
    const m = line[s] ?? 0;
    return m <= 0 ? 0 : 1 - normalCdf((9.5 - m) / (k * Math.sqrt(m)));
  });
  const others = (skip) => ps.reduce((a, p, i) => (skip.includes(i) ? a : a * (1 - p)), 1);
  const p0 = others([]);
  let p1 = 0; let p2 = 0;
  for (let i = 0; i < 5; i++) {
    p1 += ps[i] * others([i]);
    for (let j = i + 1; j < 5; j++) p2 += ps[i] * ps[j] * others([i, j]);
  }
  return { dd: Math.max(0, 1 - p0 - p1), td: Math.max(0, 1 - p0 - p1 - p2) };
}
