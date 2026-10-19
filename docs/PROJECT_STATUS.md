# Project status (2026-10-19, evening)

## Where things stand

- **Live** at **https://fantasycopilot.vercel.app**. The Vercel project is `fantasy-copilot`; the old `fantasy-copilot-nba.vercel.app` redirects there with a 308.
- **Shipped:**
  - Today (one-click apply) and Week;
  - Outlook: nightly playoff, #1-seed and title odds (Phase 3);
  - Settings;
  - game-day alerts, `status_events`, PWA push plumbing (Phase 2b).
- **UI overhaul (branch `ui-overhaul`):**
  - fixed the font bug (pages were rendering in Times);
  - dark default with a light/system toggle;
  - court-orange brand; status and chart tokens (chart palette validated in both modes);
  - app shell: desktop top bar, phone bottom tab bar, safe areas;
  - ESPN headshots and team logos; StatTiles and ProbBars;
  - redesigned Today, Week, Outlook, Settings and Login.
- **Vercel:** `VAPID_PRIVATE_KEY` is saved as a Secret. Its value was visible in a session, so rotate the VAPID pair before turning push on.

## Deferred (Jack's call)

- **Push notifications:** cron-job.org for `/api/cron/gameday`, then enable on the iPhone. Rotate the VAPID keys first; `VAPID_SUBJECT` in Vercel still has the old URL (it's only a contact address).

## Next tasks (Jack's order)

1. **Waivers and streaming** (`/nba/waivers`): free-agent pool, net added starts, ΔP(win this week), one-click add/drop with an approved write test.
2. **Players and trends:** player pages, game logs, rolling fantasy points, minutes and usage, risers and fallers.
3. **Live matchup:** live scores, games left per day, odds updating through the week.
4. **League and trades:** standings, power rankings, rosters, trade analyzer and target finder.
