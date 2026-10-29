-- PBP Stats (api.pbpstats.com) season numbers per player, refreshed nightly: the league-wide
-- pull takes seconds, so the player card reads one row instead. Matched to ESPN players by
-- normalized name (and team when two share a name).
create table pbp_players (
  season integer not null,          -- ESPN season (end year): 2027 = 2026-27
  nba_id integer not null,
  name_key text not null,
  team text not null,
  usage double precision,
  ts_pct double precision,
  shot_quality double precision,
  zones jsonb not null,             -- [{ zone, frequency, accuracy }]
  refreshed_at timestamptz not null default now(),
  primary key (season, nba_id)
);
create index pbp_players_name on pbp_players (season, name_key);
