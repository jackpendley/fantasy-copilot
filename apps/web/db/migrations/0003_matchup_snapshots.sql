-- This week's head-to-head odds, recorded by the nightly job before each day's games, so the
-- matchup page can chart how the win chance moved through the week.
create table matchup_snapshots (
  id bigint generated always as identity primary key,
  taken_at timestamptz not null default now(),
  matchup_period integer not null,
  scoring_period integer not null,   -- the day it was taken (before that day's games)
  my_points double precision not null,
  opp_points double precision not null,
  my_projected double precision not null,  -- projected final
  opp_projected double precision not null,
  p_win double precision not null
);
create index matchup_snapshots_period on matchup_snapshots (matchup_period, taken_at);
