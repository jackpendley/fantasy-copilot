# Project status (2026-11-16, late evening)

## Where things stand

**Live** at **https://fantasycopilot.vercel.app** (Vercel Pro since Nov 10; **Neon on Launch since Nov 16**).

**Neon (Nov 16):** the Free plan's 5 GB of transfer ran out (5.03 GB, plus 52 of 100 CU-hours by mid-month at a fixed 0.25 CU: awake ~13 h a day). The app kept working; the console still showed the compute active before the upgrade. Jack upgraded to **Launch** in Vercel (Storage → database → Settings; the database is Vercel-managed, so plan changes happen there), which **restarted Neon's billing period at Nov 16 3:55 PM**. The goal is to fit back under Free: budget **2 GB and 60 CU-hours a month** (docs/COMPUTE.md §10). Settings → "Database this month" shows Neon's own numbers and the pace (`NEON_API_KEY`, a project-scoped key Jack created; Production only), with push alerts at 60%/85% of Free or when a month at this rate passes the budget. **The period ends Nov 30, 5 PM MST** (Neon bills by calendar month); in its last 36 hours a push says whether a month at this rate fits Free (#174): that's the reminder for Jack's Dec 1 decision. First reading (Nov 16, 11 PM): 0.01 GB and 1.4 CU-hours, **awake 5 of the first 7 hours** (evening games: the 15-minute matchup timeline and gameday runs keep it up).

- **Tabs:** Today, Matchup, Players (Moves, Free agents, Trends, Draft), League (Trades, team pages).
- **Simulations:** moves and trades run on the GitHub Actions worker (ADR-058/059).

**CPU: Vercel Pro since Nov 10** (docs/COMPUTE.md §9).

