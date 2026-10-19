// League-rules-driven player valuation: fantasy points (points leagues) or
// z-scores (category / roto leagues), then value over replacement by position.
// Pure: rules + per-game projection lines in, ranked values out.

export const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
const PCT = { 'FG%': ['FGM', 'FGA'], 'FT%': ['FTM', 'FTA'], '3P%': ['3PM', '3PA'] };
const NEGATIVE = new Set(['TO', 'PF', 'TF', 'EJ', 'FF', 'DQ']);

/** Fantasy points per game from a per-game line and a { STAT: points } map. */
export function fantasyPointsPerGame(line, points) {
  let total = 0;
  for (const [stat, pts] of Object.entries(points)) total += (line[stat] ?? 0) * pts;
  return total;
}

/** Number of starting lineup spots per team (everything except bench and IR). */
export function startersPerTeam(roster) {
  return Object.entries(roster).filter(([s]) => s !== 'BE' && s !== 'IR').reduce((a, [, n]) => a + n, 0);
}

function meanSd(xs) {
  const m = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length || 1);
  return { m, sd: Math.sqrt(v) || 1 };
}

/**
 * Category z-scores. `scale(p)` turns a per-game stat into the basis being valued
 * (per game, or per game x GP for season volume). Percentage categories are
 * volume-weighted: (pct - pool pct) x attempts. Negative categories flip sign.
 * The pool (who the means/sds come from) is re-estimated twice from the top `poolSize`.
 */
export function categoryScores(players, categories, { poolSize, scale = () => 1, punt = [] }) {
  const cats = categories.filter((c) => !punt.includes(c));
  const raw = (p, c) => {
    if (PCT[c]) return null;
    return (p.line[c] ?? 0) * scale(p);
  };
  let pool = players.slice(0, poolSize);
  let z = new Map();
  for (let iter = 0; iter < 3; iter++) {
    const stats = {};
    for (const c of cats) {
      if (PCT[c]) {
        const [mk, at] = PCT[c];
        const made = pool.reduce((a, p) => a + (p.line[mk] ?? 0) * scale(p), 0);
        const att = pool.reduce((a, p) => a + (p.line[at] ?? 0) * scale(p), 0);
        const lgPct = att ? made / att : 0;
        const impact = (p) => ((p.line[mk] ?? 0) - lgPct * (p.line[at] ?? 0)) * scale(p);
        stats[c] = { impact, ...meanSd(pool.map(impact)) };
      } else {
        stats[c] = { impact: (p) => raw(p, c), ...meanSd(pool.map((p) => raw(p, c))) };
      }
    }
    z = new Map(players.map((p) => {
      const byCat = {};
      let total = 0;
      for (const c of cats) {
        const s = stats[c];
        let v = (s.impact(p) - s.m) / s.sd;
        if (NEGATIVE.has(c)) v = -v;
        byCat[c] = Math.round(v * 100) / 100;
        total += v;
      }
      return [p.id, { total, byCat }];
    }));
    pool = [...players].sort((a, b) => z.get(b.id).total - z.get(a.id).total).slice(0, poolSize);
  }
  return z;
}

// Which positions each lineup slot accepts.
export const SLOT_ACCEPTS = {
  PG: ['PG'], SG: ['SG'], SF: ['SF'], PF: ['PF'], C: ['C'],
  G: ['PG', 'SG'], F: ['SF', 'PF'], 'SG/SF': ['SG', 'SF'], 'G/F': ['PG', 'SG', 'SF'],
  'PF/C': ['PF', 'C'], 'F/C': ['SF', 'PF', 'C'], UTIL: POSITIONS,
};

/**
 * Lineup-aware replacement level. Fill every team's starting slots league-wide in value
 * order, each player into the most restrictive open slot he is eligible for. A position's
 * replacement level is the best player at that position left without a starting slot:
 * once the league's C and UTIL slots are full, the next center is only a bench piece, no
 * matter how good his raw line is. This is what keeps one position from flooding the top.
 */
export function slotReplacementLevels(players, teams, roster) {
  const open = Object.entries(roster)
    .filter(([s, n]) => SLOT_ACCEPTS[s] && n > 0)
    .map(([s, n]) => ({ slot: s, left: n * teams }))
    .sort((a, b) => SLOT_ACCEPTS[a.slot].length - SLOT_ACCEPTS[b.slot].length);
  const sorted = [...players].sort((a, b) => b.raw - a.raw);
  const level = {};
  const starters = new Set();
  for (const p of sorted) {
    const o = open.find((x) => x.left > 0 && SLOT_ACCEPTS[x.slot].some((pos) => p.eligible.includes(pos)));
    if (o) { o.left--; starters.add(p.id); continue; }
    for (const pos of p.eligible) if (level[pos] == null) level[pos] = p.raw;
    if (POSITIONS.every((pos) => level[pos] != null)) break;
  }
  for (const pos of POSITIONS) if (level[pos] == null) level[pos] = 0;
  return level;
}

