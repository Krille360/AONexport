"use client";

import { useEffect, useState, useCallback } from "react";
import WidgetShell from "./WidgetShell";
import type { DailySummary } from "@/lib/types";

const REFRESH_MS = parseInt(
  process.env.NEXT_PUBLIC_REFRESH_INTERVAL ?? "30000",
  10
);

/** Returns HH:MM. If iso is from a different day than dayFilter, prepends the date (MM-DD HH:MM). */
function fmtFirstTime(iso: string | null, dayFilter: string): string {
  if (!iso) return "–";
  const datepart = iso.slice(0, 10);
  const time = new Date(iso).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  if (datepart !== dayFilter) return `${datepart.slice(5)} ${time}`; // MM-DD HH:MM
  return time;
}

/** Returns HH:MM only if the date matches dayFilter, otherwise "–". */
function fmtLastTime(iso: string | null, dayFilter: string): string {
  if (!iso) return "–";
  if (iso.slice(0, 10) !== dayFilter) return "–";
  return new Date(iso).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
}

type SortCol = "username" | "forsta_anslutning" | "senaste_aktivitet" | "max_duration_min" | "max_mb_in" | "max_mb_out";
type SortKey = { col: SortCol; dir: "desc" | "asc" };

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
  // Empty = implicit sort only. Click = primary key, Shift+click = add secondary key.
  const [sortKeys, setSortKeys] = useState<SortKey[]>([]);

  const handleSort = (col: SortCol, e: React.MouseEvent) => {
    if (e.shiftKey) {
      setSortKeys((prev) => {
        const idx = prev.findIndex((k) => k.col === col);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { col, dir: prev[idx].dir === "desc" ? "asc" : "desc" };
          return next;
        }
        return [...prev, { col, dir: "desc" }];
      });
    } else {
      setSortKeys((prev) => {
        const existing = prev.find((k) => k.col === col);
        if (existing && prev.length === 1) {
          return [{ col, dir: existing.dir === "desc" ? "asc" : "desc" }];
        }
        return [{ col, dir: "desc" }];
      });
    }
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
  // Only show rows where senaste_aktivitet falls on the selected day
  const base = rows.filter((r) => {
    if (dayFilter && r.dag !== dayFilter) return false;
    if (dayFilter && r.senaste_aktivitet?.slice(0, 10) !== dayFilter) return false;
    return true;
  });

  const sorted = [...base].sort((a, b) => {
    for (const { col, dir } of sortKeys) {
      let cmp = 0;
      if (col === "username") {
        cmp = a.username.localeCompare(b.username);
      } else if (col === "forsta_anslutning" || col === "senaste_aktivitet") {
        const av = a[col] ?? "";
        const bv = b[col] ?? "";
        cmp = av < bv ? -1 : av > bv ? 1 : 0;
      } else {
        const av = (a[col] as number | null) ?? -1;
        const bv = (b[col] as number | null) ?? -1;
        cmp = av < bv ? -1 : av > bv ? 1 : 0;
      }
      if (cmp !== 0) return dir === "desc" ? -cmp : cmp;
    }
    // Implicit tiebreakers – always descending: newest last-seen → total data → duration
    const senA = a.senaste_aktivitet ?? "";
    const senB = b.senaste_aktivitet ?? "";
    if (senB > senA) return 1;
    if (senB < senA) return -1;
    const totalDiff = ((b.max_mb_in ?? 0) + (b.max_mb_out ?? 0)) - ((a.max_mb_in ?? 0) + (a.max_mb_out ?? 0));
    if (totalDiff !== 0) return totalDiff;
    return (b.max_duration_min ?? -1) - (a.max_duration_min ?? -1);
  });

  type ColDef = { col: SortCol | null; label: string; align: "left" | "right" };
  const columns: ColDef[] = [
    { col: "username",           label: "Användare", align: "left"  },
    { col: "forsta_anslutning",  label: "Första",    align: "right" },
    { col: "senaste_aktivitet",  label: "Senaste",   align: "right" },
    { col: "max_duration_min",   label: "Max tid",   align: "right" },
    { col: "max_mb_in",          label: "↓ In",      align: "right" },
    { col: "max_mb_out",         label: "↑ Ut",      align: "right" },
    { col: null,                 label: "Tunnel",    align: "left"  },
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
                    className={`pb-2 pr-3 text-left ${col ? "cursor-pointer hover:text-gray-300 transition-colors" : ""}`}
                    onClick={col ? (e) => handleSort(col, e) : undefined}
                  >
                    {label}
                    {col && (() => {
                      const idx = sortKeys.findIndex((k) => k.col === col);
                      if (idx < 0) return null;
                      return (
                        <span className="ml-1 text-indigo-400">
                          {sortKeys[idx].dir === "desc" ? "↓" : "↑"}
                          {sortKeys.length > 1 && <sup className="text-[9px]">{idx + 1}</sup>}
                        </span>
                      );
                    })()}
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
                    <td className="py-1.5 pr-3 font-mono text-gray-400">
                      {fmtFirstTime(r.forsta_anslutning, dayFilter)}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-gray-400">
                      {fmtLastTime(r.senaste_aktivitet, dayFilter)}
                    </td>
                    <td className="py-1.5 pr-3">
                      {r.max_duration_min != null
                        ? `${Math.floor(r.max_duration_min / 60)}t ${Math.round(r.max_duration_min % 60)}m`
                        : "–"}
                    </td>
                    <td className="py-1.5 pr-3 text-emerald-400">
                      {fmtMb(r.max_mb_in)}
                    </td>
                    <td className="py-1.5 pr-3 text-amber-400">
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
