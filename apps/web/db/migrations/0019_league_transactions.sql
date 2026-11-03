-- Every executed league roster move (waiver claims, free-agent adds, trades: one row per team
-- in a trade), kept so team pages can show each move's history and impact. From ESPN's
-- mTransactions2 view; `at` is when ESPN processed it (or when it was made, until stamped).
create table league_transactions (
  key text primary key,          -- team:at:adds:drops (a move is read again on later syncs)
  team_id integer not null,
  type text not null,            -- WAIVER | FREEAGENT | TRADE
  at timestamptz not null,
  scoring_period integer not null,
  adds integer[] not null,
  drops integer[] not null
);
create index league_transactions_team on league_transactions (team_id, at);
