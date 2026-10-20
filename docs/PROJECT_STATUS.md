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
- **Players & trends (branch `players-trends`):**
  - `/nba/players`: search, hot & cold, minutes opening up, free agents being added, your roster.
  - `/nba/players/[id]`: FP/G vs projection, last 5, minutes, an FP-per-game chart with a 5-game average, and the game log in league scoring.
  - No usage rate yet (ADR-015).
- **Vercel:** `VAPID_PRIVATE_KEY` is saved as a Secret. Its value was visible in a session, so rotate the VAPID pair before turning push on.

## Deferred (Jack's call)

- **Push notifications:** cron-job.org for `/api/cron/gameday`, then enable on the iPhone. Rotate the VAPID keys first; `VAPID_SUBJECT` in Vercel still has the old URL (it's only a contact address).

## Next tasks (Jack's order)

1. **Live matchup:** live scores, games left per day, odds updating through the week.
2. **League and trades:** standings, power rankings, rosters, trade analyzer and target finder.
