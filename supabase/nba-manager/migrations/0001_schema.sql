-- NBA manager schema v1 (Phase 2). Apply in the Supabase SQL editor or with psql.
-- All access goes through the service-role key from server code: RLS on, no policies,
-- so the anon key can read nothing.

-- Every ESPN write (lineup moves; later adds/drops/claims), with request and response.
create table espn_actions (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null,                 -- 'lineup' | 'lineup-check' | 'add-drop' | ...
  scoring_period_id integer not null,
  request jsonb not null,
  ok boolean not null,
  http_status integer not null,
  code text not null,                 -- ESPN status ('EXECUTED') or error type
  message text not null default '',
  response jsonb
);

-- One row per job run (cron and manual), so failures are visible in the app.
create table refresh_log (
  id bigint generated always as identity primary key,
  job text not null,
  status text not null,               -- 'ok' | 'error'
  detail text,
  ran_at timestamptz not null default now()
);

-- Player status changes as each source first reported them: the basis for news latency
-- (which free source is fastest) and, later, the availability model's labels.
create table status_events (
  id bigint generated always as identity primary key,
  player_id integer not null,         -- ESPN player id
  source text not null,               -- 'espn_injuries' | 'nba_lineups' | 'nba_injury_report' | 'espn_fantasy'
  status text not null,               -- normalized: OUT, QUESTIONABLE, ..., INACTIVE, STARTER
  detail text,
  published_at timestamptz,           -- when the source says it was published (if it says)
  observed_at timestamptz not null default now(),  -- when we first saw it
  game_date date                      -- US/Eastern game date it applies to, when known
);
create index status_events_player on status_events (player_id, observed_at desc);
-- A status is recorded once per source until it changes.
create unique index status_events_dedupe on status_events (player_id, source, status, coalesce(game_date, '1970-01-01'));

-- Web push subscriptions (one per installed device).
create table push_subscriptions (
  id bigint generated always as identity primary key,
  endpoint text not null unique,
  keys jsonb not null,                -- { p256dh, auth }
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);

-- Alerts already sent, so a rule fires once per situation.
create table alerts_sent (
  id bigint generated always as identity primary key,
  dedupe_key text not null unique,    -- e.g. 'out-starter:2026-10-20:4395724'
  title text not null,
  body text not null,
  sent_at timestamptz not null default now()
);

alter table espn_actions enable row level security;
alter table refresh_log enable row level security;
alter table status_events enable row level security;
alter table push_subscriptions enable row level security;
alter table alerts_sent enable row level security;
