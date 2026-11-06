import "server-only";
// Everything the player card shows, in one serializable object:
//  - who he is;
//  - his game today, live or final, with the box score and where it's heading;
//  - his next game and its projections (ours, ESPN's, Vegas');
//  - his season against last season, with advanced numbers from ESPN, PBP Stats and DARKO;
//  - what he's worth for the rest of the season.
// Built from the same data and models as the pages. Game state comes from today's scoreboard,
// so a game that has started is never shown as upcoming. ESPN's game log can trail a game by
// hours, so recent games it hasn't added yet are read from the box score.

import { percentileOf } from "./pbp-metrics";
import { after } from "next/server";
import { PRO_TEAM_BY_ID } from "@fantasy-copilot/espn";
import { fantasyPoints, normalizeStatus, withDerived } from "@fantasy-copilot/fantasy-core";
import {
  fetchGameLog,
  fetchGameSummary,
  fetchScoreboard,
  parseBoxScore,
  type GameLogEntry,
  type ScoreboardGame,
} from "@fantasy-copilot/nba-data";
import { db, dbConfigured } from "@/lib/db";
import { espnConfig } from "@/lib/env";
import { memoFetch } from "@/lib/fetch-memo";
import { fmtTip } from "@/lib/format";
import { bestProjection, blendSetting } from "./accuracy";
import {
  darkoView,
  ensurePbpPlayers,
  espnAdvanced,
  pbpPlayer,
  type DarkoView,
  type EspnAdvanced,
  type PbpPlayer,
} from "./advanced";
import { absenceOf, absences, returnLabel } from "./availability";
import { LAST_SCORING_PERIOD, dateForScoringPeriod, shortDay } from "./calendar";
import {
  contributions,
  projectedFinal,
  seasonSplit,
  type Contribution,
  type SeasonSplit,
} from "./card-stats";
import { loadDraftPicks, nbaSchedule } from "./data";
import { marketContext, marketValue } from "./market";
import { propsForGames } from "./market-data";
import { scoreGames, summarize } from "./player";
import { loadPlayer, loadPlayerPool } from "./pool";
import { gameEnvironment, matchupFactor, perGameProjection } from "./projection";
import { teamValue, valueContext } from "./trade";
import { vegasProjection } from "./vegas";

export interface CardGame {
  day: string;
  opponent: string;
  home: boolean;
  tip: string;
}

export interface LiveGame {
  state: "in" | "post";
  opponent: string;
  home: boolean;
  teamScore: number | null;
  oppScore: number | null;
  /** "Q3 5:12", "Halftime", "Final". */
  status: string;
  /** His box score so far; null until he checks in (or if he didn't play). */
  line: Record<string, number> | null;
  fp: number;
  /** Tonight's fantasy points by stat (FG and FT net). */
  byStat: Contribution[];
  /** Our pregame number for this game. */
  pregame: number;
  /** Points so far plus his expected rate over the minutes he should still play. */
  projectedFinal: number;
  expectedMinutes: number;
  /** Sportsbook lines (closing, when the live ones are gone) and where he stands. */
  props: { market: string; line: number; current: number }[];
}

export interface SeasonBlock {
  /** "2026-27". */
  label: string;
  split: SeasonSplit | null;
  espn: EspnAdvanced | null;
  pbp: PbpPlayer | null;
  /** FP/G percentile among this league's rostered players with enough games (this season). */
  fppgPercentile?: number | null;
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
  /** His game today once it has tipped (in progress or final). */
  live: LiveGame | null;
  /** His next game that hasn't started (after his estimated return, if he's out). */
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
    /** The opponent's defense against his position (1 = average). */
    matchup: number;
    /** Minutes our model expects (minutes x rate), when it has them. */
    minutes: number | null;
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
  contributions: Contribution[];
  /** This season and last, with advanced numbers. */
  seasons: { current: SeasonBlock; last: SeasonBlock };
  darko: DarkoView | null;
  /** NBA.com id (from PBP Stats), for links to sites that use it. */
  nbaId: number | null;
  rest: {
    gamesLeft: number;
    projectedPoints: number;
    /**
     * Starts he'd make on his fantasy team (or on Jack's, for a free agent), out of his games
     * left (gamesLeft). `games`: the ones while he's on that roster; `cut`: when the team's
     * IR-return plan drops him, who comes back and when ("Nov 9").
     */
    starts: {
      starts: number;
      games: number;
      team: string;
      cut: { back: string; date: string } | null;
    } | null;
    marketValue: number;
    adp: number | null;
    owned: number | null;
    ownedChange: number | null;
  };
  schedule: CardGame[];
  /** Before his first game this season, form comes from last season. */
  formFromLastSeason: boolean;
}

