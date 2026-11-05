# Project status (2026-11-05)

## Where things stand

**Live** at **https://fantasycopilot.vercel.app**, on Vercel Hobby with Neon Postgres. Four tabs: Today, Matchup, Players (Moves, Free agents, Trends), League (with Trades and team pages).

**Every simulation runs by itself now (Nov 5, PRs #79–#87):**

- **The worker checks every move** (ADR-058): every drop of every add on Moves, the best 3 drops of the other evaluated adds, and the best 15 trade ideas. That's ~290 moves per job, in groups of 12, most important first.
  - Clearly worse moves stop after 1,000 seasons; close ones run to ±0.5 title points or 20,000 seasons.
  - **Measured:** the opening moves are settled ~4 min after a trigger, and all 288 moves in ~13.5 min (16 runners).
- **Moves:**
  - each card shows its deep check with no button, and the drop picker shows every drop's title change;
  - while a job re-checks, cards keep their last numbers with a spinner; after your own roster change they show a loader until the new numbers have 4,000 seasons;
  - a banner shows progress ("64 of 288 moves done"), and `/api/moves/status` is polled instead of re-rendering the page.
- **Free agents:** a sortable Title column (each player's best checked move).
- **Trades:**
  - each idea shows its simulated title change, and the evaluation shows title, playoffs and wins with margins;
  - the trade search itself runs on the worker (ADR-059, `worker_tasks`);
  - Simulate stays for custom trades.
- **What starts a job:** a roster move anywhere in the league (the 5-minute transaction watch, or right away for moves made in the app), injury news or IR changes on your roster (the 5-minute job; at most one job per 5 min for news), and the nightly run.

**Later on Nov 5 (#89–#94):**

- **#89, temporary trim:** until Nov 20, other teams' moves re-check at most every 30 min. Own moves and news stay immediate.
- **#90:** the job's moves are built on the worker (`sim-build` task; the waiver analysis is no longer on Vercel). A roster move now costs Vercel ~0.9 s instead of ~5.3 s.
- **#91–#94, worker coordination:**
  - separate heartbeats for the simulation runners and the task runner (short, so a runner that left doesn't block a new run);
  - one dispatch a minute;
  - the task runner doesn't idle on queued jobs;
  - a task asked for again while queued still brings a runner.
- **Verified in production:**
  - Recalculate gives one dispatch, the worker build (2.8 s), then ~290 moves done in ~14 min, with the cards showing "Updating" and their last numbers;
  - the news trigger queued a job ("Injury news for your players");
  - the trade search ran on the worker (9.6 s).

**Vercel CPU** (the main constraint; see `docs/COMPUTE.md`):

- **Nov 5:** 3 h 6 m of Hobby's 4 h over a rolling 30 days. Over the limit, Vercel pauses the project.
- **Biggest cost found:** the trade idea search (~7.5 s per run). It now runs on the worker, at most every 15 min for other teams' changes. Jack's own moves and the nightly run refresh it right away.
- **Measured per step** (`cpu_log`, Settings → "Vercel CPU, last 24 hours"):
  - gameday ~0.6 s per run;
  - a roster move ~5.3 s to build the simulation job;
  - the worker's requests ~2.8 s per job.
- **Projection:** ≈5.5 min a day after #90. The 30-day window (3 h 10 m on Nov 5) needs ≤ ~4 min a day until ~Nov 19, when the heavy late-October days start rolling off. **Check Vercel → Usage daily until then.**

## Waiting on Jack

- **Vercel's Git auto-deploy** was slow or missing on Nov 5 (merged commits sat 5–30 min, with no commit status). Jack OK'd deploying `main` from the dashboard meanwhile. If it recurs, check github.com/settings/installations → Vercel for a pending permission request (that page needs his password).
- **Decision:** the 1-minute transaction watch (Jack chose it) is **deferred** until CPU has room. It costs ~0.1 s per call (~2 min a day). The 5-minute watch stays.
- **Decision (optional):** to cut the full job from ~13.5 to ~7 min, the moves beyond each card's opening drop could run to ±0.75 instead of ±0.5. Jack's call.

## Next tasks

1. **CPU, until ~Nov 19:**
   - gameday is now the biggest piece (~2.7 min a day);
   - skip the league load at night;
   - post the worker's results less often (~3.9 s per job);
   - if Jack agrees, log availability every 10 min instead of 5 outside the game window (a pre-registered test's cadence).
   - Re-measure 24 h and update COMPUTE.md.
2. **Check in production:**
   - the trade search's first run on the worker (it runs when the ideas' inputs change);
   - the nightly run (11:00 UTC) queues a job and prunes old jobs and tasks;
   - `move_results` keeps numbers through the next re-check (Moves shows "Updating", not loaders).
3. **Earlier items still open:**
   - the official-statuses forward test (once ≥1,500 non-Out rows);
   - the props and DARKO blend tests (nightly; `/nba/model`);
   - win-probability candidate C after week 7 (Dec 6) and recalibration after week 13;
   - props coverage for free agents.
4. **Roadmap** (`docs/ROADMAP.md`): own projection models, opponent manager profiles, a playoff-schedule planner, NFL and MLB. The task queue (`worker_tasks`) is the place for heavier models.

## Renewals

- `GITHUB_DISPATCH_TOKEN` expires **Nov 1, 2027**.
