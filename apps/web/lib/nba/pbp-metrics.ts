// Advanced stats from PBP Stats' season totals, with each player's league percentile among
// regulars (at least 10 minutes a game). Pure. Style stats (3-point rate, unassisted points,
// shot quality: the expected eFG% of his shot mix, low for high-volume 3-point shooters) get a
// percentile but no good/bad color.

/** The raw PBP Stats fields kept per player-season (pbp_players.stats). */
export const PBP_FIELDS = [
  "GamesPlayed",
  "Minutes",
  "Points",
  "Assists",
  "Rebounds",
  "OffRebounds",
  "DefRebounds",
  "Steals",
  "Blocks",
  "Turnovers",
  "Fouls",
  "FoulsDrawn",
  "PlusMinus",
  "OnOffRtg",
  "OnDefRtg",
  "Usage",
  "TsPct",
  "EfgPct",
  "ShotQualityAvg",
  "FG3APct",
  "PtsUnassisted2s",
  "PtsUnassisted3s",
  "PtsPutbacks",
  "SecondChancePoints",
] as const;

export type PbpStats = Partial<Record<(typeof PBP_FIELDS)[number], number>>;

type Better = "high" | "low" | null;

interface MetricDef {
  key: string;
  label: string;
  group: "Scoring" | "Playmaking" | "Rebounding & defense" | "Impact" | "Style";
  better: Better;
  value: (s: PbpStats) => number | null;
  format: (v: number) => string;
}

const per36 = (k: keyof PbpStats) => (s: PbpStats) =>
  s[k] != null && s.Minutes ? (s[k]! / s.Minutes) * 36 : null;
const pct1 = (v: number) => `${v.toFixed(1)}%`;
const one = (v: number) => v.toFixed(1);

export const METRICS: MetricDef[] = [
  {
    key: "usage",
    label: "Usage",
    group: "Scoring",
    better: "high",
    value: (s) => s.Usage ?? null,
    format: pct1,
  },
  {
    key: "ts",
    label: "True shooting",
    group: "Scoring",
    better: "high",
    value: (s) => (s.TsPct != null ? s.TsPct * 100 : null),
    format: pct1,
  },
  {
    key: "efg",
    label: "Effective FG",
    group: "Scoring",
    better: "high",
    value: (s) => (s.EfgPct != null ? s.EfgPct * 100 : null),
    format: pct1,
  },
  {
    key: "pts36",
    label: "Points / 36",
    group: "Scoring",
    better: "high",
    value: per36("Points"),
    format: one,
  },
  {
    key: "drawn36",
    label: "Fouls drawn / 36",
    group: "Scoring",
    better: "high",
    value: per36("FoulsDrawn"),
    format: one,
  },
  {
    key: "ast36",
    label: "Assists / 36",
    group: "Playmaking",
    better: "high",
    value: per36("Assists"),
    format: one,
  },
  {
    key: "tov36",
    label: "Turnovers / 36",
    group: "Playmaking",
    better: "low",
    value: per36("Turnovers"),
    format: one,
  },
  {
    key: "reb36",
    label: "Rebounds / 36",
    group: "Rebounding & defense",
    better: "high",
    value: per36("Rebounds"),
    format: one,
  },
  {
    key: "oreb36",
    label: "Off. rebounds / 36",
    group: "Rebounding & defense",
    better: "high",
    value: per36("OffRebounds"),
    format: one,
  },
  {
    key: "stl36",
    label: "Steals / 36",
    group: "Rebounding & defense",
    better: "high",
    value: per36("Steals"),
    format: one,
  },
  {
    key: "blk36",
    label: "Blocks / 36",
    group: "Rebounding & defense",
    better: "high",
    value: per36("Blocks"),
    format: one,
  },
  {
    key: "fouls36",
    label: "Fouls / 36",
    group: "Rebounding & defense",
    better: "low",
    value: per36("Fouls"),
    format: one,
  },
  {
    key: "net",
    label: "Net rating on court",
    group: "Impact",
    better: "high",
    value: (s) => (s.OnOffRtg != null && s.OnDefRtg != null ? s.OnOffRtg - s.OnDefRtg : null),
    format: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`,
  },
  {
    key: "pm36",
    label: "+/− per 36",
    group: "Impact",
    better: "high",
    value: per36("PlusMinus"),
    format: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`,
  },
  {
    key: "threeRate",
    label: "3-point rate",
    group: "Style",
    better: null,
    value: (s) => (s.FG3APct != null ? s.FG3APct * 100 : null),
    format: (v) => `${v.toFixed(0)}%`,
  },
  {
    key: "selfCreated",
    label: "Unassisted points",
    group: "Style",
    better: null,
    value: (s) =>
      s.Points ? (((s.PtsUnassisted2s ?? 0) + (s.PtsUnassisted3s ?? 0)) / s.Points) * 100 : null,
    format: (v) => `${v.toFixed(0)}%`,
  },
  {
    key: "shotQuality",
    label: "Shot quality",
    group: "Style",
    better: null,
    value: (s) => (s.ShotQualityAvg != null ? s.ShotQualityAvg * 100 : null),
    format: pct1,
  },
];

