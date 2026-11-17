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

## Fallback fix: players without an ESPN projection (2026-10-27)

- **Problem:** ESPN doesn't project some players (deep free agents, late signings). Before, they were projected at their raw season average, so after one game Mo Bamba was "38.5 FP/G".
- **Fix:** they now blend toward 15 FP/G with the same 15-game prior weight as everyone else. 15 FP/G is the median ESPN projection among the 180 projected free agents on Oct 27.
- **Scope:** this is a fallback, not a model change. It only affects players with no ESPN projection, which the walk-forward backtest (built on rostered players' priors) doesn't cover. Revisit if logged accuracy (PR 5) shows a bias for these players.

## Weekly win probability

### Pre-registration (2026-10-27, before any fitting)

- **Problem:** `winProbability` uses a margin spread of 0.14 × points still to come for each side. That shrinks linearly as the week runs out, but random game-to-game noise shrinks only with the square root of the games left. Week 1 showed 99% with four days left and 100% before Sunday's games.
- **Data:** this league's 2025-26 regular season (ESPN, same league id): per-day points for both teams in every matchup.
  - At the start of each day: margin so far, expected points still to come for each team, and the final margin.
  - Expected points still to come = the team's points per NBA game on the slate in earlier weeks × NBA games left that week (point in time; week 1 skipped).
- **Candidate:** variance of the rest-of-week margin = a·(E₁ + E₂) + b·(E₁² + E₂²), where E is each team's expected points still to come.
  - The first term is game-to-game noise; the second is shared surprises like injuries, rest and lineup misses.
  - a and b are fitted by maximum likelihood on weeks 2–10.
- **Test:** weeks 11–19, every matchup-day.
  - Brier score of P(win) for the candidate vs the current model, plus a reliability table.
  - The same comparison restricted to the last two days of a week.
- **Ships if** the candidate's Brier score is lower on weeks 11–19. Separately, the app never shows 100% or 0% until no games are left.

### Result (2026-10-27): the candidate did not ship

Fitted on weeks 2–10: a = 19, b = 0.012. Tested on weeks 11–19 (420 matchup-days):

| Model                        | Brier (test) | Brier, last 2 days |
| ---------------------------- | -----------: | -----------------: |
| **current (0.14 × to come)** |   **0.0778** |         **0.0461** |
| candidate (a·E + b·E²)       |       0.0831 |             0.0490 |

Reliability on the test weeks, P(home wins) bucket → actual:

| Predicted | current: n, actual | candidate: n, actual |
| --------- | -----------------: | -------------------: |
| 0–5%      |            125, 0% |              101, 0% |
| 5–20%     |             34, 0% |               45, 0% |
| 20–40%    |            30, 23% |              38, 16% |
| 40–60%    |            33, 64% |              46, 57% |
| 60–80%    |            47, 77% |              51, 82% |
| 80–95%    |            23, 87% |              56, 89% |
| 95–100%   |           128, 93% |              83, 95% |

**Reading:**

- The current model is mildly overconfident at the top: "95–100%" won 93% of the time.
- The candidate overcorrects. Its stand-in for points still to come (a team's points per NBA game × games left) is noisier than the app's lineup projection, and the fit absorbed that noise as extra variance.
- The rule said ship only on a lower Brier score, so it doesn't ship.
- What did change: the app never shows 100% or 0% while points are still to come (">99%" / "<1%"), and every matchup's state is now logged each morning with the app's own projections (`matchup_states`, migration 0008).
- The league's earlier seasons aren't accessible (ESPN 401), so a fresh test has to come from this season.

### Pre-registration 2 (2026-10-27): recalibrate on this season's logged states

- **Data:** `matchup_states` (every matchup, each morning, with the app's own remaining projections and P(win)); finals from ESPN.
- **Candidates**, fitted on weeks 2–7:
  - (A) logistic recalibration of the current probability: σ(α + β·logit p);
  - (B) the variance form a·E + b·E², refit on these states.
- **Test:** weeks 8–13.
- **Ships:** whichever candidate has the lower Brier score than the current model on the test weeks (if both, the lower). Report its reliability table.

### Pre-registration 3 (2026-11-01): candidate C, each remaining start's own spread

- **Problem:** on Nov 1 (the last day of week 2) Jack led by 72.5 with 78 points to come against 111: a projected margin of +39.5 with 3 starters against 5. The current model's spread is 0.14 × points to come per side (±19), so it showed 98%. One game swings far more than 14%.
- **Exploration** (2024-25 and 2025-26 player game logs, 29,700 games at a projection of 10+; no matchup results used): a player's fantasy points around his previous-20-game average have an SD of 11.5 at a 10–12.5 average, 13.2 at 20–22.5, 15.4 at 30–32.5 and about 20 at 45+. A weighted line: **SD = 8.8 + 0.22 × projection** (`scripts/fit-start-sd.ts`).
  - For Nov 1 that gives ±40 for the margin and about 84%, not 98%.
- **Candidate C** (no parameter fitted on matchups):
  - each side's variance still to come = Σ over its projected starts of (8.8 + 0.22 × the start's projection)²;
  - today's starters come from the day board; a game in progress counts its variance × the share of the game left;
  - P(home wins) = Φ((margin so far + home to come − away to come) ÷ √(home variance + away variance)), with the same points to come as the current model.
- **Logging:** `matchup_states.home_start_var` / `away_start_var` (migration 0015), each morning from Nov 2, beside the current model's `p_home`.
- **Test:** every logged matchup-morning of weeks 3–7 (Nov 2 – Dec 6); finals from ESPN. Evaluated **once**, after week 7's finals.
- **Ships if** candidate C's Brier score is lower than the current model's on those rows. Also reported: Brier on the last two days of each week, and the reliability table.
- If C ships, Pre-registration 2 (weeks 8–13) compares its candidates against C instead of the 0.14 model.

### Pre-registration 3b (2026-11-01, before any matchup data is read): candidate C on 2025-26, rebuilt

The forward test above waits for this season's logs. Last season can be tested now: ESPN still serves this league's 2025-26 rosters for every day (lineup slots and each day's points), and projections can be rebuilt from game logs.

- **Data:** every regular-season matchup of 2025-26 (weeks 1–19), each morning of each matchup week. Weeks 11–19 were the test weeks of the first comparison (above); candidate C was never fitted or tried on them.
- **Rebuilt each morning, point in time, the same for both models:**
  - **margin so far:** the two teams' daily points before that day (ESPN);
  - **roster:** each team's roster that day (ESPN); IR-slot players don't play;
  - **projection:** a player's average league fantasy points over his last 20 games before that day (2025-26 games, filled with 2024-25 games while he has fewer than 20), scored with the league's 2025-26 settings;
  - **out:** a player whose team has played 2+ games since his last game is out for the rest of that week;
  - **points to come:** for each remaining day of the week, the best lineup (the app's optimizer, the league's slots) among his roster's players with a game; the sum of the starters' projections;
  - **candidate C's variance:** the same starters, Σ (a + b × projection)², with a and b refit by `scripts/fit-start-sd.ts` on **2024-25 game logs only**, so the test season's games don't shape it.
- **Models:** current, P = Φ(mean ÷ (0.14 × √(E_home² + E_away²))); candidate C, P = Φ(mean ÷ √(V_home + V_away)); mean = margin so far + E_home − E_away for both. Ties are dropped.
- **Gate:** C ships if its Brier score is lower **and** the 95% interval of the Brier difference (mean of per-matchup-week differences ± 1.96 SE, matchup-weeks as the unit) is entirely below 0.
- **Also reported:** Brier on the last two days of each week; the reliability table for both models.
- **If it passes:** the app's win chance uses candidate C (the line fitted on both seasons, as in the code). The weeks 3–7 forward test still runs, as a check. **If it fails:** nothing changes, and the forward test decides on Dec 6.
- **Script:** `scripts/backtest-win-prob.ts`.

### Result 3b (2026-11-01): candidate C does not pass on 2025-26

Per-start SD refit on 2024-25 only: 8.16 + 0.247 × projection (14,108 games). 2025-26: 139 days of rosters, 226 players, **834 matchup-mornings in 114 matchup-weeks**.

| Model                    |  Brier | Brier, last 2 days |
| ------------------------ | -----: | -----------------: |
| current (0.14 × to come) | 0.0872 |             0.0516 |
| candidate C              | 0.0865 |             0.0493 |

C − current, by matchup-week: **−0.0005 [−0.0028, +0.0017]**. The interval includes 0, so **C doesn't ship.**

Reliability, P(home wins) bucket → actual:

| Predicted | current: n, actual | candidate C: n, actual |
| --------- | -----------------: | ---------------------: |
| 0–5%      |            234, 0% |                259, 1% |
| 5–20%     |             84, 7% |                 72, 8% |
| 20–40%    |            49, 29% |                40, 43% |
| 40–60%    |            52, 58% |                45, 49% |
| 60–80%    |            81, 79% |                63, 84% |
| 80–95%    |            98, 84% |                86, 81% |
| 95–100%   |           236, 94% |               269, 92% |

**Reading:**

- C is a little better, mostly on the last two days (0.0493 vs 0.0516), but too little to tell apart from noise over 114 matchup-weeks.
- Both models are overconfident at the top: "95–100%" won 92–94% of the time. A leader the app shows at 95%+ has lost about 1 time in 15.
- C doesn't fix that. Per-start noise alone misses the shared surprises (late scratches, a manager's lineup misses), so C is too narrow early in a week, even as it widens the last days.
- The weeks 3–7 forward test (Pre-registration 3) still runs and decides on Dec 6; Pre-registration 2 (weeks 8–13) still includes the variance form a·E + b·E², which has a shared term.

## Teammate role boost (2026-10-27): no gain, not shipped

- **Hypothesis:** when regular teammates sit, the remaining players get more minutes and shots. The minutes trend only catches that after a few games.
- **Feature, point in time:** minutes vacated by absent regulars. A regular averaged 20+ minutes over his last 10 games, the last of them for this team within 10 days; he's absent when he has no entry in his team's game.
  - In the backtest that's who didn't play; in production it would be the injury report. Inactive lists are out about an hour before tip.
- **Model:** current × (1 + k × vacated ÷ 240), optionally scaled by his own minutes, or counting only absent teammates who share a position.
- **Exploration, 2025-26** (271 players, 16,756 games), vs the current model (blend + minutes trend + game environment):

| Variant                     | k = 0.25               | k = 0.5                | k = 1                 |
| --------------------------- | ---------------------- | ---------------------- | --------------------- |
| any absent regular          | +0.005 [−0.006, 0.017] | +0.045 [0.020, 0.070]  | +0.220 [0.165, 0.274] |
| … scaled by his minutes     | +0.008 [−0.003, 0.019] | +0.046 [0.022, 0.069]  | +0.206 [0.152, 0.261] |
| same-position absences only | −0.003 [−0.009, 0.004] | +0.002 [−0.010, 0.014] | +0.038 [0.012, 0.063] |

**Reading:**

- No variant beats the current model even on the season it was explored on, so there's nothing to pre-register for a held-out test. **Not shipped.**
- Role changes still reach the projection through the blend toward this season's games and the minutes trend (both tested).
- **Possible later:** a minutes-share model by position once the injury-report history (`status_events`, with return dates since Oct 27) covers enough games to know absences before tip.

## Season simulator: IR-return roster bug (fixed 2026-10-29)

When a player came back from the IR slot, the simulator dropped the player picked at season start as his fill-in. If streaming had already dropped that player, nobody was cut and the roster grew by one for the rest of the simulated season.

- **Size of the bug:** with real league inputs on Oct 29, 61% of simulated team-seasons ended over the 13-man limit (14–19 players).
- **Who it favored:** teams with an injured, low-value player, who is usually the first streamed away.
- **Fix:** the fill-in goes if he's still on the roster, otherwise the roster's lowest-projected player. A test checks that no simulated roster ever exceeds the league limit. It fails on the old code.

It showed up in a real decision. Jack dropped the injured Egor Demin (out until Nov 7) for Collin Gillespie, and the Outlook's odds fell.

Same draws, 2,000 seasons, two seeds:

|                                   | Title        | #1 seed  | Playoffs | Expected wins |
| --------------------------------- | ------------ | -------- | -------- | ------------- |
| Before the fix: Demin → Gillespie | −3.5 pts     | −4.4 pts | −3.5 pts | −0.44         |
| After the fix: Demin → Gillespie  | −0.5 (noise) | +1.0     | +0.4     | +0.05         |

The move was about neutral, not harmful. The Waivers page had said +0.31 wins: Waivers values a roster as fixed, while the simulator also lets the team stream that spot. Making recommendations agree with the simulator is the next change (ADR-033).

## Pre-registration: minutes-aware early-season projection (2026-10-29, before any run)

**Question:** do hot starts deserve more weight? Jack noticed guards starting well, such as Ja'Kobe Walter: 27.1 FP/G over 4 games, projected 16.5 by the current 15-game blend.

**Hypothesis:** breakouts are mostly minutes. Fantasy points per minute are stable, so a role change should move the projection faster than a scoring streak.

**Candidate "minutes × rate":**

- **Minutes:** his prior-season minutes blended with this season's at `kMin` prior games.
- **Rate:** fantasy points per minute: prior-season rate blended with this season's at `kRate` prior minutes-equivalent games.
- **Prediction:** minutes × rate, then the shipped minutes trend and game environment.

**Procedure:**

- Grid `kMin` ∈ {2, 4, 8} × `kRate` ∈ {15, 30}, explored on 2025-26 (prior 2024-25). The best by overall MAE is chosen there.
- That one candidate is then run once on held-out 2024-25 (prior 2023-24) against the current model.

**Ships if** its per-player mean error difference vs the current model has a 95% CI entirely below 0 on the held-out season. It is also reported for games 1–20, where it should help most.

### Result (2026-10-29): passed, shipped

The pre-registration above was committed (3b6b805) before either run.

**Exploration, 2025-26** (270 players, 16,652 games): the error difference vs the current model, mean per player with 95% CI.

| kMin \ kRate | 15                          | 30                      |
| ------------ | --------------------------- | ----------------------- |
| 2            | **−0.072 [−0.103, −0.041]** | −0.058 [−0.090, −0.026] |
| 4            | −0.062                      | −0.046                  |
| 8            | −0.038                      | −0.021                  |

kMin 2, kRate 15 was chosen.

**Held out, 2024-25** (242 players, 14,951 games), chosen candidate only:

| Predictor                                      |   MAE | Games 1–20 | Games 21+ | vs current (95% CI, by player) |
| ---------------------------------------------- | ----: | ---------: | --------: | ------------------------------ |
| minutes × rate (kMin 2, kRate 15)              | 10.49 |      10.15 |     10.65 | −0.038 [−0.065, −0.010]        |
| current model (blend 15 + trend + environment) | 10.51 |      10.22 |     10.66 | baseline                       |

The CI is entirely below 0, so it ships. In production the prior is ESPN's preseason projection: its minutes and its points per minute. Players without minutes data fall back to the old blend.

**Early-season examples, Oct 29:**

- Christian Braun: 35.8 minutes against 27.5 projected, 18.0 → 20.5.
- Jalen Suggs: 33.3 against 26.3, 20.6 → 23.2.
- Scotty Pippen Jr.: 16.8 against 25.1, 20.4 → 16.8.

**Not covered yet:** players ESPN didn't project, such as Pelle Larsson (30.8 minutes, 21.5 FP/G). They keep the 15 FP/G prior blend. A minutes-aware prior for them is the next candidate.

## Pre-registration: teammate absences and opponent defense (2026-10-29, before any run)

The baseline is the shipped model: minutes × rate, minutes trend, game environment. The harness is the same walk-forward backtest, with the same pool and prior seasons.

**A. Teammate absences as minutes.** The blanket points boost failed (ADR-031). This candidate moves minutes only: expected minutes += kSame × minutes usually played by absent same-position regulars, plus kOther × minutes of other absent regulars, capped at 40. His per-minute rate is unchanged. Absences are point in time: a regular (20+ minutes over his last 10 games, for this team within 10 days) who didn't play.

- Grid: kSame ∈ {0.1, 0.2, 0.3} × kOther ∈ {0, 0.05}.

**B. Opponent defense against each position.** For each opponent and each player's first listed position: actual fantasy points over our baseline projection, summed over the opponent's earlier games only (point in time). The factor is f = (n·r + k) / (n + k), where n is the number of player-games so far and r is that ratio. Prediction × f.

- Grid: k ∈ {100, 200, 400}.

**Procedure:** each family's best setting by overall MAE on 2025-26 (prior 2024-25) is then judged once on held-out 2024-25 (prior 2023-24). A family ships only if its per-player error difference against the shipped model has a 95% CI entirely below 0 there.

Vegas player props already price tonight's absences, so A matters most for the days ahead (Matchup, Waivers, Outlook). Vegas totals already price overall defense, so B tests only the positional part on top.

### Results (2026-10-29)

**A. Teammate absences as minutes: failed at exploration (2025-26).** Every setting was worse than the shipped model, so per the rule it was not run on the held-out season.

| Setting             | vs shipped (95% CI, by player) |
| ------------------- | ------------------------------ |
| kSame 0.1, kOther 0 | +0.025 [+0.003, +0.048]        |
| kSame 0.2, kOther 0 | +0.148 [+0.103, +0.193]        |
| kSame 0.3, kOther 0 | +0.316 [+0.252, +0.380]        |

The kOther 0.05 settings were worse again. This is the second form of the idea to fail (after ADR-031). Two reasons it may fail:

- The minutes model already moves minutes quickly once a role changes.
- Absences are inferred from the player pool (~380 players), so some are missed.

Sportsbook props price tonight's absences directly once they're known, and the props blend is the route for that.

**B. Opponent defense by position: passed, shipped.**

- Exploration (2025-26): k 100 −0.009, **k 200 −0.010 [−0.017, −0.002]**, k 400 −0.007.
- Held out (2024-25), k 200: **−0.010 FP/game, 95% CI [−0.017, −0.002]**. MAE 10.48 → 10.47.

The gain is small and grows through the season as each opponent's sample grows; early on the factors sit near 1.

**In production:**

- **Nightly:** `lib/nba/defense.ts` rebuilds the table from every logged pregame projection and its result, with the factor itself divided back out (`pregame_projections.matchup_factor`, migration 0013), so it never feeds on its own output.
- **Where it applies:** today's and this week's projections (Today, Matchup, Waivers this week, logged projections, the player card, which names it). Not the rest-of-season values, where opponents average out.

## Pre-registration: three candidates (2026-10-29, before any run)

All three are judged against what ships today: minutes × rate (kMin 2, kRate 15), minutes trend, game environment and opponent defense by position (k 200). The walk-forward harness is `apps/web/scripts/backtest-projection.ts`. Each test reports per-player mean error differences with a 95% interval; a candidate **ships only if that interval is entirely below 0** on its judging data.

### C. A minutes-aware prior for players ESPN didn't project

**Today:** these players (Pelle Larsson-type) blend their season average toward a flat 15.0 FP/G at 15 prior games, ignoring minutes.

**Candidate:** minutes × rate with generic priors:

- prior minutes M0 = 22.8 (the median ESPN-projected minutes among the 178 projected free agents, Oct 29);
- prior rate R0 = 15.0 / 22.8 = 0.658 FP per minute, so a player with no games still projects to 15.0, as today;
- kMin 2, kRate ∈ {5, 15}.

The trend, environment and defense layers are applied to both, as in production.

**Pool:** players in the harness pool with fewer than 20 games in the prior season (no real prior: rookies and fringe players) and 20+ in the test season. Each is projected as if ESPN hadn't projected him.

**Procedure:** pick kRate on 2025-26 (prior 2024-25); judge that one setting once on held-out 2024-25. If the held-out pool has fewer than 30 players, the result is reported as inconclusive and nothing ships.

### D. DARKO in the blend (forward test on logged data)

DARKO can't be backtested: only today's projection is published. The daily snapshot (`projection_snapshots`, source `darko`) has been saved since the morning job started logging it.

**Data:**

- For each logged pregame projection with a result, DARKO's projection is its latest snapshot captured before tip and dated within 2 days of the game.
- That projection's per-game box score is scored with the league's settings.

**Protocol:** the same as the props test (`lib/nba/props-eval.ts`):

- the first evaluation runs once there are ≥7 game days and ≥800 player-games with both projections;
- the weight w ∈ {0, 0.1, …, 1} is chosen on the first half of the game days;
- (1 − w)·ours + w·DARKO is judged on the second half.

**Ships if** w > 0 and the interval is entirely below 0. It is evaluated nightly and shown on `/nba/model`. Passing it would then be wired into projections in its own PR.

### E. Opponent defense per stat

**Today:** one factor per opponent and position scales the whole projection.

**Candidate:** one factor per opponent, position and counting stat (FGM, FGA, FTM, FTA, 3PM, REB, AST, STL, BLK, TO).

- His expected count of each stat is the baseline projection × his prior-season count per fantasy point (point in time).
- f = (n·r + k) / (n + k) from the opponent's earlier games against that position, where r = actual count ÷ expected count.
- The prediction adds, for each stat, (fantasy value of one unit) × expected count × (f − 1) to the baseline.
- The baseline here is minutes × rate + trend + environment, with no position factor.
- k ∈ {100, 200, 400}.

**Procedure:** pick k on 2025-26 against the shipped overall factor (k 200); judge that one k once on held-out 2024-25 against it.

### Results (2026-10-29)

The pre-registration above was committed (710e033) before any run. Exploration picked kRate 15 for C and k 200 for E (by overall MAE).

**C. Unprojected players' minutes: passed, shipped.**

| Season                 | Pool                        | Fallback MAE | Candidate MAE | vs fallback (95% CI, by player) |
| ---------------------- | --------------------------- | -----------: | ------------: | ------------------------------- |
| 2025-26 (exploration)  | 47 players, 2,781 games     |        9.470 |         9.066 | −0.536 [−0.779, −0.293]         |
| **2024-25 (held out)** | **52 players, 2,849 games** |    **9.459** |     **9.140** | **−0.463 [−0.689, −0.238]**     |

- The gain is large because the flat 15.0 FP/G pull ignores a young player's role.
- **In production:** ESPN gives season minutes for 52 of the 72 unprojected players with a season on Oct 29. They now get minutes × rate from the generic priors; the other 20 keep the flat blend.
- **Caveat:** the backtest pool (players without a real prior, mostly rookies) stands in for "ESPN didn't project him". Players who reach 20 games are survivors, but both predictors are judged on the same players.

**E. Opponent defense per stat: failed, not shipped.**

| Season                | k 200 vs shipped overall factor (95% CI) |
| --------------------- | ---------------------------------------- |
| 2025-26 (exploration) | +0.002 [−0.000, +0.005]                  |
| 2024-25 (held out)    | +0.004 [+0.002, +0.007]                  |

The per-stat version is slightly worse. Ten factors per opponent and position spread the same sample thin, and the overall factor already captures most of it.

**D. DARKO in the blend: collecting.**

- The nightly morning job now scores DARKO's snapshot for every logged game and runs the props test's rules on it (`model_settings` `darko_blend`).
- `/nba/model` shows DARKO's accuracy and the test's status.
- The first verdict comes once there are 7 game days and 800 games with both projections.

## Pre-registration: availability (2026-10-29, before any outcome was looked at)

**Question:** how likely is a listed player to play? Today the app takes ESPN's injury feed, which only says "Out" or "Day-To-Day", and plays a day-to-day player with probability 0.75 (`fantasy-core` `playProbability`). The finer priors in that table (probable 0.93, questionable 0.5, doubtful 0.12) are guesses and never see those statuses from ESPN.

**Data:** the NBA's official injury report, a PDF the league publishes through each game day (hourly at :30 until late 2025, every 15 minutes since) and archives. Each report prints its own publish time, so it is point in time. Parsed with `packages/nba-data/src/injury-report.ts`; the harness is `apps/web/scripts/backtest-availability.ts`.

- **Snapshots** for each game: **midday**, the latest report published at or before min(1 PM ET, tip − 3 h); **pre-tip**, the latest at or before tip − 1 h. Reports are searched up to 3 hours back from the cutoff; a game without one in that window has no row for that snapshot.
- **Rows:** every listed player (Available, Probable, Questionable, Doubtful, Out) in the projection harness's pool (today's rostered players and top free agents), matched by name and team, in regular-season games. Player-seasons with no logged games are left out, because a failed game-log fetch looks the same.
- **Label:** he played (minutes > 0 in that game, from his ESPN game log).
- **Point-in-time features:** games his team has played before this one that he missed in a row (team schedules come from the logged games of every pool player's opponents).

**Baselines:**

- **B0, today's app:** Out 0; Probable, Questionable and Doubtful 0.75 (ESPN shows them as day-to-day); Available 1.
- **B1, the status priors:** Probable 0.93, Questionable 0.5, Doubtful 0.12, Out 0, Available 1.

**Candidates** (each cell's play rate on the fit season, smoothed toward its parent with 10 pseudo-rows):

- **A1:** status × snapshot, smoothed toward B1.
- **A2:** A1 split by whether he played his team's previous game (no previous game counts as played), smoothed toward A1.
- **A3:** A1 split by games missed in a row (0, 1–2, 3+), smoothed toward A1.

**Procedure:**

- Walk forward: exploration fits on 2024-25 and scores 2025-26. It picks one of A1–A3 by mean Brier score.
- That one candidate is judged once on held-out 2024-25, fit on 2023-24.
- The metric is the per-player mean Brier difference with a 95% interval.
- **Ships only if** the held-out interval is entirely below 0 against **both** B0 and B1. If the held-out season has fewer than 2,000 non-Out rows, the result is inconclusive and nothing ships.

**If it ships:**

- The table is refit on 2025-26 with the same smoothing and hard-coded.
- The app reads the latest official report in the 5-minute job, logs it to `status_events` (source `nba_injury_report`), and uses the fitted chance for players it lists for that game.
- A report published 3+ hours before tip uses the midday table; a later one uses the pre-tip table.
- Players it doesn't list keep today's ESPN-based chance.
- The NBA.com inactive list stays final.
- Chances for days ahead (week projections) are unchanged; that's a separate candidate.

### Result (2026-10-30): failed, not shipped

The pre-registration above was committed before any outcome was looked at: the first commit of PR #44 (7060fc0 on the PR branch; the run happened after it). Later harness changes only fixed fetching: the hourly-to-quarter-hourly switch date, retrying network errors, and the All-Star break gap.

**Data:**

- The official reports came from the league's archive.
- Of 776–803 tip-time groups per season, 96–99% had a midday report and 99% a pre-tip report.
- About 55% of listed players are in the pool; the rest are mostly two-way and G League players.
- Reports switched from hourly to quarter-hourly on 2025-12-22.

Exploration (fit 2024-25, score 2025-26; 14,939 rows, 323 players) picked **A3** by mean Brier (0.0399; A2 0.0401, A1 0.0407).

| Held out: 2024-25, fit on 2023-24 (13,390 rows, 297 players) |      Brier | vs B0 (95% CI, by player)      | vs B1 (95% CI, by player)      |
| ------------------------------------------------------------ | ---------: | ------------------------------ | ------------------------------ |
| B0 today (ESPN day-to-day = 0.75)                            |     0.0768 |                                | +0.0249 [+0.0188, +0.0309]     |
| B1 status priors                                             |     0.0546 | −0.0249 [−0.0309, −0.0188]     |                                |
| **A3 (chosen)**                                              | **0.0546** | **−0.0251 [−0.0297, −0.0206]** | **−0.0003 [−0.0027, +0.0022]** |

A3 beats B0 but not B1, so it fails the gate.

**What the test found:**

- Almost all of the gain comes from the official report's finer statuses. Fitting the chances adds nothing measurable over the priors already in `fantasy-core`.
- On both seasons, players actually played at these rates (2024-25 / 2025-26):
  - questionable: 53–63%;
  - probable: 93–98%;
  - doubtful: 0–5%;
  - Available (listed, then cleared): 90–95%.
- Today the app treats every ESPN day-to-day player as 0.75 to play.

**Not shipped:** B1 on official statuses was not a pre-registered candidate, and both seasons have now been seen. It is tested forward instead (below).

## Pre-registration: official statuses, forward test (2026-10-30, before any data)

**Candidate:**

- For a player on the latest official report, his chance to play comes from his listed status, using the existing priors (probable 0.93, questionable 0.5, doubtful 0.12, out 0, available 1).
- Players not listed keep today's ESPN-based chance.

**Baseline:** today's app, ESPN's injury-feed status at the same moment (day-to-day 0.75, out 0, not listed 1).

**Data (logged from this PR's deploy on):**

- The 5-minute job reads each new official report from 9 AM ET on game days. It stores every status change for listed players it can match to an ESPN player (league rosters and ESPN's injury feed), along with the report's printed time.
- It also logs ESPN's injury feed for every listed player from 9 AM.

**Rows:**

- For each listed player and game, two snapshots: midday, the latest report at or before min(1 PM ET, tip − 3 h), and pre-tip, the latest at or before tip − 1 h.
- The baseline uses ESPN's latest status for that game day observed before the same cutoff. A row without an ESPN observation that day before the cutoff is left out.
- The label is whether he played (a box score line in `game_results`).

**Metric:** per-player mean Brier difference, candidate − baseline, with a 95% interval.

**Ships only if** the interval is entirely below 0. The first evaluation runs once there are ≥1,500 non-Out rows; one evaluation, no peeking before then.

**Note (2026-11-05, no rows evaluated yet):** to save Vercel CPU (docs/COMPUTE.md), Jack approved logging every 10 minutes before the game window opens (90 min before the first tip); it stays every 5 minutes in the window.

- **Official reports** come every 15 minutes, and each carries its printed time, so every report is still read and placed by that time.
- **The pre-tip cutoff** (tip − 1 h) is inside the window, so it's unchanged.
- **The only effect:** the midday cutoff's ESPN observation can be up to 10 minutes old instead of 5. This works slightly against the baseline, and is recorded here before any evaluation.

**Note (2026-11-06, no rows evaluated yet):** under the CPU saver (Nov 6 to Nov 22, docs/COMPUTE.md), logging runs every 30 minutes before the game window and every 10 minutes in it.

**Note (2026-11-09, no rows evaluated yet):** in minimal mode (Nov 9 to Nov 21) logging runs every 30 minutes throughout, and the saver's cadence then holds until Nov 29. Official reports come every 15 minutes, so a status may be logged up to ~30 minutes after it appeared.

- **In the window,** every 15-minute report is still read, and the pre-tip cutoff is unchanged.
- **Before the window,** about half the official reports are not read. The midday row then uses the latest report read before its cutoff (up to 30 minutes older), and ESPN's observation can be up to 30 minutes old. Both sides lose freshness. Rows from these days are kept and evaluated with the rest, as registered.

**Note (2026-11-16, no rows evaluated yet):** to let Neon sleep (docs/COMPUTE.md §10), the 5-minute job remembers per server instance which statuses it has stored and skips the query when nothing changed. Cadence and the rows logged are unchanged: a status that's new to the table is still inserted at the run that first sees it. (Saver and minimal mode ended Nov 10; the cadence is back to every 10 minutes before the window and every 5 in it.)

## Pre-registration: day-to-day players on later days (2026-11-02, before any run)

**Question:** how likely is a player listed day-to-day today to play his team's games on the next few days?

**Today's rule (week projections and the season simulation):**

- A day-to-day player (ESPN shows the official report's probable, questionable and doubtful all as day-to-day) plays with probability 0.75 today and tomorrow, then 1.
- Ruled-out players are unchanged by this test: they sit until ESPN's estimated return date, which historical reports don't carry.

**Data:**

- The NBA's official injury reports for 2023-24, 2024-25 and 2025-26 (cached by `scripts/backtest-availability.ts`).
- The harness is a new mode of that script (`DAYS_AHEAD=1`).

**Rows:**

- For each day D with games, the latest report published at or before 1 PM ET.
- Every listed player with status Probable, Questionable or Doubtful, matched to an ESPN player in the projection pool.
- One row per game his listed team plays on days D+1 to D+6.
- **Label:** he played (minutes > 0 in his ESPN game log).
- Player-seasons with no logged games are left out.

**Baseline B0 (today):** 0.75 for a game on D+1, 1 for later days.

**Candidate C1 (the only one):** the play rate by days ahead (1, 2, 3, 4–6) on the fit season, smoothed toward B0 with 10 pseudo-rows.

**Procedure:**

- **Exploration:** fit on 2023-24, score 2024-25 (reported, not a gate).
- **Held out, judged once:** fit on 2024-25, score 2025-26.
- **Metric:** per-player mean Brier difference (C1 − B0) with a 95% interval.
- **Ships only if** the held-out interval is entirely below 0, with at least 2,000 rows.

**If it ships:**

- `playChance` in `lib/nba/week.ts` uses the table refit on 2025-26 for day-to-day players on later days (today unchanged).
- The season simulator's injury chain is not changed by this test.

### Result (2026-11-02): passed, shipped

The pre-registration above was committed (6ce7d6b) before the harness existed. Exploration ran first, then the held-out season once.

**Exploration:** fit 2023-24 (4,406 rows), score 2024-25 (5,411 rows, 273 players). C1 − B0 = −0.0602 [−0.0729, −0.0475].

| Held out: 2025-26, fit on 2024-25 (4,946 rows, 297 players) |      Brier | vs B0 (95% CI, by player)      |
| ----------------------------------------------------------- | ---------: | ------------------------------ |
| B0 today (0.75 tomorrow, then 1)                            |     0.2662 |                                |
| **C1 play rate by days ahead**                              | **0.1992** | **−0.0564 [−0.0716, −0.0412]** |

| Days ahead |  Rows | Played (2025-26) |   B0 | C1 (fit on 2024-25) |
| ---------- | ----: | ---------------: | ---: | ------------------: |
| 1          |   391 |            0.586 | 0.75 |               0.627 |
| 2          | 1,142 |            0.722 | 1.00 |               0.704 |
| 3          |   842 |            0.702 | 1.00 |               0.727 |
| 4–6        | 2,571 |            0.750 | 1.00 |               0.725 |

**What it found:**

- A player listed probable, questionable or doubtful at 1 PM plays only about 59% of his team's games the next day, and about 70–75% over the following five days.
- The app assumed 75% tomorrow and 100% after that.
- Week projections and the Matchup win chance were too high for banged-up rosters.

**Shipped:** `playChance` (`lib/nba/week.ts`) uses the table refit on 2025-26:

- 1 day 0.59; 2 days 0.725; 3 days 0.705; 4–6 days 0.751;
- today unchanged; 7+ days counts as healthy (untested).

## Pre-registration: manager activity from lineups (2026-11-02, before any run)

**Question:** how should the season simulation estimate how often a manager sets a lineup (`act`)?

**Today:**

- `act` is ESPN's count of moves to an active slot ÷ (2.5 moves × days so far).
- It's blended with last season's count when the same ESPN owner returns (new owners start at 0.7, 21-day prior weight).
- A deep, healthy roster needs few moves and can look inactive.

**Target:** what `act` means in the simulator, the share of days a manager's lineup is set.

- A **set day** for a team: no bench player with a game that day sat while a starting slot he could fill was empty or held by a player without a game.
- The realized share of set days in a later window is the truth to predict.

**Data:**

- 2025-26 (this league): each team's roster and lineup slots on every day (cached by `scripts/backtest-win-prob.ts`, `data/local/winprob-2026/`).
- Games from the cached ESPN game logs (a player "had a game" if his team played).
- **Moves to active** are counted from day-to-day slot changes (bench or IR to a starting slot), as ESPN counts them.

**Predictions:** at the end of each regular-season week k = 2–18, for each team, predict its set-day share in weeks k+1 to k+3:

- **A (today):** the move-count formula on weeks 1..k (2.5 moves per active day, capped at 1). The prior is the neutral 0.7 with 21-day weight (last season's counts aren't in the cache).
- **B (candidate):** the set-day share in weeks 1..k, shrunk toward the league's share in weeks 1..k with 14 pseudo-days.
- **C (candidate):** everyone 1.0.

**Metric:** mean absolute error, clustered by team: each team's mean |error| over its k, then a mean ± 95% interval over the 12 teams of B − A and of C − A.

**Ships:**

- The better of B and C, only if its interval is entirely below 0 against A.
- If neither passes, `act` stays as it is.

**If B ships:**

- `act` comes from this season's set days (nightly, from ESPN's daily lineups), with the same shrinkage.
- Last season is no longer used.
- The Outlook's "Active" column shows it as "Lineups set".

### Result (2026-11-02): neither candidate passes; `act` unchanged

The pre-registration above was committed (6ce7d6b) before the harness existed (`scripts/backtest-activity.ts`, one run).

**Data:** 2025-26, 139 days of all 12 teams' lineups. Predictions were made at the end of weeks 2–18.

| Estimate of act                      | MAE (mean of 12 teams) | vs A (95% CI, by team, t with 11 df) |
| ------------------------------------ | ---------------------: | ------------------------------------ |
| A today (move counts, neutral prior) |                 0.1438 |                                      |
| B set-day share, shrunk              |                 0.1068 | −0.0370 [−0.0978, +0.0238]           |
| C everyone 1.0                       |                 0.2005 | +0.0567 [−0.0802, +0.1935]           |

**What it found:**

- Managers really differ: season set-day shares were 0.42, 0.58, 0.61, 0.70, 0.80, 0.90, 0.91, 0.94, 0.99, 0.99, 0.99 and 1.00.
- "Everyone 100%" is the worst of the three.
- The lineup-based share was closer on average, but with 12 teams its interval includes 0, so it doesn't ship.
- A forward retest on this season's lineups needs its own pre-registration.

## Pre-registration: ESPN's estimated return dates (2026-11-06, before any look at the data)

**Question:** ESPN's injury feed gives a return date for nearly every ruled-out player. Season-long values (trades, waivers, the Outlook, the simulator) count a player from that date (`lib/nba/availability.ts absenceOf`). Often the date is when he'll be **re-evaluated** ("re-evaluated in two weeks"), not when he returns. Do players come back later than ESPN's date, and by how much?

**Today's rule (baseline):** out until ESPN's estimated return date, or 7 days when there's none.

**Candidate:** ESPN's date plus the median lag observed in training, by type:

- notes saying "re-evaluated";
- every other note with a date.

**Data:**

- `status_events` rows with a `return_date` (logged since Oct 27, 2026);
- `game_results` for the first game played after the absence began.
- An absence counts once it has ended (he played again) or the season is over.
- Rows are matched by ESPN player id.

**Split:** absences that began on even ISO weeks train, odd weeks test.

**Metric:** mean absolute error in team games missed, candidate vs baseline, on the test half, with a 95% bootstrap interval of the difference.

**Ships only if** the interval is entirely below 0. Then the lag goes into `absenceOf`, with an ADR.

**When:** first evaluation once ≥60 absences have ended; one evaluation, no peeking before then.

**Not part of this test:** how long day-to-day players sit (the day-to-day test, 2026-11-02).

## Pre-registration: position-aware streaming in the season simulator (2026-11-16, before any run)

**Question:** in the season simulator (`packages/fantasy-core/src/sim.ts`), every manager streams and makes IR pickups by raw value: the roster player with the lowest `fppg x games left this week + 3 x fppg` goes for the free agent with the highest. Position isn't considered, so a simulated team can stream its third guard away for a sixth center. Jack asked for the simulation to respect roster construction. Does a position-aware rule keep the simulator's calibration, and does it stream to fit?

**Today's rule (baseline):** the raw value above.

**Candidate:** the same rule, but each value counts lineup points:

- **This week:** what the player adds to the team's lineups on its remaining days. A free agent counts his points where an open slot takes him, otherwise his gain over the weakest starter whose slot he fits. A roster player counts what the lineup loses without him: his points minus the best bench player who could fill his slot.
- **Later:** `3 x fppg`, scaled by the share of this week's games he'd start (1 with none left).
- Lineups use each day's healthy players as of today.
- Only the 5 best free agents by today's raw value are scored.
- The same threshold applies (+8), with the same add budget.
- IR pickups use the same value.

**Data:** the league as it stands on the run day (ESPN reads only; nothing is written). Both rules run 4,000 seasons with the same seed (common random numbers), plus one synthetic roster.

**Checks (all must pass):**

1. **Fit (synthetic):** a team with two guards for three guard-only slots (PG, SG, G) and six centers, and one free agent of each kind at equal points. The candidate streams the guard in at least 90% of its streams; the baseline is reported alongside.
2. **Add volume:** for every team with `addsPerWeek >= 0.25`, the candidate's simulated adds per week are within ±15% (or ±0.15 adds, whichever is larger) of the baseline's. The baseline is calibrated to managers' real add counts, and the candidate must not undo that.
3. **Weekly scoring spread:** for every team with `act >= 0.7`, the coefficient of variation of weekly points is within ±0.01 of the baseline's (calibrated to ~0.13).
4. **Points:** the league's mean weekly points under the candidate are at least the baseline's minus 0.5%. A smarter streamer shouldn't score less.
5. **Cost:** CPU per simulated season is at most 20% above the baseline's, on the same machine.

**Reported, not pass/fail:** each team's title odds before and after, and the Nov 16 Paul Reed moves (dropping Naz Reid or Kris Dunn).

**Ships only if** all five checks pass. Then the candidate becomes the default, with an ADR; otherwise the rule stays and the result is written here.

**When:** one evaluation, run once the candidate is implemented (`apps/web/scripts/experiment-fit-streams.ts`), with no tuning between runs. A failed check isn't re-run with changed thresholds.

### Result (2026-11-16): failed checks 1 and 5, not shipped

One evaluation. The code is kept on the unmerged branch `experiment/fit-streams` (d07ab7c): the `fitStreams` flag, the per-season adds and pickups it was measured by, the check-1 test, and `scripts/experiment-fit-streams.ts`. League setup: day 28 (week 5), 15 regular weeks left, 4,000 seasons per rule.

| Check                    | Result                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 1. Fit (synthetic)       | **Fail.** The guard was 0.556 of the candidate's pickups of the two (n = 417; raw rule 0.480, n = 515). The bar was 0.90. |
| 2. Add volume            | Pass for all 11 teams with ≥ 0.25 adds per week. The largest change was −0.08 a week.                                     |
| 3. Weekly scoring spread | Pass for all 9 teams with act ≥ 0.7. Every CV moved by 0.003 or less.                                                     |
| 4. League points         | Pass: 847.7 → 861.5 a week (+1.6%).                                                                                       |
| 5. Cost                  | **Fail:** 3.6 → 8.9 ms per season (+147%). The bar was +20%.                                                              |

- **A disclosure on check 1:** the first harness measured a proxy, which of the two free agents was on the final roster: 0.773 vs raw 0.503. The pre-registration says "its streams", so the pickups themselves were then counted once, and that count is the result above. The bar wasn't changed.
- **Why check 1 failed (diagnosis after the result):** at 1.5 adds a week, the synthetic team usually adds **both** free agents over a season. The center also adds lineup points: UTIL slots held by 19–20-point forwards. So the share of pickups can't show which one the rule prefers when it has to choose. A revised check would need to measure the first choice between them. That needs a new pre-registration, and a cheaper candidate, given check 5.
- **Reported (4,000 seasons, noisy):** Jack's title odds with Reed for Naz Reid: raw +0.2, fit +0.6. With Reed for Kris Dunn: raw +0.8, fit +0.9. Production's racing deep check that day settled at Reid +0.4±0.1 and Dunn +0.3±0.1 (160,000 seasons).
- **Note on check 3:** CVs were pooled over seasons and weeks (about 0.29, which includes between-season spread), not the within-season ~0.13 of the calibration. Both rules were measured the same way.

## Pre-registration: position-aware streaming, attempt 2 (2026-11-16, before any run)

**Why again:** the first attempt failed two checks (above). Check 1 was confounded: over a season the synthetic team adds both free agents, so the share of pickups can't show which one the rule prefers. Check 5 failed on cost: lineups were re-solved for each day of the week at every stream check.

**Candidate (attempt 2):**

- **Same values as attempt 1:** lineup points this week (positions, schedule, current absences), plus `3 x fppg` scaled by the share of games started.
- **Cached lineups:** each team's lineups for the week, with every roster player who plays that day, are solved once per team per week and roster, then reused at every check. A player's own availability still counts his current absence.
- **Fewer scored:** only the 5 weakest roster players by raw value are scored as drops (5 best free agents, as before).
- Branch `experiment/fit-streams-2`.

**Checks (all must pass):**

1. **First choice (synthetic, same roster and free agents as attempt 1):** in each season where team 1 picks up either free agent, the first one picked is the guard in ≥ 90% of seasons. The raw rule is reported alongside.
2. **Add volume:** as in attempt 1 (±15% or ±0.15 adds a week of the raw rule, teams with ≥ 0.25 adds a week).
3. **Weekly scoring spread:** as in attempt 1 (±0.01 CV, teams with act ≥ 0.7).
4. **League points:** as in attempt 1 (≥ the raw rule's − 0.5%).
5. **Cost:** CPU per simulated season ≤ +20% over the raw rule, same machine, same run.

**Data and run:** the league as it stands on the run day; 4,000 seasons per rule, same seed (`scripts/experiment-fit-streams.ts`); check 1 as a test, 200 seasons. One evaluation, no tuning between runs.

**Ships only if** all five pass (then `fitStreams` becomes the default, with an ADR). Otherwise the result is written here and the raw rule stays.

### Result (2026-11-16): failed check 5 (cost), not shipped

One evaluation (pre-registration on main at f038550; code on the unmerged branch `experiment/fit-streams-2`, 1768146). Setup: day 28 (week 5), 4,000 seasons per rule.

| Check                       | Result                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------- |
| 1. First choice (synthetic) | Pass: the guard was the first pickup in 1.000 of seasons (n = 200; raw rule 0.070). |
| 2. Add volume               | Pass for all 11 teams; the largest change was −0.09 a week.                         |
| 3. Weekly scoring spread    | Pass for all 9 active teams; every CV moved by 0.003 or less.                       |
| 4. League points            | Pass: 847.3 → 861.2 a week (+1.6%).                                                 |
| 5. Cost                     | **Fail:** 3.7 → 7.7 ms per season (+108%; the bar was +20%).                        |

- **Reading:** the rule does what it should: it picks the player the lineup is missing, and it keeps the sim's calibration. But it doubles the simulation's cost even with the week's lineups cached, so every job would take about twice as long.
- **Before an attempt 3:** profile where the time goes. One candidate is roster changes clearing the lineup caches, and the per-check scoring. Any new attempt needs its own pre-registration.
- **Reported (4,000 seasons, noisy):** Reed for Naz Reid: raw −1.0, fit +0.3. Reed for Kris Dunn: raw +0.4, fit +1.3.

### Attempt 3: profiling, no test run (2026-11-16)

Branch `experiment/fit-streams-3` (not merged). `scripts/profile-sim.ts` there snapshots the league's simulation input to `data/local/` and times or profiles either rule offline (a plain esbuild bundle under `node --cpu-prof`; through tsx every frame reads as line 1). One machine, 1,000 seasons, profiling seed 20261116.

**Where attempt 2's extra time went** (fit 7.8 ms vs raw 4.0 ms per season, self time over 1,000 seasons):

| Cost                           | Extra   | Cause                                                                                  |
| ------------------------------ | ------- | -------------------------------------------------------------------------------------- |
| `topFree`                      | +0.75 s | re-sorted its shortlist on every insert while scanning every free agent                |
| `weekOf` and its lineup solves | +1.1 s  | the week's lineups solved again after every roster change and at each new week         |
| `lastSlots`                    | +0.54 s | copying lineup slots, also on the raw path (so the measured baseline was inflated too) |
| drop pool, closures, GC        | +0.6 s  | copy-and-sort of the roster each check, closures built per check                       |

**The rewrite:** slots only on the fit path; week lineups from today on; fixed-size shortlists; scoring hoisted out of per-check closures. It makes **identical decisions** (same seed: the same 73,021 adds and the same title odds for all 12 teams as attempt 2). The cost went from **7.8 to 5.1 ms per season**, against a raw rule of **3.1 ms** in the same bundle: **+65%**, short of check 5's +20%.

**What's left is the design, not waste:** per 1,000 seasons, 424k fit checks, 60% of which rebuild the week's lineups (each team's first check of a week, and every check after a roster change). That's 1.37M extra lineup solves on top of the raw rule's 1.57M, plus the scoring itself. Getting to +20% needs a cheaper model of positional need, for example room counts by position without solving lineups, or today's room only. That would be a different candidate with its own pre-registration. So **no attempt-3 run was made**: it would fail check 5 for certain.

### Attempt 4: an exact cheaper rewrite, no test run (2026-11-16)

Jack asked (Nov 16) for the cheaper version. Branch `experiment/fit-streams-4` (6d7cc7b, not merged); the values are attempt 2's, unchanged.

- **A gate was tried first and dropped:** letting the raw rule decide whether to stream and lineup values only whom saves nothing, because the raw rule wants a stream at 70% of checks with budget (294k of 419k per 1,000 seasons).
- **Day lineups without solving:** the best lineup from a subset of players keeps every full-roster starter in that subset (greedy on a matroid). So each day's lineup starts from the standing lineup's starters who play and adds the others who play, best first, by the solver's augmenting paths. Checked equal to a full solve on all 1.64M day lineups of 1,000 seasons.
- **The standing lineup follows each stream:** without the dropped player it refills his slot from the bench; the pickup takes a slot by an augmenting path or replaces the weakest starter whose removal lets him in. Equal to a full solve on all 194k swaps checked.
- **Free agents ranked once a day** for every team's check (values change only daily), and a healthy free agent whose raw value can't beat the best so far isn't scored (his lineup value can't exceed it). Identical pickups with and without.
- **Slot assignment** can differ from a full solve's (same players), which changes some scores: 240,625 pickups vs 240,910 on the profiling seed.

**Cost** (profiling seed 20261116, one machine, 2,000 seasons, six alternating raw/fit pairs): fit/raw **1.19–1.25, median +22%** (attempt 3: +65%; attempt 2: +108%). Scoring 3 candidates a side instead of 5 measured +11% to +19%, within run-to-run noise of the default, so it isn't proposed.

**No pre-registered run:** at +22% check 5's +20% bar would likely fail narrowly. Whether to keep that bar or set another before an attempt-4 run is Jack's call; checks 1–4 would stay as in attempt 2.

## Pre-registration: position-aware streaming, attempt 4 (2026-11-17, before any run of checks 1–4)

**Goal (unchanged since attempt 1):** the season simulator behind every title-odds number (Moves, trades, the Outlook) has each team stream by raw value, ignoring position, so a simulated team can drop its third guard for a sixth center. That makes simulated rivals, and Jack's own simulated streaming, play worse than real managers who fill lineups, and it can mis-rank adds and drops that change roster construction (Jack asked Nov 16 for the simulation to respect it). The candidate values streams by the lineup points they add this week.

**Candidate:** attempt 2's values exactly, computed as in attempt 4 above (`experiment/fit-streams-4`, 6d7cc7b): day lineups patched from the standing lineup, the standing lineup carried through each swap, free agents ranked once a day.

**Checks 1–4:** as in attempt 2 (first choice ≥ 90% in the synthetic test; add volume ±15% or ±0.15 a week; weekly CV ±0.01; league points ≥ raw − 0.5%).

**Check 5, cost: ≤ +25%** CPU per simulated season over the raw rule, same machine, same run (attempts 1–3 used +20%). **Why the change, decided before any attempt-4 run of checks 1–4 (Jack, Nov 17: "continue"):** simulations run on GitHub's free runners, so the cost is time, not money. A move check's job takes ~9 min now against ADR-063's 12-minute budget; +25% on its simulation time keeps it inside. Attempt 4 measured +22% (median; 1.19–1.25) on the profiling seed.

**Run:** `scripts/experiment-fit-streams.ts` on the branch, the league as it stands on the run day, 4,000 seasons per rule with the simulator's default seed (not the profiling seed), check 1 as the branch's test. One evaluation, no tuning.

**Ships only if** all five pass: `fitStreams` becomes the default, with an ADR, and job times are watched on Settings. Otherwise the result is written here and the raw rule stays.

### Result (2026-11-17): checks 1–4 passed, check 5 (cost) failed; not shipped

One evaluation (pre-registration on main at fc09d44; branch `experiment/fit-streams-4` at 906a252). Setup: day 29 (week 5), 15 regular weeks left, 4,000 seasons per rule.

| Check                       | Result                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------- |
| 1. First choice (synthetic) | Pass: the guard was the first pickup in 1.000 of seasons (n = 200; raw rule 0.070). |
| 2. Add volume               | Pass for all 11 teams; the largest change −0.11 a week (team 11, 2.33 → 2.22).      |
| 3. Weekly scoring spread    | Pass for all 9 active teams; every CV moved by 0.003 or less.                       |
| 4. League points            | Pass: 847.5 → 860.8 a week (+1.6%).                                                 |
| 5. Cost                     | **Fail:** 2.9 → 4.0 ms per season (**+38%**; the bar was +25%).                     |

- **The cost estimate didn't hold:** the profiling bundle had measured +22% (median of six pairs). The pre-registered harness (unbundled, the live setup, one pair) measured +38%. The result is the harness's.
- **What it means:** the rule does what it should and keeps the simulator calibrated (as in attempt 2); only its time fails. At +38%, a ~9-minute move-check job would take ~12.5 minutes, just past ADR-063's 12-minute budget. Whether that time is worth it is Jack's call, not a re-run with a new bar.
- **Reported:** title odds under each rule (Jack 16.2% → 18.2%, within the noise of 4,000 seasons). The Reed moves were skipped (Reed is no longer a free agent).
- **Shipped on Jack's decision (2026-11-17, ADR-065):** checks 1–4 are the quality checks and passed; check 5 was a time budget, and Jack accepts the time ("time is not much of a factor for the overnight calculations"), with triggered updates made fast by job design instead. Shipped as tested, plus one fix: a change day (ADR-064's `SimPlayer.change`) now also clears the standing lineup and week the rule caches (found merging with main; a temporary exactness check over 100 seasons found 119 of 38,955 week lineups stale without it, 0 of 41,168 with it).

## Pre-registration: projections after a teammate returns (2026-11-16, before any run)

**Question:** a player who filled in while a regular teammate was out keeps his inflated numbers in every rest-of-season value: trades, Moves, the season simulator. Example, Nov 16: Paul Reed played all 12 of his games without Jalen Duren (out since Oct 23). Ours projects 27.1 FP/G, ESPN preseason 17.6, for all 60 games left, though Duren's estimated return is Nov 24. Does projecting from the games the teammate **played** predict the player better once the teammate is back?

**How this differs from ADR-031/ADR-036 (failed):** those boosted the **next game** for minutes vacated by absent teammates, and the minutes trend already catches a role change within a few games. This one is about the games **after a known return**, judged as of the return day, before the trend can see anything. That's what rest-of-season values need, since they're decided days or weeks ahead.

**Today's rule (baseline):** `perGameProjection` as shipped: minutes × per-minute rate blended with the prior, plus the minutes trend. Its inputs are the player's games so far this season.

**Candidate:** the same function with the same prior, given only his games this season in which the teammate also played. With few or none (Reed), it falls back toward the prior through the existing blend.

**Data:** the cached public ESPN game logs (`apps/web/data/local/backtest/`, ~420 players a season).

- **Seasons:** 2025-26 (prior 2024-25) and 2024-25 (prior 2023-24). The prior stands in for ESPN's preseason projection, as in `scripts/backtest-projection.ts`.
- **Team games:** a team's games are its players' (game id, side). A player's team is the team of his latest game.
- **Event:** a regular teammate T (20+ minutes a game over his last 10) misses ≥ 5 straight team games, then plays again for the same team (game R).
- **Affected player P:** on that team at R, with ≥ 3 games during the absence and ≥ 10 games before R this season.
- **As of:** R's day (only games before R count).
- **Target:** P's mean FP over his next 10 games from R. An event needs at least 5.

**Metric:** absolute error per (P, event), candidate minus baseline. Mean with a 95% bootstrap interval (2,000 resamples, clustered by player). Both seasons pooled; each also reported, along with the subset where P's minutes moved ≥ 4 during the absence.

**Ships only if** the pooled interval is entirely below 0. Then rest-of-season values switch at each injured teammate's estimated return (the simulator, `teamValue`, the week projection, trades), with an ADR. Otherwise the cards only note when a player's games overlap a teammate's absence (facts, not a model).

**When:** one evaluation, run once the harness exists (`scripts/backtest-teammate-return.ts`). There's nothing to tune.

**Not part of this test:** a teammate newly out long-term (the mirror case). There are no "without him" games to project from at that point; that needs a minutes-share model.

### Result (2026-11-16): failed, not shipped

One evaluation (`scripts/backtest-teammate-return.ts`, pre-registration on main at d3d1f51). The harness was first checked with `DRY=1`, which prints event counts only, no outcomes.

| Events                               | n                   | MAE today | MAE candidate | Candidate − today | 95% CI (by player) |
| ------------------------------------ | ------------------- | --------- | ------------- | ----------------- | ------------------ |
| **Pooled (the test)**                | 2,120 (611 players) | 4.32      | 4.75          | +0.427            | [0.299, 0.560]     |
| 2025-26                              | 1,183 (322 players) | 4.20      | 4.59          | +0.381            | [0.195, 0.573]     |
| 2024-25                              | 937 (289 players)   | 4.47      | 4.96          | +0.486            | [0.287, 0.686]     |
| Minutes moved ≥ 4 during the absence | 818 (377 players)   | 4.42      | 5.19          | +0.764            | [0.511, 1.018]     |

Projecting from only the games the teammate played is clearly worse, so today's projection stays.

**Exploration, after the evaluation (not a test):** today's projection's signed error, by how much the player's minutes moved while the teammate was out:

| Minutes while he was out | n     | Today − actual | Candidate − actual |
| ------------------------ | ----- | -------------- | ------------------ |
| up ≥ 6                   | 425   | −0.65          | −4.16              |
| up 3–6                   | 377   | +0.68          | −1.32              |
| within ±3                | 1,085 | +0.09          | −0.09              |
| down ≥ 3                 | 233   | −0.20          | +1.71              |

- **Reading:** a fill-in's bigger role mostly sticks over the 10 games after the teammate returns. Returning players often come back on limited minutes, and coaches keep what worked. Today's projection is about unbiased for them; the biggest fill-ins even beat it slightly.
- **So** Paul Reed's 27.1 isn't shown to be inflated for the coming weeks.
- **Not tested:** horizons beyond 10 games, and direct same-position backups specifically. Either needs its own pre-registration, judged forward on this season's later returns, since these two seasons have now been looked at.

## Pre-registration: teammate returns, test 2 — rest of season and same-position backups (2026-11-16, before any run)

**Question:** test 1 (above) judged the next 10 games after a regular teammate returns. Rest-of-season values (the card's projected points, `teamValue` in trades and Moves, the simulator) hold one per-game number for every game left. Does a fill-in's projection over **the rest of the season** improve if it reverts, fully or partly, to how he played with the teammate? And is the answer different for a **direct same-position backup** (Paul Reed behind Jalen Duren)?

**Why older seasons:** 2024-25 and 2025-26 were looked at in test 1. Jack chose (Nov 16) to test now on **2021-22, 2022-23 and 2023-24**, which no test has evaluated for this question (2023-24's logs were only a prior in test 1), rather than wait for this season's returns.

**Data:** ESPN's public season pool lists every player who played each season and his default position; each one's public game log is cached (`scripts/fetch-history.ts`, `data/local/backtest/`). The prior is his previous season (2020-21 for 2021-22, and so on), as in test 1.

**Events and affected players:** exactly as test 1 (`scripts/backtest-teammate-return.ts`): T averages 20+ minutes over his last 10 games, misses ≥ 5 straight team games, and plays again for the same team (game R). P is on that team at R, with ≥ 3 games during the absence and ≥ 10 before R. As of R's day.

**Target:** P's mean FP over **all his remaining regular-season games** from R (at least 10).

**Today's rule (baseline):** `perGameProjection` from all his games so far.

**Candidates** (each the shipped function with the same prior):

- **A, full revert:** from only his games this season in which T played.
- **B, revert after 10:** today's projection for the team's next 10 games, A after; the predicted mean weights them by the team's remaining games (known on the day).
- **C, halfway:** the mean of today's projection and A, for every remaining game.

**Event sets:**

1. All affected teammates.
2. **Same-position backups:** P's default position group equals T's (guards PG/SG, forwards SF/PF, centers C), and P's minutes during the absence exceed his minutes before it by ≥ 4.

**Metric:** per (P, event), |candidate − actual| − |today − actual|; the mean, with a bootstrap interval (4,000 resamples, clustered by player). Three candidates × two sets = six comparisons, so each uses a **99.17% interval** (Bonferroni for 95% overall).

**Ships only if** a comparison's interval is entirely below 0.

- A pass in set 1 applies to every player whose teammate returns; a pass only in set 2 applies only to same-position backups whose minutes rose ≥ 4.
- If more than one candidate passes in a set, the lowest MAE ships.
- Shipping means rest-of-season values change on T's estimated return day (simulator, `teamValue`, week projection, trades, the card's "after T returns" number), with an ADR. If none passes, nothing changes, and the cards' rest-of-season values stay as they are.

**When:** `DRY=1` first (event counts only, no outcomes), then one evaluation. Nothing to tune; thresholds are fixed above.

**Not part of this test:** the mirror case (a teammate newly out long-term), and horizons between 10 games and the rest of the season.

### Result (2026-11-16): failed, not shipped

One evaluation (`scripts/backtest-teammate-return-2.ts`, pre-registration on main at 1746c87). `scripts/fetch-history.ts` cached every player who played in 2020-21 to 2023-24 (533, 579, 502 and 536; no failed fetch). `DRY=1` first: 1,224, 906 and 798 player-events (2021-22, 2022-23, 2023-24), 429 of them same-position backups, none without a position.

| Set                                      | Candidate         | n                     | MAE today | MAE candidate | Candidate − today | 99.17% CI (by player) |
| ---------------------------------------- | ----------------- | --------------------- | --------- | ------------- | ----------------- | --------------------- |
| 1. All affected teammates                | A, full revert    | 2,928 (1,054 players) | 3.63      | 4.01          | +0.385            | [0.242, 0.533]        |
| 1. All affected teammates                | B, after 10 games | 2,928 (1,054 players) | 3.63      | 3.75          | +0.121            | [0.015, 0.231]        |
| 1. All affected teammates                | C, halfway        | 2,928 (1,054 players) | 3.63      | 3.65          | +0.024            | [−0.055, 0.102]       |
| 2. Same-position backups, minutes up ≥ 4 | A, full revert    | 429 (315 players)     | 3.87      | 4.25          | +0.380            | [−0.091, 0.887]       |
| 2. Same-position backups, minutes up ≥ 4 | B, after 10 games | 429 (315 players)     | 3.87      | 3.82          | −0.051            | [−0.408, 0.340]       |
| 2. Same-position backups, minutes up ≥ 4 | C, halfway        | 429 (315 players)     | 3.87      | 3.73          | −0.144            | [−0.406, 0.147]       |

No interval lies below 0, so today's projection stays for the rest of the season too. Over all affected teammates, reverting is worse (A, B) or no better (C). For same-position backups, B and C lean better but are well within noise.

**Exploration, after the evaluation (not a test):** backup centers whose minutes rose ≥ 6 during the absence (Paul Reed's case), signed error over the rest of the season, n = 31: today **+2.02** FP/G, A −3.72, B −1.99, C −0.85.

- **Reading:** across all fill-ins, today's projection holds up for the rest of the season as it did for 10 games. The one hint is the narrowest group: big-minute backup centers ran about 2 FP/G below today's projection over the rest of the season, and halfway came closest. With 31 events and the subgroup chosen after the fact, that's a lead, not a finding.
- **For Reed:** no tested rule says to change his 27.1. If the hint holds, his rest-of-season value is nearer 25 than 27 once Duren is back.
- **Next, if wanted:** pre-register "halfway for same-position backups whose minutes rose ≥ 6" and judge it forward on this season's returns.

## Pre-registration: teammate returns, test 3 — halfway for big-minute same-position backups (2026-11-17, before any run)

**Question:** test 2's exploration (above, not a test) found that backup centers whose minutes rose ≥ 6 ran about 2 FP/G below today's projection after the starter returned, and halfway (C) came closest. Jack chose (Nov 16) to keep exploring it and to pre-register it. One hypothesis, judged twice:

> For a **same-position backup whose minutes rose ≥ 6** while a regular teammate was out, the **halfway rule** (C: the mean of today's projection and the one from only games with the teammate) predicts his rest-of-season FP/G better than today's projection.

**Same as test 2, unchanged:** events, affected players, target (mean FP over all remaining regular-season games from the return, at least 10), today's rule, candidate C, the position groups, and the code (`scripts/teammate-return-events.ts`, moved out of test 2's script; re-running test 2 reproduces its table exactly).

**The set:** P's default position group equals T's, and P's minutes during the absence exceed his minutes before it by **≥ 6**. Every group (guards, forwards, centers); the threshold of 6 comes from the exploration.

**Part 1, historical (run now):** **2017-18, 2018-19, 2019-20 and 2020-21**, none of them evaluated for this question (2020-21 was only test 2's prior). Priors are each previous season. ESPN's public season pool starts at 2017-18, so 2016-17's logs are fetched for 2017-18's players. 2019-20's hiatus and bubble and 2020-21's protocol absences stay in: missed games are counted as team games, as before.

**Part 2, forward (this season):** returns on or after **Nov 17, 2026**, with the same rules; 2025-26 is the prior. It's evaluated **once, after the regular season** (the script refuses before Apr 20, 2027), when every event's rest of the season is known. It will be small (test 2 found about 140 same-position backups a season at ≥ 4 minutes, so fewer at ≥ 6, and only from Nov 17), so it may not have the power to pass alone.

**Metric:** per (P, event), |halfway − actual| − |today − actual|; the mean with a bootstrap interval (4,000 resamples, clustered by player; seed 20261118 for part 1, 20270420 for part 2). Two comparisons (one per part), so each uses a **97.5% interval** (Bonferroni for 95% overall). A part passes if its interval lies entirely below 0.

**Ships:**

- **Part 1 passes:** ship now, in its own PR with an ADR. When a regular's estimated return date is known, his same-position backups whose minutes rose ≥ 6 change on that day to halfway, for the rest of the season (simulator, `teamValue` in trades and Moves, the week projection, and the card's "after T returns" number). Part 2 then checks it: if its mean difference is ≥ 0 (no better than today), the rule comes out.
- **Part 1 fails:** nothing changes now. Ship only if part 2 passes.

**Described, not tested** (both parts): the set's signed error for today and halfway, and the centers within the set (MAE and signed error).

**When:** `DRY=1` first (event counts only, no outcomes), then one evaluation of part 1. Nothing is tuned; nothing is re-run with other thresholds.

### Result, part 1 (2026-11-17): failed, nothing changes

One evaluation (`scripts/backtest-teammate-return-3.ts`, pre-registration on main at 308b42f). `scripts/fetch-history.ts` cached every player who played in 2017-18, 2018-19 and 2019-20 (534, 528 and 487), and 2016-17's logs for 2017-18's 534 players; no failed fetch. `DRY=1` first: 660, 736, 800 and 866 player-events (2017-18 to 2020-21), 314 of them in the set (66, 68, 81 and 99), none without a position. As a harness check (counts only), test 2's seasons give 308 in the same set.

| Set                                   | n                 | MAE today | MAE halfway | Halfway − today | 97.5% CI (by player) |
| ------------------------------------- | ----------------- | --------- | ----------- | --------------- | -------------------- |
| Same-position backups, minutes up ≥ 6 | 314 (238 players) | 3.80      | 3.95        | +0.148          | [−0.134, 0.442]      |

The interval isn't below 0, so halfway doesn't ship now; per the pre-registration it ships only if part 2 (this season, judged after Apr 20, 2027) passes.

**Described, not tested:**

- **The whole set:** signed error (predicted − actual) today **+0.07**, halfway **−1.63**. Today's projection is close to unbiased for big-minute backups overall; halfway takes too much away.
- **Centers in the set, n = 12:** today **+3.19**, halfway −0.65; MAE today 5.89, halfway 3.14.

**Reading:** the hypothesis as registered (every position group) fails, and its sign is the wrong way. The center pattern from test 2's exploration appears again in seasons it wasn't drawn from: 43 events across seven seasons, today too high by 2–3 FP/G each time. But 12 events can't carry a test, and the subgroup was found by looking. **For Reed:** nothing changes; his 27.1 stays. The center lead is still a lead.

## Exploration: what happens to a fill-in when the regular returns (2026-11-17, not a test)

Jack (Nov 17): a borderline starter whose position-mate, a star, returns from injury should lose production; does the data show it, and does the model account for it? `scripts/explore-teammate-returns.ts`, every season tests 2 and 3 used (2017-18 to 2023-24), same events. FP/G in this league's scoring; "today" is the projection on the return day; intervals 95%, clustered by player.

| Group                               | n     | FP/G before | during | after | today's projection | minutes before → during → after | today − actual       |
| ----------------------------------- | ----- | ----------- | ------ | ----- | ------------------ | ------------------------------- | -------------------- |
| Every affected teammate             | 5,990 | 16.0        | 18.2   | 17.6  | 17.3               | 22.8 → 25.4 → 24.2              | −0.32 [−0.52, −0.12] |
| Other positions, minutes up ≥ 6     | 783   | 10.5        | 18.0   | 15.0  | 15.0               | 16.2 → 25.8 → 22.2              | −0.05 [−0.47, +0.37] |
| Same position, minutes up ≥ 6       | 622   | 9.9         | 17.4   | 14.0  | 14.5               | 16.5 → 26.8 → 22.0              | +0.43 [−0.05, +0.90] |
| — guards                            | 358   | 9.3         | 16.6   | 13.4  | 13.9               | 17.2 → 27.5 → 22.6              | +0.54 [−0.02, +1.13] |
| — forwards                          | 221   | 10.0        | 17.2   | 14.4  | 14.3               | 15.7 → 26.0 → 21.7              | −0.10 [−0.97, +0.70] |
| — centers                           | 43    | 14.3        | 25.0   | 17.6  | 19.9               | 14.8 → 25.4 → 18.1              | +2.35 [+0.41, +4.29] |
| — returning player in the top third | 208   | 10.2        | 18.0   | 14.1  | 14.8               | 15.9 → 26.5 → 20.9              | +0.69 [−0.06, +1.38] |
| — top third, centers                | 29    | 14.4        | 24.9   | 17.5  | 20.0               | 15.1 → 25.5 → 18.2              | +2.51 [+0.45, +4.55] |

- **The drop is real:** big-minute same-position backups fall from 17.4 to 14.0 FP/G after the return (minutes 26.8 → 22.0). They keep about half the surge: among the 477 whose FP/G rose ≥ 3, 51% of it remained.
- **Today's projection already expects most of it:** on the return day it carried 55% of the surge (it blends last season and the whole season so far, not the hot stretch), so for guards and forwards it lands close. That is why reverting rules (tests 1–3) came out too low.
- **Centers are where it falls short:** there is one center spot, so a returning starting center takes his minutes back almost entirely (25.4 → 18.1, nearly the 14.8 before). Today's projection ran 2.35 FP/G too high; a star's return makes little difference beyond position.
- **Paul Reed (2026-27, described):** 18.4 FP/G in 13.8 min last season behind Duren; 25.4 over his 12 games this season, all but two without Duren. Centers' history (≈30% of the surge kept) would put him near 20 after Duren returns, not 27.1.

## Pre-registration: teammate returns, test 4 — how much each position keeps (2026-11-17, before any run)

**Model:** on the day a regular returns, a same-position teammate whose minutes rose ≥ 6 while he was out gets `today − λ_g × (today − with-him)`, where "with-him" is the projection from only games the regular played (test 1's A) and λ_g is the least-squares share for his position group (guards, forwards, centers), clipped to [0, 1]. λ = 0 is today's projection; test 3's halfway was λ = 0.5 for everyone.

**Walk-forward:** each tested season (2018-19 to 2023-24) uses λs fitted only on earlier seasons (from 2017-18, which trains only). Events, target (rest-of-season FP/G) and today's rule as tests 2 and 3 (`scripts/backtest-teammate-return-4.ts`).

**Disclosure:** these seasons were already explored (tests 2 and 3 and the table above), including the center pattern that motivates position-specific shares. A pass here is weaker evidence than one on unseen data; the forward check below is the unseen part.

**Comparisons:** (1) all same-position backups with minutes up ≥ 6; (2) the centers among them. Per event, |model − actual| − |today − actual|; 4,000 resamples clustered by player (seed 20261119); **97.5% intervals** (Bonferroni over two). Signed errors are reported alongside.

**Ships if** (1) or (2) passes: the λs refitted on all seven seasons, applied (centers only if only (2) passes) from the regular's estimated return day, for the rest of the season, in the simulator, `teamValue`, the week projection and the card ("27.1 now · ~X after Duren returns"), with an ADR. **Forward check:** this season's returns from Nov 17, judged once after Apr 20, 2027 with test 3 part 2's data; if the model's MAE is worse than today's there, it comes out.

**When:** `DRY=1` (counts only), then one evaluation.

### Result (2026-11-17): passed (all big-minute same-position backups); ships

One evaluation (pre-registration on main at fc09d44). `DRY=1` first: guards/forwards/centers per season 30/34/2 (2017-18, trains only), 36/29/3, 44/32/5, 65/32/2, 90/34/15, 47/35/6, 46/25/10.

| Tested season | λ guards | λ forwards | λ centers (fitted on earlier seasons) |
| ------------- | -------- | ---------- | ------------------------------------- |
| 2018-19       | 0.00     | 0.24       | 0.90                                  |
| 2019-20       | 0.11     | 0.00       | 0.43                                  |
| 2020-21       | 0.13     | 0.00       | 0.54                                  |
| 2021-22       | 0.12     | 0.00       | 0.54                                  |
| 2022-23       | 0.13     | 0.00       | 0.53                                  |
| 2023-24       | 0.16     | 0.05       | 0.51                                  |

| Set                                      | n                 | MAE today | MAE model | Model − today | 97.5% CI (by player) | Signed error today → model |
| ---------------------------------------- | ----------------- | --------- | --------- | ------------- | -------------------- | -------------------------- |
| 1. Same-position backups, minutes up ≥ 6 | 556 (423 players) | 3.90      | 3.80      | −0.103        | [−0.214, −0.000]     | +0.49 → −0.03              |
| 2. Centers among them                    | 41 (38 players)   | 5.65      | 4.47      | −1.188        | [−2.389, +0.065]     | +2.16 → −1.22              |

- **Set 1 passes, barely** (the interval's top is just below 0), so the model ships for every big-minute same-position backup, with the shares refitted on all seven seasons: **guards 0.23, forwards 0.07, centers 0.49**. Centers alone don't pass (41 events), but they carry most of the gain.
- **Reading:** Jack's logic holds: the fill-in loses production when the regular returns. Today's projection already expected most of it for guards and forwards; for centers it expected too little, and the fitted share takes about half of the gap between today's projection and his projection from games with the regular.
- **Forward check:** this season's returns from Nov 17, judged once after Apr 20, 2027; if the model's MAE is worse than today's there, it comes out.
- **Consequence revised (2026-11-17, Jack; before any forward data):** no model is pulled mid-season or after it on a schedule. The forward check still runs once after Apr 20, 2027, as registered; its result feeds the between-seasons refit of the shares and position grouping (with the history), not a removal. The test itself is unchanged.

## Exploration: positions for teammate returns, both directions (2026-11-17, not a test)

Jack (Nov 17): make sure a PF/C isn't treated like a backup center when he's really a forward, and that a PF/C who does back up at center isn't missed. Test 4 groups by ESPN's primary position for the season, so a PF/C listed PF is a forward. That means he gets the forward share, and he is never paired with a returning center. `scripts/explore-teammate-positions.ts` covers the same seasons and events as test 4 (2017-18 to 2023-24), for fill-ins whose minutes rose ≥ 6. It adds each season's ESPN eligibility (`eligible-{season}.json`, now saved by `fetch-history.ts`; it is season-specific: Jokic is PF/C in 2018-19, C only from 2019-20) and rebounds plus blocks per 36. Columns are as in the exploration above, plus the least-squares share of the gap the return takes back (λ).

| Returning player → fill-in                     | n   | FP/G before → during → after | today − actual (95% CI) | λ   |
| ---------------------------------------------- | --- | ---------------------------- | ----------------------- | --- |
| C → C (test 4's centers)                       | 43  | 14.3 → 25.0 → 17.6           | +2.35 [+0.41, +4.29]    | 49% |
| C → PF/C (primary PF, C-eligible)              | 16  | 11.5 → 23.3 → 16.4           | +3.09 [+0.25, +5.30]    | 48% |
| C → forward, not C-eligible                    | 71  | 8.9 → 17.7 → 13.3            | +0.38 [−0.70, +1.49]    | 12% |
| PF/C → C                                       | 19  | 11.0 → 22.1 → 16.3           | +1.30 [−1.08, +3.95]    | 46% |
| PF/C → forward, not C-eligible                 | 45  | 9.4 → 18.2 → 15.1            | −0.48 [−2.01, +1.23]    | 0%  |
| Forward (not C-eligible) → PF/C                | 16  | 18.4 → 23.3 → 22.6           | −1.47 [−6.17, +2.93]    | 0%  |
| Both C-eligible                                | 87  | 12.8 → 23.5 → 17.2           | +1.81 [+0.55, +3.09]    | 45% |
| Big by stats → big (top third, reb + blk / 36) | 197 | 11.5 → 21.5 → 16.1           | +1.36 [+0.49, +2.22]    | 36% |

- **Under-applying is real:** when a center returns, a PF/C fill-in loses his surge like a backup center (λ 48%, today +3.09 too high). Test 4's grouping misses him, and also misses the center behind a returning PF/C (the Davis or Sabonis type).
- **Over-applying doesn't show:** a forward who isn't C-eligible keeps most of his surge when a center returns (λ 12%), and nothing changes when a PF/C returns ahead of a pure forward (λ 0%). Grouping by C-eligibility puts each of these cells on the right side.
- **Stats-based bigs separate less cleanly** than ESPN's eligibility (λ 36%, a weaker signal).
- **Small cells, found by looking:** this motivates test 5 and is not evidence for it.

## Pre-registration: teammate returns, test 5 — centers by eligibility (2026-11-17, before any run)

**Candidate:** test 4's model with one change. A player's group is **C if he is C-eligible** in ESPN that season; otherwise it is his primary-position group (guards, forwards). A teammate is adjusted when his group equals the returning regular's. Shares λ_G, λ_F, λ_C are fitted for this grouping. Everything else is as test 4: events, minutes up ≥ 6, the least-squares share clipped to [0, 1], the target (rest-of-season FP/G) and today's rule.

**Baseline:** **test 4's model as shipped** (primary-position groups), with its shares fitted on the same training seasons.

**Data:**

- **Training:** both models fit their shares on 2017-18 to 2023-24.
- **Judged on 2024-25 and 2025-26** (priors 2023-24 and 2024-25; `fetch-history.ts 2025 2026`).
- **Disclosure:** test 1 used these two seasons for its own question (every teammate, next 10 games, the with-him projection), and nothing was broken out by position. They are the only complete seasons not used by tests 2–4 or by the exploration above.

**Comparison (one):** on every event either model adjusts, per event |candidate − actual| − |test 4's model − actual|. The bootstrap uses 4,000 resamples clustered by player (seed 20261120) and a **95% interval**.

- **Passes** if the whole interval is below 0.
- **Described, not tested:** events the two pair differently, the candidate's centers, and each model against today's projection.

**Ships if it passes:** production groups by C-eligibility (`groupOf` in `lib/nba/teammate-return.ts`, from the player's eligible positions), with the shares refitted on all nine seasons, and an ADR-064 amendment. **If it fails,** test 4's model stays as shipped. The between-seasons refit uses the forward data, as ADR-064 says.

**When:** `DRY=1` (counts only), then one evaluation.

### Result (2026-11-17): not passed; test 4's model stays

One evaluation (pre-registration on main at c77fef9). `DRY=1` first:

- **Training:** 658 events.
- **2024-25:** 133 events (test 4's grouping G/F/C 62/50/13, candidate 62/38/21).
- **2025-26:** 124 events (47/55/12 and 47/45/22).
- 40 test events are paired differently; no event lacks eligibility.

Shares fitted on 2017-18 to 2023-24: test 4's grouping G 0.23, F 0.07, C 0.49; candidate G 0.23, F 0.13, C 0.45.

| Set                                         | n                 | MAE today | MAE test 4's model | MAE candidate | Candidate − test 4's model | 95% CI (by player) | Signed error today → test 4 → candidate |
| ------------------------------------------- | ----------------- | --------- | ------------------ | ------------- | -------------------------- | ------------------ | --------------------------------------- |
| Every event either model adjusts (the test) | 257 (191 players) | 4.05      | 4.03               | 4.07          | +0.041                     | [−0.049, +0.138]   | −0.76 → −1.42 → −1.62                   |
| — paired differently by the two             | 40 (32 players)   | 4.15      | 4.12               | 4.49          | +0.372                     | [−0.187, +0.969]   | −1.20 → −1.32 → −2.36                   |
| — candidate's centers                       | 43 (39 players)   | 4.55      | 4.78               | 5.05          | +0.262                     | [−0.284, +0.814]   | −0.12 → −1.75 → −2.68                   |

- **Not passed:** grouping centers by eligibility predicts no better than test 4's grouping, and leans worse. The PF/C pattern in the exploration did not carry over to fresh seasons.
- **Described, and important:** on these two seasons **test 4's model itself is no better than today's projection**: −0.023 [−0.179, +0.129]. The candidate's is +0.019 [−0.158, +0.197].
  - In 2024-25 and 2025-26, fill-ins kept _more_ of their surge than today's projection expected (signed error −0.76).
  - So taking some away made the centers worse there: MAE 4.55 → 4.78, signed error −0.12 → −1.75, over 25 test-4 center events.
- **Shares on all nine seasons** (2017-18 to 2025-26): test 4's grouping G 0.22, F 0.06, **C 0.34** (from 0.49); candidate G 0.22, F 0.11, C 0.31.
- **Per the pre-registration,** test 4's model stays as shipped. Whether to refit its shares on all nine seasons now is Jack's call (ADR-064). The between-seasons refit uses this season's forward data.

## Draft-day projection accuracy (baseline for the projection-model work; method set 2026-11-06)

**What:** our pre-draft FP/G projections (`apps/draft-nba/dist/rankings.csv`, uploaded in Settings, stored privately) against this season's actual FP/G. The comparison is shown live on Players → Draft.

- **Judged:** ranked players with ≥10 games.
- **Metric:** mean absolute error.
- **Simple baseline:** last season's FP/G re-scored with this season's rules (the league changed its scoring), on the players with 20+ games last season. Both are reported on that same set.
- **ESPN's preseason projection:** not available, since ESPN overwrites its projections in place and none were saved.

**Status:** no numbers yet; they need the upload. The first numbers get recorded here, with the date and n, as the baseline any projection model must beat. This is a descriptive check, not a ship test: no model ships from it.
