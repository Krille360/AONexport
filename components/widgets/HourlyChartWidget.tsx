"use client";

import { useEffect, useState, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import WidgetShell from "./WidgetShell";
import type { HourlyStat } from "@/lib/types";

const REFRESH_MS = parseInt(
  process.env.NEXT_PUBLIC_REFRESH_INTERVAL ?? "30000",
  10
);

type ChartPoint = {
  label: string;
  unika_anvandare: number;
};

function buildChartData(rows: HourlyStat[]): ChartPoint[] {
  // Show only today
  const today = rows
    .filter((r) => {
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return r.dag === today;
    })
    .sort((a, b) => a.timme - b.timme);

  if (today.length > 0) {
    return today.map((r) => ({
      label: `${String(r.timme).padStart(2, "0")}:00`,
      unika_anvandare: r.unika_anvandare,
    }));
  }

  // Fallback: last 24h points from latest day
  return rows.slice(-24).map((r) => ({
    label: `${r.dag} ${String(r.timme).padStart(2, "0")}:00`,
    unika_anvandare: r.unika_anvandare,
  }));
}

export default function HourlyChartWidget() {
  const [data, setData]     = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/hourly-stats", { cache: "no-store" });
      if (!res.ok) throw new Error("Kunde inte hämta data");
      const rows: HourlyStat[] = await res.json();
      setData(buildChartData(rows));
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

  return (
    <WidgetShell
      title="Unika aktiva per timme (idag)"
      loading={loading}
      error={error}
      onRefresh={fetch_}
    >
      {data.length === 0 ? (
        <div className="flex items-center justify-center h-full text-gray-600 text-sm">
          Ingen data for idag
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <defs>
              <linearGradient id="gradUsers" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="label"
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                background: "#1f2937",
                border: "1px solid #374151",
                borderRadius: 8,
                color: "#f3f4f6",
                fontSize: 12,
              }}
              labelStyle={{ color: "#9ca3af" }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, color: "#9ca3af", paddingTop: 4 }}
            />
            <Area
              type="monotone"
              dataKey="unika_anvandare"
              name="Unika anvandare"
              stroke="#6366f1"
              strokeWidth={2}
              fill="url(#gradUsers)"
              dot={false}
              activeDot={{ r: 4, fill: "#6366f1" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </WidgetShell>
  );
}
