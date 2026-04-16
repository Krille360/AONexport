"use client";

import { useEffect, useState, useCallback } from "react";
import WidgetShell from "./WidgetShell";
import type { ActiveSession } from "@/lib/types";

const REFRESH_MS = parseInt(
  process.env.NEXT_PUBLIC_REFRESH_INTERVAL ?? "30000",
  10
);

function fmtBytes(b: number): string {
  if (b >= 1_073_741_824) return (b / 1_073_741_824).toFixed(1) + " GB";
  if (b >= 1_048_576)     return (b / 1_048_576).toFixed(1) + " MB";
  if (b >= 1_024)         return (b / 1_024).toFixed(0) + " KB";
  return b + " B";
}

function fmtDuration(min: number | null): string {
  if (min == null) return "–";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}t ${m}m` : `${m}m`;
}

function fmtMbits(bps: number): string {
  const mbits = bps * 8 / 1_000_000;
  if (mbits >= 1) return mbits.toFixed(2) + " Mbit/s";
  return (bps * 8 / 1_000).toFixed(1) + " Kbit/s";
}

function StatusBadge({ state }: { state: string | null }) {
  const map: Record<string, string> = {
    active:   "bg-emerald-500/20 text-emerald-300",
    idle:     "bg-amber-500/20 text-amber-300",
    sleeping: "bg-blue-500/20 text-blue-300",
  };
  const cls = (state && map[state.toLowerCase()]) ?? "bg-gray-700 text-gray-300";
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {state ?? "unknown"}
    </span>
  );
}

type SortCol = "username" | "duration_min" | "total_bytes_in" | "total_bytes_out" | "avg_bps_in" | "avg_bps_out";
type SortKey = { col: SortCol; dir: "desc" | "asc" };

export default function ActiveUsersWidget({
  onTotalsUpdate,
}: {
  onTotalsUpdate?: (inBps: number, outBps: number) => void;
}) {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  // Empty = implicit sort only (largest first). Click = primary key, Shift+click = add secondary key.
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
      const res = await fetch("/api/active-sessions", { cache: "no-store" });
      if (!res.ok) throw new Error("Kunde inte hämta data");
      const data: ActiveSession[] = await res.json();
      setSessions(data);

      if (onTotalsUpdate) {
        const sumIn  = data.reduce((s, r) => s + r.avg_bps_in,  0);
        const sumOut = data.reduce((s, r) => s + r.avg_bps_out, 0);
        onTotalsUpdate(sumIn, sumOut);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Okänt fel");
    } finally {
      setLoading(false);
    }
  }, [onTotalsUpdate]);

  useEffect(() => {
    fetch_();
    const t = setInterval(fetch_, REFRESH_MS);
    return () => clearInterval(t);
  }, [fetch_]);

  const sorted = [...sessions].sort((a, b) => {
    // Apply user-defined sort keys in order
    for (const { col, dir } of sortKeys) {
      let cmp = 0;
      if (col === "username") {
        cmp = a.username.localeCompare(b.username);
      } else {
        const av = (a[col] as number) ?? -1;
        const bv = (b[col] as number) ?? -1;
        cmp = av < bv ? -1 : av > bv ? 1 : 0;
      }
      if (cmp !== 0) return dir === "desc" ? -cmp : cmp;
    }
    // Implicit tiebreakers – always descending: total traffic → duration → speed
    const totalDiff = (b.total_bytes_in + b.total_bytes_out) - (a.total_bytes_in + a.total_bytes_out);
    if (totalDiff !== 0) return totalDiff;
    const durDiff = (b.duration_min ?? -1) - (a.duration_min ?? -1);
    if (durDiff !== 0) return durDiff;
    return (b.avg_bps_in + b.avg_bps_out) - (a.avg_bps_in + a.avg_bps_out);
  });

  const columns: { col: SortCol | null; label: string; align: string }[] = [
    { col: "username",        label: "Användare",   align: "left"  },
    { col: null,              label: "Intern IP",   align: "left"  },
    { col: null,              label: "Extern IP",   align: "left"  },
    { col: "duration_min",    label: "Tid ansl.",   align: "right" },
    { col: "total_bytes_in",  label: "↓ In totalt", align: "right" },
    { col: "total_bytes_out", label: "↑ Ut totalt", align: "right" },
    { col: "avg_bps_in",      label: "↓ Ner",      align: "right" },
    { col: "avg_bps_out",     label: "↑ Upp",      align: "right" },
    { col: null,              label: "Tunnel",      align: "left"  },
    { col: null,              label: "Status",      align: "left"  },
  ];

  return (
    <WidgetShell
      title={`Aktiva sessioner (${sessions.length})`}
      loading={loading}
      error={error}
      onRefresh={fetch_}
    >
      <table className="w-full text-xs text-gray-300 border-collapse">
        <thead>
          <tr className="text-gray-500 uppercase tracking-wider border-b border-gray-700 select-none">
            {columns.map(({ col, label, align }, i) => (
              <th
                key={i}
                className={`pb-2 pr-3 ${align === "right" ? "text-right" : "text-left"} ${col ? "cursor-pointer hover:text-gray-300 transition-colors" : ""}`}
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
          {sorted.length === 0 && !loading ? (
            <tr>
              <td colSpan={10} className="py-6 text-center text-gray-600">
                Inga aktiva sessioner
              </td>
            </tr>
          ) : (
            sorted.map((s, i) => (
              <tr
                key={`${s.username}-${s.client_ip}`}
                className={`border-b border-gray-800 hover:bg-gray-800/50 transition-colors ${
                  i % 2 === 0 ? "" : "bg-gray-800/20"
                }`}
              >
                <td className="py-2 pr-3 font-medium text-white">{s.username}</td>
                <td className="py-2 pr-3 font-mono">{s.client_ip}</td>
                <td className="py-2 pr-3 font-mono text-gray-400">{s.client_external_ip ?? "–"}</td>
                <td className="py-2 pr-3 text-right">{fmtDuration(s.duration_min)}</td>
                <td className="py-2 pr-3 text-right text-emerald-400">{fmtBytes(s.total_bytes_in)}</td>
                <td className="py-2 pr-3 text-right text-amber-400">{fmtBytes(s.total_bytes_out)}</td>
                <td className="py-2 pr-3 text-right text-emerald-300">{fmtMbits(s.avg_bps_in)}</td>
                <td className="py-2 pr-3 text-right text-amber-300">{fmtMbits(s.avg_bps_out)}</td>
                <td className="py-2 pr-3 text-gray-400">{s.tunnel_type ?? "–"}</td>
                <td className="py-2"><StatusBadge state={s.user_activity_state} /></td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </WidgetShell>
  );
}
