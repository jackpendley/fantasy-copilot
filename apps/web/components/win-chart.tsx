"use client";

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
  label: string;
  pWin: number;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** This week's win chance, one point per day (before games) plus now. One series, no legend. */
export function WinChart({ points }: { points: WinPoint[] }) {
  return (
    <div className="h-44 w-full">
      <ResponsiveContainer>
        <LineChart data={points} margin={{ top: 12, right: 12, bottom: 0, left: -16 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            fontSize={11}
            stroke="var(--muted-foreground)"
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
            formatter={(v) => [pct(Number(v)), "Win chance"]}
          />
          <Line
            dataKey="pWin"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={{ r: 4, strokeWidth: 2, stroke: "var(--card)", fill: "var(--chart-1)" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
