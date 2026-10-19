import { cn } from "@/lib/utils";

// ESPN team logos by ESPN abbreviation (lowercase in the CDN path).
export function TeamLogo({
  abbr,
  size = 20,
  className,
}: {
  abbr: string;
  size?: number;
  className?: string;
}) {
  if (!abbr || abbr === "FA" || abbr === "?") return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote CDN image, no optimizer needed
    <img
      src={`https://a.espncdn.com/combiner/i?img=/i/teamlogos/nba/500/${abbr.toLowerCase()}.png&w=${size * 2}&h=${size * 2}`}
      alt={abbr}
      width={size}
      height={size}
      loading="lazy"
      className={cn("inline-block shrink-0", className)}
    />
  );
}
