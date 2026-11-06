-- Jack's protected players (ADR-060): never offered in trades, never suggested as drops.
create table player_prefs (
  player_id integer primary key,
  no_trade boolean not null default false,
  no_drop boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Precision tiers (ADR-060): each group of moves runs to its own target and season limits.
-- Existing groups keep the old single rule (±0.5 title points, 4,000-20,000 seasons).
alter table sim_groups
  add column target_2se double precision not null default 0.005,
  add column min_seasons integer not null default 4000,
  add column max_seasons integer not null default 20000;
