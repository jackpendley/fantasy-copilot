"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface FpPoint {
  label: string;
  opponent: string;
  fp: number;
  rolling: number | null;
}

/** Fantasy points per game (bars) with a 5-game rolling average (line). One axis. */
export function FpChart({ points }: { points: FpPoint[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            fontSize={11}
            stroke="var(--muted-foreground)"
            minTickGap={16}
          />
          <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(label, payload) =>
              `${label} vs ${(payload?.[0]?.payload as FpPoint | undefined)?.opponent ?? ""}`
            }
            formatter={(v, name) => [Number(v).toFixed(1), String(name)]}
          />
          <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey="fp"
            name="Fantasy points"
            fill="var(--chart-1)"
            radius={[4, 4, 0, 0]}
            maxBarSize={18}
          />
          <Line
            dataKey="rolling"
            name="5-game average"
            stroke="var(--chart-2)"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
