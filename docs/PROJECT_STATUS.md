# Project status (2026-11-17, afternoon)

## Where things stand

**Live** at **https://fantasycopilot.vercel.app** (Vercel Pro since Nov 10; **Neon on Launch since Nov 16**).

**Neon:**

- **The goal:** fit back under Free. The budget is **2 GB and 60 CU-hours a month** (docs/COMPUTE.md §10).
- **The period** started at the upgrade on Nov 16 at 3:55 PM and **ends Nov 30 at 5 PM MST**. In its last 36 hours a push says whether a month at this rate fits Free: that's the reminder for Jack's Dec 1 decision (#174).
- **Settings → "Database this month"** shows Neon's numbers. On Nov 17 at 1 PM: 0.03 GB, 2.7 CU-hours, awake 11 h.
- **Awake-time check:** Nov 17 at 4:13 PM, which judges the first full day. If the pace is over budget, the 15-minute matchup timeline is the first thing to batch.

**Product:**

- **Tabs:** Today, Matchup, Players (Moves, Free agents, Trends, Draft), League (Trades, team pages).
- **Simulations** run on the GitHub Actions worker (ADR-058/059).
- **CPU:** Vercel Pro has no CPU cap. Usage comes out of the $20 credit plus a $10 on-demand budget (docs/COMPUTE.md §9).

**Nov 16 (#155–#176):**

- racing deep checks (ADR-063);
- Neon transfer and awake-time cuts, and the usage card and alerts (#169, #170, #174);
- teammate-return tests 1–3, all failed;
- streaming attempts 2–3, failed on cost.

Details are in git history and MODEL_CARD.

**Nov 17 (#181–#192).** Jack's asks:

- confirm with data, and build into the model, that a borderline starter loses production when the star at his position returns;
- check the position data in both directions (PF/C);
- make triggered updates fast without losing accuracy;
- ship position-aware streaming.

Plan: `~/.claude/plans/i-m-playing-fantasy-basketball-rippling-fox.md`.

| PR         | What                                                                                                                                                                                                                                                                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #181–#183  | **Teammate returns shipped** (ADR-064). The exploration confirms the drop: fill-ins keep about half their surge, and today's projection already expects most of it, except for centers. Test 4 (shares by position) passed. A fill-in's projection changes from the regular's estimated return date, in the simulator, trades, the week projection and the card. |
| #184       | Effects compute on the gameday run when missing or older than 26 h, so the first run after a deploy doesn't wait for the nightly (live Nov 17 at 1:10 PM, 21 players). **The forward check after Apr 20 feeds the between-seasons refit, not a removal.** Jack: no mid- or post-season pulls on a schedule.                                                      |
| #185       | **Position-aware streaming shipped** (ADR-065). Jack overrode the +25% time budget: checks 1–4 passed, +38% CPU. Includes a fix: a change day also clears the cached lineups (without it, 119 of 38,955 week lineups were stale).                                                                                                                                |
| #186       | Migration 0030: `sim_jobs.started_at`, `outlook_at` and `done_at`. Settings shows the median minutes from a trigger to the runners, the Outlook and all checks, by trigger kind.                                                                                                                                                                                 |
| #188       | **Measured:** runner setup is ~5 s, so it isn't worth caching. Waiting runners and the task runner now ask every 5 s (were 20 s and 30 s), and builds are claimed before trade searches.                                                                                                                                                                         |
| #189, #191 | **The PF/C question.** In the exploration, when a center returns, a PF/C fill-in loses like a backup center; a forward who isn't C-eligible doesn't. **Test 5** (centers by C-eligibility, judged on 2024-25 and 2025-26) **did not pass**. Test 4's model was no better than today's projection on those seasons.                                               |
| #192       | **Shares refitted on all nine seasons** (Jack approved): G 0.22, F 0.06, **C 0.34** (was 0.49). Stored effects take the current shares.                                                                                                                                                                                                                          |

**The other session (Jack's), same day:**

- #180: fetch timeouts (open);
- #187: queue tests on real Postgres in CI;
- #190 (ADR-066): quiet jobs close, runners retry, chunks are counted once (migration 0031).

## Follow-ups Jack asked for (Nov 17)

1. **Confirm a simulation job has run with position-aware streaming live.** It deployed ~1:10 PM Nov 17; no job had run by 1:30 PM.
   - Check the worker logs (`gh run list` / `gh run view` on `simulate.yml`).
   - Check Settings: the job finished, and the new timing lines appear.
   - Check League: the Outlook updated.
   - Report to Jack. Session reminder: Nov 17, 7:47 PM.
2. **Tiered jobs (plan 4c),** once #186's timings give a baseline of a day or two.
   - Report the baseline to Jack first.
   - Build on the other session's ADR-066 changes in `lib/nba/sim-jobs.ts`.
   - Order: the replay-harness accuracy guard first, with its criterion set before the run, then the tiers.
   - Session reminder: Nov 19, 9:43 AM.

## Waiting on Jack

- **Neon, Dec 1 decision:** the Nov 30 push says whether a month at this rate fits Free. Then stay on Launch (about $6 a month at the budget) or switch back in Vercel.
- **Check on the phone:**
  - **Player cards:** a fill-in shows "X/g now · Y/g once … is back (date)".
  - **Moves:** cards keep their numbers through a lineup change.
- **Earlier, still to check:** the popup's live box score during a game, the on-court edge, and the lock job's wait-for-the-tip moves (#143, #146).
- **Worker → Neon directly** (approved Nov 9): Jack adds `DATABASE_URL` as a GitHub Actions secret when the PR is ready.

## Next tasks

1. The two follow-ups above.
2. **Watch the database daily for a week** against the budget: ≤ ~67 MB and ≤ 2 CU-hours a day.
3. **PR 7:** the worker reads and writes Neon directly (ADR; `/api/worker/*` moves into the worker).
4. **Draft accuracy:** once ranked players have 10+ games, record the first numbers in MODEL_CARD.
5. **Return-date test** (MODEL_CARD, Nov 6): once ≥ 60 absences with ESPN return dates have ended.
6. **After Apr 20, 2027** (both feed the between-seasons refit, not a removal):
   - teammate returns test 3 part 2: `fetch-history.ts 2026 2027`, then `FORWARD=1 DRY=1`, then one `FORWARD=1` run;
   - test 4's forward check.
7. **Still open:**
   - the partner's simulated odds on trades;
   - the official-statuses forward test;
   - the props and DARKO blend tests;
   - win-probability candidate C (Dec 6) and recalibration (week 13);
   - props coverage for free agents.
8. **Roadmap** (`docs/ROADMAP.md`): own projection models, manager profiles, a playoff-schedule planner, NFL and MLB.

## Background

- **Nov 17:** models change deliberately, from history and new data between seasons. They aren't pulled on a schedule (Jack).
- **Nov 16:** the ± on Moves is simulation noise only. The model's own error is larger, and more seasons don't remove it (ADR-063).
- **Nov 10:** the Moves card's weekly win chance assumes both teams set their best lineup daily (Jack's preference).
- **Scheduling** stays on cron-job.org (decided Nov 10).

## Renewals

- `GITHUB_DISPATCH_TOKEN` expires **Nov 1, 2027**.
