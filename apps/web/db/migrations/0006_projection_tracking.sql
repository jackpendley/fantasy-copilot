-- What we and the sportsbooks projected before each game, and what happened, so the props
-- blend can be trained and tested walk-forward (MODEL_CARD.md).

-- Captured with each props snapshot, before tip. model_fppg is our per-game projection
-- (game environment included, play probability not); vegas_fppg the props-implied one.
create table pregame_projections (
  game_id bigint not null,
  player_id integer not null,
  snapshot text not null,               -- morning, pregame, close (as prop_lines)
  captured_at timestamptz not null,
  tip timestamptz not null,
  model_fppg double precision not null,
  vegas_fppg double precision,
  primary key (game_id, player_id, snapshot)
);

-- Box scores of finished games (everyone who played), scored with the league's settings.
create table game_results (
  game_id bigint not null,
  player_id integer not null,
  team_id integer not null,
  line jsonb not null,
  fp double precision not null,
  recorded_at timestamptz not null default now(),
  primary key (game_id, player_id)
);
