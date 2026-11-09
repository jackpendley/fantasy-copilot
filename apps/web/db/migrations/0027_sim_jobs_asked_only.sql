-- A job of only the trades Jack asked to simulate (sim-asked): it runs ahead of the full job
-- without replacing it, and the Moves and League pages ignore it.
alter table sim_jobs add column asked_only boolean not null default false;
