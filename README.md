# fantasy-copilot

Tools for winning ESPN fantasy leagues with data, optimization and machine learning. NBA first, then NFL and MLB.

| App                                | What it does                                                                                                                                                                                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`apps/web`](apps/web)             | **Fantasy Copilot**, one app with a section per sport (NBA now; NFL, MLB next). Daily optimal lineups (one-click apply), matchup outlook, injuries and lineup news. Coming: waivers and streaming, season odds (playoffs, #1 seed, title), trades. Next.js + Postgres. |
| [`apps/nba-ml`](apps/nba-ml)       | Data warehouse and models: minutes, availability, production rate and expected shooting. Python.                                                                                                                                                                       |
| [`apps/draft-nba`](apps/draft-nba) | Chrome extension for the ESPN draft room: league-rescored projections, value over replacement, roster-aware picks.                                                                                                                                                     |

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
