-- Expensive views (trade targets, later waivers), computed in the background and served from
-- here. `fingerprint` summarizes the inputs (rosters, injuries, free agents, day); a page whose
-- inputs no longer match shows the stored result while a fresh one is computed.
create table view_cache (
  key text primary key,
  fingerprint text not null,
  value jsonb not null,
  computed_at timestamptz not null default now(),
  compute_ms integer
);
