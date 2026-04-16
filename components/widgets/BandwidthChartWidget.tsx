"use client";

import { useEffect, useState, useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import WidgetShell from "./WidgetShell";
import TimeRangeSelector, { getPresetDates, toLocalSQL, type RangePreset } from "./TimeRangeSelector";

const REFRESH_MS = parseInt(
  process.env.NEXT_PUBLIC_REFRESH_INTERVAL ?? "30000",
  10
);

interface Point {
  bucket:   string;
  mbps_in:  number;
  mbps_out: number;
}

/** Format bucket label for X-axis: hide date when it's the same throughout */
function fmtLabel(bucket: string): string {
  // bucket: "YYYY-MM-DD HH:MM:00" | "YYYY-MM-DD HH:00:00" | "YYYY-MM-DD 00:00:00"
  const [date, time] = bucket.split(" ");
  if (!time || time === "00:00:00") return date.substring(5); // MM-DD
  return time.substring(0, 5); // HH:MM
}

export default function BandwidthChartWidget() {
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
        `/api/bandwidth-timeseries?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
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

  // Auto-refresh: recompute rolling window for non-custom presets
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
      title="Bandbredd Mbit/s"
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
          <>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -4 }}>
                <defs>
                  <linearGradient id="bwGradIn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#34d399" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#34d399" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="bwGradOut" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="bucket"
                  tickFormatter={fmtLabel}
                  tick={{ fill: "#9ca3af", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: "#9ca3af", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  unit=" Mb"
                  width={60}
                />
                <Tooltip
                  contentStyle={{
                    background: "#1f2937", border: "1px solid #374151",
                    borderRadius: 8, color: "#f3f4f6", fontSize: 12,
                  }}
                  labelStyle={{ color: "#9ca3af" }}
                  labelFormatter={(v) => String(v).substring(0, 16)}
                  formatter={(v: number, name: string) => [
                    `${v.toFixed(3)} Mbit/s`,
                    name === "mbps_in" ? "↓ Ned" : "↑ Upp",
                  ]}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, color: "#9ca3af", paddingTop: 4 }}
                  formatter={(v) => v === "mbps_in" ? "↓ Ned" : "↑ Upp"}
                />
                <Area
                  type="monotone" dataKey="mbps_in"
                  stroke="#34d399" fill="url(#bwGradIn)"
                  strokeWidth={1.5} dot={false}
                />
                <Area
                  type="monotone" dataKey="mbps_out"
                  stroke="#f59e0b" fill="url(#bwGradOut)"
                  strokeWidth={1.5} dot={false}
                />
              </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Stats */}
            {data.length > 0 && (() => {
              const inVals  = data.map((d) => d.mbps_in);
              const outVals = data.map((d) => d.mbps_out);
              const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
              return (
                <div className="flex flex-wrap gap-6 shrink-0 text-xs text-gray-400 border-t border-gray-700 pt-2">
                  <div className="flex items-center gap-3">
                    <span className="text-emerald-400 font-semibold">↓ Ned</span>
                    <span>Avg: <strong className="text-gray-200">{avg(inVals).toFixed(2)}</strong></span>
                    <span>Max: <strong className="text-gray-200">{Math.max(...inVals).toFixed(2)}</strong></span>
                    <span>Min: <strong className="text-gray-200">{Math.min(...inVals).toFixed(2)}</strong></span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-amber-400 font-semibold">↑ Upp</span>
                    <span>Avg: <strong className="text-gray-200">{avg(outVals).toFixed(2)}</strong></span>
                    <span>Max: <strong className="text-gray-200">{Math.max(...outVals).toFixed(2)}</strong></span>
                    <span>Min: <strong className="text-gray-200">{Math.min(...outVals).toFixed(2)}</strong></span>
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>
    </WidgetShell>
  );
}
