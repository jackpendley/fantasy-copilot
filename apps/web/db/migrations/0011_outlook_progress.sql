-- Outlook runs report as they go: a run's row exists from the start ('running'), holds the odds
-- so far (every 250 seasons) and becomes 'final' at the end. History and "change since last
-- update" read final rows only; a running row is the page's provisional preview.
alter table outlook_runs add column status text not null default 'final';
alter table outlook_runs add column updated_at timestamptz;
