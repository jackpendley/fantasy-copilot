-- Market data collected for the model (ESPN's public odds feed and DARKO). Point in time:
-- every row carries when it was captured, and lines are only captured before tip.

-- Player props (DraftKings via ESPN). One row per game, player, market and snapshot:
-- 'morning' (nightly job), 'pregame' (evening job), 'close' (last capture before tip).
create table prop_lines (
  game_id bigint not null,
  player_id integer not null,
  market text not null,               -- PTS, REB, AST, 3PM, STL, BLK
  snapshot text not null,
  captured_at timestamptz not null,
  tip timestamptz not null,
  line double precision not null,
  over_price double precision not null,   -- decimal odds
  under_price double precision not null,
  open_line double precision,
  book_updated_at timestamptz,
  primary key (game_id, player_id, market, snapshot)
);
create index prop_lines_player on prop_lines (player_id, tip);

-- Game lines (spread and total) from the scoreboard, same snapshots.
create table game_lines (
  game_id bigint not null,
  snapshot text not null,
  captured_at timestamptz not null,
  tip timestamptz not null,
  home_team integer not null,
  away_team integer not null,
  spread double precision,              -- home spread (negative = home favored)
  total double precision,
  primary key (game_id, snapshot)
);

-- Outside projections (DARKO), one row per player per as-of date.
create table projection_snapshots (
  source text not null,
  as_of date not null,
  player_id integer not null,
  captured_at timestamptz not null default now(),
  payload jsonb not null,
  primary key (source, as_of, player_id)
);
