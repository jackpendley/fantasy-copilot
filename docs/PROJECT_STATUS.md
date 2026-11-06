# Project status (2026-11-06, early morning)

## Where things stand

**Live** at **https://fantasycopilot.vercel.app** (Vercel Hobby, Neon Postgres).

- **Tabs:** Today, Matchup, Players (Moves, Free agents, Trends, **Draft**), League (Trades, team pages).
- **Simulations:** every move and trade idea is simulated automatically on the GitHub Actions worker (ADR-058/059). Nov 5's PRs #79–#103 are in the previous status below, under "Background".

Nov 6 (PRs #106–#113, plus the fix #115) carried out Jack's 14-request plan (`~/.claude/plans/i-m-playing-fantasy-basketball-rippling-fox.md`).

| PR   | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #106 | **Correctness.** Past days on Matchup show no projection for players who were out (IR, or a logged Out status without playing): Duren's "projected 29.9" is gone. An audit test locks in that injured players count nothing until their estimated return everywhere. MODEL_CARD pre-registers a test of ESPN's return dates. "Starts for you" is now out of all games left, plus "cut Nov 9 for Duren". The win chart always ends at Now (the headline) and sits under it. |
| #107 | **UI.** Injury notes are 2 readable lines (phones too); the header and bottom nav are solid; league matchup boxes have one layout with only scores colored; the on-court player gets a green tint and edge instead of a dot, and players not playing today are greyed.                                                                                                                                                                                                     |
| #108 | **Pull to refresh** on touch screens (the browser's own pull is off).                                                                                                                                                                                                                                                                                                                                                                                                      |
| #109 | **Protected players and precision tiers (ADR-060).** "Never drop" (Moves) and "Not for trade" (Trades) panels; `player_prefs`. Top tier (asked-for moves, each card's opening move, streams, the watch list): ±0.35 title points, 4,000–40,000 seasons. Rest: ±1.0, 1,000–6,000.                                                                                                                                                                                           |
| #110 | **Interested list** (ESPN watch list). Watched free agents get move cards. Watched players on other teams get the best 3 "Trade for him" packages (`trade-for` worker task), each simulated. A watch-list change queues a job (`sim_jobs.watch_key`).                                                                                                                                                                                                                      |
| #111 | **7-level percentile scale (ADR-061).** Shaded StatTiles on the card's Advanced tab, level-filled badges, colored values in Free agents and Trends. Checked for contrast and color blindness, light and dark.                                                                                                                                                                                                                                                              |
| #112 | **Trends → Vs last season.** FP/G against the latest prior season with 40+ games, both scored with this season's rules (the league changed its scoring), with MPG, TS%, usage, per-36 and a role badge. Prior seasons come from ESPN's public season pool, stored once.                                                                                                                                                                                                    |
| #115 | **Season pool fix.** ESPN's public season pool ignores the sort, so its `limit` cut arbitrary players: the rankings import matched 318 of 348, and the stored last-season baselines lost ~⅓ of players with 40+ games (Towns, Quickley). Now the whole pool (~1,100 players, ~26 MB, once); the baselines re-fetch once on the next nightly run.                                                                                                                           |
| #113 | **Players → Draft.** Rankings upload in Settings (`draft_rankings`, private); per-player rank vs pick vs season; projection accuracy vs carrying over last season; the hindsight draft (~160 ms of CPU, cached daily).                                                                                                                                                                                                                                                     |

**Verified in production:**

- **Matchup:** Wednesday's board shows Duren at 0 / Out with no projection, and the chart ends at the headline 32%.
- **Moves and Compare:**
  - Compare shows "53 of 61";
  - the Never drop panel is there;
  - the Interested section shows Fears' card and 7 players' packages; Jrue Holiday's best package already had 16,000 seasons at ±0.4.
- **Stat colors:** Free agents and the Advanced tab look right in dark and light.
- **Trends:** Vs last season works, including the 2024-25 fallback (Scoot Henderson).
- **Draft:** the hindsight draft renders.

## Waiting on Jack

- **Done Nov 6:**
  - **Rankings re-uploaded after #115:** all 348 rows match, and every drafted player has a rank.
  - **Protected players set:** Never drop is Tatum, Duren, Avdija, Daniels, Allen, Wilson and Hart; Not for trade is only Duren. Both are verified on Moves and Trades.
- **Vercel's Git auto-deploy** worked for every merge on Nov 6 (deploys within ~1 min).
- **1-minute transaction watch:** deferred until CPU has room. The 5-minute watch stays.

## Daily CPU check (until ~Nov 20)

- **Schedule:** Claude checks Vercel → Usage every morning (session cron, 8:47 local) plus Settings' CPU card.
- **Report:** 2–4 lines; nothing changes without Jack's OK.
- **Expiry:** the job lasts 7 days per session. It re-creates around Nov 11 and stops Nov 21. **A new session before Nov 20 should set it up again.**
- **Nov 6 additions to watch:**
  - **Precision tiers:** more seasons for ~10 top moves, far fewer for ~280 others. Measure job time and per-job Vercel CPU on the first jobs and compare with ~15.5 s per job.
  - **`trade-for` results:** each new set of packages queues a job.
  - **One-time costs:** the season baselines fetch (two ~16 MB pools, once).

## Next tasks

1. **Nov 6 checks:**
   - the first full-day CPU, and jobs under the precision tiers (time, CPU, the ± shown on top moves);
   - overnight gameday "nothing due" skips;
   - #101's per-job worker CPU;
   - the nightly prune;
2. **Draft accuracy:** the card appears once ranked players have 10+ games (the most had 9 on Nov 6). Then record the first numbers in MODEL_CARD.
   - **Also:** check that the nightly run re-fetched the season baselines (`season-baselines` returns `true` once, then `false`), and that Trends' Vs last season now includes Towns and Quickley.
3. **Return-date test** (MODEL_CARD, Nov 6): evaluate once ≥60 absences with ESPN return dates have ended. One evaluation, no peeking before then.
4. **If CPU is above ~4 min a day:** see the options in COMPUTE.md.
5. **After Nov 20:**
   - the trims end on their own;
   - revisit the 1-minute watch;
   - more work moves to the worker.
6. **Still open from earlier:**
   - the partner's simulated odds on trades;
   - the official-statuses forward test (≥1,500 rows);
   - the props and DARKO blend tests;
   - win-probability candidate C (Dec 6) and recalibration (week 13);
   - props coverage for free agents.
7. **Roadmap** (`docs/ROADMAP.md`): own projection models (the Draft tab's accuracy is their baseline), manager profiles, a playoff-schedule planner, NFL and MLB.

## Background (Nov 5, PRs #79–#103)

- **Automatic simulations:** every move checked on the worker; cards keep their last numbers while re-checking.
- **Builds on the worker:** the trade search and job builds run there (ADR-059), so a roster move costs Vercel ~0.9 s.
- **Gameday:** gameday runs skip when nothing is due.
- **Temporary trims:** other teams' moves re-check at most every 90 min until Nov 20; trade ideas refresh at most every 15 min for others' changes.
- **CPU:** Hobby allows 4 h of Active CPU per 30 days; Nov 5 was at 3 h 10 m. See `docs/COMPUTE.md`.

## Renewals

- `GITHUB_DISPATCH_TOKEN` expires **Nov 1, 2027**.
