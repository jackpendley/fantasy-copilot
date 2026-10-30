# Project status (2026-10-30)

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

**Shipped Oct 29–30 (PRs #30–#44):**

- **Scheduler (#30):** cron-job.org job 8752774 calls `/api/cron/gameday` every 5 minutes. Settings shows "Background jobs".
- **Speed (#31, #32):** ESPN reads memoized; trade targets precomputed; skeletons. Outlook runs take ~20 s, with the first odds in ~4 s.
- **Simulator IR fix (#33), waivers checked by the simulation (#34).**
- **Projection:** minutes × rate (#35); opponent defense by position (#37); unprojected players' minutes × rate (#40).
- **Player card v2 (#36).**
- **Player rows (#38, #39, #41–#43):**
  - Today and Matchup rows have three lines: logo, name and positions; the day's game, with the opponent's logo; his stats. Finished games read "Final 121-113" (no W/L).
  - Matchup sides mirror a Today row: points over projection by the slot column.
  - Phones in portrait have no headshots on Matchup (a side is ~150 px, no room beside a name and the score); landscape and desktop do.
  - Long game and stat lines wrap instead of being cut; both sides are top-aligned.
  - Checked at 320–1280 px: no horizontal scroll. The top nav moves to the bottom tab bar below 1024 px.
- **Availability (#44, ADR-038):**
  - Fitted play chances from three seasons of the NBA's official injury reports failed the held-out gate. They beat today's app (ESPN day-to-day = 0.75) but not fixed per-status chances.
  - The official statuses with the existing priors are now **tested forward**. The 5-minute job logs each new official report (table `official_status`) and ESPN's whole injury feed, from 9 AM ET on game days.

**Data sources** (free first; paid ones on hold, see memory `nba-data-sources`):

- ESPN (fantasy, site, core APIs);
- DraftKings props via ESPN;
- DARKO;
- PBP Stats;
- the NBA official injury report (`ak-static.cms.nba.com`).

**Read the injury report politely.** A burst of ~16,000 guessed file names got this machine refused for about an hour on Oct 29. The live job makes at most one request per 5 minutes. The backfill harness spaces requests 2 s apart and never caches a miss.

**Compute budget:** Vercel Hobby includes 4 active CPU-hours a month. Outlook runs take ~20 s, waiver checks ~40 s, trade refreshes ~5 s, and parsing a report ~0.2 s. Check Vercel → Usage.

## Waiting on Jack

1. **Push notifications:** rotate the VAPID keys, then enable on the iPhone.
2. **Vercel → Usage:** check Active CPU after a few days with the scheduler on.

## Next tasks

1. **Watch the first production runs of the new logging.** Look at `refresh_log` "gameday" (the `availability` field, and "official-report" errors). `official_status` should fill from 9 AM ET on game days.
2. **Official statuses forward test:**
   - write its evaluation (rows, snapshots and gate are pre-registered in MODEL_CARD);
   - run it **once**, when there are ≥1,500 non-Out rows (roughly 3–4 weeks);
   - if it passes, the day board and week projections use official statuses for listed players.
3. **Props blend test** and **DARKO blend test:** they run nightly. Check `/nba/model` once 7 game days and 800 games are in.
4. **Rest-of-season value with streaming** for the quick Waivers ranking.
5. **Win-probability recalibration** after week 13 (pre-registered).
6. Replace the fixed league-average team total (115.3) with this season's average.
7. **Days-ahead availability** (week projections still hold today's status for two days): a separate candidate.