- **Nov 10:** the 30-day total passed 4 h (4 h 0 m 28 s at 9:17; Vercel warned of a pause in 24 h). Jack upgraded to Pro the same day, per the tripwire.
- **Pro has no CPU-hour cap.** Usage comes out of the $20 monthly credit; the last 30 days would have cost ~$3, ~$4–6 without the cuts.
- **Minimal mode and the saver ended Nov 10** (`lib/cpu-saver.ts`, PR #135): background work every 5 min in the game window, other teams' moves within 30 min, pages refresh every minute in games. Trade packages stay on request.
- **Pro settings (Nov 10, Jack's OK):**
  - cron-job.org's gameday job back to every 5 minutes;
  - an on-demand budget of **$10** beyond the $20 credit (alerts at $5, $7.50 and $10; pause off);
  - every project builds on the **Basic** machine (the team default too);
  - pokemon-tcgp-db skips builds for its sync bot's data commits (Ignored Build Step on the commit message); its site reads Supabase, so they changed nothing.
- **MarketScope** is on the same team and plan.

**Nov 16, earlier (#155–#167):** blank Moves tables fixed (roster key), racing to ±0.1 with the head-to-head pick (ADR-063), roster fit on each card, the #162 transfer cuts (compressed payloads, SQL head to head, 204 polls), faster racing (#163), teammate-return test 1 failed (#165), streaming attempt 2 failed on cost (#167). Details in git history and MODEL_CARD.

**Nov 16, evening (#169–#173):** Jack's asks: build all four prevention items (a transfer budget, compression, totals in SQL, an alert), profile and retry position-aware streaming, and test longer horizons and same-position backups on historical data. Plan: `~/.claude/plans/i-m-playing-fantasy-basketball-rippling-fox.md`.

| PR   | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #169 | **Usage on Settings + alerts; let Neon sleep.** No `*/15` worker schedule (its peek woke Neon 96 times a day): `ensureWorker` catches a missed dispatch from runs that already have the database awake. The gameday job skips status and official-report queries it already made (same rows logged), logs only when it queried anyway, checks the lock job once, captures closing lines inside 20 min of tip (was 90). `dbUse.queries` per instance; `DB_TRAFFIC_LOG=1` logs result sizes by query.                   |
| #170 | **Transfer cuts:** deep checks read by key in SQL (Moves poll and page, trade simulate poll, Free agents); job refreshes skip settled moves' sums; League refresh every 15 s (was 5) with history memoized; season baselines memoized 6 h; freshness checks read fingerprints only.                                                                                                                                                                                                                                   |
| #171 | **Pre-registration:** teammate returns test 2 (rest of season; same-position backups) on 2021-22 to 2023-24, unseen for this question. `scripts/fetch-history.ts` cached every player's game log and position (2,150 players over four seasons).                                                                                                                                                                                                                                                                      |
| #172 | **Test 2 failed, not shipped.** Over the rest of the season no reverting rule beats today's projection (all fill-ins: full revert +0.39 MAE, after-10 +0.12, halfway +0.02; same-position backups: −0.05 and −0.14 for after-10 and halfway, intervals well across 0). Exploration (n = 31, not a test): backup centers whose minutes rose ≥ 6 ran ~2 FP/G below today's projection over the rest of the season; halfway came closest. For Reed: no change; if the hint holds, nearer 25 than 27 after Duren returns. |
| #173 | **Streaming attempt 3, profiling only:** the rewrite on `experiment/fit-streams-3` makes identical decisions to attempt 2 at 5.1 ms per season (was 7.8; raw 3.1): +65%, still past +20%. The rest is the design (60% of fit checks rebuild the week's lineups), so no test was run. Also: trade ideas after news or other teams' moves refresh at most hourly on the worker (was 15 min; news had launched the worker every 20 min), and the task runner leaves after 30 s idle.                                     |

**Nov 16, late evening (#174–#176):** Jack's replies: remind him about the plan Dec 1, keep exploring the backup-center lead and register a test, build the cheaper streaming version.

| PR / branch                             | What                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #174                                    | **Plan check before each Neon period ends** (the Dec 1 reminder, monthly after). Pace is now "a month at this rate" (30.4 days): it had assumed the period ran a month from its start, so the Nov 16 period would have read as ending Dec 16. Settings shows the end (11-30 5:00 PM, checked in production).                                                                                                                        |
| #175                                    | **Pre-registration, teammate returns test 3:** halfway for same-position backups whose minutes rose ≥ 6. Part 1 on 2017-18 to 2020-21 (fetched: ESPN's pool starts at 2017-18; 2016-17 logs as priors); part 2 forward on this season's returns from Nov 17, run once after Apr 20, 2027. Event code moved to `scripts/teammate-return-events.ts` (test 2 reproduces exactly).                                                      |
| #176                                    | **Part 1 failed:** n 314, halfway − today +0.148 [−0.134, 0.442]. Today's projection is about unbiased for big-minute backups (+0.07); halfway runs low (−1.63). Centers again (n 12, described): today +3.19, halfway −0.65. Reed's 27.1 stays.                                                                                                                                                                                    |
| `experiment/fit-streams-4` (not merged) | **Streaming attempt 4, cost only:** exact rewrite of the lineup work: day lineups patched from the standing lineup (equal to full solves on 1.64M days), the standing lineup carried through each swap (equal on 194k swaps), free agents ranked once a day. **+22%** CPU over the raw rule (median of alternating pairs; attempt 3 +65%, attempt 2 +108%), against the pre-registered +20% bar. No test run: Jack decides the bar. |

- **Nov 9–13 (#118–#154):** minimal mode and the saver, trade packages on request, trades with a team, the opaque phone status bar, the Matchup scoreboard details, rows and daily projections, stream timing around the first tip, centered rows and the phone score column (ADR-062), and stat tables that fit phones. The PRs are in git history.

**Asked trades (fixed in #128):** until #128 each ask queued a full job (~250 moves plus the Outlook), so League and Players showed loaders and the trade waited ~12 min. Now an ask queues an asked-only job that doesn't replace the full one. Each ask still costs ~5 s of Vercel CPU (`prepareJob`).

## Waiting on Jack

- **Neon, Dec 1 decision:** the Nov 30 push says whether a month at this rate fits Free; then stay on Launch (about $6 a month at the budget) or switch back in Vercel.
- **Streaming attempt 4's cost bar:** pre-register it with the +20% bar as is (likely a narrow fail at ~+22%), or a +25% bar (roughly 2 more minutes on a 9-minute job, if simulation is most of its time). Checks 1–4 would be unchanged.
- **Center lead:** 43 events over seven seasons, today too high by 2–3 FP/G each time, but subgroup-found and small. Option: add "backup centers, minutes up ≥ 6" as a forward test alongside test 3 part 2 (Bonferroni over both).
- **Check on the phone (Moves):** cards keep their numbers through a lineup change; each card opens on its pick; the "Open lineup spots" line; reopening refreshes.
- **Earlier, still to check:** the popup's live box score fit during a game; the on-court edge during a game; the lock job's wait-for-the-tip moves (#143, #146).
- **Worker → Neon directly** (approved Nov 9): Jack adds `DATABASE_URL` as a GitHub Actions secret when the PR is ready. Its transfer counts against the same budget.

## Daily CPU check

Ended Nov 10 (Jack's OK): Pro has no CPU cap, and the budget alerts cover spending.

## Next tasks

1. **Measure the next full jobs with #163** (the first-tip job, then the nightly one): wall time (target ≤ 10 min), chunks, longest runner (worker logs), Vercel CPU per job (Settings). Record them in ADR-063 and docs/COMPUTE.md. Settings on Nov 16 at 11 PM: 8 simulation jobs in 24 hours, 9.2 min on average, but that mixes job kinds; confirm a full one in the worker logs.
2. **Watch the database:** Settings' "Database this month" daily for a week against the budget (≤ ~67 MB and ≤ 2 CU-hours a day). Turn on `DB_TRAFFIC_LOG=1` for a day (Vercel env, Jack's OK) to rank the remaining reads; the Model page's and nightly blend/defense reads of every logged game grow all season and are the next candidates.
3. **PR 7:** the worker reads and writes Neon directly (ADR; `/api/worker/*` moves into the worker). Jack adds `DATABASE_URL` as a GitHub Actions secret.
4. **Scheduling stays on cron-job.org** (decided Nov 10). The 1-minute watch is parked (COMPUTE.md §7).
5. **Draft accuracy:** the card appears once ranked players have 10+ games; record the first numbers in MODEL_CARD.
6. **Return-date test** (MODEL_CARD, Nov 6): evaluate once ≥ 60 absences with ESPN return dates have ended.
7. **Teammate returns test 3, part 2:** after Apr 20, 2027: `fetch-history.ts 2026 2027`, then `FORWARD=1 DRY=1`, then one `FORWARD=1` run (MODEL_CARD).
8. **Neon awake time in game windows:** if the first full day's pace is over 60 CU-hours, the 15-minute matchup timeline (logged every run) is the first thing to batch.
9. **Still open:**
   - the partner's simulated odds on trades;
   - the official-statuses forward test (≥ 1,500 rows);
   - the props and DARKO blend tests;
   - win-probability candidate C (Dec 6) and recalibration (week 13);
   - props coverage for free agents.
10. **Roadmap** (`docs/ROADMAP.md`): own projection models, manager profiles, a playoff-schedule planner, NFL and MLB.

## Background

- **Nov 16:** the ± on Moves is simulation noise only. The model's own error (projections, the sim's assumptions) is larger, and more seasons don't remove it (ADR-063).

- **Nov 10, decided:** the Moves card's weekly win chance keeps assuming both teams set their best lineup daily (Jack prefers the optimal-lineup number; the season simulation still uses each manager's observed activity).

- **Nov 6** (#106–#116): correctness fixes, UI polish, pull to refresh, protected players and precision tiers (ADR-060), the Interested list, the percentile scale (ADR-061), Trends vs last season, Players → Draft, the season pool fix.
- **Nov 5** (#79–#103): automatic simulations, builds on the worker, gameday skips.

## Renewals

- `GITHUB_DISPATCH_TOKEN` expires **Nov 1, 2027**.
