"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import WidgetShell from "./WidgetShell";
import { formatUsername } from "@/lib/types";
import type { ActiveSession } from "@/lib/types";

const REFRESH_MS = parseInt(
  process.env.NEXT_PUBLIC_REFRESH_INTERVAL ?? "30000",
  10
);

const COLORS = [
  "#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe",
  "#818cf8", "#93c5fd", "#67e8f9",
];

export default function TopBandwidthWidget() {
  const [data, setData]       = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/active-sessions", { cache: "no-store" });
      if (!res.ok) throw new Error("Kunde inte hämta data");
      const sessions: ActiveSession[] = await res.json();
      // Sort by total traffic
      setData(
        sessions
          .sort(
            (a, b) =>
              b.total_bytes_in + b.total_bytes_out -
              (a.total_bytes_in + a.total_bytes_out)
          )
          .slice(0, 10)
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Okänt fel");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch_();
    const t = setInterval(fetch_, REFRESH_MS);
    return () => clearInterval(t);
  }, [fetch_]);

  const chartData = data.map((s) => ({
    name: formatUsername(s.username),
    mb_in:  Math.round(s.total_bytes_in  / 1_048_576 * 10) / 10,
    mb_out: Math.round(s.total_bytes_out / 1_048_576 * 10) / 10,
  }));

  return (
    <WidgetShell
      title="Top Total (Aktiva)"
      loading={loading}
      error={error}
      onRefresh={fetch_}
    >
      {chartData.length === 0 ? (
        <div className="flex items-center justify-center h-full text-gray-600 text-sm">
          Inga aktiva sessioner
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fill: "#9ca3af", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              unit=" MB"
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fill: "#e5e7eb", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={160}
            />
            <Tooltip
              contentStyle={{
                background: "#1f2937",
                border: "1px solid #374151",
                borderRadius: 8,
                color: "#f3f4f6",
                fontSize: 12,
              }}
              formatter={(v: unknown, name: unknown) => [
                `${v} MB`,
                name === "mb_in" ? "Upp" : "Ned",
              ]}
            />
            <Bar dataKey="mb_in" name="Upp" stackId="a" fill="#34d399" radius={[0, 0, 0, 0]}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Bar>
            <Bar dataKey="mb_out" name="Ned" stackId="a" fill="#f59e0b" radius={[0, 2, 2, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </WidgetShell>
  );
}
