-- Racing groups (ADR-063): moves promoted to a deeper tier. Later promotions join one with room
-- instead of starting their own (each group re-simulates the base every chunk), and a promoted
-- move that falls clearly behind its race's leader stops.
alter table sim_groups add column promoted boolean not null default false;
