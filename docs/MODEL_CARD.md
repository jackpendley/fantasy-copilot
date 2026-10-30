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
