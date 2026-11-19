-- Who played in each finished game, from ESPN's box score (lib/nba/market-data.ts): everyone
-- listed, with a DNP's reason ("COACH'S DECISION", an injury). Inactive players aren't listed,
-- so a team's regular missing from a recorded game was inactive. A game with rows is recorded;
-- one without (a failed fetch) is fetched again by the next run.
create table game_participation (
  game_id bigint not null,
  player_id integer not null,
  team_id integer not null,
  played boolean not null,
  starter boolean not null,
  minutes real not null,
  reason text,
  recorded_at timestamptz not null default now(),
  primary key (game_id, player_id)
);
create index game_participation_team on game_participation (team_id, game_id);

-- NBA.com's daily lineups as they change before each game (every player, not only rostered
-- ones): active or inactive, starter, confirmed. One row per state a player-game was seen in,
-- with NBA.com's own timestamp and when we saw it. Inactive here before tip is the late scratch
-- the injury report can miss.
create table lineup_log (
  game_date date not null,
  nba_game_id text not null,
  team text not null,
  nba_person_id integer not null,
  name text not null,
  inactive boolean not null,
  starter boolean not null,
  confirmed boolean not null,
  nba_timestamp text,
  observed_at timestamptz not null,
  primary key (nba_game_id, nba_person_id, inactive, starter, confirmed)
);
