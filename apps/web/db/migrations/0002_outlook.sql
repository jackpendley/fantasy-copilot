-- Season outlook runs (Phase 3): one row per simulation, so the app can chart odds over time.
create table outlook_runs (
  id bigint generated always as identity primary key,
  run_at timestamptz not null default now(),
  scoring_period integer not null,   -- first day simulated (today)
  seasons integer not null,
  -- [{ teamId, name, wins, losses, pointsFor, expWins, playoffs, seed1, final, champ, act, addsPerWeek }]
  results jsonb not null
);
create index outlook_runs_time on outlook_runs (run_at desc);
