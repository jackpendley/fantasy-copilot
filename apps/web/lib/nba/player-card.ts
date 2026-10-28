import "server-only";
// Everything the player card shows, in one serializable object: who he is, his next game and
// its projections (ours, ESPN's, Vegas'), recent form, where his points come from, and what
// he's worth for the rest of the season. Built from the same data and models as the pages.

import { PRO_TEAM_BY_ID } from "@fantasy-copilot/espn";
import { normalizeStatus } from "@fantasy-copilot/fantasy-core";
import { espnConfig } from "@/lib/env";
import { fmtTip } from "@/lib/format";
import { absenceOf, absences, returnLabel } from "./availability";
import { LAST_SCORING_PERIOD, dateForScoringPeriod, shortDay } from "./calendar";
import { loadDraftPicks, nbaSchedule } from "./data";
import { marketContext, marketValue } from "./market";
import { propsForGames } from "./market-data";
import { scoreGames, summarize } from "./player";
import { loadPlayer, loadPlayerPool } from "./pool";
import { gameEnvironment, perGameProjection } from "./projection";
import { teamValue, valueContext } from "./trade";
import { vegasProjection } from "./vegas";

export interface CardGame {
  day: string;
  opponent: string;
  home: boolean;
  tip: string;
}

export interface PlayerCardData {
  id: number;
  name: string;
  proTeam: string;
  positions: string[];
  status: string;
  injury: { note: string; back: string | null } | null;
  owner: string;
  mine: boolean;
  available: boolean;
  next: (CardGame & { today: boolean }) | null;
  projection: {
    /** The number shown under scores: the most accurate source (ours until a blend passes). */
    best: number;
    ours: number;
    espn: number | null;
    vegas: number | null;
    vegasLines: { market: string; line: number }[];
    /** Vegas game-environment factor for the next game (1 = average). */
    environment: number;
  };
  form: {
    games: number;
    fppg: number | null;
    last5: number | null;
    minutes: number | null;
    minutesLast5: number | null;
    /** Last 10 games, oldest first. */
    spark: number[];
  };
  recent: {
    date: string;
    opponent: string;
    home: boolean;
    result: string;
    line: Record<string, number>;
    fp: number;
  }[];
  /** Per-game stats and what each is worth in this league's scoring, biggest first. */
  contributions: { stat: string; perGame: number; points: number }[];
  rest: {
    gamesLeft: number;
    projectedPoints: number;
    /** Starts he'd make on his fantasy team (or on Jack's, for a free agent). */
    starts: { starts: number; games: number; team: string } | null;
    marketValue: number;
    adp: number | null;
    owned: number | null;
    ownedChange: number | null;
  };
  schedule: CardGame[];
  /** Before his first game this season, form comes from last season. */
  formFromLastSeason: boolean;
}

const STATS = ["PTS", "REB", "AST", "STL", "BLK", "3PM", "FGM", "FGA", "FTM", "FTA", "TO"];

