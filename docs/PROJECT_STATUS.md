# Project status (2026-11-16)

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

**Nov 16 (#155–#160): Moves.** Jack's four asks: why the best-moves tables went blank overnight, open each card on its best and most precise move, count roster construction and schedules, and check the best moves more precisely (plan: `~/.claude/plans/i-m-playing-fantasy-basketball-rippling-fox.md`).

| PR   | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #155 | **Blank tables overnight, fixed.** The roster key that matches stored results to Jack's roster held every lineup slot, so a lineup change made every result look like it belonged to another roster ("—"). The 5-minute check compared only today's rosters (the key reads tomorrow's) and doesn't read the league from ~9 PM to 4 AM MT. There was no sim job from 3:30 PM Sunday until a league move set one off at 2:10 AM. The phone kept its old page (it polls only while a job runs). **Now:** the key holds players plus the IR flag only; the check covers tomorrow's roster; a Moves visit with blank cards and no job queues one (cards say "Checking…"); a tab shown again re-asks, and reloads after 5+ min away. |
| #156 | **Racing and the head-to-head pick (ADR-063).** Tiers: decision ±0.1 (to 160,000 seasons) for Jack's best move and up to 3 rivals; top ±0.2 for each card's opening move, its best drop and up to 3 rivals; rest ±1. Moves still in reach of a leader (not 2 SE behind it head to head over shared chunks) move into deeper groups as results arrive. A card opens on its **pick**: most title odds, and among drops within the noise, most expected wins, then this week's win chance. The drop list shows each ±. Live: Paul Reed's card opens on Naz Reid at +0.4±0.1; Kris Dunn's drop, rechecked, is +0.3±0.1 (it had shown +0.5±0.5 at 6,000 seasons and opened the card).                                               |
| #157 | **Roster fit on each card:** open lineup spots for a guard, forward or center over the rest of the season, with and without the move (only kinds changing by 2+ days), and both players' playoff-week games.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| #158 | **Pre-registration:** position-aware streaming in the season sim (MODEL_CARD).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| #159 | **Runners wait while a racing job has chunks out.** In the first racing job, 8 of 16 left at minute 5, before the promotions; it took 19 min.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| #160 | **Roster fit counts room** ("how many more guards could start"), not which slot the greedy left empty. A swingman (Hart, SG/SF) had made a center add read "guard 136 → 130".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

- **Not shipped:** position-aware streaming in the season sim. It failed pre-registered checks 1 (fit: 0.556 of pickups were the guard; bar 0.90) and 5 (CPU +147%; bar +20%). Calibration checks 2–4 passed. The code is on the unmerged branch `experiment/fit-streams`; the diagnosis is in MODEL_CARD. Both the points estimate and the sim's lineups were already position-aware; only the sim's own in-season streams aren't.
- **Nov 9–13 (#118–#154):** minimal mode and the saver, trade packages on request, trades with a team, the opaque phone status bar, the Matchup scoreboard details, rows and daily projections, stream timing around the first tip, centered rows and the phone score column (ADR-062), and stat tables that fit phones. The PRs are in git history.

**Asked trades (fixed in #128):** until #128 each ask queued a full job (~250 moves plus the Outlook), so League and Players showed loaders and the trade waited ~12 min. Now an ask queues an asked-only job that doesn't replace the full one. Each ask still costs ~5 s of Vercel CPU (`prepareJob`).

## Waiting on Jack

- **Check on the phone (Moves):**
  - cards keep their numbers through a lineup change;
  - each card opens on its pick, and the dropdown shows each ±;
  - the "Open lineup spots" line and playoff-week games;
  - reopening the app refreshes the numbers.
- **Position-aware streaming:** whether to try again. That needs a new pre-registration (the first choice between two free agents, not the share of pickups) and a cheaper candidate.
- **Earlier, still to check:** the popup's live box score fit during a game; the on-court edge during a game; the lock job's wait-for-the-tip moves (#143, #146).
- **Worker → Neon directly** (approved Nov 9): Jack adds `DATABASE_URL` as a GitHub Actions secret when the PR is ready.

## Daily CPU check

Ended Nov 10 (Jack's OK): Pro has no CPU cap, and the budget alerts cover spending.

## Next tasks

1. **Measure a full racing job with every runner (#159):** today's first-tip job (5 PM MT) or the nightly job. Record wall time (budget 12 min), chunks and Vercel CPU per job (Settings; budget 2 s) in ADR-063 and docs/COMPUTE.md. Over budget: lower `DECISION_TIER.maxSeasons` to 72,000 (±0.15), or `MAX_RIVALS` to 2.
2. **PR 7:** the worker reads and writes Neon directly (ADR; `/api/worker/*` moves into the worker). Jack adds `DATABASE_URL` as a GitHub Actions secret.
3. **Scheduling stays on cron-job.org** (decided Nov 10). The 1-minute watch is parked (COMPUTE.md §7).
4. **Draft accuracy:** the card appears once ranked players have 10+ games; record the first numbers in MODEL_CARD.
5. **Return-date test** (MODEL_CARD, Nov 6): evaluate once ≥ 60 absences with ESPN return dates have ended.
6. **Still open:**
   - the partner's simulated odds on trades;
   - the official-statuses forward test (≥ 1,500 rows);
   - the props and DARKO blend tests;
   - win-probability candidate C (Dec 6) and recalibration (week 13);
   - props coverage for free agents.
7. **Roadmap** (`docs/ROADMAP.md`): own projection models, manager profiles, a playoff-schedule planner, NFL and MLB.

## Background

- **Nov 16:** the ± on Moves is simulation noise only. The model's own error (projections, the sim's assumptions) is larger, and more seasons don't remove it (ADR-063).

- **Nov 10, decided:** the Moves card's weekly win chance keeps assuming both teams set their best lineup daily (Jack prefers the optimal-lineup number; the season simulation still uses each manager's observed activity).

- **Nov 6** (#106–#116): correctness fixes, UI polish, pull to refresh, protected players and precision tiers (ADR-060), the Interested list, the percentile scale (ADR-061), Trends vs last season, Players → Draft, the season pool fix.
- **Nov 5** (#79–#103): automatic simulations, builds on the worker, gameday skips.

## Renewals

- `GITHUB_DISPATCH_TOKEN` expires **Nov 1, 2027**.
