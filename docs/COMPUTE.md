# Compute: where Fantasy Copilot spends CPU, and where it should

Written 2026-11-05. It is updated as measurements come in; the measured facts are dated.

**Since Nov 10 the team is on Vercel Pro** (§9); the efficiency work below still keeps the bill inside Pro's $20 credit.

**Goal (Nov 5):** stay on Vercel Hobby while the app grows into a serious analytics platform (NBA now, then NFL and MLB). Heavy computation should live where it's free and scalable.

**Decisions (Jack, Nov 5):**

- keep Neon;
- ESPN cookies stay on Vercel;
- no Google Cloud Run for now;
- nothing paid without his approval.

## 1. Measured (Nov 5)

**Vercel Active CPU** (Usage, rolling 30 days):

| What                   | Value                               |
| ---------------------- | ----------------------------------- |
| Team total             | **3 h 6 m of 4 h**                  |
| fantasy-copilot        | 2 h 55 m (93.8%)                    |
| Daily use since Oct 29 | ~14–23 min (Nov 3 ≈ 14, Nov 4 ≈ 15) |
| Daily use Oct 6–19     | ≈ 0                                 |

- **Hobby is enforced on the rolling 30-day window.** Over 4 h, the project is paused, and community reports say it can't deploy fixes until usage drops back.
- **The days leaving the window are near zero,** so ~15 min a day crosses 4 h in about 4 days.
- **The sustainable rate is 8 min a day.**

**Vercel CPU by route, last 12 h** (Observability, Nov 5 ~11:00 MST):

| Route                    | Calls | Active CPU | Per call |
| ------------------------ | ----- | ---------- | -------- |
| `/api/cron/[job]`        | 149   | **4 min**  | ~1.6 s   |
| `/api/players/[id]/card` | 85    | 26 s       | ~0.3 s   |
| `/nba/players` (Moves)   | 27    | 25 s       | ~0.9 s   |
| `/nba/week`              | 122   | 7 s        | 57 ms    |
| `/nba/today`             | 58    | 4.6 s      | 79 ms    |
| `/api/worker/result`     | 176   | 4.6 s      | 26 ms    |
| `/nba/league`            | 21    | 3.0 s      | 0.14 s   |
| `/api/worker/next`       | 68    | 2.3 s      | 34 ms    |
| `/nba/league/[id]`       | 65    | 1.7 s      | 26 ms    |
| `/nba/players/[id]`      | 40    | 0.9 s      | 22 ms    |

- P75 CPU per invocation is 797 ms, and P75 CPU throttle is 15.6%.
- The 5-minute cron is ~73% of all CPU. Pages are about a fifth.

**GitHub Actions worker:** 16 runners × 4 cores, ~80 simulated seasons per core per second.

- Nov 5 job: 273 moves (every drop of every add on Moves).
- Its requests to Vercel cost ~7 s per 12 h before PR #79.

## 2. How work flows today

| Scheduler                     | What it calls                    | How often                                                   |
| ----------------------------- | -------------------------------- | ----------------------------------------------------------- |
| cron-job.org (job 8752774)    | `/api/cron/gameday`              | every 5 min, all day                                        |
| Vercel cron                   | `/api/cron/nightly`              | 11:00 UTC                                                   |
| Vercel cron                   | `/api/cron/pregame`              | 22:00 UTC                                                   |
| GitHub Actions `simulate.yml` | `/api/worker/{next,result,task}` | on dispatch (a roster move); no schedule since Nov 16 (§10) |

**The gameday job, every 5 minutes** (`lib/jobs.ts gamedayRun`):

1. **Roster watch:** ESPN's transaction log for today and tomorrow (2 requests). On a move, `after()` runs `refreshLogged`, which:
   - builds a simulation job on Vercel (Outlook setup + the full waiver analysis + ~300 move patches);
   - searches trade ideas (`findTradeTargets`).
2. **The league, loaded and parsed in full:**
   - the ESPN league (settings, rosters, team, matchup scores), plus tomorrow's rosters;
   - the NBA schedule (memoized per instance for 6 h), scoreboard, injury feed, lineups;
   - defense table and league total (database).

   The parse is memoized for only 15 s per instance, so nothing is reused between runs.

3. **DARKO check:** hourly.
4. **Timeline points:** every 15 min during games.
5. **Pregame snapshot:** if missing.
6. **Availability logging:** from 9 AM ET (official report, ESPN injury feed).
7. **Status events:** in the game window. New news triggers a trade-idea search.
8. **Closing props:** within 90 min of tips.
9. **Push alerts.**

**Caches:**

- per-instance `memoFetch` (15–60 s) and `memoAsync` (parsed league 15 s, waiver view 30 s, free agents 60 s);
- `view_cache` rows (trade ideas, move checks, deep checks);
- result tables (`outlook_runs`, `matchup_*`, `sim_*`).

**NFL and MLB later:**

- **NFL** is weekly: a few game windows a week, with injury news concentrated on Wed–Sat. Heavy work is rare but large (season simulations, trade search).
- **MLB** is daily like the NBA, with ~2× the players and games, and lineups posted a few hours before each game.

All of them share player-level work (stat projections, availability) that doesn't depend on a league's scoring. Only scoring, rosters and settings are per league.

## 3. Findings

**Measured:**

- **M1.** The 5-minute job is ~73% of Vercel CPU, ~1.6 s per call on average. That average includes the `after()` work set off by roster moves.
- **M2.** Moves (~0.9 s per visit) and the player card (~0.3 s) are the costliest pages.

