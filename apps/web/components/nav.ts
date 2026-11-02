import { CalendarCheck, CalendarRange, Settings, Trophy, Users } from "lucide-react";

// One section per sport. NBA is live; NFL and MLB join when they ship.
export const SPORTS = [
  { key: "nba", label: "NBA", live: true },
  { key: "nfl", label: "NFL", live: false },
  { key: "mlb", label: "MLB", live: false },
] as const;

export const NBA_NAV = [
  { href: "/nba/today", label: "Today", icon: CalendarCheck },
  { href: "/nba/week", label: "Matchup", icon: CalendarRange },
  // Players = moves, free agents and trends (was Waivers + Players); League = standings,
  // odds and trades (was Outlook + League).
  { href: "/nba/players", label: "Players", icon: Users },
  { href: "/nba/league", label: "League", icon: Trophy },
] as const;

export const SETTINGS_NAV = { href: "/settings", label: "Settings", icon: Settings } as const;
