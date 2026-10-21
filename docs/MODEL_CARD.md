# Model card: per-game fantasy-point projection

The number behind daily lineups, the week projection, waivers and trades
(`apps/web/lib/nba/projection.ts`). It starts from ESPN's league-scored preseason projection and
blends in this season's results.

**Rule (CLAUDE.md):** a change ships only after it beats the current model and a simple baseline
on a pre-registered, walk-forward test.

## Backtest setup (`apps/web/scripts/backtest-projection.ts`)

- **Players:** everyone rostered in the league on Oct 20, 2026, plus the top 250 free agents. Players need 20+ games in both the prior season and the test season.
- **Point-in-time:** each game is predicted only from what was known before tip:
  - the player's previous-season per-game average (the prior);
  - his earlier games this season.
  - ESPN's past-season projections are not used, because ESPN may have revised them during the season.
- **Scoring:** this league's current scoring settings applied to ESPN box scores.
- **Metric:** mean absolute error (MAE) per game played. Each variant is compared on the same games, with a 95% interval across players.

## Exploration: 2025-26 (prior 2024-25), 283 players, 17,608 games

Several variants were tried on this season, so it is **not** a clean test.

| Predictor                                            |   MAE | vs current (95% CI)     |
| ---------------------------------------------------- | ----: | ----------------------- |
| 10-game blend + minutes trend                        | 10.20 | −0.114 [−0.139, −0.088] |
| **15-game blend + minutes trend (registered below)** | 10.23 | −0.087 [−0.109, −0.065] |
| Recency-weighted blend (k=10, half-life 15)          | 10.25 | −0.067 [−0.087, −0.047] |
| **15-game blend (current)**                          | 10.31 | baseline                |
| Season-to-date only                                  | 10.41 | +0.101 [0.046, 0.155]   |
| Prior only (last season's average)                   | 10.91 | +0.607 [0.485, 0.728]   |

**Reading:**

- Single games are noisy: every reasonable predictor misses by about 10 fantasy points.
- The current blend already beats both simple baselines.
- Recent minutes carry a small but consistent signal.

## Pre-registration (2026-10-20, written before the held-out test was run)

- **Candidate:** the current blend (`PRIOR_GAMES` = 15) × minutes trend.
  - Trend = 1 + 0.5 × (clip(last-5-game minutes ÷ season minutes, 0.6, 1.4) − 1).
  - Applied once a player has 8+ games.
  - The prior stays at 15 games: the live prior is ESPN's projection, probably stronger than a last-season average, so the shorter prior that won in exploration isn't justified.
- **Held-out test:** 2024-25 (prior 2023-24), same setup.
- **Ships if** its per-player mean error difference vs the current blend has a 95% interval entirely below 0.

## Held-out result: 2024-25 (prior 2023-24), 255 players, 15,800 games

| Predictor                                      |       MAE | vs current (95% CI)         |
| ---------------------------------------------- | --------: | --------------------------- |
| **15-game blend + minutes trend (registered)** | **10.53** | **−0.052 [−0.077, −0.027]** |
| 15-game blend (current)                        |     10.58 | baseline                    |
| Season-to-date only                            |     10.72 | +0.137 [0.086, 0.189]       |
| Prior only (previous season's average)         |     10.95 | +0.361 [0.270, 0.453]       |

**Decision (2026-10-20): ships.**

- The interval is entirely below 0, so it beats the current model. It also beats both simple baselines.
- Effect: about 0.5% lower error per game.
- It mainly helps when a player's role changes, which shows in his minutes before his season average catches up.
- Code: `minutesTrend` in `projection.ts`. It uses only games before the as-of day, so pregame projections stay fixed.

**Caveat:** in production, "season minutes" come from the per-game entries ESPN sends with each player. If ESPN only sends recent games, the trend compares the last 5 games with that window, not the whole season. Check once players have 15+ games.

## Next candidates (not shipped)

- **Availability model:** who plays at all.
  - Probably the bigger lever: a missed game costs a full projection, while per-game error is about 10 points.
  - Ingredients: ESPN injury notes, NBA.com inactive lists, back-to-back rest.
  - Needs `status_events` history: logging started in Phase 2b.
- **DARKO** (darko.app, free daily player ratings, CSV download, no stated terms):
  - Can't be backtested historically, because only today's snapshot is published.
  - Plan: with Jack's OK, and after confirming reuse is allowed, save one snapshot a day, then test after 3–4 weeks of games.
- **NBA.com stats** (`nba_api`): usage rate and minutes. Blocks cloud IPs, so it would run locally or in GitHub Actions.
- **Paid, only with Jack's approval:**
  - balldontlie ALL-STAR $9.99/mo (game stats, injuries) and GOAT $39.99/mo (lineups, advanced stats, player props);
  - betting-line player props, the strongest single-game signal.

## Game environment from Vegas lines

### Exploration: 2025-26 (284 players, 17,669 games, written 2026-10-21)

- **Idea:** scale each game's projection by his team's implied points from the closing line, relative to the league average: (team ÷ league)^β.
  - Team total = (total − home spread) ÷ 2 for the home team, (total + spread) ÷ 2 for the visitors.
  - League average = the mean implied team total over the earlier days of that season. There's no adjustment until 40 team-games have lines.
  - Lines come from ESPN's odds endpoint per game (closing, pregame). 1,237 of 1,241 games have one.
- **Baseline:** the current model (15-game blend + minutes trend).

| β on top of the current model |   MAE | vs current (95% CI)     |
| ----------------------------- | ----: | ----------------------- |
| 0.75                          | 10.19 | −0.022 [−0.035, −0.008] |
| 1                             | 10.19 | −0.021 [−0.038, −0.003] |
| 0.5                           | 10.19 | −0.018 [−0.028, −0.009] |
| 0.25                          | 10.20 | −0.011 [−0.016, −0.006] |
| 1.5                           | 10.20 | −0.006 [−0.032, 0.020]  |
| current model                 | 10.21 | baseline                |

### Pre-registration (2026-10-21, before the held-out run)

- **Candidate:** current model × (team implied total ÷ league average)^0.75.
- **Held-out test:** 2024-25 (prior 2023-24), same setup.
  - 2024-25 was already the held-out season for the minutes trend. This is a separate hypothesis, but it's the second test on that season. So the bar stays the same: the interval must be entirely below 0.
- **Ships if** its per-player mean error difference vs the current model has a 95% interval entirely below 0. Then it applies to daily and weekly projections for games with a posted line.

### Held-out result: 2024-25 (256 players, 15,859 games, 1,239 of 1,240 games with lines)

| Predictor                                     |       MAE | vs current (95% CI)         |
| --------------------------------------------- | --------: | --------------------------- |
| **current model + game environment (β 0.75)** | **10.49** | **−0.028 [−0.047, −0.008]** |
| current model (15-game blend + minutes trend) |     10.52 | baseline                    |
| Season-to-date only                           |     10.71 | +0.191 [0.136, 0.245]       |
| Prior only (previous season's average)        |     10.94 | +0.411 [0.315, 0.508]       |

**Decision (2026-10-21): ships.**

- The interval is entirely below 0. The effect is small, about 0.3% lower error per game.
- **In production:** daily lineups and today's part of the week projection use the posted line from ESPN's scoreboard. Days without a line yet are unchanged.
- **League average:** fixed at 115.3, 2025-26's average implied team total; 2024-25's was 113.3. A fixed value scales every game alike, so start/sit choices and head-to-head odds barely depend on it. Replace it with this season's collected average (`game_lines`) once there are a few weeks of lines.

## Pre-registration: sportsbook props (2026-10-21, before any data)

- **Data:** for every player with DraftKings props, the `pregame` snapshot (22:00Z cron) stores two projections in `pregame_projections`:
  - our projection: current model + game environment, before play probability;
  - the props-implied one (`lib/nba/vegas.ts`).
- **Scoring:** the next morning's job stores box scores in `game_results`, scored with league settings including bonuses. Only games the player actually played count.
- **When:** first evaluation once there are ≥7 game days and ≥800 player-games (`GET /api/model/props`, `lib/nba/props-eval.ts`).
- **Walk-forward:**
  - choose the blend weight w (0, 0.1, …, 1) on the first half of the game days by MAE;
  - judge (1 − w)·ours + w·Vegas on the second half.
- **Ships if** w > 0 and the blend's per-player mean error difference vs our model has a 95% interval entirely below 0.
  - Then today's lineups, live projections and this week's odds use the blend for players with props.
  - The weight is refit as data grows, re-checked on the most recent half each time.
