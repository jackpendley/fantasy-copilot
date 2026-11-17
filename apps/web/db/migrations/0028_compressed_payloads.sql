-- Big JSON payloads stored gzip-compressed (base64 text) instead of as jsonb: every read of
-- them is database transfer, and Neon's Free plan allows 5 GB a month (used up Nov 16, 2026).
-- A task's input (megabytes) is read once by the worker; a job's setup and moves by each
-- simulation runner. Rows written before this keep their jsonb (the readers fall back to it).
alter table worker_tasks add column input_gz text;
alter table sim_jobs add column setup_gz text, add column moves_gz text, add column n_moves integer;
