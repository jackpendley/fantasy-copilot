"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// ESPN's public image CDN, keyed by the same player id the fantasy API uses.
const headshot = (id: number, px: number) =>
  `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${id}.png&w=${px * 2}&h=${Math.round(px * 1.46)}&cb=1`;

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

export function PlayerAvatar({
  id,
  name,
  size = 40,
  className,
}: {
  id: number;
  name: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-muted-foreground",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {failed ? (
        initials(name)
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- remote CDN image, no optimizer needed
        <img
          src={headshot(id, size)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute bottom-0 h-full w-auto max-w-none object-cover object-top"
        />
      )}
    </span>
  );
}
