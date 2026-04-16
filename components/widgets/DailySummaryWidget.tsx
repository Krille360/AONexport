"use client";

import { useEffect, useState, useCallback } from "react";
import WidgetShell from "./WidgetShell";
import type { DailySummary } from "@/lib/types";

const REFRESH_MS = parseInt(
  process.env.NEXT_PUBLIC_REFRESH_INTERVAL ?? "30000",
  10
);

/** Returns HH:MM only if the ISO timestamp's date portion matches dayFilter (YYYY-MM-DD). */
function fmtTime(iso: string | null, dayFilter: string): string {
  if (!iso) return "–";
  // The date part is the first 10 chars of the ISO string (YYYY-MM-DD).
  // We compare this to the selected day so we never show a time from a different day.
  const datepart = iso.slice(0, 10);
  if (datepart !== dayFilter) return "–";
  return new Date(iso).toLocaleTimeString("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

type SortCol = "username" | "forsta_anslutning" | "senaste_aktivitet" | "max_duration_min" | "max_mb_in" | "max_mb_out";
type SortDir = "desc" | "asc";

function fmtMb(mb: number | null): string {
  if (mb == null) return "–";
  if (mb >= 1_048_576)  return (mb / 1_048_576).toFixed(2)  + " TB";
  if (mb >= 1_024)      return (mb / 1_024).toFixed(2)      + " GB";
  if (mb >= 1)          return mb.toFixed(1)                 + " MB";
  return (mb * 1_024).toFixed(1) + " KB";
}

export default function DailySummaryWidget() {
  const [rows, setRows]     = useState<DailySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState<string>("");
  const [sortCol, setSortCol] = useState<SortCol>("max_mb_in");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = (col: SortCol) => {
    setSortDir((d) => (sortCol === col ? (d === "desc" ? "asc" : "desc") : "desc"));
    setSortCol(col);
  };

  const fetch_ = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/daily-summary", { cache: "no-store" });
      if (!res.ok) throw new Error("Kunde inte hämta data");
      const data: DailySummary[] = await res.json();
      setRows(data);
      // Default to latest day
      if (data.length > 0 && !dayFilter) {
        setDayFilter(data[0].dag);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Okänt fel");
    } finally {
      setLoading(false);
    }
  }, [dayFilter]);

  useEffect(() => {
    fetch_();
    const t = setInterval(fetch_, REFRESH_MS);
    return () => clearInterval(t);
  }, [fetch_]);

  const days = Array.from(new Set(rows.map((r) => r.dag))).sort().reverse();
  const base = dayFilter ? rows.filter((r) => r.dag === dayFilter) : rows;

  const sorted = [...base].sort((a, b) => {
    if (sortCol === "username") {
      const cmp = a.username.localeCompare(b.username);
      return sortDir === "asc" ? cmp : -cmp;
    }
    if (sortCol === "forsta_anslutning" || sortCol === "senaste_aktivitet") {
      const av = a[sortCol] ?? "";
      const bv = b[sortCol] ?? "";
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    }
    const av = (a[sortCol] as number | null) ?? -1;
    const bv = (b[sortCol] as number | null) ?? -1;
    return sortDir === "desc" ? bv - av : av - bv;
  });

  type ColDef = { col: SortCol | null; label: string };
  const columns: ColDef[] = [
    { col: "username",           label: "Användare" },
    { col: "forsta_anslutning",  label: "Första"    },
    { col: "senaste_aktivitet",  label: "Senaste"   },
    { col: "max_duration_min",   label: "Max tid"   },
    { col: "max_mb_in",          label: "↓ In"      },
    { col: "max_mb_out",         label: "↑ Ut"      },
    { col: null,                 label: "Tunnel"    },
  ];

  return (
    <WidgetShell
      title="Daglig sammanfattning"
      loading={loading}
      error={error}
      onRefresh={fetch_}
    >
      <div className="flex flex-col h-full gap-2">
        {/* Day selector */}
        <div className="flex items-center gap-2 shrink-0">
          <label className="text-xs text-gray-500">Dag:</label>
          <select
            value={dayFilter}
            onChange={(e) => setDayFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-2 py-1 focus:outline-none"
          >
            {days.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-600">
            ({sorted.length} anvandare)
          </span>
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs text-gray-300 border-collapse">
            <thead>
              <tr className="text-gray-500 uppercase tracking-wider border-b border-gray-700 sticky top-0 bg-gray-900 select-none">
                {columns.map(({ col, label }, i) => (
                  <th
                    key={i}
                    className={`text-left pb-2 pr-3 ${col ? "cursor-pointer hover:text-gray-300 transition-colors" : ""}`}
                    onClick={col ? () => handleSort(col) : undefined}
                  >
                    {label}
                    {col && sortCol === col && (
                      <span className="ml-1 text-indigo-400">{sortDir === "desc" ? "↓" : "↑"}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-gray-600">
                    Ingen data
                  </td>
                </tr>
              ) : (
                sorted.map((r, i) => (
                  <tr
                    key={`${r.dag}-${r.username}`}
                    className={`border-b border-gray-800 hover:bg-gray-800/50 transition-colors ${
                      i % 2 === 0 ? "" : "bg-gray-800/20"
                    }`}
                  >
                    <td className="py-1.5 pr-3 font-medium text-white">
                      {r.username}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono text-gray-400">
                      {fmtTime(r.forsta_anslutning, dayFilter)}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono text-gray-400">
                      {fmtTime(r.senaste_aktivitet, dayFilter)}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      {r.max_duration_min != null
                        ? `${Math.floor(r.max_duration_min / 60)}t ${Math.round(r.max_duration_min % 60)}m`
                        : "–"}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-emerald-400">
                      {fmtMb(r.max_mb_in)}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-amber-400">
                      {fmtMb(r.max_mb_out)}
                    </td>
                    <td className="py-1.5 text-gray-400">
                      {r.tunnel_type ?? "–"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </WidgetShell>
  );
}
