# Project status (2026-11-09)

## Where things stand

**Live** at **https://fantasycopilot.vercel.app** (Vercel Hobby, Neon Postgres).

- **Tabs:** Today, Matchup, Players (Moves, Free agents, Trends, Draft), League (Trades, team pages).
- **Simulations:** moves and trades run on the GitHub Actions worker (ADR-058/059).

**CPU: minimal mode until Nov 21** (docs/COMPUTE.md §9).

- **Nov 9:** Vercel was at 3 h 51 m of 4 h, with ~8 min leaving the 30-day window before Nov 21. Jack chose minimal mode over paying for Pro.
- **Tripwire:** a morning check at **≥ 3 h 56 m** means Jack pays for one month of Pro that day.
- **What minimal mode does:**
  - background work every 30 min (cron-job.org changed too, Nov 9);
  - other teams' moves and injury news wait for the nightly job;
  - open pages refresh every 5 min.
- **The saver** runs until Nov 29.
- **MarketScope** keeps running (its site uses ~0.5–0.85 min a day).
- **No production page checks during the saver.** Jack sees the changes on his phone.

Nov 9 (PRs #118–#123, #125) carried out Jack's six requests (plan: `~/.claude/plans/i-m-playing-fantasy-basketball-rippling-fox.md`).

| PR   | What                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #118 | **Minimal mode** (`minimalOn`, until Nov 21) and the saver extended to Nov 29. Streams get the rest tier until Nov 29. Trade packages no longer run with every job.                                                                                                                                                                                                 |
| #119 | **Trade packages on request.** "Find trade packages" on watched players on other teams. **Asked trades** (`lib/nba/asked-trades.ts`): every job checks them until each has a result settled after the ask. **Moves order:** Best moves, Best streams this week, Interested free agents, then watched players elsewhere. The watch-list key counts only free agents. |
| #120 | **Trades:** "Best trades with {team}" (league-wide ideas at once; "Find more" runs the search for that team on the worker, task `trade-with`). "Simulate season odds" on your own trade runs on the worker as an asked trade. The Vercel `simulateTrade` is gone.                                                                                                   |
| #121 | **Mobile:** an opaque status bar (`statusBarStyle: "default"`, theme-color follows the toggle). This fixes the tab bar sitting ~62 pt high while pages load, and the blur behind the clock. **"Expected return: Nov 24"** labels.                                                                                                                                   |
| #122 | **Matchup scoreboard:** each team's record and place. Tap the card for starts and points per start, so far and projected, and the projected finals.                                                                                                                                                                                                                 |
| #123 | **Charts:** the win chance spreads each day by its games (`lib/chart-axes.ts`). Odds over time on a daily date axis.                                                                                                                                                                                                                                                |

**Deviation from the plan:** asked trades queue a normal job, not a "small" one. A new job always supersedes the live one, so a small job would cancel the job behind the Moves numbers. Each ask costs ~5 s of Vercel CPU.

## Waiting on Jack

- **Check on the phone:**
  - **Tab bar and blur (#125):** both persisted after #121 because iOS keeps a Home Screen app's status-bar style from when it was added (WebKit bug 260508). Jack must **delete the icon and add it again** from Safari (sign in once, re-enable alerts in Settings). The app shows a callout while the old install is in use (`components/home-screen-check.tsx`). After re-adding, check Players and Matchup.
  - **Status bar colors:** if it's white in dark mode, switch `statusBarStyle` to `"black"`.
  - **Features:** the scoreboard details, both charts, Moves, Trades, and the Expected-return labels.
- **Tripwire:** pay for one Pro month (Vercel → Settings → Billing) only if a morning check reads ≥ 3 h 56 m.
- **Worker → Neon directly** (after Nov 21, approved Nov 9): Jack adds `DATABASE_URL` as a GitHub Actions secret when the PR is ready.

## Daily CPU check (until ~Nov 20)

- **Schedule:** session cron at 8:47 local. It reads Vercel → Usage (and each project's share) plus Settings' CPU card.
- **Report:** 2–4 lines; nothing changes without Jack's OK.
- **Renew it around Nov 11.** At the renewal, also set a one-time reminder for **Nov 21: set cron-job.org's gameday job back to every 5 minutes** (Jack approved the change both ways). Delete the daily job Nov 21. **A new session before Nov 20 should set it up again.**

## Next tasks

1. **Watch minimal mode:** tomorrow's total, the per-project bars, and Settings (gameday runs ~48 a day; simulation jobs only after own moves, asks and nightly).
2. **Nov 21:**
   - cron-job.org back to every 5 min;
   - minimal mode ends on its own;
   - then PR 7: the worker reads and writes Neon directly (ADR; `/api/worker/*` moves into the worker; ~1.5–3 min a day less).
3. **Nov 29:**
   - the saver ends;
   - check the steady state is ≤ ~7 min a day for all projects (Hobby averages 8).
4. **Draft accuracy:** the card appears once ranked players have 10+ games; record the first numbers in MODEL_CARD.
5. **Return-date test** (MODEL_CARD, Nov 6): evaluate once ≥ 60 absences with ESPN return dates have ended.
6. **Still open:**
   - the partner's simulated odds on trades (the worker's result has only Jack's side);
   - the official-statuses forward test (≥ 1,500 rows);
   - the props and DARKO blend tests;
   - win-probability candidate C (Dec 6) and recalibration (week 13);
   - props coverage for free agents;
   - the 1-minute watch once CPU has room.
7. **Roadmap** (`docs/ROADMAP.md`): own projection models, manager profiles, a playoff-schedule planner, NFL and MLB (NBA + NFL together likely need Pro or Cloud Run's free tier; decide next summer).

## Background

- **Nov 6** (#106–#116): correctness fixes, UI polish, pull to refresh, protected players and precision tiers (ADR-060), the Interested list, the percentile scale (ADR-061), Trends vs last season, Players → Draft, the season pool fix.
- **Nov 5** (#79–#103): automatic simulations, builds on the worker, gameday skips.

## Renewals

- `GITHUB_DISPATCH_TOKEN` expires **Nov 1, 2027**.
