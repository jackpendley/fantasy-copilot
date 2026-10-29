-- The opponent-defense factor applied to each logged projection (null = none, i.e. 1), so the
-- nightly defense table is computed against the projection without it (no feedback loop).
alter table pregame_projections add column matchup_factor double precision;
