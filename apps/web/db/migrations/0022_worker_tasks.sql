-- Work the GitHub Actions worker does besides season simulations (docs/COMPUTE.md): one task
-- per input (kind + fingerprint), so repeated requests reuse it. A newer input supersedes a
-- queued one of the same kind; a task whose runner went quiet is handed out again (3 tries).
create table worker_tasks (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null,
  fingerprint text not null,
  input jsonb not null,
  -- queued | running | done | failed | superseded
  status text not null default 'queued',
  attempts integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  error text
);
create index worker_tasks_status on worker_tasks (status, created_at);
create unique index worker_tasks_live on worker_tasks (kind, fingerprint)
  where status in ('queued', 'running');
