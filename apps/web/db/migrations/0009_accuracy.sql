-- Projection accuracy for every player with a game (not only those with props), with ESPN's
-- preseason projection as a baseline, and the model settings the nightly job maintains
-- (the props blend weight, once the pre-registered test passes).
alter table pregame_projections add column espn_fppg double precision;
alter table pregame_projections alter column model_fppg drop not null;

create table model_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
