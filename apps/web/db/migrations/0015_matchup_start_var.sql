-- The variance of each side's points still to come, summed over its projected starts (each
-- player's spread around his projection): the input of the win-probability candidate C
-- pre-registered in MODEL_CARD.md ("Weekly win probability"). Null on rows logged before it.
alter table matchup_states
  add column home_start_var double precision,
  add column away_start_var double precision;
