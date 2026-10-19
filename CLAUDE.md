# fantasy-copilot — guide for Claude sessions

A monorepo of tools for **winning Jack's ESPN fantasy leagues**. Right now it is NBA only. NFL comes once the NBA app is fully built, then MLB.

- `apps/nba-manager`: the season-long team manager. Next.js 16 + Supabase on Vercel.
- `apps/nba-ml`: data warehouse and ML (Python).
- `apps/draft-nba`: the draft-room Chrome extension.

Jack's league is "FOX Champions League" (ESPN 322514556, team 13, 2026-27). Its quirks are in `docs/LEAGUE.md`.

## Start here every session

1. Read `docs/PROJECT_STATUS.md`: the current phase, blockers and the exact next task.
2. Read the current phase in `docs/ROADMAP.md`.
3. Check `docs/DECISIONS.md` before changing anything it covers.
4. At session end, **rewrite** `docs/PROJECT_STATUS.md` (don't append) and tick ROADMAP milestones.

## Working agreement

- **Claude implements everything.** Explain significant decisions and trade-offs so Jack can follow the code. He's building toward a backend/full-stack role.
- Build in small, tested vertical slices. No new frameworks or infrastructure without a stated reason.
- **Git:** one branch per milestone, opened as a PR with `gh pr create`. Squash-merge once CI is green. `main` stays deployable. The repo is **public**.
- **Still requires approval:**
  - creating cloud resources (Vercel, Supabase, new databases);
  - adding or changing secrets;
  - paying for any data or plan;
  - making a deployment public.

## Non-negotiable rules

- **ESPN writes:** lineup moves, adds, drops and claims change Jack's real team.
  - They only happen from an explicit confirm in the UI, or a job Jack has turned on.
  - Every write is logged to `espn_actions` with the request and response.
  - Never write to ESPN from tests or scripts.
- **Private data stays out of git:**
  - ESPN cookies, league JSON dumps, other managers' names and team names.
  - Fixtures from real responses are trimmed and anonymized ("Team 14", "{OWNER-14}").
  - `**/data/local/` is gitignored.
- **Point-in-time features:** a model may only use data available before that game's tip.
  - Injury reports, lineups and lines carry when they were published or observed.
  - Never stamp historical data with import time.
- **Never fabricate:** stats, projections or results. Missing data shows as missing. Synthetic test data is labeled synthetic.
- **Models ship only after beating their baseline** (ESPN's projection and a simple baseline) on a pre-registered, walk-forward test. Results go in `docs/MODEL_CARD.md`.

## Commands

- `pnpm install`
- `pnpm test` (all packages)
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format`
- `pnpm test:sources`: smoke-tests every live data source (no database needed).
- `pnpm dev`: runs the NBA manager app.

---

# General behavioral guidelines

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
