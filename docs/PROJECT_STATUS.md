# Project status (2026-11-12)

## Where things stand

**Live** at **https://fantasycopilot.vercel.app** (Vercel Pro since Nov 10, Neon Postgres).

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

Nov 9–12 (PRs #118–#139) carried out Jack's six requests and the fixes after he tried them (plan: `~/.claude/plans/i-m-playing-fantasy-basketball-rippling-fox.md`).

| PR   | What                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #118 | **Minimal mode** (`minimalOn`, until Nov 21) and the saver extended to Nov 29. Streams get the rest tier until Nov 29. Trade packages no longer run with every job.                                                                                                                                                                                                                                                                            |
| #119 | **Trade packages on request.** "Find trade packages" on watched players on other teams. **Asked trades** (`lib/nba/asked-trades.ts`): every job checks them until each has a result settled after the ask. **Moves order:** Best moves, Best streams this week, Interested free agents, then watched players elsewhere. The watch-list key counts only free agents.                                                                            |
| #120 | **Trades:** "Best trades with {team}" (league-wide ideas at once; "Find more" runs the search for that team on the worker, task `trade-with`). "Simulate season odds" on your own trade runs on the worker as an asked trade. The Vercel `simulateTrade` is gone.                                                                                                                                                                              |
| #121 | **Mobile:** an opaque status bar (`statusBarStyle: "default"`, theme-color follows the toggle). This fixes the tab bar sitting ~62 pt high while pages load, and the blur behind the clock. **"Expected return: Nov 24"** labels.                                                                                                                                                                                                              |
| #122 | **Matchup scoreboard:** each team's record and place. Tap the card for starts and points per start, so far and projected, and the projected finals.                                                                                                                                                                                                                                                                                            |
| #123 | **Charts:** the win chance spreads each day by its games (`lib/chart-axes.ts`). Odds over time on a daily date axis.                                                                                                                                                                                                                                                                                                                           |
| #125 | **Old Home Screen installs:** iOS keeps the status-bar style from when the app was added (WebKit bug 260508), so #121 only applied after a re-add. A callout asks old installs to re-add (`components/home-screen-check.tsx`). Jack re-added Nov 9: tabs and blur fixed.                                                                                                                                                                       |
| #127 | **Simulate button:** one per trade (keyed), keeps polling after reloads and when the app returns to the front, shows the numbers so far ("refining"). Trades links no longer prefetch (40–60 function calls per visit).                                                                                                                                                                                                                        |
| #128 | **Asked trades get a small job of their own** (task `sim-asked`, `sim_jobs.asked_only`): only the asked trades, run ahead of the full job without replacing it. The pages (`liveJob()`, outlook-refresh) ignore it; the simulate button reads `liveJob(true)`. A full job still replaces it.                                                                                                                                                   |
| #130 | **Claim timing:** a waiver claim (or any move after the lock) keeps the dropped player until it processes; the season part compares both rosters from that day (`waiverAnalysis`). The simulator reports each season's per-week points. `GET /api/moves/sim-input?key=` (session only) returns one move's simulation input, for one-off runs off Vercel.                                                                                       |
| #133 | **Deep checks time claims too:** a move whose add joins after the job's first day (a claim before the lock, or one clearing later) plays the current roster until then and swaps that day (`SimTeam.next`; the add is reserved meanwhile). IR moves stay immediate, the add out until his day.                                                                                                                                                 |
| #135 | **Pro: minimal mode and the saver end** (both dates set to Nov 10); COMPUTE.md §9 records the overage and the move to Pro.                                                                                                                                                                                                                                                                                                                     |
| #131 | **Ruled-out players keep their game** (display only; finished in #138).                                                                                                                                                                                                                                                                                                                                                                        |
| #138 | **Out players and final scores:** `cellFromLive` no longer drops a ruled-out player's game. He shows the game and score, "Exp. return" in place of stats, no points (Matchup and Today). Past days fetch that day's scoreboard (`loadFinalScoreboard`, 6 h cache): "vs PHI 121-113 Final", score first everywhere. **Starts so far** count a starter only if his team plays and he isn't ruled out (`countsAsStart`; a 0-minute start counts). |
| #139 | **Phone Matchup cells:** 8 px side padding on both sides (was 2 px), so the 3 px on-court edge no longer covers text.                                                                                                                                                                                                                                                                                                                          |

**Asked trades (fixed in #128):** until #128 each ask queued a full job (~250 moves plus the Outlook), so League and Players showed loaders and the trade waited ~12 min. Now an ask queues an asked-only job that doesn't replace the full one. Each ask still costs ~5 s of Vercel CPU (`prepareJob`).

## Waiting on Jack

- **Check on the phone:**
  - **Matchup and Today (#138, #139):** a ruled-out player shows his game, its score and "Exp. return" (no points). Past days show final scores, and Monday's starts leave out Quickley (checked in production Nov 12). The on-court edge clears the text on both sides (check during a game).
  - **Simulate a trade (#128):** League and Players should show no loaders; the trade's numbers should appear within a few minutes.
  - **Features:** the scoreboard details, both charts, Moves, Trades, and the Expected-return labels.
- **Worker → Neon directly** (approved Nov 9): Jack adds `DATABASE_URL` as a GitHub Actions secret when the PR is ready.

## Daily CPU check

Ended Nov 10 (Jack's OK): Pro has no CPU cap, and the budget alerts cover spending.

## Next tasks

1. **After #135 deploys:** the first fantasy-copilot build on the Basic machine should succeed (it was Elastic), and the next morning's usage (Vercel → Usage, Settings' CPU card) should show ~5–9 min a day of Fluid Active CPU, a few cents.
2. **PR 7:** the worker reads and writes Neon directly (ADR; `/api/worker/*` moves into the worker). On Pro it saves money, not a cap; Jack adds `DATABASE_URL` as a GitHub Actions secret.
3. **Scheduling stays on cron-job.org** (decided Nov 10): a Vercel cron costs the same, would block deploys on Hobby, and has no call history or failure emails. **The 1-minute watch is parked:** it would only see moves made in the ESPN app ~2–4 min sooner, against a simulation that takes several minutes and other teams' moves that wait up to 30 min anyway (COMPUTE.md §7). Revisit if a race for a player ever turns on minutes.
4. **Draft accuracy:** the card appears once ranked players have 10+ games; record the first numbers in MODEL_CARD.
5. **Return-date test** (MODEL_CARD, Nov 6): evaluate once ≥ 60 absences with ESPN return dates have ended.
6. **Still open:**
   - the partner's simulated odds on trades (the worker's result has only Jack's side);
   - the official-statuses forward test (≥ 1,500 rows);
   - the props and DARKO blend tests;
   - win-probability candidate C (Dec 6) and recalibration (week 13);
   - props coverage for free agents.
7. **Roadmap** (`docs/ROADMAP.md`): own projection models, manager profiles, a playoff-schedule planner, NFL and MLB (on Pro, NBA + NFL together fit the credit; check next summer).

## Background

- **Nov 10, decided:** the Moves card's weekly win chance keeps assuming both teams set their best lineup daily (Jack prefers the optimal-lineup number; the season simulation still uses each manager's observed activity).

- **Nov 6** (#106–#116): correctness fixes, UI polish, pull to refresh, protected players and precision tiers (ADR-060), the Interested list, the percentile scale (ADR-061), Trends vs last season, Players → Draft, the season pool fix.
- **Nov 5** (#79–#103): automatic simulations, builds on the worker, gameday skips.

## Renewals

- `GITHUB_DISPATCH_TOKEN` expires **Nov 1, 2027**.