const STATS = ["PTS", "REB", "AST", "STL", "BLK", "3PM", "FGM", "FGA", "FTM", "FTA", "TO", "PF"];
const LIVE_FETCH = memoFetch(15_000);
const label = (season: number) => `${season - 1}-${String(season).slice(2)}`;

function statusText(g: ScoreboardGame): string {
  if (g.state === "post") return g.detail || "Final";
  if (/half/i.test(g.detail)) return "Halftime";
  return `${g.period > 4 ? `OT${g.period > 5 ? g.period - 4 : ""}` : `Q${g.period}`} ${g.clock}`;
}

/** His box line in a game, from ESPN's summary (live or final); null if he hasn't played. */
async function boxLine(gameId: number, playerId: number) {
  const summary = await fetchGameSummary(gameId, LIVE_FETCH).catch(() => null);
  return summary
    ? (parseBoxScore(summary).find((r) => r.playerId === playerId)?.line ?? null)
    : null;
}

/** The latest closing (or morning) lines we stored for him in this game. */
async function storedProps(gameId: number, playerId: number) {
  if (!dbConfigured()) return [];
  const rows = await db()<{ market: string; line: number }[]>`
    select distinct on (market) market, line from prop_lines
    where game_id = ${gameId} and player_id = ${playerId}
    order by market, captured_at desc
  `.catch(() => []);
  return rows;
}

/** One game in a full log (the player page): date, opponent, box score and fantasy points. */
export interface LogGame {
  gameId: number;
  date: string;
  opponent: string;
  home: boolean;
  playoffs: boolean;
  fp: number;
  /** 5-game rolling average (null for the first four games). */
  rolling: number | null;
  line: Record<string, number>;
}

/**
 * The card's data; with `full`, also both seasons' full game logs (the player page).
 */
