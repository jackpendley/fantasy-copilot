"use client";

// The week's win chance over time: Monday to Sunday on the x axis always, a point before each
// day's games and every 15 minutes while games are on, then "now". One series, no legend. Each
// day gets an equal slot spread by activity (lib/chart-axes.ts): the games fill most of it, so
// a quiet night doesn't flatten the day's swings; the tooltip shows the real time.

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
import { gameTimeX, type DayWindow } from "@/lib/chart-axes";

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

/** `windows`: each day of the week with its games (lib/chart-axes.ts dayWindows). */
export function WinChart({ points, windows }: { points: WinPoint[]; windows: DayWindow[] }) {
  const days = windows.length;
  const data = points.map((p) => ({ ...p, x: gameTimeX(p.t, windows) }));
  const dayStarts = Array.from({ length: days + 1 }, (_, i) => i);
  const midDays = Array.from({ length: days }, (_, i) => i + 0.5);
  const dense = points.length > days + 2;
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: -16 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          {dayStarts.map((x) => (
            <ReferenceLine key={x} x={x} stroke="var(--border)" />
          ))}
          <XAxis
            type="number"
            dataKey="x"
            domain={[0, days]}
            ticks={midDays}
            tickFormatter={(x: number) => weekday(windows[Math.floor(x)]!.start + DAY / 2)}
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
            labelFormatter={(_, payload) => moment(Number(payload?.[0]?.payload?.t ?? 0))}
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
