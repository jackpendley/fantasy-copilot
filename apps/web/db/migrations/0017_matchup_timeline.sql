-- Every league matchup's win chance through game days (every 15 minutes while games are on),
-- for the Matchup page's chart. Morning-only rows for the win-probability tests stay in
-- matchup_states.
create table matchup_timeline (
  id bigint generated always as identity primary key,
  taken_at timestamptz not null default now(),
  matchup_period integer not null,
  scoring_period integer not null,
  home_id integer not null,
  away_id integer not null,
  home_points double precision not null,
  away_points double precision not null,
  p_home double precision not null
);
create index matchup_timeline_week on matchup_timeline (matchup_period, home_id, taken_at);
