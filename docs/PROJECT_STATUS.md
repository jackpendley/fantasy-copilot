# Project status (2026-10-20, night)

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

- **League & trades, the League tab:**
  - `/nba/league`: standings, pts/wk strength, power rank, playoff and title odds.
  - `/nba/league/[id]`: team rosters.
  - `/nba/league/trades`:
    - trade analyzer (starting-point changes for both sides, raw gap, a "Simulate" button for playoff and title odds);
    - 1-for-1 trade targets across the league (ADR-017).
  - Settings moved to the header gear on phones.

- **League & trades (PR #12)** shipped.
- **Live stat lines (PR #13):**
  - Today and Matchup rows show ESPN box scores, live and final points, and the fixed pregame projection plus the updated projection with ▲/▼ (ADR-018).
  - Fixed `playerIdsFilter`: ESPN rejects a limit without a sort.

- **Trades v2 (PR #14):**
  - market-value acceptance (ESPN plus league draft), up to 3-for-3 with roster balancing, size filter, realism tiers (ADR-019);
  - Collins-for-Brown-style ideas are gone.

- **Steadier Outlook (PR #15):** common random numbers, 2,000 seasons, and a "What changed" panel with the roster moves behind odds changes (ADR-020).

- **Model backtest (PR #16):** walk-forward backtest and `docs/MODEL_CARD.md`. The minutes trend passed a held-out season and ships.

- **Roster moves everywhere + real-time Outlook (branch `roster-ahead-realtime-outlook`):**
  - Moves made after the first tip (ESPN applies them tomorrow) now count in Matchup, Waivers, League, Trades, Outlook and Players (ADR-021).
  - "Takes effect tomorrow" banner on Today and Matchup.
  - Waivers offers the IL slot instead of a drop.
  - Outlook re-runs after app adds, on page visit, and from the roster watch (ADR-022).
  - `pnpm --filter @fantasy-copilot/web smoke` loads every page (read-only).

- **Vegas + DARKO collection (branch `market-data`):**
  - props, game lines and DARKO snapshots are stored for the model (ADR-023);
  - a "Vegas" projection shows on Today and player pages;
  - new daily `pregame` cron.

- **Matchup redesign (branch `matchup-redesign`):**
  - head-to-head by lineup slot, ESPN style, for any day of the week (past finals, live today, projected days ahead);
  - scoreboard with current points big and projected finals;
  - one-line box scores (tap for the full line) and solid ▲/▼ on Today and Matchup.

- **Trades every size (branch `trades-every-size`):** 2-for-1, 3-for-2 and the other shapes now surface, with exact cuts, IL for injured arrivals, and free-agent fills (ADR-024).

- **Model: game environment + props tracking (branch `game-environment`):**
  - Vegas game totals now scale projections (passed the held-out test, ADR-025);
  - pregame projections (ours and Vegas) and box scores are stored for the props test.

## Plan in progress (approved 2026-10-20, second plan)

`~/.claude/plans/i-m-playing-fantasy-basketball-rippling-fox.md`:

1. Roster moves count everywhere; Outlook re-runs on moves (this branch).
2. Start collecting Vegas lines (ESPN core API: DraftKings props and game lines) and DARKO daily snapshots, and show the Vegas projection.
3. Today & Matchup redesign: one-line stats with the full box on tap, solid ▲/▼, head-to-head by slot.
4. Trades: every size (the quick estimate ignored the free-agent fill, so 2-for-1/3-for-1/3-for-2 never surfaced), with drop, IL and adds-left edge cases.
5. Train the model on market data (game environment backtest now; props stacking after 7 game days).

## Deferred (Jack's call)

- **A 5-minute scheduler for `/api/cron/gameday`** (cron-job.org, or a GitHub Actions schedule with `CRON_SECRET` as a repo secret). It powers push alerts and the outlook's roster watch. Until then, Outlook updates after app adds and when the page is opened.
- **Push notifications:** enable on the iPhone once the scheduler runs. Rotate the VAPID keys first; `VAPID_SUBJECT` in Vercel still has the old URL (it's only a contact address).

## Next tasks

1. After the `market-data` merge: check that the 22:00Z pregame cron and the nightly job store props, and that rows show "Vegas".
2. **Around Oct 29 (7 game days of props):** run the pre-registered props test (`/api/model/props`). If the blend passes, wire it into daily projections.
3. Replace the fixed league-average team total (115.3) with this season's collected average.
4. Open: Jack's first in-app add/claim (the write path is still untested live); the 5-minute scheduler.
