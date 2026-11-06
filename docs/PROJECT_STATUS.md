# Project status (2026-11-05, end of day)

## Where things stand

**Live** at **https://fantasycopilot.vercel.app**, on Vercel Hobby with Neon Postgres. Four tabs: Today, Matchup, Players (Moves, Free agents, Trends), League (with Trades and team pages).

Today (PRs #79–#103) did two things:

- made every simulation run by itself;
- cut Vercel CPU, which was close to Hobby's limit.

### Every simulation runs by itself

- **Every move is checked** (ADR-058, #79): every drop of every add on Moves, the best 3 drops of the other evaluated adds, and the best 15 trade ideas (#87). That's ~290 moves per job, in groups of 12, most important first.
  - Clearly worse moves stop after 1,000 seasons; close ones run to ±0.5 title points or 20,000 seasons.
  - 16 GitHub runners.
- **Moves (#83, #84):**
  - no "Simulate this drop" button any more, and the drop picker shows every drop's title change;
  - while a job re-checks, cards keep their last numbers (`move_results`) with a spinner and "Updating after: …";
  - after your own roster change they show a loader until the new numbers have 4,000 seasons;
  - injury news keeps the old numbers;
  - a banner shows progress ("78 of 288 moves done"), and the page polls `/api/moves/status` instead of re-rendering.
- **Free agents (#86):** a sortable Title column (each player's best checked move ± margin).
- **Trades (#87):** each idea shows its simulated title change, and the evaluation shows title, playoffs and wins with margins. Simulate stays only for custom trades.
- **What starts a job:**
  - your own moves, right away (in the app, or seen by the 5-minute watch);
  - injury news or IR changes on your roster (5-minute job, at most one job per 5 min);
  - other teams' moves (until Nov 20 at most every 90 min, see below);
  - the nightly run.
- **Measured in production:**
  - the opening moves are settled ~3–4 min after a trigger, and all ~290 in ~14 min;
  - the news trigger worked ("Injury news for your players").

### Vercel CPU (see `docs/COMPUTE.md`)

- **Hobby rule:** 4 h of Active CPU over a rolling 30 days; above it, Vercel pauses the project. **Nov 5: 3 h 10 m.**
- **The danger window:** the days leaving the window until ~Nov 19 used almost nothing, so use must average ≤ ~4 min a day until then. After that, the heavy late-October days (12–23 min each) roll off.
- **Measurement (#80):** `cpu_log` and Settings → "Vercel CPU, last 24 hours" break each job down by step; Vercel Observability gives per-route figures. `scripts/profile-cpu.ts` profiles locally (read-only).
- **Moved to the GitHub worker** (`worker_tasks`, ADR-059):
  - the trade-idea search (~7.5 s per run, #82);
  - building each simulation job, including the waiver analysis (#90).

  A roster move now costs Vercel **~0.9 s instead of ~5.3 s**.

- **Gameday job (#96, Jack approved):**
  - injury-report logging every 10 min before the game window (5 min in it; MODEL_CARD note recorded before any evaluation);
  - runs with nothing due skip the league load (`gamedayPlan`).

  It was ~0.55 s per run before this.

- **Worker traffic** (#98, #100, #101): per job, from ~18 s to **~15.5 s** (measured). #98 halved the requests, #100 made one request post results and claim the next chunks, and #101 recomputes the move numbers at most every 20 s (not measured yet).
- **Temporary trims:**
  - other teams' moves re-check at most every **90 min** until Nov 20 (#89, raised from 30 in #103, Jack's call); the roster watch looks back 105 min so a waiting move is still seen;
  - trade ideas refresh at most every 15 min for other teams' changes (#81/#82).
- **Projection:** before #96/#101/#103 it was ~6–7 min a day at ~15 jobs a day (a job costs ~15 s). Those three should bring it toward ~4 min a day. **To be confirmed by the first full day (Nov 6).**

### Bugs found and fixed today

- **#85:** a reused job kept an old roster key, so it was re-queued every 5 min.
- **#91–#94:** worker coordination:
  - separate short heartbeats for simulation and task runners;
  - one dispatch a minute;
  - the task runner doesn't idle on queued jobs;
  - a re-asked queued task still brings a runner.
- **#88:** a flaky CPU test.

## Daily CPU check (until ~Nov 20)

- Claude checks Vercel → Usage every morning (scheduled 8:47 local, ~9:17 in practice) in this session, plus Settings' CPU card.
- It reports in 2–4 lines: the 30-day total, yesterday's use, the projection, and any action needed. It changes nothing without Jack's OK.
- The job is session-only and expires after 7 days. It re-creates itself around Nov 11 and stops on Nov 21. **A new session before Nov 20 should set it up again.**

## Waiting on Jack

- **Vercel's Git auto-deploy** was slow on Nov 5 (merged commits sat 5–30 min with no commit status). Jack OK'd deploying `main` from the dashboard when it happens. If it recurs, check github.com/settings/installations → Vercel for a pending permission request (that page needs his password).
- **1-minute transaction watch:** deferred until CPU has room (~0.1 s per call, ~2 min a day). The 5-minute watch stays.
- **Optional:** the full job could drop from ~14 to ~7 min if moves beyond each card's opening drop ran to ±0.75 instead of ±0.5.

## Next tasks

1. **Nov 6 checks:**
   - the first full-day CPU (the daily check);
   - overnight gameday runs show "skipped: nothing due";
   - #101's per-job worker CPU (Observability, one job);
   - the nightly run (11:00 UTC) queues a job and prunes old jobs, tasks and `cpu_log`.
2. **If CPU is still above ~4 min a day:** next options in COMPUTE.md (more seasons per request, at the cost of later first numbers; a Vercel Pro month).
3. **After Nov 20:**
   - the trims end on their own;
   - revisit the 1-minute watch;
   - move more work to the worker per the target architecture in COMPUTE.md.
4. **Earlier items still open:**
   - the official-statuses forward test (once ≥1,500 non-Out rows);
   - the props and DARKO blend tests (nightly; `/nba/model`);
   - win-probability candidate C after week 7 (Dec 6) and recalibration after week 13;
   - props coverage for free agents.
5. **Roadmap** (`docs/ROADMAP.md`): own projection models, opponent manager profiles, a playoff-schedule planner, NFL and MLB. The task queue (`worker_tasks`) is where heavier models run.

## Renewals

- `GITHUB_DISPATCH_TOKEN` expires **Nov 1, 2027**.
