-- Every matchup in the league each morning, with the app's own projections, so the weekly win
-- probability can be calibrated on real states (MODEL_CARD.md, "Weekly win probability").
-- Final results come from ESPN when the calibration runs.
create table matchup_states (
  id bigint generated always as identity primary key,
  taken_at timestamptz not null default now(),
  matchup_period integer not null,
  scoring_period integer not null,     -- the day, before its games
  home_id integer not null,
  away_id integer not null,
  home_points double precision not null,
  away_points double precision not null,
  home_remaining double precision not null,  -- projected points still to come
  away_remaining double precision not null,
  p_home double precision not null           -- the model's P(home wins) at the time
);
create unique index matchup_states_day on matchup_states (matchup_period, scoring_period, home_id);
