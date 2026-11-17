-- The chunks each group's runners have posted, so a chunk posted twice (a runner that retries
-- after a lost answer) counts once in sim_groups.posted. A job is done when every chunk handed
-- out is back, so a double count would close it early.
create table sim_posts (
  job_id bigint not null references sim_jobs (id) on delete cascade,
  grp integer not null,
  chunk integer not null,
  primary key (job_id, grp, chunk)
);
