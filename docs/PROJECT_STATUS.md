# Project status (2026-10-19, evening)

## Where things stand

- **Live** at **https://fantasycopilot.vercel.app**. The Vercel project is `fantasy-copilot`; the old `fantasy-copilot-nba.vercel.app` redirects there with a 308.
- **Shipped:**
  - Today (one-click apply) and Week;
  - Outlook: nightly playoff, #1-seed and title odds (Phase 3);
  - Settings;
  - game-day alerts, `status_events`, PWA push plumbing (Phase 2b).
- **UI overhaul (PR #8):** dark/light/system theme, court-orange brand, app shell with a phone tab bar, headshots and logos, redesigned pages.
- **Waivers & streaming (PR #9), `/nba/waivers`:**
  - best moves this week, ranked by ΔP(win);
  - best long-term adds;
  - free-agent table;
  - claim/add with a named-drop confirm.
  - **The add/drop and claim write path is untested live.** Jack's first claim is the test, and it's audited.
- **Players & trends (PR #10):**
  - `/nba/players`: search, hot & cold, minutes opening up, free agents being added, your roster.
  - `/nba/players/[id]`: FP/G vs projection, last 5, minutes, an FP-per-game chart with a 5-game average, and the game log in league scoring.
  - No usage rate yet (ADR-015).
- **Vercel:** `VAPID_PRIVATE_KEY` is saved as a Secret. Its value was visible in a session, so rotate the VAPID pair before turning push on.

- **Live matchup (PR #11), the Matchup tab (`/nba/week`):**
  - live totals from ESPN, plus in-game remainders in the projection;
  - "Today": both lineups with live fantasy points and what's still to come;
  - both teams' starts by day;
  - a win-chance chart from nightly snapshots (`matchup_snapshots`, migration 0003).
  - Auto-refreshes every minute during games.
  - **First real test is the opener (Oct 20):** check that live points match ESPN's app.

- **League & trades (branch `league-trades`), the League tab:**
  - `/nba/league`: standings, pts/wk strength, power rank, playoff and title odds.
  - `/nba/league/[id]`: team rosters.
  - `/nba/league/trades`:
    - trade analyzer (starting-point changes for both sides, raw gap, a "Simulate" button for playoff and title odds);
    - 1-for-1 trade targets across the league (ADR-017).
  - Settings moved to the header gear on phones.

## Deferred (Jack's call)

- **Push notifications:** cron-job.org for `/api/cron/gameday`, then enable on the iPhone. Rotate the VAPID keys first; `VAPID_SUBJECT` in Vercel still has the old URL (it's only a contact address).

## Next tasks (Jack's order)

All four features Jack picked are built. Candidates next, in rough value order:

1. **Check the opener (Oct 20):** live matchup points vs the ESPN app; Jack's first waiver claim (the untested write path).
2. **Push notifications** (deferred by Jack): rotate VAPID, cron-job.org, enable on the iPhone.
3. **Data warehouse and ML** (`apps/nba-ml`): our own projections to beat ESPN's, usage and minutes trends.
4. **Trades v2:** 2-for-1 targets, manager tendencies.
5. **NFL**, then **MLB** sections.