export async function loadPlayerCard(id: number, now = new Date()): Promise<PlayerCardData | null> {
  const [p, poolData, draftPicks] = await Promise.all([
    loadPlayer(id, now),
    loadPlayerPool(now),
    loadDraftPicks().catch(() => new Map<number, number>()),
  ]);
  if (!p) return null;
  const { sp, data, pool } = poolData;
  const pl = p.entry.player;
  const games = await nbaSchedule(espnConfig().season);

  // Schedule from today: his team's next games.
  const upcoming = games
    .filter(
      (g) =>
        g.scoringPeriodId >= sp &&
        (g.homeProTeamId === pl.proTeamId || g.awayProTeamId === pl.proTeamId),
    )
    .sort((a, b) => a.date - b.date);
  const asGame = (g: (typeof games)[number]): CardGame => {
    const home = g.homeProTeamId === pl.proTeamId;
    return {
      day: shortDay(dateForScoringPeriod(g.scoringPeriodId)),
      opponent: PRO_TEAM_BY_ID[home ? g.awayProTeamId : g.homeProTeamId] ?? "?",
      home,
      tip: fmtTip(new Date(g.date).toISOString()),
    };
  };
  // A ruled-out player's next game is his first one back.
  const absence = absenceOf(pl, p.injury ?? undefined, sp);
  const nextGame = upcoming.find((g) => g.scoringPeriodId >= (absence?.outUntil ?? sp)) ?? null;

  // Projections for the next game.
  const ours = perGameProjection(pl, nextGame?.scoringPeriodId ?? sp).fppg;
  const line = nextGame && data.scoreboard.find((g) => g.gameId === nextGame.gameId);
  const environment = nextGame
    ? gameEnvironment(line ?? null, nextGame.homeProTeamId === pl.proTeamId)
    : 1;
  const props =
    nextGame && nextGame.scoringPeriodId === sp
      ? ((await propsForGames([nextGame.gameId]).catch(() => new Map())).get(id) ?? [])
      : [];
  const vegas = vegasProjection(props, pl.projection?.stats, ours, data.settings.scoring);

  // Recent form.
  const rows = scoreGames(p.log, p.scoring);
  const sum = summarize(rows);
  const played = rows.filter((r) => (r.line.MIN ?? 0) > 0);

  // Where his points come from (season per-game stats, or ESPN's projection early on).
  const perGame =
    pl.season?.stats && Object.keys(pl.season.stats).length
      ? pl.season.stats
      : (pl.projection?.stats ?? {});
  const misses: Record<string, number> = {
    FGMI: (perGame.FGA ?? 0) - (perGame.FGM ?? 0),
    FTMI: (perGame.FTA ?? 0) - (perGame.FTM ?? 0),
  };
  const contributions = Object.entries(p.scoring)
    .filter(([stat]) => !["DD", "TD", "QD"].includes(stat))
    .map(([stat, pts]) => {
      const v = perGame[stat] ?? misses[stat] ?? 0;
      return { stat, perGame: v, points: v * pts };
    })
    .filter((c) => c.perGame !== 0)
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points));

  // Rest of season: games he's available for, and the starts he'd make.
  const gamesLeft = upcoming.filter(
    (g) =>
      g.scoringPeriodId <= LAST_SCORING_PERIOD && g.scoringPeriodId >= (absence?.outUntil ?? sp),
  ).length;
  const owner = data.ahead.teams.find((t) => t.roster.some((x) => x.id === id));
  const roster = owner ? owner.roster : [...data.ahead.me.roster, { ...pl, slot: "BE" }];
  const ctx = valueContext(
    games,
    data.settings.slotCounts,
    sp,
    LAST_SCORING_PERIOD,
    data.settings.regularSeasonWeeks,
    absences(roster, data.injuries, sp),
  );
  const usage = teamValue(roster, ctx).usage.get(id) ?? null;
  const market = marketContext([...pool.map((e) => e.player)], draftPicks);

  return {
    id,
    name: pl.name,
    proTeam: pl.proTeam,
    positions: pl.positions,
    status: normalizeStatus(p.injury?.status ?? pl.injuryStatus),
    injury: p.injury
      ? { note: p.injury.long || p.injury.short, back: absence ? returnLabel(absence) : null }
      : null,
    owner: p.entry.owner,
    mine: p.entry.mine,
    available: p.entry.available,
    next: nextGame ? { ...asGame(nextGame), today: nextGame.scoringPeriodId === sp } : null,
    projection: {
      best: ours * environment,
      ours: ours * environment,
      espn: pl.projection?.avg ?? null,
      vegas: vegas?.fppg ?? null,
      vegasLines: props.map((l: { market: string; line: number }) => ({
        market: l.market,
        line: l.line,
      })),
      environment,
    },
    form: {
      games: sum.games,
      fppg: sum.fppg,
      last5: sum.last5,
      minutes: sum.minutes,
      minutesLast5: sum.minutesLast5,
      spark: played.slice(-10).map((r) => r.fp),
    },
    recent: played
      .slice(-10)
      .reverse()
      .map((r) => ({
        date: new Date(r.date).toLocaleDateString("en-US", {
          month: "numeric",
          day: "numeric",
          timeZone: "America/New_York",
        }),
        opponent: r.opponent,
        home: r.home,
        result: r.result,
        line: Object.fromEntries(["MIN", ...STATS].map((k) => [k, r.line[k] ?? 0])),
        fp: r.fp,
      })),
    contributions,
    rest: {
      gamesLeft,
      projectedPoints: gamesLeft * perGameProjection(pl, sp).fppg,
      starts: usage
        ? {
            ...usage,
            team: owner
              ? owner.id === data.me.id
                ? "your team"
                : owner.name
              : "your team, if added",
          }
        : null,
      marketValue: marketValue(pl, market),
      adp: pl.market?.adp ?? null,
      owned: pl.percentOwned,
      ownedChange: pl.percentChange,
    },
    schedule: upcoming.slice(0, 7).map(asGame),
    formFromLastSeason: p.logSeason !== p.season,
  };
}
