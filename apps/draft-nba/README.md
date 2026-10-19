# Hoops Draft Copilot

A Chrome extension that puts a live, **roster-aware fantasy basketball draft board** inside the
ESPN draft room. Projections are re-scored for your league's exact rules.

Built for the 2026-27 "FOX Champions League" draft and used live.

> **Unofficial.** Not affiliated with ESPN or FantasyPros. It reads ESPN's undocumented
> fantasy endpoints using your own signed-in session.

## What it does
- **League-rescored projections:**
  - ESPN's 2026-27 projections are blended 50/50 with FantasyPros consensus.
  - They're re-scored with your league's scoring (`data/local/league-rules.json`), including misses and double/triple-double rates.
- **Value over replacement, lineup-aware:**
  - Replacement levels come from filling every team's actual starting slots (PG/SG/SF/PF/C/G/F/UTIL).
  - That keeps one position from flooding the top of the board.
- **"Take now" ranking:**
  - Value over the best player of the same position group (G/F/C) likely to be available at your next pick.
  - Survival odds use ESPN ADP.
- **Roster fit:**
  - Maximum matching of your roster to starting slots, using multi-position eligibility.
  - Then a guard/forward/big bench structure. No third center once the bench big is drafted.
- **Live draft room:**
  - Picks are read off the page. ESPN's API lists every pick as player −1 until the draft ends.
  - Manual ✓ is a fallback.

## Use
```bash
pnpm install
pnpm run fetch                              # ESPN + FantasyPros projections -> data/cache/
pnpm run import:league <league.json>        # your league's settings -> data/local/league-rules.json
pnpm run build                              # dataset, cheat sheet, extension -> dist/, extension/build/
```
Load `extension/` unpacked in Chrome, then open your ESPN draft room.

## After the draft
`scripts/postdraft/` holds the season simulations used to rank the league after the draft:
- `league-sim.mjs`: daily lineups, the real NBA and league schedules, manager activity, streaming, injuries.
- The other scripts are earlier versions.

Their inputs are private league files, kept in gitignored `data/local/postdraft/`.

## Tests
`pnpm test` (node:test, 118 tests).
