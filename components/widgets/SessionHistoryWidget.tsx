"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import WidgetShell from "./WidgetShell";
import { formatUsername } from "@/lib/types";

const REFRESH_MS = parseInt(
  process.env.NEXT_PUBLIC_REFRESH_INTERVAL ?? "30000",
  10
);

interface Session {
  username:           string;
  client_ip:          string;
  client_external_ip: string;
  tunnel_type:        string;
  auth_method:        string;
  connected_since:    string;
  last_seen:          string;
  duration_min:       number | null;
  total_bytes_in:     number;
  total_bytes_out:    number;
}

interface SamplePoint {
  bucket:   string;
  mbps_in:  number;
  mbps_out: number;
}

function fmtBytes(b: number): string {
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`;
  if (b >= 1_048_576)     return `${(b / 1_048_576).toFixed(1)} MB`;
  return `${(b / 1024).toFixed(1)} KB`;
}

function fmtDur(min: number | null): string {
  if (min == null) return "–";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDateTime(iso: string): string {
  // "YYYY-MM-DDTHH:MM:SS" → "YYYY-MM-DD HH:MM"
  return iso.substring(0, 16).replace("T", " ");
}

export default function SessionHistoryWidget() {
  const [sessions, setSessions]           = useState<Session[]>([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [expanded, setExpanded]           = useState<string | null>(null);
  const [samples, setSamples]             = useState<Record<string, SamplePoint[]>>({});
  const [samplesLoading, setSamplesLoading] = useState<Set<string>>(new Set());
  const [samplesError, setSamplesError]   = useState<Record<string, string>>({});
  const [filter, setFilter]               = useState("");

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/session-history", { cache: "no-store" });
      if (!res.ok) throw new Error("Kunde inte hämta data");
      setSessions(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Okänt fel");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const sessionKey = (s: Session) => `${s.client_ip}|${s.connected_since}`;

  const toggleExpand = async (s: Session) => {
    const key = sessionKey(s);
    if (expanded === key) {
      setExpanded(null);
      return;
    }
    setExpanded(key);
    if (samples[key] !== undefined) return; // already loaded

    setSamplesLoading((prev) => new Set(prev).add(key));
    try {
      const res = await fetch(
        `/api/session-samples?client_ip=${encodeURIComponent(s.client_ip)}&connected_since=${encodeURIComponent(s.connected_since)}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error("Kunde inte hämta sampel");
      const data: SamplePoint[] = await res.json();
      setSamples((prev) => ({ ...prev, [key]: data }));
    } catch (e) {
      setSamplesError((prev) => ({
        ...prev,
        [key]: e instanceof Error ? e.message : "Okänt fel",
      }));
      setSamples((prev) => ({ ...prev, [key]: [] }));
    } finally {
      setSamplesLoading((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const filtered = (filter.trim()
    ? sessions.filter((s) => {
        const f = filter.trim().toLowerCase();
        const u = s.username.toLowerCase();
        // Word-boundary matching: start of segment separated by ".", "-" or space
        const matchesUser =
          u.startsWith(f) ||
          u.includes(`.${f}`) ||
          u.includes(`-${f}`) ||
          formatUsername(s.username).toLowerCase().split(" ").some((part) => part.startsWith(f));
        return matchesUser || s.client_ip.includes(f) || s.client_external_ip.toLowerCase().includes(f);
      })
    : [...sessions]
  ).sort((a, b) => (b.last_seen > a.last_seen ? 1 : b.last_seen < a.last_seen ? -1 : 0));

  return (
    <WidgetShell
      title="Historiska sessioner"
      loading={loading}
      error={error}
      onRefresh={load}
    >
      <div className="flex flex-col h-full gap-2">
        {/* Filter */}
        <input
          type="text"
          placeholder="Sök användare / IP…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="shrink-0 bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1 focus:outline-none focus:border-indigo-500 placeholder-gray-600"
        />

        <div className="flex-1 overflow-auto min-h-0">
          <table className="w-full text-xs text-gray-300 border-collapse">
            <thead className="sticky top-0 bg-gray-900 z-10">
              <tr className="text-gray-500 border-b border-gray-700">
                <th className="text-left py-1 px-2 font-semibold">Användare</th>
                <th className="text-left py-1 px-2 font-semibold">IP</th>
                <th className="text-left py-1 px-2 font-semibold">Ansluten</th>
                <th className="text-left py-1 px-2 font-semibold">Frånkopplad</th>
                <th className="text-left py-1 px-2 font-semibold">Varaktighet</th>
                <th className="text-left py-1 px-2 font-semibold">↑ Upp</th>
                <th className="text-left py-1 px-2 font-semibold">↓ Ned</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const key       = sessionKey(s);
                const isExp     = expanded === key;
                const pts       = samples[key] ?? [];
                const isLoading = samplesLoading.has(key);
                const err       = samplesError[key];

                return (
                  <React.Fragment key={key}>
                    <tr
                      onClick={() => toggleExpand(s)}
                      className={`border-b border-gray-800 cursor-pointer transition-colors ${
                        isExp
                          ? "bg-indigo-900/20"
                          : "hover:bg-gray-800/50"
                      }`}
                    >
                      <td className="py-1 px-2 max-w-[140px] truncate" title={s.username}>{formatUsername(s.username)}</td>
                      <td className="py-1 px-2 font-mono">{s.client_ip}</td>
                      <td className="py-1 px-2">{fmtDateTime(s.connected_since)}</td>
                      <td className="py-1 px-2">{fmtDateTime(s.last_seen)}</td>
                      <td className="py-1 px-2">{fmtDur(s.duration_min)}</td>
                      <td className="py-1 px-2 text-emerald-400">{fmtBytes(s.total_bytes_in)}</td>
                      <td className="py-1 px-2 text-amber-400">{fmtBytes(s.total_bytes_out)}</td>
                    </tr>

                    {isExp && (
                      <tr>
                        <td colSpan={7} className="bg-gray-800/60 px-3 py-3">
                          {isLoading ? (
                            <div className="flex items-center justify-center h-32 text-gray-500 text-xs">
                              Laddar…
                            </div>
                          ) : err ? (
                            <div className="flex items-center justify-center h-32 text-red-400 text-xs">
                              {err}
                            </div>
                          ) : pts.length === 0 ? (
                            <div className="flex items-center justify-center h-32 text-gray-600 text-xs">
                              Inga sampel sparade för sessionen
                            </div>
                          ) : (
                            <SessionChart data={pts} />
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>

          {filtered.length === 0 && !loading && (
            <div className="flex items-center justify-center h-20 text-gray-600 text-xs">
              Inga avslutade sessioner hittades
            </div>
          )}
        </div>
      </div>
    </WidgetShell>
  );
}

// ─── Inline session chart ─────────────────────────────────────────────────────

interface SessionChartProps {
  data: SamplePoint[];
}

function calcStats(pts: SamplePoint[], key: "mbps_in" | "mbps_out") {
  const vals = pts.map((p) => p[key]);
  const avg  = vals.reduce((a, b) => a + b, 0) / vals.length;
  const max  = Math.max(...vals);
  const min  = Math.min(...vals);
  return { avg, max, min };
}

function SessionChart({ data }: SessionChartProps) {
  const inStats  = calcStats(data, "mbps_in");
  const outStats = calcStats(data, "mbps_out");

  return (
    <div className="flex flex-col gap-2">
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="bucket"
              tickFormatter={(v) => String(v).substring(11, 16)}
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
              width={55}
            />
            <Tooltip
              contentStyle={{
                background: "#1f2937", border: "1px solid #374151",
                borderRadius: 8, color: "#f3f4f6", fontSize: 11,
              }}
              labelFormatter={(v) => String(v).substring(0, 19)}
              formatter={(v: number, name: string) => [
                `${Number(v).toFixed(3)} Mbit/s`,
                name === "mbps_in" ? "↑ Upp" : "↓ Ned",
              ]}
            />
            <Line
              type="monotone" dataKey="mbps_in"
              stroke="#34d399" strokeWidth={2} dot={false}
            />
            <Line
              type="monotone" dataKey="mbps_out"
              stroke="#f59e0b" strokeWidth={2} dot={false}
              strokeDasharray="4 2"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Stats row */}
      <div className="flex gap-6 text-xs text-gray-400 border-t border-gray-700/50 pt-2">
        <div className="flex items-center gap-3">
          <span className="text-emerald-400 font-semibold">↑ Upp</span>
          <span>Avg: <strong className="text-gray-200">{inStats.avg.toFixed(2)}</strong></span>
          <span>Max: <strong className="text-gray-200">{inStats.max.toFixed(2)}</strong></span>
          <span>Min: <strong className="text-gray-200">{inStats.min.toFixed(2)}</strong></span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-amber-400 font-semibold">↓ Ned</span>
          <span>Avg: <strong className="text-gray-200">{outStats.avg.toFixed(2)}</strong></span>
          <span>Max: <strong className="text-gray-200">{outStats.max.toFixed(2)}</strong></span>
          <span>Min: <strong className="text-gray-200">{outStats.min.toFixed(2)}</strong></span>
        </div>
      </div>
    </div>
  );
}
