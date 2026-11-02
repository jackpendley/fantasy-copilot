# Project status (2026-11-02)

## Where things stand

**Live** at **https://fantasycopilot.vercel.app**, on Vercel Hobby with Neon Postgres. Four tabs:

- **Today**
- **Matchup** (`/nba/week`):
  - any week (`?week=`) and any team (`?team=`);
  - every league matchup with its win chance;
  - both teams' schedules.
- **Players** (`/nba/players`):
  - Moves (was Waivers);
  - Free agents;
  - Trends (was Players);
  - search as you type.
- **League** (`/nba/league`): your odds, what changed, the odds chart (was Outlook), standings with strength and odds, Trades.

Settings and Model accuracy are reached from the header. Every ESPN write goes through a UI confirm and is audited in `espn_actions`.

**Shipped Nov 2 (PRs #51–#61):**

- **Jobs and push (#51):**
  - Nightly steps log their own results (the Oct 29 matchup-snapshot "fetch failed" was a one-off).
  - Errors keep their cause; the snapshot retries.
  - Settings dates are in Arizona time.
  - Push survives a bad device, and an alert is only marked sent once delivered.
  - DARKO is checked hourly.
  - Jack rotated the VAPID keys; push works on his iPhone.
- **Matchup (#52):**
  - Past weeks show finals; later weeks are projected.
  - A league scoreboard of all matchups with win chances; `matchup_states` drives other matchups' charts.
  - Schedule tabs for both teams.
  - The boards are unchanged.
- **Waivers, now Moves (#53, ADR-046):**
  - Exact numbers: Outlook now → with move → change ± margin, plus this week's matchup.
  - Any drop can be chosen and simulated on request.
  - Clearer labels; the "Later" points fix.
  - Free agents sort by any column, with G/F filters.
- **Players search (#54):** the whole player list (~1,100) is searched in the browser as you type, with a ranked matcher. Hot & Cold has a free-agents toggle.
- **Simulation precision (#55, ADR-047):**
  - Playoff replays: title odds are ~2.4× as precise per CPU second.
  - Waiver checks run in 400-season batches; close calls get a second batch within a 2-minute daily budget. Title change is ±1.3–1.4 (was ±3.2).
  - Trades use replays too.
  - Simulation CPU is logged and shown on Settings.
- **Four tabs (#56, ADR-048):** Players and League merges, with redirects from old links.
- **Fixes:**
  - IR-return cuts follow one rule everywhere (#57, ADR-049).
  - No cut-off text on the remaining pages (#58).
  - This season's league team total in the game-environment factor (#59, ADR-050: 115.42 vs 115.3, effect under 0.1% today).
  - Six simulated moves per refresh; the quick ranking keeps no streaming credit (#61, ADR-051: it doesn't track the simulation among close calls).
- **Tests (#60, MODEL_CARD):**
  - **Day-to-day players on later days passed and shipped.** They play ~59% tomorrow and ~70–75% after (the old rule was 75%, then 100%).
  - **Manager activity from lineups:** neither candidate passed; `act` is unchanged.

**Data sources** (free first; paid ones on hold, see memory `nba-data-sources`):

- ESPN (fantasy, site, core APIs);
- DraftKings props via ESPN;
- DARKO;
- PBP Stats;
- the NBA official injury report (`ak-static.cms.nba.com`).

**Read the injury report politely:** at most one request per 5 minutes live; backfills space requests 2 s apart.

**Compute budget:**

- Vercel Hobby includes 4 active CPU-hours a month.
- Settings → Simulation CPU shows the last 30 days of Outlook, move-check and trade simulations.
- Vercel → Usage has the full total, pages included.
- Move checks: about 8 s per batch on Vercel; second batches stop once a day's move checks pass 2 minutes.

## Waiting on Jack

1. **Vercel → Usage:** check Active CPU after a few days with the 5-minute job and the new simulation settings. Compare with Settings → Simulation CPU.
2. **Optional:** set `VAPID_SUBJECT` to `mailto:` plus his email (push already works).

## Next tasks

1. **Watch the first production runs:**
   - Settings should show matchup-snapshot "ok" after the Nov 3 nightly run.
   - "darko" rows when DARKO publishes.
   - move-sim CPU in Settings.
2. **Official statuses forward test** (pre-registered): run once when there are ≥1,500 non-Out rows (~3–4 weeks of logging).
3. **Props blend and DARKO blend tests** run nightly; check `/nba/model`.
4. **Win probability, candidate C:** after week 7's finals (Dec 6), run the forward test once on weeks 3–7 (Pre-registration 3).
5. **Win-probability recalibration** after week 13 (Pre-registration 2).
6. **Outlook precision:** once the monthly CPU is known, consider playoff replays for the Outlook too (title ±0.4 instead of ±0.8 at ~1.6× its CPU).
7. **Manager activity:** a forward retest of the lineup-based share on this season's lineups, if pre-registered (2025-26 alone was inconclusive with 12 teams).
8. **Free agents' Vegas props on Moves:** today's games for free agents use our model only (Today and Matchup use the blend).
9. **Roadmap** (`docs/ROADMAP.md`):
   - own projection models (minutes, play chance, rate);
   - opponent manager profiles and scouting;
   - a playoff-schedule planner;
   - NFL and MLB later.
