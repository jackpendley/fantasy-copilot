-- Each move's last settled deep check (ADR-058, docs/COMPUTE.md), kept while newer checks run
-- so the Moves page can show the last numbers with "Updating" instead of losing them.
create table move_results (
  key text primary key,
  job_id bigint not null,
  -- Jack's roster (and its injury news) the check was for (lib/nba/move-checks.ts rosterKey).
  roster_key text not null,
  effect jsonb not null,
  settled_at timestamptz not null default now()
);
