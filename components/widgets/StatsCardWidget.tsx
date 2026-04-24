"use client";

import { useEffect, useState, useCallback } from "react";
import type { DashboardStats } from "@/lib/types";

const REFRESH_MS = parseInt(
  process.env.NEXT_PUBLIC_REFRESH_INTERVAL ?? "30000",
  10
);

function StatCard({ label, value, color, small }: { label: string; value: string; color: string; small?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={`font-bold ${small ? "text-2xl" : "text-3xl"} ${color}`}>{value}</span>
      <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</span>
    </div>
  );
}

function fmtBits(bps: number): string {
  const g = bps * 8 / 1_000_000_000;
  if (g >= 1)   return g.toFixed(2) + " Gbit/s";
  const m = bps * 8 / 1_000_000;
  if (m >= 1)   return m.toFixed(2) + " Mbit/s";
  return (bps * 8 / 1_000).toFixed(1) + " Kbit/s";
}

function fmtDuration(min: number): { value: string; label: string } {
  if (min >= 60) return { value: (min / 60).toFixed(1) + "h", label: "Snitt-tid" };
  return { value: min.toFixed(0) + " min", label: "Snitt-tid" };
}

export default function StatsCardWidget() {
  const [stats, setStats]             = useState<DashboardStats | null>(null);
  const [loading, setLoading]         = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats", { cache: "no-store" });
      if (!res.ok) throw new Error("fetch failed");
      setStats(await res.json());
      setLastUpdated(new Date());
    } catch {
      // keep last data on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const timer = setInterval(fetchStats, REFRESH_MS);
    return () => clearInterval(timer);
  }, [fetchStats]);

  const duration = stats?.avg_duration_min != null
    ? fmtDuration(stats.avg_duration_min)
    : { value: "–", label: "Snitt-tid" };

  return (
    <div className="flex flex-col h-full bg-gray-900 border border-gray-700 rounded-xl shadow-lg overflow-hidden">
      <div className="drag-handle flex items-center justify-between px-4 py-2.5 bg-gray-800 border-b border-gray-700 cursor-grab active:cursor-grabbing select-none shrink-0">
        <span className="text-sm font-semibold text-gray-200 tracking-wide">Översikt</span>
        <div className="flex items-center gap-2">
          {loading && <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />}
          {lastUpdated && (
            <span className="text-gray-600 text-xs">
              {lastUpdated.toLocaleTimeString("sv-SE")}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 grid grid-cols-3 grid-rows-2 gap-x-4 gap-y-5 p-4">
        <StatCard
          label="Aktiva nu"
          value={stats?.active_users != null ? String(stats.active_users) : "–"}
          color="text-emerald-400"
        />
        <StatCard
          label="Unika idag"
          value={stats?.total_today != null ? String(stats.total_today) : "–"}
          color="text-indigo-400"
        />
        <StatCard
          label={duration.label}
          value={duration.value}
          color="text-amber-400"
        />

        {/* Ned / Upp spans full bottom row */}
        <div className="col-span-3 grid grid-cols-2 gap-4 pt-2 border-t border-gray-800">
          <StatCard
            label="↑ Upp"
            value={stats ? fmtBits(stats.total_bps_in)  : "–"}
            color="text-emerald-400"
            small
          />
          <StatCard
            label="↓ Ned"
            value={stats ? fmtBits(stats.total_bps_out) : "–"}
            color="text-amber-400"
            small
          />
        </div>
      </div>
    </div>
  );
}
