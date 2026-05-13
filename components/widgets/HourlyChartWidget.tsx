"use client";

import { useEffect, useState, useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import WidgetShell from "./WidgetShell";
import TimeRangeSelector, { getPresetDates, toLocalSQL, type RangePreset } from "./TimeRangeSelector";

const REFRESH_MS = parseInt(
  process.env.NEXT_PUBLIC_REFRESH_INTERVAL ?? "30000",
  10
);

interface Point {
  bucket:          string;
  unika_anvandare: number;
}

function fmtLabel(bucket: string): string {
  const [date, time] = bucket.split(" ");
  if (!time || time === "00:00:00") return date.substring(5); // MM-DD
  return time.substring(0, 5); // HH:MM
}

export default function HourlyChartWidget() {
  const [data, setData]       = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [range, setRange]     = useState<[string, string] | null>(null);
  const [preset, setPreset]   = useState<RangePreset>("1h");

  const load = useCallback(async (from: string, to: string) => {
    try {
      setError(null);
      setLoading(true);
      const res = await fetch(
        `/api/users-timeseries?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error("Kunde inte hämta data");
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Okänt fel");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRangeChange = useCallback((from: string, to: string, p: RangePreset) => {
    setPreset(p);
    setRange([from, to]);
    load(from, to);
  }, [load]);

  useEffect(() => {
    if (!range) return;
    const t = setInterval(() => {
      if (preset === "custom") {
        load(range[0], range[1]);
      } else {
        const [f, to] = getPresetDates(preset);
        const from = toLocalSQL(f);
        const toStr = toLocalSQL(to);
        setRange([from, toStr]);
        load(from, toStr);
      }
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [range, preset, load]);

  return (
    <WidgetShell
      title="Unika aktiva användare"
      loading={loading}
      error={error}
      onRefresh={range ? () => load(range[0], range[1]) : undefined}
    >
      <div className="flex flex-col h-full gap-2">
        <TimeRangeSelector onRangeChange={handleRangeChange} />

        {data.length === 0 && !loading ? (
          <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
            Ingen data för valt intervall
          </div>
        ) : (
          <div className="flex-1 min-h-0">
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
                  dataKey="bucket"
                  tickFormatter={fmtLabel}
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "#1f2937", border: "1px solid #374151",
                    borderRadius: 8, color: "#f3f4f6", fontSize: 12,
                  }}
                  labelStyle={{ color: "#9ca3af" }}
                  labelFormatter={(v) => String(v).substring(0, 16)}
                  formatter={(v: unknown) => [String(v ?? ""), "Unika användare"]}
                />
                <Area
                  type="monotone"
                  dataKey="unika_anvandare"
                  name="Unika användare"
                  stroke="#6366f1"
                  fill="url(#gradUsers)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: "#6366f1" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </WidgetShell>
  );
}
