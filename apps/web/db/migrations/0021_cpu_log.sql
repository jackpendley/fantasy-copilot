-- Vercel CPU per scheduled or background run, by step (docs/COMPUTE.md). Vercel's own
-- Observability gives CPU per route; this splits a route's runs into their steps.
create table cpu_log (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  source text not null,
  cpu_ms integer not null,
  steps jsonb not null,
  detail jsonb not null default '{}'
);
create index cpu_log_source on cpu_log (source, ran_at desc);

-- Vercel CPU the worker's requests cost per job (assignments and posts).
alter table sim_jobs add column vercel_cpu_ms integer not null default 0;