export async function loadPlayerCard(
  id: number,
  now = new Date(),
  full = false,
): Promise<(PlayerCardData & { logs?: { current: LogGame[]; last: LogGame[] } }) | null> {
  const [p, poolData, draftPicks] = await Promise.all([
    loadPlayer(id, now),
    loadPlayerPool(now),
    loadDraftPicks().catch(() => new Map<number, number>()),
  ]);
  if (!p) return null;
  const { sp, data, pool } = poolData;
  const pl = p.entry.player;
  const scoring = data.settings.scoring;
  const games = await nbaSchedule(espnConfig().season);
  const isHis = (g: (typeof games)[number]) =>
    g.homeProTeamId === pl.proTeamId || g.awayProTeamId === pl.proTeamId;
  const asGame = (g: (typeof games)[number]): CardGame => {
    const home = g.homeProTeamId === pl.proTeamId;
    return {
      day: shortDay(dateForScoringPeriod(g.scoringPeriodId)),
      opponent: PRO_TEAM_BY_ID[home ? g.awayProTeamId : g.homeProTeamId] ?? "?",
      home,
      tip: fmtTip(new Date(g.date).toISOString()),
    };
  };

  // Today: has his game tipped? Then it's live or final, and "next" is a later game.
  const todayGame = games.find((g) => g.scoringPeriodId === sp && isHis(g)) ?? null;
  const todayBoard = todayGame
    ? (data.scoreboard.find((g) => g.gameId === todayGame.gameId) ?? null)
    : null;
  const started = todayBoard
    ? todayBoard.state !== "pre"
    : todayGame != null && todayGame.date <= now.getTime();
  const upcoming = games
    .filter((g) => isHis(g) && (g.scoringPeriodId > sp || (g.scoringPeriodId === sp && !started)))
    .sort((a, b) => a.date - b.date);
  // A ruled-out player's next game is his first one back.
  const absence = absenceOf(pl, p.injury ?? undefined, sp);
  const nextGame = upcoming.find((g) => g.scoringPeriodId >= (absence?.outUntil ?? sp)) ?? null;

  const model = (day: number) => perGameProjection(pl, day);
  const blendWeight = (await blendSetting().catch(() => null))?.weight ?? 0;

  // Projections for the next game.
  const ours = model(nextGame?.scoringPeriodId ?? sp);
  const nextLine = nextGame && data.scoreboard.find((g) => g.gameId === nextGame.gameId);
  const nextHome = nextGame?.homeProTeamId === pl.proTeamId;
  const environment = nextGame ? gameEnvironment(nextLine ?? null, nextHome) : 1;
  // The opponent's defense against his position (1 before the first nightly run).
  const matchup = nextGame
    ? matchupFactor(
        data.defense,
        nextHome ? nextGame.awayProTeamId : nextGame.homeProTeamId,
        pl.positions,
      )
    : 1;
  const nextProps =
    nextGame && nextGame.scoringPeriodId === sp
      ? ((await propsForGames([nextGame.gameId]).catch(() => new Map())).get(id) ?? [])
      : [];
  const vegas = vegasProjection(nextProps, pl.projection?.stats, ours.fppg, scoring);

  // Game logs: this season and last, plus recent games ESPN's log hasn't picked up yet.
  const season = p.season;
  const [lastLog, yesterdayBoard] = await Promise.all([
    p.logSeason === season ? fetchGameLog(id, season - 1).catch(() => []) : Promise.resolve(p.log),
    fetchScoreboard(
      dateForScoringPeriod(Math.max(1, sp - 1)).replace(/-/g, ""),
      memoFetch(60_000),
    ).catch(() => []),
  ]);
  const thisLog: GameLogEntry[] = p.logSeason === season ? [...p.log] : [];
  const inLog = new Set(thisLog.map((g) => g.gameId));
  const lateGames = [
    ...yesterdayBoard.filter((g) => g.state === "post"),
    ...(todayBoard?.state === "post" ? [todayBoard] : []),
  ].filter(
    (g) => (g.homeTeamId === pl.proTeamId || g.awayTeamId === pl.proTeamId) && !inLog.has(g.gameId),
  );
  for (const g of lateGames) {
    const line = await boxLine(g.gameId, id);
    if (!line) continue;
    const home = g.homeTeamId === pl.proTeamId;
    const mine = home ? g.homeScore : g.awayScore;
    const theirs = home ? g.awayScore : g.homeScore;
    thisLog.push({
      gameId: g.gameId,
      date: g.tip,
      opponent: PRO_TEAM_BY_ID[home ? g.awayTeamId : g.homeTeamId] ?? "?",
      home,
      result: mine != null && theirs != null ? (mine > theirs ? "W" : "L") : "",
      score: mine != null && theirs != null ? `${mine}-${theirs}` : "",
      part: "regular",
      line,
    });
  }
  thisLog.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const formLog = thisLog.some((g) => g.part === "regular") ? thisLog : p.log;
  const rows = scoreGames(formLog, scoring);
  const sum = summarize(rows);
  const played = rows.filter((r) => (r.line.MIN ?? 0) > 0);
  const regular = (log: GameLogEntry[]) =>
    scoreGames(log, scoring).filter((r) => r.part === "regular");

  // Today's game, live or final.
  let live: LiveGame | null = null;
  if (started && todayGame && todayBoard) {
    const home = todayGame.homeProTeamId === pl.proTeamId;
    const line = await boxLine(todayGame.gameId, id);
    const fp = line ? fantasyPoints(withDerived(line), scoring) : 0;
    const today = model(sp);
    const pregame = bestProjection(
      today.fppg *
        gameEnvironment(todayBoard, home) *
        matchupFactor(
          data.defense,
          home ? todayGame.awayProTeamId : todayGame.homeProTeamId,
          pl.positions,
        ),
      null,
      blendWeight,
    );
    const expectedMinutes =
      today.minutes ?? sum.minutes ?? pl.projection?.stats?.MIN ?? (line?.MIN || 30);
    const liveProps = (await propsForGames([todayGame.gameId]).catch(() => new Map())).get(id);
    const props: { market: string; line: number }[] = liveProps?.length
      ? liveProps
      : await storedProps(todayGame.gameId, id);
    live = {
      state: todayBoard.state === "post" ? "post" : "in",
      opponent: PRO_TEAM_BY_ID[home ? todayGame.awayProTeamId : todayGame.homeProTeamId] ?? "?",
      home,
      teamScore: home ? todayBoard.homeScore : todayBoard.awayScore,
      oppScore: home ? todayBoard.awayScore : todayBoard.homeScore,
      status: statusText(todayBoard),
      line,
      fp,
      byStat: line ? contributions(line, scoring) : [],
      pregame,
      projectedFinal: projectedFinal({
        fp,
        minutes: line?.MIN ?? 0,
        expectedMinutes,
        rate: expectedMinutes ? pregame / expectedMinutes : 0,
        final: todayBoard.state === "post",
      }),
      expectedMinutes,
      props: props.map((l) => ({
        market: l.market,
        line: l.line,
        current: line?.[l.market] ?? 0,
      })),
    };
  }

  // Where his points come from (season per-game stats, or ESPN's projection early on).
  const perGame =
    pl.season?.stats && Object.keys(pl.season.stats).length
      ? pl.season.stats
      : (pl.projection?.stats ?? {});

  // Advanced numbers, this season and last. Never block the card.
  const [espnNow, espnLast, pbpNow, pbpLast, darko] = await Promise.all([
    espnAdvanced(id, season).catch(() => null),
    espnAdvanced(id, season - 1).catch(() => null),
    pbpPlayer(pl.name, pl.proTeam, season).catch(() => null),
    pbpPlayer(pl.name, pl.proTeam, season - 1).catch(() => null),
    darkoView(pl.name, pl.proTeam, scoring).catch(() => null),
  ]);

  if (!pbpNow && !pbpLast) after(() => ensurePbpPlayers([season, season - 1]).catch(() => {}));

  // Rest of season: games he's available for, and the starts he'd make.
  const restGames = games.filter(
    (g) =>
      isHis(g) &&
      g.scoringPeriodId <= LAST_SCORING_PERIOD &&
      g.scoringPeriodId >= Math.max(started ? sp + 1 : sp, absence?.outUntil ?? sp),
  );
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
  const value = teamValue(roster, ctx);
  const usage = value.usage.get(id) ?? null;
  const cutBy = value.activations.find((a) => a.drop?.id === id) ?? null;
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
    live,
    next: nextGame ? { ...asGame(nextGame), today: nextGame.scoringPeriodId === sp } : null,
    projection: {
      best: bestProjection(ours.fppg * environment * matchup, vegas?.fppg ?? null, blendWeight),
      ours: ours.fppg * environment * matchup,
      espn: pl.projection?.avg ?? null,
      vegas: vegas?.fppg ?? null,
      vegasLines: nextProps.map((l: { market: string; line: number }) => ({
        market: l.market,
        line: l.line,
      })),
      environment,
      matchup,
      minutes: ours.minutes ?? null,
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
    contributions: contributions(perGame, scoring),
    seasons: {
      current: {
        label: label(season),
        split: seasonSplit(regular(thisLog)),
        espn: espnNow,
        pbp: pbpNow,
        fppgPercentile: fppgPercentile(pool, seasonSplit(regular(thisLog))?.fppg ?? null),
      },
      last: {
        label: label(season - 1),
        split: seasonSplit(regular(p.logSeason === season ? lastLog : p.log)),
        espn: espnLast,
        pbp: pbpLast,
      },
    },
    darko,
    ...(full
      ? {
          logs: {
            current: logGames(scoreGames(thisLog, scoring)),
            last: logGames(scoreGames(p.logSeason === season ? lastLog : p.log, scoring)),
          },
        }
      : {}),
    nbaId: pbpNow?.nbaId ?? pbpLast?.nbaId ?? null,
    rest: {
      gamesLeft: restGames.length,
      projectedPoints: restGames.length * model(sp).fppg,
      starts: usage
        ? {
            ...usage,
            team: owner
              ? owner.id === data.me.id
                ? "your team"
                : owner.name
              : "your team, if added",
            cut: cutBy
              ? {
                  back: cutBy.player.name,
                  date: new Date(`${dateForScoringPeriod(cutBy.day)}T12:00:00Z`).toLocaleDateString(
                    "en-US",
                    { month: "short", day: "numeric", timeZone: "UTC" },
                  ),
                }
              : null,
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

/** True while his game is in progress: the card refreshes itself and isn't cached. */
export const isLive = (c: PlayerCardData) => c.live?.state === "in";

/**
 * Where his FP/G ranks among this league's rostered players with enough games this season (3,
 * or 40% of the most anyone has), as a percentile: the players he'd compete with for a spot.
 */
function fppgPercentile(
  all: {
    available: boolean;
    player: { season: { avg: number | null; total: number | null } | null };
  }[],
  fppg: number | null,
): number | null {
  if (fppg == null) return null;
  const pool = all.filter((e) => !e.available);
  const games = (w: { avg: number | null; total: number | null } | null) =>
    w?.avg && w.total ? w.total / w.avg : 0;
  const most = Math.max(0, ...pool.map((e) => games(e.player.season)));
  const min = Math.max(1, Math.min(3, Math.ceil(most * 0.4)));
  const values = pool
    .filter((e) => games(e.player.season) >= min && e.player.season?.avg != null)
    .map((e) => e.player.season!.avg!)
    .sort((a, b) => a - b);
  const p = percentileOf(values, fppg);
  return p == null ? null : Math.round(p);
}

function logGames(rows: ReturnType<typeof scoreGames>): LogGame[] {
  return rows.map((r) => ({
    gameId: r.gameId,
    date: r.date,
    opponent: r.opponent,
    home: r.home,
    playoffs: r.part === "post",
    fp: Math.round(r.fp * 10) / 10,
    rolling: r.rolling != null ? Math.round(r.rolling * 10) / 10 : null,
    line: r.line as Record<string, number>,
  }));
}
