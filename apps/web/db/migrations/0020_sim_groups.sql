-- Deep checks of every move (ADR-058). A job's moves are split into groups that take their own
-- chunks of seasons (each chunk replays the base on that chunk's seeds, so every move stays
-- paired with it), most important group first. Each chunk's per-move sums are rows here, so
-- the app sums them in the database instead of reloading every chunk on every post.
create table sim_groups (
  job_id bigint not null references sim_jobs (id) on delete cascade,
  grp integer not null,
  -- 0: moves Jack asked for, 1: the Moves page's opening moves, 2: everything else.
  prio integer not null,
  keys text[] not null,
  -- Move keys still getting seasons.
  active text[] not null,
  next_chunk integer not null default 0,
  posted integer not null default 0,
  primary key (job_id, grp)
);

create table sim_move_sums (
  job_id bigint not null references sim_jobs (id) on delete cascade,
  key text not null,
  chunk integer not null,
  -- Seasons, then per metric the sum and the sum of squares of (move - base) per season.
  n integer not null,
  title_s double precision not null,
  title_q double precision not null,
  playoffs_s double precision not null,
  playoffs_q double precision not null,
  seed1_s double precision not null,
  seed1_q double precision not null,
  bye_s double precision not null,
  bye_q double precision not null,
  wins_s double precision not null,
  wins_q double precision not null,
  primary key (job_id, key, chunk)
);

-- The checks are recomputed from the sums at most every few seconds while runners post.
alter table sim_jobs add column refreshed_at timestamptz;

-- Jobs queued before groups can't be continued: the next one replaces them.
update sim_jobs set status = 'superseded', updated_at = now() where status in ('queued', 'running');
