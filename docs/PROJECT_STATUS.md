# Project status (2026-10-29, evening)

## Where things stand

**Live** at **https://fantasycopilot.vercel.app**, on Vercel Hobby with Neon Postgres. Pages:

- Today
- Matchup (`/nba/week`)
- Waivers
- Players
- League / Trades
- Outlook
- Model (`/nba/model`)
- Settings

Every ESPN write goes through a UI confirm and is audited in `espn_actions`.

**Shipped Oct 29 (PRs #30–#38):**

- **Scheduler endpoint (#30):** `/api/cron/gameday` answers at once and works in `after()`. Settings shows "Background jobs" (with the error text when one fails). **cron-job.org job 8752774** calls it every 5 minutes; verified Oct 29 (200 in 1.9 s, `gameday ok`).
- **Speed (#31):**
  - ESPN reads reused 15–60 s per instance (`lib/fetch-memo.ts`), cleared on writes and detected moves.
  - Trade targets stored in `view_cache` and refreshed in the background (Trades 6.4 s → ~0.5 s).
  - `loading.tsx` skeletons everywhere.
- **Outlook in seconds (#32):**
  - Simulator 5.3× faster, with bit-identical results (golden test).
  - Provisional odds every 250 seasons (`outlook_runs.status`).
  - Production run ~20 s (was ~85 s), first odds at ~4 s.
- **Simulator IR bug (#33):** an IR return could grow a roster past 13. This is why dropping the injured Demin for Gillespie looked like −3.5 title points; it's about neutral (ADR-032).
- **Waivers checked by the simulation (#34):**
  - The top 4 moves are re-run in the Outlook's simulator (800 paired seasons), title odds first, "about even" within noise.
  - Background job in `view_cache`, budgeted for Hobby CPU (ADR-033).
- **Projection: minutes × rate (#35):** passed its pre-registered held-out test (ADR-034).
- **Player card v2 (#36):**
  - Live/Final and Next game tab; Season tab (this season against last).
  - ESPN advanced stats, PBP Stats (stored nightly in `pbp_players`), DARKO; net FG/FT bars.
  - Always current: game-state aware, late box scores merged, polling while live (ADR-035).
- **Opponent defense by position (#37):** passed its pre-registered held-out test and is applied to daily and weekly projections. Teammate-absence minutes failed and aren't shipped (ADR-036).
- **Mobile matchup (#38):**
  - Team logo on the name line.
  - Two full info lines on phones (`@BOS 82-77 Q4 10:37`, `22p 9r 4a 1s`).
  - Edge-to-edge board, no row photo below 640 px. Checked at 375 and 390 px with live games.
  - The nightly matchup snapshot retries once (the Oct 29 4 AM run failed once).

**Data sources** (free first; paid ones on hold, see memory `nba-data-sources`): ESPN (fantasy, site, core APIs), DraftKings props via ESPN, DARKO, PBP Stats. Databallr/nbarapm, Dunks & Threes and The Odds API are pinned until the free stack is complete.

**Compute budget:** Vercel Hobby includes **4 active CPU-hours a month**, and going over pauses functions for up to 30 days. Each background simulation is budgeted against it:

- Outlook run ~20 s;
- waiver checks ~40 s;
- trade refresh ~5 s.

Check Vercel → Usage regularly.

## Waiting on Jack

1. **Push notifications:** rotate the VAPID keys, then enable on the iPhone.
2. **Vercel → Usage:** check Active CPU after a few days with the scheduler on (cron-job.org job 8752774, every 5 minutes, header `Authorization: Bearer <CRON_SECRET>`).

## Next tasks

1. **Watch the first production runs** of:
   - the nightly PBP Stats pull (`refresh_log` "pbp-players");
   - the defense table ("defense");
   - waiver checks ("move-checks");
   - the matchup snapshot retry ("matchup-snapshot").
     The Live tab was checked during the Oct 29 games.
2. **Props blend test:** it runs itself nightly; check `/nba/model` once 7 days and 800 games are in.
3. **Next model candidates** (pre-register first):
   - a minutes-aware prior for players ESPN didn't project (Pelle Larsson-type);
   - DARKO's projection in the blend;
   - the per-stat version of opponent defense.
4. **Rest-of-season value with streaming:** the quick Waivers ranking still values a fixed roster. The simulator check covers the top 4; a cheaper replacement-level adjustment could align the whole list.
5. **Win-probability recalibration** after week 13 (pre-registered, data logging).
6. Replace the fixed league-average team total (115.3) with this season's average.
