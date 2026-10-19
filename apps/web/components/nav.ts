import { CalendarCheck, CalendarRange, Settings, TrendingUp } from "lucide-react";

// One section per sport. NBA is live; NFL and MLB join when they ship.
export const SPORTS = [
  { key: "nba", label: "NBA", live: true },
  { key: "nfl", label: "NFL", live: false },
  { key: "mlb", label: "MLB", live: false },
] as const;

export const NBA_NAV = [
  { href: "/nba/today", label: "Today", icon: CalendarCheck },
  { href: "/nba/week", label: "Week", icon: CalendarRange },
  { href: "/nba/outlook", label: "Outlook", icon: TrendingUp },
] as const;

export const SETTINGS_NAV = { href: "/settings", label: "Settings", icon: Settings } as const;
