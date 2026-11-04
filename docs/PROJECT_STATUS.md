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
- **#64, simulation worker (ADR-053):** GitHub Actions (8 runners) plays move checks and the Outlook in 200-season chunks. Each move runs until ±0.5 title points (2 SE), between 4,000 and 20,000 seasons, and the base run gets 8,000+. Shown per move: P(helps) and P(best). Results update progressively. **Live since Nov 3.**
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

Nothing right now.

**Done Nov 3:**

- Deployment retention set to 1 day for every type, with Jack's OK. Vercel always keeps the live deployment and the last 3 production deployments, and deleted ones can be restored for the retention period. This frees the Functions Storage that was at 7.1 of 10 GB.

- `WORKER_SECRET` set in GitHub and Vercel (on the second try: the first values didn't match, and the runners got 401).
- `GITHUB_DISPATCH_TOKEN` set: fine-grained, this repo only, Actions read and write, expires **Nov 1, 2027** (checked on GitHub). **Renew it before then.**
- `VAPID_SUBJECT` was already set.
- **Production test:**
  - Simulate this drop started a GitHub run in 22 s.
  - A run of 8 runners finished in ~3 min.
  - Moves showed "Deep check done: 15 moves, up to 12,000 seasons each" (top: +Lively −Collins, +0.8 ±0.3 title points, >99% helps, 43% best).
  - #72 fixed asking again for a move already queued, which didn't start a runner.
- **#75 (Nov 3):**
  - **Problem:** "Simulate this drop" kept showing its 400-season quick check until the page was reloaded. Jack saw "positive" at 400 seasons, then "neutral" at 11,200 after reopening.
  - **Fix:** the card now refreshes every 15 s and swaps in the deep check when it lands (giving up after 10 min). Until then it says the quick check is rough and to wait.
  - **Compare** button on each move: the add and the drop side by side, covering projections, rest of season, this season, box score, fantasy points by stat and advanced stats with percentiles. The better value is shown in green.

## Next tasks

1. **Worker:** time a real roster move to first and final deep results (the target is about 2 and 5 min). Compare Vercel Active CPU before and after (Nov 2: 2 h 29 m of 4 h).
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
