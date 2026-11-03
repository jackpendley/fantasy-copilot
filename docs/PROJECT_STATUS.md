# Project status (2026-11-02, end of round 2)

## Where things stand

**Live** at **https://fantasycopilot.vercel.app**, on Vercel Hobby with Neon Postgres. Four tabs:

- **Today**
- **Matchup** (`/nba/week`):
  - any week or team;
  - a Mon–Sun win chart with points every 15 minutes during games;
  - a league strip with Jack's matchup first and finals in green/red;
  - on-court/bench dots during live games.
- **Players:**
  - **Moves**, with deep simulation checks once the worker is on;
  - **Free agents**, with FP/G percentile badges;
  - **Trends**;
  - search.
- **League:**
  - odds and a "What a bye is worth" line;
  - sortable standings with Bye and #1 columns;
  - Most impactful moves;
  - Trades.
  - Each team page has odds over time, roster moves with their impact, and injury games missed.

The player card has a fixed size and closes on navigation. It shows advanced stats with league percentiles (green ≥80th, red ≤20th) and colored game results. The player page has the same data plus every game, for this season or last.

**Shipped Nov 2, round 1 (#51–#62):** jobs and push fixes, the Matchup rework, the Moves numbers, search, simulation replays, four tabs, IR rule, day-to-day test (see git log / ADR-046–051).

**Shipped Nov 2, round 2 (#63–#70):**

- **#63, CPU diet (ADR-052):**
  - Outlook reruns are coalesced to one per 30 minutes.
  - Page visits never start simulations.
  - Parsed league and free agents are memoized.
  - One win chance everywhere: Matchup and Moves both use the props blend for today (the 63% vs 61% fix).
- **#64, simulation worker (ADR-053):** GitHub Actions (8 runners) plays move checks and the Outlook in 200-season chunks. Each move runs until ±0.5 title points (2 SE), between 4,000 and 20,000 seasons, and the base run gets 8,000+. Shown per move: P(helps) and P(best). Results update progressively. **Off until Jack adds the secrets (below)**; until then Vercel keeps the old quick checks.
- **#65:** Players tabs share a layout. Switches are ~10–20 ms warm.
- **#66:** `matchup_timeline` (every 15 min in game windows), the Mon–Sun chart, strip order and colors, on-court dots (from the ESPN summary).
- **#67:** Vercel builds only `main`: no preview deployments, which were filling Functions Storage (7.1 of 10 GB).
- **#68, card and page (ADR-054):** `pbp_players.stats`, 17 metrics with percentiles among regulars, rostered-player FP/G percentiles, `fpTone` colors everywhere, `FpChart` with average and projection lines, the last-season toggle.
- **#69, byes (ADR-055):** the simulator counts byes and titles won with one (golden test extended). On Nov 3, a bye meant a 27% title chance vs 12% as a 3–6 seed.
- **#70, move history (ADR-056):** `league_transactions`; per move, the odds change at the time (≈ when not clean), points since and value now; injuries as games missed × projection.

**Vercel usage on Nov 2:**

- Active CPU 2 h 29 m of 4 h.
- Functions Storage 7.12 of 10 GB (this is what the warning email was about).
- After #63, CPU grew ~2 min in 5 h, and #67 stops the storage growth.
- Recommendation given: stay on Hobby. Pro ($20) only if usage stays near the limits.

## Waiting on Jack

1. **Worker secrets** (needed for deep move checks; nothing set as of Nov 2 evening):
   1. Run `! S=$(openssl rand -hex 32) && printf '%s' "$S" | gh secret set WORKER_SECRET --repo jackpendley/fantasy-copilot && printf '%s' "$S" | pbcopy && echo "saved + copied"`.
   2. Paste the same value into Vercel as `WORKER_SECRET` (Sensitive, Production).
   3. Create a fine-grained GitHub token (this repo only, Actions: read and write) and add it to Vercel as `GITHUB_DISPATCH_TOKEN`.
   4. Redeploy.
2. **`VAPID_SUBJECT`** = `mailto:` plus his email in Vercel. The dashboard asked for 2FA, so Jack does this.
3. **Optional:** a Vercel deployment retention policy (an account setting) to delete old deployments' functions and free storage. Needs his OK.

## Next tasks

1. **After the secrets:** verify a production worker run. A roster move should show first deep results within ~2 min and final results within ~5. Then compare Vercel Active CPU before and after.
2. **Production checks:**
   - `pbp_players.stats` fills on the first card open after deploy, or nightly. Percentiles appear then.
   - Team pages show "At the time" values from the season's Outlook runs.
   - The first bye numbers appear after the next Outlook run.
3. **Official statuses forward test** (pre-registered): once ≥1,500 non-Out rows (~3–4 weeks).
4. **Props and DARKO blend tests** run nightly; check `/nba/model`.
5. **Win probability:** candidate C after week 7's finals (Dec 6, Pre-registration 3); recalibration after week 13 (Pre-registration 2).
6. **Free agents' Vegas props on Moves:** free agents are now in the blend (#63). Check the props coverage for them.
7. **Roadmap** (`docs/ROADMAP.md`):
   - own projection models;
   - opponent manager profiles;
   - a playoff-schedule planner;
   - NFL and MLB.
