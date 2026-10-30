-- The NBA's official injury report, logged live for the availability forward test (MODEL_CARD,
-- 2026-10-30): each status change for a listed player, stamped with the time printed on the
-- report (point in time). A status that changes and changes back is a new row each time.
create table official_status (
  id bigint generated always as identity primary key,
  player_id integer not null,          -- ESPN player id
  game_id bigint,                      -- ESPN game id, when the schedule has it
  game_date date not null,             -- US/Eastern
  tip timestamptz,
  status text not null,                -- Available | Probable | Questionable | Doubtful | Out
  reason text,
  published_at timestamptz not null,   -- printed on the report
  observed_at timestamptz not null default now()
);
create index official_status_player on official_status (player_id, game_date, published_at desc);
