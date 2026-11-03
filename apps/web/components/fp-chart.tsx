"use client";

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fpTone } from "@/lib/display";

export interface FpPoint {
  label: string;
  opponent: string;
  fp: number;
  /** 5-game rolling average (null for the first games). */
  rolling: number | null;
  minutes?: number | null;
}

const COLOR = { good: "var(--success)", bad: "var(--danger)", null: "var(--chart-1)" } as const;

/**
 * Fantasy points per game: bars colored like the game log (green 25%+ above his average, red
 * 40%+ below), his 5-game average as a line and his season average (and projection) as dashed
 * references. One axis.
 */
export function FpChart({
  points,
  average,
  projection,
  compact = false,
}: {
  points: FpPoint[];
  average: number | null;
  projection?: number | null;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "h-36 w-full" : "h-60 w-full"}>
      <ResponsiveContainer>
        <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            fontSize={10}
            stroke="var(--muted-foreground)"
            minTickGap={compact ? 10 : 16}
          />
          <YAxis tickLine={false} axisLine={false} fontSize={10} stroke="var(--muted-foreground)" />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            itemStyle={{ color: "var(--foreground)" }}
            labelFormatter={(label, payload) => {
              const p = payload?.[0]?.payload as FpPoint | undefined;
              return `${label} vs ${p?.opponent ?? ""}${p?.minutes === 0 ? " (didn't play)" : ""}`;
            }}
            formatter={(v, name) => [Number(v).toFixed(1), String(name)]}
          />
          {average != null && (
            <ReferenceLine
              y={average}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 3"
              label={{
                value: `avg ${average.toFixed(1)}`,
                position: "insideTopRight",
                fontSize: 10,
                fill: "var(--muted-foreground)",
              }}
            />
          )}
          {projection != null && (
            <ReferenceLine
              y={projection}
              stroke="var(--chart-3)"
              strokeDasharray="2 4"
              label={{
                value: `proj ${projection.toFixed(1)}`,
                position: "insideBottomLeft",
                fontSize: 10,
                fill: "var(--chart-3)",
              }}
            />
          )}
          <Bar dataKey="fp" name="Fantasy points" radius={[4, 4, 0, 0]} maxBarSize={18}>
            {points.map((p, i) => (
              <Cell key={i} fill={COLOR[`${fpTone(p.fp, average, p.minutes)}`]} />
            ))}
          </Bar>
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
