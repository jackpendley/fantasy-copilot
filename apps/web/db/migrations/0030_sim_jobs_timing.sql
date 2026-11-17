-- How long each trigger waits (Settings): when a runner first took the job's work, when its
-- Outlook reached the base run's minimum seasons, and when it finished. From read_at, when the
-- rosters were read for it.
alter table sim_jobs add column started_at timestamptz, add column outlook_at timestamptz,
  add column done_at timestamptz;
