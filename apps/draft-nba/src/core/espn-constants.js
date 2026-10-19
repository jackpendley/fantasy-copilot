// ESPN fantasy basketball enum maps. Stable across seasons.

export const POSITION_BY_ID = {
  1: 'PG', 2: 'SG', 3: 'SF', 4: 'PF', 5: 'C',
};

// Lineup slot ids. Positional slots double as eligibility: a player's
// `eligibleSlots` lists every slot ESPN lets him fill.
export const SLOT_BY_ID = {
  0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C', 5: 'G', 6: 'F',
  7: 'SG/SF', 8: 'G/F', 9: 'PF/C', 10: 'F/C', 11: 'UTIL', 12: 'BE', 13: 'IR',
};
export const POSITIONAL_SLOT_IDS = [0, 1, 2, 3, 4];

export const PRO_TEAM_BY_ID = {
  0: 'FA',
  1: 'ATL', 2: 'BOS', 3: 'NO', 4: 'CHI', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET',
  9: 'GS', 10: 'HOU', 11: 'IND', 12: 'LAC', 13: 'LAL', 14: 'MIA', 15: 'MIL', 16: 'MIN',
  17: 'BKN', 18: 'NY', 19: 'ORL', 20: 'PHI', 21: 'PHX', 22: 'POR', 23: 'SAC', 24: 'SA',
  25: 'OKC', 26: 'UTAH', 27: 'WSH', 28: 'TOR', 29: 'MEM', 30: 'CHA',
};

// Other sites' abbreviations -> ESPN's.
export const TEAM_ALIASES = {
  GSW: 'GS', NOP: 'NO', NYK: 'NY', SAS: 'SA', UTA: 'UTAH', WAS: 'WSH', PHO: 'PHX', BRK: 'BKN', CHO: 'CHA',
};

export function normalizeTeam(abbr) {
  if (!abbr) return null;
  const up = String(abbr).toUpperCase();
  return TEAM_ALIASES[up] || up;
}

// ESPN basketball stat ids (raw counting stats; ESPN also emits per-game copies at 26-33).
export const STAT_BY_ID = {
  0: 'PTS', 1: 'BLK', 2: 'STL', 3: 'AST', 4: 'OREB', 5: 'DREB', 6: 'REB', 7: 'EJ',
  8: 'FF', 9: 'PF', 10: 'TF', 11: 'TO', 12: 'DQ', 13: 'FGM', 14: 'FGA', 15: 'FTM',
  16: 'FTA', 17: '3PM', 18: '3PA', 19: 'FG%', 20: 'FT%', 21: '3P%', 22: 'AFG%',
  23: 'FGMI', 24: 'FTMI', 25: '3PMI', 37: 'DD', 38: 'TD', 39: 'QD', 40: 'MIN',
  41: 'GS', 42: 'GP',
};

export const SEASON = 2027; // ESPN names an NBA season by the year it ends (2026-27).
export const READ_HOST = 'https://lm-api-reads.fantasy.espn.com';
export const PLAYER_UNIVERSE_URL =
  `${READ_HOST}/apis/v3/games/fba/seasons/${SEASON}/segments/0/leaguedefaults/1?view=kona_player_info`;

export function leagueUrl(leagueId, views, season = SEASON) {
  const q = views.map((v) => `view=${v}`).join('&');
  return `${READ_HOST}/apis/v3/games/fba/seasons/${season}/segments/0/leagues/${leagueId}?${q}`;
}
