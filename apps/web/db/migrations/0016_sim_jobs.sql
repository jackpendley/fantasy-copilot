-- Season simulations run by the GitHub Actions worker (ADR-053). A job is the season
-- simulated from one set of rosters: the base run (the Outlook) and Jack's candidate moves,
-- played in chunks of seasons that any number of runners take in turn.
create table sim_jobs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- queued | running | done | superseded
  status text not null default 'queued',
  trigger text,
  team_id integer not null,
  scoring_period integer not null,
  -- When the rosters were read (the Outlook run's run_at).
  read_at timestamptz not null,
  fingerprint text not null,
  -- The simulation input (fantasy-core WireInput) and the moves (WireMove[]).
  setup jsonb not null,
  moves jsonb not null,
  -- Waiver fingerprint and roster key the moves were built from (lib/nba/move-checks.ts).
  waiver_fingerprint text,
  roster_key text,
  replays integer not null,
  chunk_seasons integer not null,
  next_chunk integer not null default 0,
  max_chunks integer not null,
  -- Move keys still getting seasons.
  active text[] not null,
  -- The outlook_runs row this job writes (progressively).
  outlook_run_id bigint,
  last_worker_at timestamptz,
  -- Team names, records and activity for the Outlook rows (OutlookTeam fields).
  meta jsonb not null
);
create index sim_jobs_status on sim_jobs (status, created_at desc);

create table sim_chunks (
  job_id bigint not null references sim_jobs (id) on delete cascade,
  chunk integer not null,
  result jsonb not null,
  posted_at timestamptz not null default now(),
  primary key (job_id, chunk)
);
