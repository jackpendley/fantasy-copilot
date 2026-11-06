-- Jack's ESPN watch list as a job saw it (the Interested list, ADR-060): the 5-minute check
-- queues a new job when it changes. Older jobs have none and never trigger it.
alter table sim_jobs add column watch_key text;
