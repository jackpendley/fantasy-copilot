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

**Vercel CPU** (the main constraint; see `docs/COMPUTE.md`):

- **Nov 5:** 3 h 6 m of Hobby's 4 h over a rolling 30 days. Over the limit, Vercel pauses the project.
- **Biggest cost found:** the trade idea search (~7.5 s per run). It now runs on the worker, at most every 15 min for other teams' changes. Jack's own moves and the nightly run refresh it right away.
- **Measured per step** (`cpu_log`, Settings → "Vercel CPU, last 24 hours"):
  - gameday ~0.6 s per run;
  - a roster move ~5.3 s to build the simulation job;
  - the worker's requests ~2.8 s per job.
- **Projection:** ≈7 min a day against the 8 min a day Hobby sustains.

## Waiting on Jack

- **Vercel's Git auto-deploy** was slow or missing on Nov 5 (merged commits sat 5–30 min, with no commit status). Jack OK'd deploying `main` from the dashboard meanwhile. If it recurs, check github.com/settings/installations → Vercel for a pending permission request (that page needs his password).
- **Decision:** the 1-minute transaction watch (Jack chose it) is **deferred** until CPU has room. It costs ~0.1 s per call (~2 min a day). The 5-minute watch stays.
- **Decision (optional):** to cut the full job from ~13.5 to ~7 min, the moves beyond each card's opening drop could run to ±0.75 instead of ±0.5. Jack's call.

## Next tasks

1. **CPU, before anything heavier:**
   - **build the simulation job's inputs on the worker** (Vercel sends the league data it already reads; the worker runs the waiver analysis and move building): about −2 min a day;
   - **gameday:** load the league only when a step needs it (night hours, no move): about −1 min a day;
   - **coalesce other teams' moves** into one pending job (no restart storms on busy nights).
   - Then re-measure 24 h and update COMPUTE.md.
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
