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

| Scheduler                     | What it calls                    | How often                                           |
| ----------------------------- | -------------------------------- | --------------------------------------------------- |
| cron-job.org (job 8752774)    | `/api/cron/gameday`              | every 5 min, all day                                |
| Vercel cron                   | `/api/cron/nightly`              | 11:00 UTC                                           |
| Vercel cron                   | `/api/cron/pregame`              | 22:00 UTC                                           |
| GitHub Actions `simulate.yml` | `/api/worker/{peek,next,result}` | on dispatch (a roster move), plus a `*/15` fallback |

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
