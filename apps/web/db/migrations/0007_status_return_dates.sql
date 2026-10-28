-- ESPN's estimated return date with each injury status, so its estimates can be checked later
-- (point in time). A changed estimate is a new row.
alter table status_events add column return_date date;
drop index status_events_dedupe;
create unique index status_events_dedupe on status_events (
  player_id, source, status, coalesce(game_date, '1970-01-01'), coalesce(return_date, '1970-01-01')
);
