-- Settings reads each job's latest run and latest success, and a failure checks the job's last
-- few runs (lib/job-alerts.ts): both by job, newest first.
create index refresh_log_job on refresh_log (job, ran_at desc);
