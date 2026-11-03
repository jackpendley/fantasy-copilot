"use client";

// The week's win chance over time: Monday to Sunday on the x axis always, a point before each
// day's games and every 15 minutes while games are on, then "now". One series, no legend.

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface WinPoint {
  /** Epoch ms. */
  t: number;
  pWin: number;
}

const DAY = 86_400_000;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const TZ = "America/Phoenix";
const weekday = (t: number) =>
  new Date(t).toLocaleDateString("en-US", { weekday: "short", timeZone: TZ });
const moment = (t: number) =>
  new Date(t).toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: TZ,
  });

/** `start`: the week's first midnight (epoch ms); `days`: how many days the week has. */
export function WinChart({
  points,
  start,
  days,
}: {
  points: WinPoint[];
  start: number;
  days: number;
}) {
  const end = start + days * DAY;
  const dayStarts = Array.from({ length: days + 1 }, (_, i) => start + i * DAY);
  const midDays = Array.from({ length: days }, (_, i) => start + i * DAY + DAY / 2);
  const dense = points.length > days + 2;
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer>
        <LineChart data={points} margin={{ top: 12, right: 12, bottom: 0, left: -16 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          {dayStarts.map((x) => (
            <ReferenceLine key={x} x={x} stroke="var(--border)" />
          ))}
          <XAxis
            type="number"
            dataKey="t"
            domain={[start, end]}
            ticks={midDays}
            tickFormatter={weekday}
            tickLine={false}
            axisLine={false}
            fontSize={11}
            stroke="var(--muted-foreground)"
            allowDataOverflow
          />
          <YAxis
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            tickFormatter={pct}
            tickLine={false}
            axisLine={false}
            fontSize={11}
            stroke="var(--muted-foreground)"
          />
          <ReferenceLine y={0.5} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
          <Tooltip
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(t) => moment(Number(t))}
            formatter={(v) => [pct(Number(v)), "Win chance"]}
          />
          <Line
            dataKey="pWin"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={
              dense
                ? false
                : { r: 3.5, strokeWidth: 2, stroke: "var(--card)", fill: "var(--chart-1)" }
            }
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
