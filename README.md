# fantasy-copilot

Tools for winning ESPN fantasy leagues with data, optimization and machine learning.

| App                                    | What it does                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`apps/nba-manager`](apps/nba-manager) | Season-long team manager: daily optimal lineups (one-click apply), waiver and streaming suggestions, injuries and lineup news, trade analysis, league odds. Next.js + Supabase. |
| [`apps/nba-ml`](apps/nba-ml)           | Data warehouse and models: minutes, availability, production rate and expected shooting. Python.                                                                                |
| [`apps/draft-nba`](apps/draft-nba)     | Chrome extension for the ESPN draft room: league-rescored projections, value over replacement, roster-aware picks.                                                              |

| Package                                          |                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| [`packages/espn`](packages/espn)                 | Typed client for ESPN's unofficial fantasy API v3                                      |
| [`packages/fantasy-core`](packages/fantasy-core) | League scoring, the lineup optimizer (exact assignment), valuation, simulation         |
| [`packages/nba-data`](packages/nba-data)         | ESPN site API (scoreboard, injuries, box scores), NBA.com daily lineups, name matching |

```bash
pnpm install
pnpm test
pnpm test:sources   # checks every live data source
```

> **Unofficial.** This project isn't affiliated with ESPN or the NBA. It reads ESPN's undocumented endpoints using your own signed-in session, and ESPN could change or restrict them at any time.

Built by Jack Pendley. MIT license.
