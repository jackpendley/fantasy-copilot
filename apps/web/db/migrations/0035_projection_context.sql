-- The context-aware projection (ADR-069): each logged projection's factor for teammates out of
-- the game (1 = none), and the whole projection without the context model (no de-inflation, no
-- factor; game environment and matchup as logged), so its forward check compares the two on the
-- same games (MODEL_CARD).
alter table pregame_projections add column context_factor double precision;
alter table pregame_projections add column context_free_fppg double precision;
