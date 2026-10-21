-- Outlook re-runs on roster moves: what set off each run, and a lock so only one runs at a time.
alter table outlook_runs add column trigger text;

create table job_locks (
  name text primary key,
  -- The lock is free once this passes (a crashed run can't hold it forever).
  until timestamptz not null
);
