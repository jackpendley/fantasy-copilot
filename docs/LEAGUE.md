# League mechanics (2026-27)

This is what the app has to model. It was verified from ESPN settings and from last season's results.

## Scoring (H2H points)

- FGM +2, missed FG −2
- FTM +1, missed FT −1
- 3PM +2.5
- REB +1.5, AST +2, STL +4, BLK +4, TO −2
- Double-double +5, triple-double +15, quadruple-double +25
- There is no PTS stat. Points come from makes and misses.

## Roster

- Starters: PG, SG, SF, PF, C, G, F, UTIL, UTIL.
- 3 bench spots and 1 IR spot.
- **The bench is unlimited during lineup setting** (`isBenchUnlimited`). A slot nobody can fill stays empty.

## Lineups

- **Each player locks when his own game starts** (`INDIVIDUAL_GAME`).
- **ESPN has no autopilot in this league.** Unset lineups score nothing.
- There's no games-played cap, so the best daily lineup each day is also the best weekly one.

## Transactions

- At most **3 adds per matchup week**. ESPN stores this as 0.4286 per day (`matchupLimitPerScoringPeriod`).
- Traditional waivers: dropped players clear in 24 hours, processed Sundays at 8 AM.

## Calendar

Fitted to 2025-26 weekly scores (correlation 0.82):

- **Week 1 is 6 days:** Tue Oct 20 – Sun Oct 25.
- After that, weeks run Monday to Sunday.
- **The two All-Star calendar weeks are merged into one matchup** (Feb 15–28, 2027).
- **Week 8 (Dec 7–13) is an NBA Cup bye** for every team.
- Regular season: weeks 1–19, so 18 real matchups.
- **Playoffs:** weeks 20–22 (Mar 8–28), 6 teams, seeds 1–2 get a bye.
- The league season ends Mar 28. That's ESPN scoring period 160, and period 1 is Tue Oct 20.
