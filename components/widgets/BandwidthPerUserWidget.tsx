"use client";

import { useEffect, useState, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import WidgetShell from "./WidgetShell";
import { formatUsername } from "@/lib/types";
import TimeRangeSelector, { getPresetDates, toLocalSQL, type RangePreset } from "./TimeRangeSelector";

const REFRESH_MS = parseInt(
  process.env.NEXT_PUBLIC_REFRESH_INTERVAL ?? "30000",
  10
);

interface RawRow {
  username: string;
  bucket:   string;
  mbps_in:  number;
  mbps_out: number;
}

interface ChartPoint {
  bucket: string;
  [key: string]: string | number;
}

// 10 hue pairs: [download color, upload color]
// Each pair uses clearly distinct but related shades
const USER_COLORS: [string, string][] = [
  ["#34d399", "#059669"], // emerald light / dark
  ["#60a5fa", "#1d4ed8"], // blue light / dark
  ["#f472b6", "#be185d"], // pink light / dark
  ["#fb923c", "#c2410c"], // orange light / dark
  ["#a78bfa", "#6d28d9"], // violet light / dark
  ["#f9a8d4", "#db2777"], // rose light / dark
  ["#4ade80", "#15803d"], // green light / dark
  ["#facc15", "#a16207"], // yellow light / dark
  ["#38bdf8", "#0369a1"], // sky light / dark
  ["#e879f9", "#86198f"], // fuchsia light / dark
];

function fmtLabel(bucket: string): string {
  const [date, time] = bucket.split(" ");
  if (!time || time === "00:00:00") return date.substring(5);
  return time.substring(0, 5);
}

function shortUser(u: string): string {
  return formatUsername(u);
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────
interface TooltipPayloadItem {
  name:  string;
  value: number;
  color?: string;
}
interface CustomTooltipProps {
  active?:  boolean;
  payload?: TooltipPayloadItem[];
  label?:   string;
  users:    string[];
  userColors: [string, string][];
  hidden:   Set<string>;
}

function CustomTooltip({ active, payload, label, users, userColors, hidden }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;

  // Build a map of all values at this data point
  const valMap: Record<string, number> = {};
  for (const p of payload) valMap[p.name] = p.value;

  // Only show users that are visible and have non-zero activity at this bucket
  const visibleUsers = users.filter(
    (u) => !hidden.has(u) && ((valMap[`${u}_in`] ?? 0) > 0 || (valMap[`${u}_out`] ?? 0) > 0)
  );

  if (visibleUsers.length === 0) return null;

  return (
    <div
      style={{
        background: "#1f2937",
        border: "1px solid #374151",
        borderRadius: 8,
        fontSize: 11,
        color: "#f3f4f6",
        padding: "8px 10px",
        maxHeight: 280,
        overflowY: "auto",
        minWidth: 200,
      }}
    >
      <div style={{ color: "#9ca3af", marginBottom: 6, fontWeight: 600 }}>
        {String(label).substring(0, 16)}
      </div>
      {visibleUsers.map((u, i) => {
        const idx = users.indexOf(u);
        const [colorIn, colorOut] = userColors[idx % userColors.length];
        const mbIn  = (valMap[`${u}_in`]  ?? 0).toFixed(3);
        const mbOut = (valMap[`${u}_out`] ?? 0).toFixed(3);
        return (
          <div key={u} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0",
            borderTop: i > 0 ? "1px solid #374151" : undefined }}>
            <span style={{ fontWeight: 600, flex: "0 0 auto", maxWidth: 130,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {shortUser(u)}
            </span>
            <span style={{ color: colorIn,  flex: 1, textAlign: "right" }}>↑ {mbIn}</span>
            <span style={{ color: colorOut, flex: 1, textAlign: "right" }}>↓ {mbOut}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function BandwidthPerUserWidget() {
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [users, setUsers]         = useState<string[]>([]);
  const [hidden, setHidden]       = useState<Set<string>>(new Set());
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [range, setRange]         = useState<[string, string] | null>(null);
  const [preset, setPreset]       = useState<RangePreset>("1h");

  const load = useCallback(async (from: string, to: string) => {
    try {
      setError(null);
      setLoading(true);
      const res = await fetch(
        `/api/bandwidth-per-user?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error("Kunde inte hämta data");
      const rows: RawRow[] = await res.json();

      // Collect unique users in order of appearance (already top-10 from API)
      const userList = Array.from(new Set(rows.map((r) => r.username)));
      setUsers(userList);

      // Pivot: one row per bucket, keys = username_in / username_out
      const map = new Map<string, ChartPoint>();
      for (const r of rows) {
        if (!map.has(r.bucket)) map.set(r.bucket, { bucket: r.bucket });
        const pt = map.get(r.bucket)!;
        pt[`${r.username}_in`]  = r.mbps_in;
        pt[`${r.username}_out`] = r.mbps_out;
      }
      // Fill missing user keys with 0 so disconnected users drop to 0 instead of gapping
      for (const pt of map.values()) {
        for (const u of userList) {
          if (pt[`${u}_in`]  === undefined) pt[`${u}_in`]  = 0;
          if (pt[`${u}_out`] === undefined) pt[`${u}_out`] = 0;
        }
      }
      setChartData(Array.from(map.values()).sort((a, b) =>
        String(a.bucket) < String(b.bucket) ? -1 : 1
      ));
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

  const toggleUser = (u: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(u) ? next.delete(u) : next.add(u);
      return next;
    });
  };

  return (
    <WidgetShell
      title="Bandbredd per användare (Top 10)"
      loading={loading}
      error={error}
      onRefresh={range ? () => load(range[0], range[1]) : undefined}
    >
      <div className="flex flex-col h-full gap-2">
        <TimeRangeSelector onRangeChange={handleRangeChange} />

        {chartData.length === 0 && !loading ? (
          <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
            Ingen data för valt intervall
          </div>
        ) : (
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -4 }}>
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
                  content={
                    <CustomTooltip
                      users={users}
                      userColors={USER_COLORS}
                      hidden={hidden}
                    />
                  }
                />
                {/* No built-in Legend – we use custom user toggles below */}
                {users.map((u, idx) => {
                  const [colorIn, colorOut] = USER_COLORS[idx % USER_COLORS.length];
                  const isHidden = hidden.has(u);
                  return [
                    <Line
                      key={`${u}_in`}
                      type="monotone"
                      dataKey={`${u}_in`}
                      stroke={colorIn}
                      strokeWidth={1.5}
                      dot={false}
                      hide={isHidden}
                      isAnimationActive={false}
                      name={`${u}_in`}
                    />,
                    <Line
                      key={`${u}_out`}
                      type="monotone"
                      dataKey={`${u}_out`}
                      stroke={colorOut}
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                      dot={false}
                      hide={isHidden}
                      isAnimationActive={false}
                      name={`${u}_out`}
                    />,
                  ];
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* User toggles */}
        {users.length > 0 && (
          <div className="flex flex-wrap gap-1.5 shrink-0 pt-1 border-t border-gray-800">
            {users.map((u, idx) => {
              const [colorIn, colorOut] = USER_COLORS[idx % USER_COLORS.length];
              const isHidden = hidden.has(u);
              return (
                <button
                  key={u}
                  onClick={() => toggleUser(u)}
                  title={u}
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium transition-all ${
                    isHidden
                      ? "opacity-35 bg-gray-800 text-gray-500"
                      : "bg-gray-800/60 text-gray-200 hover:bg-gray-700"
                  }`}
                >
                  {/* two colour dots */}
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: colorIn }}
                  />
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: colorOut }}
                  />
                  {shortUser(u)}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </WidgetShell>
  );
}
