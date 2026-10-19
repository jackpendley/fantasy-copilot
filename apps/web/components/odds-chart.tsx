"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface OddsPoint {
  at: string;
  playoffs: number;
  seed1: number;
  champ: number;
}

// The theme's chart tokens are greys; these three stay distinguishable in light and dark mode.
const SERIES = [
  { key: "playoffs", label: "Playoffs", color: "#2563eb" },
  { key: "seed1", label: "#1 seed", color: "#d97706" },
  { key: "champ", label: "Title", color: "#16a34a" },
] as const;

const day = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function OddsChart({ points }: { points: OddsPoint[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="at" tickFormatter={day} fontSize={11} />
          <YAxis domain={[0, 1]} tickFormatter={pct} fontSize={11} />
          <Tooltip
            labelFormatter={(v) => day(String(v))}
            formatter={(v, name) => [pct(Number(v)), String(name)]}
          />
          <Legend />
          {SERIES.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={points.length < 20}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