/**
 * Replacement level by position: rank everyone by raw value, treat the top
 * `drafted` as rostered, and take the best remaining player eligible at each position.
 * A player's replacement is the lowest across his eligible positions (his most
 * valuable position assignment).
 */
export function replacementLevels(players, drafted) {
  const sorted = [...players].sort((a, b) => b.raw - a.raw);
  const rest = sorted.slice(drafted);
  const level = {};
  for (const pos of POSITIONS) {
    const best = rest.find((p) => p.eligible.includes(pos));
    level[pos] = best ? best.raw : (rest[0]?.raw ?? 0);
  }
  return level;
}

/** Split a value-sorted list into tiers wherever the gap to the next player is unusually big. */
export function assignTiers(values, { factor = 2.5, minSize = 3 } = {}) {
  const gaps = values.slice(1).map((v, i) => values[i] - v).filter((g) => g >= 0);
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const median = sortedGaps[Math.floor(sortedGaps.length / 2)] || 0;
  const tiers = [];
  let tier = 1; let size = 0;
  values.forEach((v, i) => {
    if (i > 0 && size >= minSize && values[i - 1] - v > factor * median) { tier++; size = 0; }
    tiers.push(tier);
    size++;
  });
  return tiers;
}

/**
 * rules: { scoring:{ type:'points'|'categories', points?, categories?, punt? },
 *          teams, roster:{SLOT:n}, rounds, basis:'season'|'perGame', auction?:{budget} }
 * players: [{ id, eligible:[POS], line:{per-game stats incl. GP} }]
 * Returns players with { raw, vorp, rank, tier, posRank, fppg?, z?, dollars? }, sorted by vorp.
 */
export function valuePlayers(players, rules) {
  const teams = rules.teams;
  const starters = teams * startersPerTeam(rules.roster);
  const drafted = teams * rules.rounds;
  const seasonBasis = rules.basis !== 'perGame';
  const gpScale = (p) => (seasonBasis ? (p.line.GP ?? 0) : 1);

  let scored;
  if (rules.scoring.type === 'points') {
    scored = players.map((p) => {
      const fppg = fantasyPointsPerGame(p.line, rules.scoring.points);
      return { ...p, fppg: Math.round(fppg * 100) / 100, raw: fppg * gpScale(p) };
    });
  } else {
    const prelim = [...players].sort((a, b) => (b.line.MIN ?? 0) * gpScale(b) - (a.line.MIN ?? 0) * gpScale(a));
    const z = categoryScores(prelim, rules.scoring.categories, {
      poolSize: starters,
      // Season volume relative to a full-ish season, so z stays on a per-game-like scale.
      scale: (p) => (seasonBasis ? (p.line.GP ?? 0) / 70 : 1),
      punt: rules.scoring.punt || [],
    });
    scored = players.map((p) => ({ ...p, z: z.get(p.id).byCat, raw: z.get(p.id).total }));
  }

  // Lineup-aware when the roster has real slots; the plain top-N cut otherwise.
  const level = Object.keys(rules.roster || {}).some((k) => SLOT_ACCEPTS[k])
    ? slotReplacementLevels(scored, teams, rules.roster)
    : replacementLevels(scored, drafted);
  // Free-agent level: the best player at each position left after every roster is full.
  // That is what an empty starting slot actually gets filled with in-season.
  const fa = replacementLevels(scored, drafted);
  for (const p of scored) {
    const pos = p.eligible.length ? p.eligible : POSITIONS;
    p.vorp = p.raw - Math.min(...pos.map((x) => level[x]));
    p.overFA = p.raw - Math.min(...pos.map((x) => fa[x]));
  }
  scored.sort((a, b) => b.vorp - a.vorp);
  const tiers = assignTiers(scored.slice(0, drafted).map((p) => p.vorp));
  const posCount = {};
  scored.forEach((p, i) => {
    p.rank = i + 1;
    p.tier = tiers[i] ?? null;
    const pos = p.pos || p.eligible[0];
    posCount[pos] = (posCount[pos] || 0) + 1;
    p.posRank = posCount[pos];
  });

  if (rules.auction?.budget) {
    const pool = scored.slice(0, drafted).filter((p) => p.vorp > 0);
    const sum = pool.reduce((a, p) => a + p.vorp, 0);
    const spendable = rules.auction.budget * teams - drafted; // $1 minimum per roster spot
    for (const p of scored) p.dollars = p.vorp > 0 && sum ? Math.round(1 + (p.vorp / sum) * spendable) : 1;
  }
  return { players: scored, replacement: level, freeAgent: fa, starters, drafted };
}