/** Regulars: at least 10 minutes a game, and enough games for this point of the season. */
export function qualified(s: PbpStats, minGames: number): boolean {
  return (
    (s.GamesPlayed ?? 0) >= minGames && (s.Minutes ?? 0) / Math.max(1, s.GamesPlayed ?? 0) >= 10
  );
}

/** Games needed to count: 5, or fewer early in the season (40% of the most anyone has). */
export function minGamesFor(all: PbpStats[]): number {
  const most = Math.max(0, ...all.map((s) => s.GamesPlayed ?? 0));
  return Math.max(1, Math.min(5, Math.ceil(most * 0.4)));
}

export interface Distributions {
  /** Games a regular needs at this point of the season. */
  minGames: number;
  values: Map<string, number[]>;
}

/** Each metric's sorted values among regulars. */
export function distributions(all: PbpStats[]): Distributions {
  const min = minGamesFor(all);
  const pool = all.filter((s) => qualified(s, min));
  return {
    minGames: min,
    values: new Map(
      METRICS.map((m) => [
        m.key,
        pool
          .map(m.value)
          .filter((v): v is number => v != null && Number.isFinite(v))
          .sort((a, b) => a - b),
      ]),
    ),
  };
}

/** Share of values at or below `v` (0-100), counting ties half. */
export function percentileOf(sorted: number[], v: number): number | null {
  if (!sorted.length) return null;
  let below = 0;
  let equal = 0;
  for (const x of sorted) {
    if (x < v) below++;
    else if (x === v) equal++;
  }
  return ((below + equal / 2) / sorted.length) * 100;
}

export interface PlayerMetric {
  key: string;
  label: string;
  group: MetricDef["group"];
  value: string;
  /** League percentile (higher = better for this stat; null when it isn't good or bad). */
  percentile: number | null;
  /** "good" at the 80th percentile or better, "bad" at the 20th or worse. */
  tone: "good" | "bad" | null;
  /** Good or bad at all (false for style stats like 3-point rate). */
  rated: boolean;
}

/**
 * A player's metrics with percentiles, oriented so a high percentile is always better. A
 * player who isn't a regular himself (too few games or minutes) gets his numbers without
 * percentiles: a few minutes say little.
 */
export function playerMetrics(s: PbpStats, dist: Distributions): PlayerMetric[] {
  const ranked = qualified(s, dist.minGames);
  const out: PlayerMetric[] = [];
  for (const m of METRICS) {
    const v = m.value(s);
    if (v == null || !Number.isFinite(v)) continue;
    const raw = ranked ? percentileOf(dist.values.get(m.key) ?? [], v) : null;
    const p = raw == null ? null : m.better === "low" ? 100 - raw : raw;
    out.push({
      key: m.key,
      label: m.label,
      group: m.group,
      value: m.format(v),
      percentile: p == null ? null : Math.round(p),
      tone: p == null || m.better == null ? null : p >= 80 ? "good" : p <= 20 ? "bad" : null,
      rated: m.better != null,
    });
  }
  return out;
}