**Measured locally, Nov 5** (`apps/web/scripts/profile-cpu.ts`, read-only, live league data, Apple silicon; Vercel's shared CPUs are likely slower):

| Step                                        | CPU ms                |
| ------------------------------------------- | --------------------- |
| Transaction watch (today + tomorrow)        | 51                    |
| League fetch + parse                        | 120 (parse only: 104) |
| Timeline (projections + every matchup)      | 30                    |
| **Waiver view** (Moves page, sim-job input) | **1,418**             |
| Outlook setup (sim-job input)               | 28                    |
| Sim job: base + 273 move patches (0.45 MB)  | 491                   |
| League view                                 | 16                    |
| **Trade idea search**                       | **7,476**             |
| Player card (warm league)                   | 109                   |

- **M3.** The trade idea search is ~75% of a roster move's Vercel cost. It ran after every league move, after new injury news in the game window, and on Trades page visits.
- **M4.** H1 below is mostly **rejected:** reloading the league costs ~0.1 s, so 288 runs a day are ~0.5 min. Skipping it is a small win, not the main one.

**Measured in production, Nov 5 evening** (`cpu_log`, Settings → "Vercel CPU, last 24 hours"):

| Work                                     | Vercel CPU                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Gameday run                              | ~0.6 s typical: league load ~0.37 s, availability ~0.14 s, transaction watch ~0.11 s            |
| Roster move, building the simulation job | ~5.3 s: inputs (Outlook setup + waiver analysis) ~3.9 s, ~300 move patches ~1.2 s, store ~0.1 s |
| The worker's requests per job            | ~2.8 s                                                                                          |

Vercel is ~3–4× slower than the local profile.

**Projection after #81–#87:**

| Source                          | Per day     |
| ------------------------------- | ----------- |
| Gameday (288 runs)              | ~2.5–3 min  |
| Roster moves (~20 a day × ~8 s) | ~2.7 min    |
| Pages                           | ~1.5 min    |
| **Total**                       | **≈ 7 min** |

That's under, but close to, the 8 min a day Hobby sustains. Next: build the job's inputs on the worker (−~2 min a day), and skip the league load when no step needs it (−~1 min a day).

**After #89–#94 (Nov 5, 22:00 UTC):**

| Work                          | Vercel CPU                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Roster move                   | **~0.9 s** (from ~5.3 s): inputs ~0.6 s, queueing the worker build ~0.1 s, queueing the trade search ~0.15 s          |
| Gameday run, steady state     | ~0.55 s: league 0.35 s, availability 0.13 s, watch 0.08 s; the league was unchanged since the last run in 78% of runs |
| The worker's requests per job | ~3.9 s                                                                                                                |

- **On the worker:** the job build (`sim-build`) takes 2.8 s and the trade search 9.6 s.
- **Projection:**

| Source          | Per day       |
| --------------- | ------------- |
| Gameday         | ~2.7 min      |
| Roster moves    | ~0.3 min      |
| Worker requests | ~1 min        |
| Pages           | ~1.5 min      |
| **Total**       | **≈ 5.5 min** |

Still above the ~4 min a day needed until ~Nov 19.

- **#96 (Jack approved):** availability logging every 10 min before the game window, and no league load on runs where nothing's due. Expected −0.5 to −1 min a day; measure on Nov 6.
- **The worker's traffic** was larger than the per-job meter showed. Observability over 12 h:

| Route                | Calls | CPU  |
| -------------------- | ----- | ---- |
| `/api/worker/next`   | 1,500 | 47 s |
| `/api/worker/result` | 1,400 | 35 s |
| `/api/worker/task`   | 470   | 8 s  |
| `/api/worker/peek`   | 585   | 8 s  |

That's ~15–20 s per job, ~4–5 min a day at ~15 jobs. **#98:**

- 2 chunks per core per request (half the requests and posts);
- assignments read only counts, plus the chosen group's moves;
- checks recomputed at most every 10 s (was 4);
- idle polls every 10 s (simulation runners) and 15 s (task runner).

**Measured after #98 on one job** (22:50 UTC): `next` 326 calls (9 s), `result` 171 (4.6 s), `peek` 246 (3.5 s), ~18 s. Each request costs ~15–30 ms whatever it does, and idle asks ate the saving.

**#100:**

- a post also claims the next chunks;
- `next` and the task GET answer "wait" (202) instead of separate peeks;
- waits of 20–30 s.

**Measured after #100 on one job** (23:12 UTC): `result` 236 calls (10 s), `next` 90 (3.6 s), `task` 69 (1.4 s), `peek` 45 (0.5 s), **~15.5 s per job**. Most of a post's CPU is recomputing every move's numbers, so **#101** recomputes at most every 20 s (was 10).

**Not done:** more seasons per request. Requests per job = total seasons ÷ seasons per request, so fewer requests would mean longer rounds and later first numbers.

**Simulation worker (Nov 5, 19:29 UTC):**

- 288 moves (273 drops + 15 trade ideas);
- the opening moves were settled by ~4 min, and all were done in 13.5 min;
- 1,280 chunks on 16 runners.

**Hypotheses** (the `cpu_log` meter, deployed Nov 5, confirms or rejects each one by step):

- **H1.** Every gameday run re-fetches and re-parses the whole league and tomorrow's rosters, even when nothing changed (`leagueChanged` measures how often).
- **H2.** Each league roster move costs several CPU-seconds on Vercel: the Outlook setup and full waiver analysis for the simulation job, plus a trade-idea search. Moves happen many times a day across 14 teams.
- **H3.** News during the game window re-runs the trade-idea search often (each new status event).
- **H4.** The Moves page recomputes the waiver analysis per visit (memoized only 30 s per instance).
- **H5.** Card opens re-parse the league and free-agent pool when the 15–60 s memo has expired.

## 4. External compute

|                | Vercel Hobby                               | GitHub Actions (public repo)                                                                                                                    | Cloud Run Jobs                                                                   | Cloudflare Workers Free                                                   | Supabase Edge Functions  |
| -------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------ |
| Free allowance | 4 h Active CPU / 30 days (rolling)         | Standard runners free and unmetered                                                                                                             | ~180k–240k vCPU-s and 360k–450k GiB-s a month (us-central1; check the live page) | 100k requests/day; **10 ms CPU** per request or cron run; 5 cron triggers | 500k invocations a month |
| CPU per unit   | Shared Fluid instance                      | 4 vCPU, 16 GB per runner; 20 concurrent jobs (Free)                                                                                             | Up to 8 vCPU / 32 GB per task                                                    | 10 ms                                                                     | Short functions          |
| Max run        | 300 s (`maxDuration`)                      | 6 h per job                                                                                                                                     | 24 h per task                                                                    | 10 ms CPU                                                                 | ~150 s                   |
| Start-up       | Warm or cold, ~1 s                         | ~20–40 s from dispatch                                                                                                                          | ~5–30 s                                                                          | ~0                                                                        | ~0.1–1 s                 |
| Scheduling     | Daily crons on Hobby (we use cron-job.org) | `schedule` is best-effort (often 5–30 min late, dropped under load, disabled after 60 days of repo inactivity); `workflow_dispatch` is reliable | Cloud Scheduler (3 free jobs), precise                                           | Precise cron                                                              | pg_cron                  |
| Billing risk   | Pause at the limit (no charge)             | None for standard runners in public repos                                                                                                       | **A billing account is required**; past the free tier it's billed                | None on Free (requests fail at the cap)                                   | Pause or limits          |
| Fit            | Pages, auth, light APIs, ESPN ingest       | Event-driven batch compute (simulations, analysis); not a precise scheduler                                                                     | Heavy or long compute with precise scheduling; production-grade                  | Change detection only, if it needs no secrets                             | Not used (we're on Neon) |

**Notes:**

- **GitHub's terms** expect Actions to serve the repository's software. Our simulations are this repo's own computation, which is the intended kind of use. A continuously polling job would be a poor fit.
- **Cloudflare:** a 1-minute ESPN watch there would need the ESPN cookies on Cloudflare, which Jack ruled out.
- **Recommendation:**
  - keep **GitHub Actions** as the compute tier;
  - keep **Vercel** for pages, auth and ESPN ingest;
  - write up **Cloud Run** for approval when either is true:
    - NFL/MLB volume makes runner start-up or concurrency a bottleneck;
    - precise schedules are needed that the 5-minute ingest can't trigger.

## 5. Target architecture

```
ESPN / NBA feeds ──► Vercel ingest (cheap: fetch, hash, store when changed) ──► Neon
                                                   │ change event
                                                   ▼
                     GitHub Actions worker ◄── jobs (idempotent, by input fingerprint)
                     (parse, projections, waivers, trades, simulations)
                                                   │ results
                                                   ▼
                     Neon result tables / view_cache ──► pages read results (+ live overlay)
```

- **Ingest (Vercel):** each source is fetched on its own cadence. The raw response is hashed, and when the hash is unchanged nothing downstream runs. Changed data is stored once (normalized, or raw where parsing is heavy) with its fetch time.
- **Jobs:** `sim_jobs`, generalized to any kind of computation. Each job is keyed by kind and input fingerprint, so a repeated request reuses it (idempotency).
  - Runners lease work (`next_chunk`, `last_worker_at`).
  - A job whose runners go quiet is closed with what it has.
  - A newer input supersedes an older one only when it changes the answer (an own-roster change). Other changes queue one pending job.
- **Compute (worker):** reads its inputs through the app's worker API (no cookies, no database credentials), and posts results.
- **Pages:** read stored results immediately. Stale results show with an "Updating" state while a job runs. The live overlay (scores during games) stays on Vercel, because it must be seconds-fresh.
- **League-specific inputs stay per league** (scoring, slots, roster limits, schedules). Player-level work (stat projections, availability) is computed once and shared across leagues and sports' pages.

## 6. Freshness by data

| Data                    | Source of change                    | Policy                                                                                         |
| ----------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| Live scores             | Games in progress                   | On view, every 15–20 s (pages only); timeline every 15 min                                     |
| Injuries, availability  | ESPN feed, official report, lineups | Every 5 min in the game window and from 9 AM ET; recompute only what involves a changed player |
| Transactions, rosters   | ESPN transaction log                | Watched every 1–5 min (a tiny request); a change triggers one job, coalesced                   |
| Daily projections       | DARKO, props, ESPN                  | DARKO hourly until published; props morning, pregame and closing                               |
| Rest-of-season values   | Projections, rosters                | Recomputed by the worker after a change, never on a page view                                  |
| Lineup and matchup sims | Rosters, news, scores               | Event-driven (worker); the page shows the last result                                          |
| Historical / models     | Nightly results                     | Nightly or weekly batch on the worker                                                          |
| Draft and keeper values | Offseason                           | On demand, batch                                                                               |

**Is a 1-minute watch needed?** It's useful only for moves made in the ESPN app; moves made in this app are seen instantly. It's cheap enough only if a call does nothing but fetch the transaction log and compare it. It must not load the league, wake the database or run in the small hours. Estimate: ~20–50 ms per call, 900 calls a day between 8 AM and 2 AM ET, so ~0.5 min a day. It will be measured before it's turned on.

## 7. Plan

**Now, no new services:**

1. **Measure** (`cpu_log`, shipped Nov 5): CPU by job and step, unchanged-league share, worker cost per job.
2. **Gameday ingest diet:**
   - skip the full league load when nothing needs it (outside the window, no move, no new report);
   - get today's games from the cached schedule;
   - reuse the parsed league when its hash is unchanged.
3. **Trade ideas** (shipped Nov 5): other teams' moves, news and page visits refresh them at most every 3 hours; Jack's own moves and the nightly run refresh them right away. Then **move the search to the worker** (step 6), where it's free and can search wider.
   - Coalesce other teams' moves into one pending simulation job.
4. **Pages:** cache the waiver analysis by input fingerprint in the database (shared across instances and visits).
5. **The 1-minute watch:** a light route, only after (2) shows the room.

**Free tier (GitHub Actions):** 6. Move the trade-idea search to the worker (**shipped Nov 5**, ADR-059: `worker_tasks`, the `tasks` job). Next, the waiver analysis and the move building: Vercel sends inputs (the stored league), and the worker returns the move list and checks. 7. Generalize `sim_jobs` into a job queue for NFL/MLB and the ML models.

**Billing risk (needs approval):** 8. Google Cloud Run Jobs, if the conditions in §4 arise. 9. Vercel Pro ($20/month), if Hobby limits bind despite the above.

## 8. How results are reported

**Before and after each change:**

- Vercel CPU by route and invocations (Observability, 12–24 h);
- CPU per run and per step, and CPU on unchanged-league runs (`cpu_log`, Settings);
- per simulation job: duration, moves, and Vercel CPU (`sim_jobs`);
- the projected 30-day total (daily × 30) against 240 min.

## 9. The CPU saver and minimal mode (Nov 6 to Nov 10, ended by Pro)

**Ended Nov 10.** The window passed 4 h that morning (4 h 0 m 5 s at 5:50, 4 h 0 m 28 s by 9:17; Vercel's notice: the project pauses in 24 hours), and the days leaving it were ~0–0.3 min each, so it couldn't recover. Jack moved the team to **Pro** the same day. Pro has no CPU-hour cap: usage is billed from the $20 monthly credit (Active CPU $0.128/h in iad1, memory $0.0106/GB-h, invocations $0.60/M, Basic builds $0.007/min). The last 30 days' usage would have cost ~$3; without the cuts, ~$4–6. Both switches in `lib/cpu-saver.ts` now end Nov 10 and stay in the code for a future squeeze. The history below is kept as written.

**Measured Nov 6, 15:35 MST:** 3 h 34 m of 4 h (26 min left).

- **The days leaving the window are small until Nov 18:** Oct 7–17 total under 1 min. After that, by bar height: Oct 18 ~2, Oct 19 ~3, Oct 20 ~3.5, Oct 21 ~12, Oct 22–28 ~4–8.5 each, Oct 29 ~21, then ~12–23 a day.
- **So the binding stretch is Nov 7–17:** ~2 min a day keeps ~4 min of margin on Nov 17. From Nov 22, ~5.5 min a day roughly matches what leaves, and from Nov 29 there's room.
- **The quiet-day rate before the saver** was ~4–6 min a day (Observability, 12 h windows: 2.1 min in the day, 3.2 min overnight with games). `cpu_log`, last 24 h: gameday 1.4 min (201 runs × 417 ms), roster moves 0.5 min, 19 simulation jobs × 3.1 s. Days with development and production checks ran 15–20 min.

**The saver (`lib/cpu-saver.ts`, until 2026-11-29 00:00 UTC since Nov 9; nothing is switched off):**

| Change                                     | Was                       | Under the saver                                                |
| ------------------------------------------ | ------------------------- | -------------------------------------------------------------- |
| Game-window work (statuses, props, alerts) | every 5 min               | every 10 min                                                   |
| Availability logging before the window     | every 10 min              | every 30 min                                                   |
| Other teams' moves re-check Jack's moves   | at most every 90 min      | at most every 6 h                                              |
| Injury news for Jack's players             | a new job unless one live | at most one job an hour                                        |
| League load after a move seen by the watch | every run for 105 min     | only when a run starts; waiting moves re-read on the half hour |
| Recompute of a job's numbers on posts      | every 20 s                | every 45 s                                                     |
| Seasons per chunk (permanent)              | 200                       | 500 (fewer requests per job)                                   |

- **Unchanged:** Jack's own moves (in this app or ESPN's), protected players, watch-list changes, the timeline every 15 minutes in games, the nightly and pregame jobs, every page.
- **After Nov 29,** other teams' moves wait 30 minutes (the 90-minute trim is gone; the saver covers it).
- **No production checks during the saver:** changes are verified locally and through Vercel's Usage and Observability.

**What happened instead (Nov 7–9):** the saver ran ~5–7 min a day (Friday and Sunday games, ~17–20 simulation jobs a day), and Nov 9 opened at 3 h 51 m. Only ~8 min leave the window before Nov 21.

**Minimal mode (Nov 9, Jack's choice over paying for Pro; `minimalOn`, until 2026-11-21 00:00 UTC):** the budget until Nov 17 is ~0.85 min a day for all projects. MarketScope keeps running.

| Area                                           | Saver                               | Minimal mode                                                    |
| ---------------------------------------------- | ----------------------------------- | --------------------------------------------------------------- |
| Gameday work (statuses, availability, alerts)  | every 10 min in the window          | on the hour and half hour (cron-job.org also every 30 min)      |
| Win-chance timeline in games                   | every 15 min                        | every 30 min                                                    |
| Other teams' moves (league odds, Jack's moves) | at most every 6 h                   | the nightly job; the watch looks only at moves under 35 min old |
| Injury news and watch-list changes             | at most one job an hour             | wait for the nightly job or Jack's own move                     |
| Trade ideas refreshed                          | 15 min after changes                | nightly and after Jack's own moves                              |
| Open pages' auto-refresh in games              | every minute                        | every 5 minutes (pull to refresh anytime)                       |
| Streams' season check                          | top tier (±0.35)                    | rest tier (±1.0), until Nov 29                                  |
| Trade packages for watched players elsewhere   | searched and simulated in every job | only when Jack asks (permanent, Nov 9)                          |

- **Unchanged:** every page reads ESPN live when opened; Jack's own moves and asked deep checks get full simulations; the nightly job.
- **Tripwire:** if a morning total is **3 h 56 m or more** before Nov 18, Jack pays for one month of Pro that day. (Corrected Nov 10: Pro has no CPU-hour cap; 16 h was the trial's. A later downgrade to Hobby re-applies the 4 h rolling window, which would then hold Pro-month usage.)
- **After Nov 29:** the steady state must stay ≤ ~7 min a day for all projects (Hobby averages 8). The worker writing to Neon directly (planned ~Nov 21) is the main lever.

## 10. Database transfer (Neon egress)

**Nov 16:** Neon emailed that the Free plan's 5 GB of public network transfer for the month was used up. On Free, Neon then suspends compute until the next billing period or an upgrade. We had budgeted Vercel CPU, never database transfer: every byte a query returns to Vercel counts.

**Sizes measured locally** (ESPN reads, database off; before → after #162):

| Payload                      | Read                                      | Before                                               | After                                            |
| ---------------------------- | ----------------------------------------- | ---------------------------------------------------- | ------------------------------------------------ |
| sim-build task input         | once per job, by the worker               | 1,859 KB                                             | 375 KB (gzip)                                    |
| job setup                    | each runner (16)                          | 41 KB                                                | 11 KB, once per server instance                  |
| job moves                    | each runner (16)                          | 836 KB (492 moves; ~115 in production)               | 18 KB, once per server instance                  |
| trade-search task input      | each search (~15–30 a day)                | 1,013 KB                                             | 200 KB                                           |
| racing refresh: head to head | every 20 s while a job runs               | every live move's per-chunk means (tens of MB a job) | one row per pair (~120)                          |
| P(best) chunk means          | was every refresh                         | ≤12 contenders × chunks                              | once, when the job is done                       |
| Moves poll                   | every 10 s while a job runs (visible tab) | ~100 KB                                              | 20 s; 204 with no body unless the checks changed |
| card percentiles             | per server instance's first card          | every player's PBP stats, two seasons                | the stored distributions (nightly)               |
| Outlook history              | League page, 5-min cache                  | every run's full results (~3 KB a run)               | four fields per team                             |

**Rules from here:**

- Payloads over ~50 KB are stored compressed (`lib/gz.ts`), not as jsonb.
- Aggregate in SQL; don't fetch per-chunk rows.
- Polls skip unchanged data.
- Check the Neon usage panel weekly.

### Budget and the Nov 16 cuts

**Neon's console, Nov 16** (period from Nov 1): transfer **5.03 GB** (Free: 5), compute **51.97 CU-hours** (Free: 100) at a fixed **0.25 CU**, so the database was awake about **13 hours a day**. Jack moved to Launch the same day (pay-as-you-go: $0.106 per CU-hour, 500 GB of transfer included); the goal is to fit back under Free.

| Per month | Neon Free | Budget  |
| --------- | --------- | ------- |
| Transfer  | 5 GB      | 2 GB    |
| Compute   | 100 CU-h  | 60 CU-h |

- **Measured, not guessed:** Settings → "Database this month" reads Neon's API (`NEON_API_KEY`, a project-scoped key, Production only; `lib/neon-usage.ts`): transfer, CU-hours, hours awake and the month's pace. The nightly and pregame jobs push an alert at 60% and 85% of Free, and when a month at this rate passes the budget (once each per period). "A month at this rate" scales the period's use to 30.4 days, so the short Nov 16–30 period (the upgrade restarted it) compares fairly.
- **The plan check:** in a period's last 36 hours (Neon bills by calendar month, so Nov 30's nightly and pregame runs), a push says whether a month at this rate fits Free with 15% to spare, with the steps to switch in Vercel. That's the reminder for Jack's Dec 1 decision between Launch and Free, and it repeats every month.
- **Which reads:** `DB_TRAFFIC_LOG=1` logs each query's result size by its SQL, once a minute (`[db-traffic]` in Vercel's runtime logs). On for a day at a time only: it costs CPU.
- **Compute is awake time.** Neon suspends after 5 idle minutes, so any query every few minutes keeps it up. Cuts (Nov 16):
  - **No `*/15` schedule** for the worker: its peek woke Neon 96 times a day. A missed dispatch is caught by `ensureWorker` in the gameday job (only when that run touched the database anyway), the nightly job, and the Moves poll while a job is live.
  - **Gameday runs skip writes they already made:** status events (`insertStatusEvents`) and official-report statuses (`logOfficialReport`) are remembered per instance, and an unchanged report needs no query. The data logged is the same; only repeat queries are skipped.
  - **The run's own logs** (`gameday` in refresh_log, its cpu_log row) are written only when the run queried the database anyway (`dbUse.queries`).
  - **Closing lines** are captured inside 20 minutes of tip, not 90. Each capture overwrote the last, so only the final one ever counted.
  - **The lock job's check** runs once per first tip per instance, not every 5 minutes for an hour.
  - **Trade ideas after injury news or other teams' moves:** at most hourly on the worker (was every 15 minutes). On Nov 16 news launched the worker every 20 minutes from mid-afternoon, one 8-second trade search each, and each run kept Neon awake ~7 minutes. Jack's own moves and the nightly job still refresh right away.
  - **The task runner leaves after 30 s idle** (was 2 minutes of asks every 15 s); a new task dispatches a run anyway.

**Awake-time check, Nov 17 (the first full day on Launch):**

- **Measured:** 3.5 CU-hours, awake 14 h, since the 3:55 PM upgrade. That's **104 CU-hours a month at this rate**: over the budget (60) and over Free (100). Transfer is fine: 0.04 GB, 1.1 GB a month.
- **Neon's monitoring graph:** the database was awake almost continuously from 4:40 PM to about 11 PM (the game window). The rest of the day was 20- to 50-minute stretches every hour or so.
- **Causes, from the code:**
  - **Nightly values re-read on a timer.** Every league load re-read the teammate-return effects every 10 minutes (new on Nov 17), and the defense table and props blend every 30. The league's average total re-read every 3 hours. The 5-minute job loads the league from 9 AM ET on game days, so these alone woke Neon about every 10 minutes all day. They change only at the nightly run.
  - **In the game window, some write or check landed on nearly every 5-minute run:**
    - a new status (lineups, injury feed);
    - an official report with a change (every 15 minutes);
    - a timeline point (every 15 minutes);
    - a closing-line capture (each of the last 20 minutes before every tip);
    - the simulation-trigger check on any league-wide change (47% of runs);
    - a repeated alert's dedupe check.

**Cuts (Nov 17):**

- **Nightly values:** each server instance reads them once after each nightly run (11:30 UTC; `lib/nightly-fresh.ts`). Missing teammate effects are looked for again every 10 minutes, so a gameday compute still shows up.
- **Held logs:** status events, official-report statuses and timeline points are held in memory with the time they were seen. They are stored together on the hour and half hour, or sooner on any run that queries anyway (`gamedayPlan().store`).
  - **No precision is lost:** rows keep `observed_at`, the report's `published_at` and `taken_at`. Only the write waits.
  - **The risk:** a server instance recycled before a store loses what it held. A status still current is seen again by the next run, a little later. Points on the Matchup chart's line would be missing for that half hour.
- **Closing lines:** only the last run before each tip captures them (8 minutes, down from 20). Only the final capture ever counted.
- **Remembered per instance:**
  - Jack's roster, news and watch list that the latest job was found to match: a league change that isn't his sends no query.
  - Alert keys already sent.
- **Expected:** the game window drops from about 100% awake to one wake per half hour (about a third of the time), and the daytime 10-minute wakes stop. **The check:** Settings' "a month at this rate", after two full days on this change, against the budget of 60 CU-hours.

**Transfer cuts (Nov 16, second PR):**

| Read                                                         | Before                                                                         | After                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Moves poll, Moves page, trade simulate poll, Free agents tab | the whole deep-checks row (~100 KB, every move)                                | only the moves shown, cut in SQL (`liveJob(…, { keys })`)                                      |
| Job refresh (every 20 s per job)                             | every move's sums (~270 B each)                                                | only moves still racing; settled ones remembered per instance, all re-read on the last refresh |
| League page while a run updates                              | full page every 5 s; every final run's history and every league move each time | every 15 s; history and moves kept a minute per instance                                       |
| Trends (and Draft)                                           | prior seasons' ~1 MB row per view                                              | six hours per instance                                                                         |
| Nightly freshness checks (season baselines, trade ideas)     | the whole row                                                                  | fingerprint and time only                                                                      |
| A job's trade ideas                                          | the whole stored list                                                          | its first `TRADE_MOVES`, cut in SQL                                                            |

Not yet cut, small this early in the season and measured with the traffic log before deciding: the Model page's and the nightly blend/defense reads of every logged game (they grow all season).

**Rules from here (adding to the ones above):**

- Every new scheduled step says how often it queries the database; a run with nothing new sends no query.
- Fallbacks run inside work that already has the database awake, never on a timer of their own.
- Check Settings' "Database this month" line weekly; the alerts cover the rest.

**Who played and the context-aware projection (Nov 20, ADR-068, ADR-069): what each queries, and how often:**

- **Box scores** (`game_participation` with `game_results`):
  - The gameday runs write them only at the half-hourly store, when the held logs wake the database anyway.
  - The nightly catches up any finished game without rows: one check of the season's game ids, then at most 120 summaries (ESPN, not the database).
- **NBA.com's lineups** (`lineup_log`): held with the other logs, stored at the same moments.
- **The context step:**
  - **Nightly:** reads the season's played rows once (game, player, team, FP, minutes: about 1 MB at season's end) and writes one gzipped `view_cache` row.
  - **Instances:** each reads that row once per nightly run (`readSinceNightly`).
  - **Gameday:** one freshness check per instance a day, inside a run that has loaded the league.
- **Settings' "Who played" card:** two aggregate queries per page view.

## 11. Tiered simulation jobs (plan 4c)

Jack's goal (Nov 17): after a trigger, the Outlook and the moves involving the changed players land first, without losing accuracy. Today every trigger re-runs every move, and the newest job replaces the one under way.

**Baseline (Nov 19, 9:45 AM).** Settings' "Minutes from a trigger to its numbers": medians since #186 shipped (Nov 17, 1:10 PM), from the rosters' read.

| Trigger                | Jobs | Runners | Outlook | All checks |
| ---------------------- | ---: | ------: | ------: | ---------: |
| Injury news            |    7 |     0.3 |     4.7 |       30.0 |
| Your moves             |    3 |     0.2 |     5.0 |       26.9 |
| League moves           |    3 |     0.3 |     3.0 |       44.9 |
| Nightly or Run outlook |    2 |     0.3 |     2.9 |       43.6 |

- **Runners start within 20 seconds** (#188), and the Outlook lands in 3 to 5 minutes. The long wait is the checks: 27 to 45 minutes.
- **Last 24 hours:** 5 jobs, about 184 moves each, done in 64 minutes on average.
- **Worker runs since Nov 17, 1:10 PM:** 17 of 53 were cancelled. They were dispatches waiting behind a run in progress; GitHub keeps one pending run per concurrency group, and the runners already up take the newest job.
- No tip-off job ran in this window.

**Design (plan 4c):**

- **Tier A:** the Outlook (the base run), on every trigger.
- **Tier B:** on every trigger, the moves it touches plus the last full sweep's contenders.
- **Tier C:** the full sweep, at low priority. A newer trigger replaces only tier C, and the nightly run and Jack's own moves always run it to the end.
- **Moves not yet re-checked** show the last sweep's numbers until C catches up.

### The replay guard (pre-registered Nov 19, before its run)

**Question.** A triggered job re-checks tier B first and shows the last full sweep's numbers for every other move. Does Jack then see the same best moves as a full re-run would show?

**Data.**

- **League state:** the league as read on Nov 19 at about 9:50 AM MST, before the day's first tip. It is saved locally (`data/local/replay-tiers/jobs-2026-11-19T1652.json`, private).
- **Built with production's code:** `simBuildOf` and `buildSimMoves`.
- **Never drop:** Jack's list as the Moves page shows it (10 players), passed at run time. It lives in production's database, which isn't readable locally.
- **Waiver moves only:** 162 to 183 per job. Trade ideas are compared on their own.

**Changes.** 21 changes of the kinds that queue a job. A seeded generator picked them before any simulation, and the dry run listed them.

- **10 league moves:** a random rival drops his lowest-valued player outside IR for one of the 15 best healthy free agents.
- **10 injury news items on Jack's players:** a random player is ruled out for 2, 7 or 21 days, in turn. A player already out would come back instead; none was.
- **Today's first tip:** moves count from tomorrow.
- **Not replayed:** Jack's own moves and the nightly run, because they run every tier to the end.

**Simulation.**

- Every move of every job plays the same 8 chunks of 500 seasons: 4,000 seasons, the top tier's minimum.
- Each run has 10 playoff replays and production's chunk seeds.
- The number compared is each move's title change.

**Tier B,** for each change, is the union of:

- moves with a touched player (the add, the drop or the IR move);
- moves the before job didn't have;
- the job's opening moves (`top`: each card's first drop, the streams and the watch list);
- the before job's **20** best moves by title change.

**Two views per change:**

- **Full:** every move's numbers after the change.
- **Tiered:** after-change numbers for B, before-change numbers for the rest.

**Measures:**

1. **Top 5:** the recommended top 5 is each add's best move, with adds ranked by its title change. It must be identical in both views: the same moves, in the same order.
2. **Top 10:** every move in the full view's top 10 by title change must be in B.

**Criterion:**

- Measure 1 holds in at least 95% of the 21 changes (at most one miss).
- Measure 2 holds in all 21.

**Fallback (set now).** If it fails, tier B with the before job's best **60** is evaluated from the same simulations.

- If that passes, tiers ship with 60.
- If both fail, tiers don't ship as designed, and Jack decides what's next.

**Limits, disclosed:**

- **Precision:** here every move gets 4,000 seasons. Production races contenders to 40,000–160,000 (ADR-063). Both views use the same numbers, so ties near the top are as close here as they are in the comparison.
- **A rival's dropped player** joins the simulated free-agent pool but isn't evaluated as an add. His moves would be in B anyway, since he's touched.
- **Fill-ins' projections** (teammate returns, ADR-064) aren't recomputed after an injury.
- **One league state:** a single morning.

`scripts/replay-tiers.ts` (`DRY=1` lists the changes; the run prints each change and the verdict).

## 12. Skipping unaffected moves

Tiers (§11) change only the order of a job's work, so they can't shorten "all checks". The checks take 27 to 45 minutes because every trigger re-runs every move. Most triggers are about players most moves don't involve: a rival's add/drop, or news on one of Jack's players.

**Design.**

- **On a rival's move or injury news:** the job re-runs the Outlook plus only the moves the change touches or makes new. Every other move keeps its numbers from the last full sweep.
- **Full sweeps** stay as today: the nightly run and Jack's own moves re-run everything.
- **Busy days:** after several triggers, a job re-checks every move touched or made new since the last full sweep.

**Expected gain** (from the dry run, before any simulation):

- **League moves:** 0 to 3 of about 165 moves re-checked.
- **Injury news:** 0 moves when the player is on Jack's Never-drop list (8 of the 10 replayed). 55 when the player can be dropped.
- **On a busy day:** 21 of 159 after 10 rival moves, and 67 with 3 news items as well.

Such a job would take about as long as the Outlook (3 to 5 minutes) instead of 27 to 45.

### The replay test (pre-registered Nov 19, before its run)

**Question.** Jack's best moves are shown from re-checked numbers for touched and new moves, and the last full sweep's numbers for the rest. Are they the same moves, with the same numbers within production's precision, as a full re-run would show?

**Data:**

- **Singles:** the tier guard's 21 changes and its simulated numbers (§11), each against its before job.
- **Busy days,** two new jobs from a fresh read of the league (Nov 19, about 1:20 PM MST). The same seeded generator picked the changes, applied together:
  - all 10 rival add/drops;
  - the 10 add/drops plus the first 3 injury news items with different players.
- **Saved locally:** `data/local/replay-tiers/skip-jobs-2026-11-19T2018.json` (private).
- **Never drop:** Jack's 10 players, as the Players page lists them.

**Simulation.** As in §11: 4,000 seasons per move on production's chunk seeds, and the number compared is each move's title change.

**Re-checked,** for each change: moves with a touched player (the add, the drop or the injured player) and moves the before job didn't have.

**Two views per change:**

- **Full:** every move's numbers after the change.
- **Skipping:** after-change numbers for the re-checked moves, before-change numbers for the rest.

**Measures:**

1. **Top 5:** the recommended top 5 (each add's best move, adds ranked by title change) has the same five moves and the same first move in both views.
2. **Numbers:** every move in the full view's top 5 is shown within ±0.2 points of its full title change. That's the top tier's precision target, `TOP_TIER.target2se`.

**Criterion,** for each trigger kind separately:

- **League moves:** measure 1 holds in at least 9 of its 10 singles, and so does measure 2. Both hold on the busy day with 10 rival moves.
- **Injury news:** measure 1 holds in at least 9 of its 10 singles, and so does measure 2. Both hold on the busy day with rival moves and news.
- **Tip-off:** a single replayed change can't support it, so tip-off jobs keep re-running everything. Its result is reported, not used.

**Fallback (set now).** If a kind fails, the same measures are applied with the before job's best 20 moves also re-checked, from the same simulations. That's a smaller saving. If that fails too, the kind keeps full re-runs, and Jack decides what's next.

**What ships when a kind passes:** its triggered jobs re-check only those moves (plus the 20 if that's what passed). The Moves page then marks kept numbers as from the last full sweep.

**Limits, disclosed:**

- **Few cases:** with 10 singles per kind, passing 9 rules out only a high miss rate, not a small one. The busy days are the harder test.
- **Two league states:** a morning and an afternoon of one day.
- **Measures cover the top 5 only.** Kept numbers further down the list can drift more until the next full sweep. The nightly run sweeps everything.
- **Precision:** every move gets 4,000 seasons here, but kept numbers in production come from sweeps with more seasons for contenders. Both views share chunk seeds, so the differences measured come from the change, not from new random draws.
- **No recomputation:** fill-ins' projections (ADR-064) aren't recomputed after an injury, as in §11.

`scripts/replay-skip.ts`:

- `DRY=1` lists the changes and how many moves each re-checks.
- `RESULT=<the guard's result file>` scores the singles from §11's simulations, then simulates the busy days and prints each change and the verdicts.

## 13. Results: the tier guard and the skip test (Nov 19)

### The tier guard (§11): does not pass. Tiers don't ship as designed.

Run from 10:38 AM to 3:43 PM MST: 2,480 chunks on 14 cores, on the saved jobs as pre-registered.

| Tier B with                         | Top 5 identical (need 20 of 21) | Top 10 inside B (need 21 of 21) |
| ----------------------------------- | ------------------------------: | ------------------------------: |
| The last sweep's best 20            |                      3/21 (14%) |                            4/21 |
| The last sweep's best 60 (fallback) |                      8/21 (38%) |                            9/21 |

- **League moves failed in all 10 changes,** at both sizes. With the best 20, 5 to 10 of the full top 10 fell outside B.
- **Injury news:** 3 of 10 at 20, and 8 of 10 at 60.
- **Tip-off failed** at both sizes.

**Why (diagnostics, not part of the criterion):**

- **Jack's best moves are nearly tied.** Before the changes, the 30 best moves span 0.83 to 0.58 title-odds points. One move's standard error at 4,000 seasons is 0.29.
- **The runs share their random draws as intended.** Across a change, each move's numbers correlate 0.89 to 0.997. The spread of their changes (0.05 to 0.30 points) is below independent noise (0.41).
- **Every change shifts all moves.** A rival's add/drop lowered the average move by 0.10 to 0.75 points. Injury news lowered it by 0.02 to 0.98.
- **So old numbers are biased, not only noisy.** Moves that keep their before numbers miss the general shift, so they rise above re-checked moves. Some moves also change on their own.
- **The worst case:** with the best 60 and one 21-day absence, the before job's 61st move kept its +0.45 and showed as #1. Re-checked, it was −0.97: 1.29 points below the true #1.
- **Cost of the tiered #1** in full numbers, against the full #1: 0 to 0.71 points with the best 20, 0 to 1.29 with the best 60. The full #1 is itself a noisy pick among near-ties, so these overstate the true cost somewhat.

The `tiered-jobs` branch (tier order, carried-over tier B, "first moves" timing) stays unmerged.

### The skip test (§12): does not pass for either kind. Triggered jobs keep re-running every move.

Run from 3:45 PM to 4:24 PM MST. The singles came from the tier guard's simulations, and the two busy days were simulated on the saved jobs, as pre-registered.

| Re-checked                  | Kind         | Top 5 same (need 9) | Within ±0.2 (need 9) | Busy day |
| --------------------------- | ------------ | ------------------: | -------------------: | -------- |
| Touched and new             | League moves |                0/10 |                 0/10 | fails    |
| Touched and new             | Injury news  |                0/10 |                 5/10 | fails    |
| Plus the best 20 (fallback) | League moves |                0/10 |                 1/10 | fails    |
| Plus the best 20 (fallback) | Injury news  |                3/10 |                 8/10 | passes   |

- **League moves:** kept numbers for the top 5 were off by 0.22 to 0.81 points. The busy day with 10 rival moves was off by 0.76 at both sizes.
- **Injury news:** kept numbers were off by 0 to 0.47 points.
- **Tip-off** (reported, not used): off by 0.34 points with touched and new moves, and 0.24 with the best 20.

**Taken together.** No trigger leaves Jack's top moves' numbers alone:

- a rival's add/drop moves them by more than production's ±0.2;
- the best moves are close enough that any shift changes the top 5.

Showing a full re-run's numbers, with the last numbers marked "updating" until then (ADR-058), is what both tests support.
