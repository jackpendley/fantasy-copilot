"use client";

import {
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { dayStarts } from "@/lib/chart-axes";

export interface OddsPoint {
  at: string;
  playoffs: number;
  seed1: number;
  champ: number;
}

// Validated categorical slots 1-3 (blue, orange, aqua), stepped per theme in globals.css.
const SERIES = [
  { key: "playoffs", label: "Playoffs", color: "var(--chart-1)" },
  { key: "seed1", label: "#1 seed", color: "var(--chart-2)" },
  { key: "champ", label: "Title", color: "var(--chart-3)" },
] as const;

const TZ = "America/Phoenix";
/** Arizona keeps MST all year: its midnight is 07:00 UTC. */
const AZ_OFFSET_MS = 7 * 3600_000;
const DAY = 86_400_000;
const day = (t: number) =>
  new Date(t).toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: TZ });
const moment = (t: number) =>
  new Date(t).toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: TZ,
  });
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Vertical nudges (px) so end labels whose values are close don't overlap. */
function labelOffsets(lastPoint: OddsPoint | undefined): Record<string, number> {
  const offsets: Record<string, number> = {};
  if (!lastPoint) return offsets;
  const MIN_GAP = 0.07; // ~13 px on this chart's height
  const sorted = SERIES.map((s) => ({ key: s.key, v: lastPoint[s.key] })).sort((a, b) => b.v - a.v);
  let prev: number | null = null;
  let shift = 0;
  for (const { key, v } of sorted) {
    shift = prev != null && prev - v < MIN_GAP ? shift + 13 : 0;
    offsets[key] = shift;
    prev = v;
  }
  return offsets;
}

/**
 * One date per day, evenly spaced, from the first run's day through today (each run at its own
 * time, so several runs in a day stay inside that day). Labels thin out to fit the width.
 */
export function OddsChart({
  points,
  now,
}: {
  points: OddsPoint[];
  /** The server's now (ms). */ now: number;
}) {
  const last = points.length - 1;
  const offsets = labelOffsets(points[last]);
  const data = points.map((p) => ({ ...p, t: Date.parse(p.at) }));
  const starts = dayStarts(data[0]?.t ?? now, Math.max(now, data.at(-1)?.t ?? now), AZ_OFFSET_MS);
  const domain = [starts[0]!, starts.at(-1)! + DAY];
  const ticks = starts.map((d) => d + DAY / 2);
  return (
    <div className="h-60 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 12, right: 40, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            type="number"
            dataKey="t"
            domain={domain}
            ticks={ticks}
            interval="preserveStartEnd"
            minTickGap={8}
            tickFormatter={day}
            fontSize={11}
            stroke="var(--muted-foreground)"
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[0, 1]}
            tickFormatter={pct}
            fontSize={11}
            stroke="var(--muted-foreground)"
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            labelFormatter={(t) => moment(Number(t))}
            formatter={(v, name) => [pct(Number(v)), String(name)]}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--popover-foreground)",
              fontSize: 12,
            }}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          {SERIES.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={points.length < 20 ? { r: 3 } : false}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            >
              {/* Direct label on the latest point (relief for the lower-contrast series). */}
              <LabelList
                dataKey={s.key}
                content={({ x, y, value, index }) =>
                  index === last ? (
                    <text
                      x={Number(x) + 6}
                      y={Number(y) + 4 + (offsets[s.key] ?? 0)}
                      fontSize={11}
                      fontWeight={600}
                      fill="var(--foreground)"
                    >
                      {pct(Number(value))}
                    </text>
                  ) : null
                }
              />
            </Line>
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
