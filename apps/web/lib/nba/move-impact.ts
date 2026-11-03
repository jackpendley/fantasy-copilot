// What a roster move did (pure): the team's odds in the Outlook runs just before and after it,
// the fantasy points the players in and out scored after it, and injury games missed.

export interface RunOdds {
  runAt: number;
  /** Per team: title, playoffs and expected wins. */
  teams: Map<number, { champ: number; playoffs: number; expWins: number }>;
}

export interface AtTheTime {
  before: number;
  after: number;
  champ: number;
  playoffs: number;
  expWins: number;
  /**
   * Only this move between the two runs, and they're within 3 hours of it: the change is the
   * move's. Otherwise other moves or results are mixed in.
   */
  clean: boolean;
}

const CLEAN_GAP_MS = 3 * 3600_000;

/**
 * The team's odds change from the last run before `at` to the first run after it. `movesAt`
 * are the times of every league roster move (any team), to tell whether others fell between.
 */
export function oddsAroundMove(
  runs: RunOdds[],
  teamId: number,
  at: number,
  movesAt: number[],
): AtTheTime | null {
  let before: RunOdds | null = null;
  let after: RunOdds | null = null;
  for (const r of runs) {
    if (r.runAt < at && (!before || r.runAt > before.runAt)) before = r;
    if (r.runAt > at && (!after || r.runAt < after.runAt)) after = r;
  }
  const b = before?.teams.get(teamId);
  const a = after?.teams.get(teamId);
  if (!before || !after || !a || !b) return null;
  const others = movesAt.filter((t) => t > before.runAt && t < after.runAt && t !== at).length;
  return {
    before: before.runAt,
    after: after.runAt,
    champ: a.champ - b.champ,
    playoffs: a.playoffs - b.playoffs,
    expWins: a.expWins - b.expWins,
    clean: others === 0 && after.runAt - before.runAt <= CLEAN_GAP_MS,
  };
}

export interface ScoredGame {
  /** Tip-off, epoch ms. */
  tip: number;
  fp: number;
  minutes: number;
}

/** Fantasy points and games played in games that tipped after `from` (and before `until`). */
export function pointsBetween(games: ScoredGame[], from: number, until = Infinity) {
  let points = 0;
  let played = 0;
  for (const g of games) {
    if (g.tip <= from || g.tip >= until || g.minutes <= 0) continue;
    points += g.fp;
    played++;
  }
  return { points, games: played };
}

/**
 * Team games he missed while on this roster: his NBA team's games that tipped between `from`
 * and `until` that aren't in his game log as played (matched by ESPN game id).
 */
export function gamesMissed(
  teamGames: { gameId: number; tip: number }[],
  playedIds: number[],
  from: number,
  until: number,
) {
  const his = new Set(playedIds);
  return teamGames.filter((g) => g.tip > from && g.tip < until && !his.has(g.gameId)).length;
}

export interface MoveLike {
  teamId: number;
  at: number;
  adds: number[];
  drops: number[];
}

/**
 * When each player a team added left that roster again (its next drop or trade of him), so
 * his points count only while he was there. Keyed by `${moveIndex}:${playerId}`.
 */
export function stintEnds(moves: MoveLike[]): Map<string, number> {
  const out = new Map<string, number>();
  moves.forEach((m, i) => {
    for (const id of m.adds) {
      const left = moves.find(
        (n, j) => j > i && n.teamId === m.teamId && n.at > m.at && n.drops.includes(id),
      );
      out.set(`${i}:${id}`, left?.at ?? Infinity);
    }
  });
  return out;
}
