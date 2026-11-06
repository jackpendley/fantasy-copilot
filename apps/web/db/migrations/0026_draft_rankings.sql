-- Jack's pre-draft rankings (apps/draft-nba/dist/rankings.csv, uploaded in Settings), matched to
-- ESPN player ids. Private: kept here, never in git. An upload replaces the previous one.
create table draft_rankings (
  player_id integer primary key,
  name text not null,
  team text not null,
  rank integer not null,
  tier integer not null,
  value double precision not null,
  fppg double precision not null,
  imported_at timestamptz not null default now()
);
