"use client";

import { useEffect, useState, useCallback } from "react";
import WidgetShell from "./WidgetShell";
import { formatUsername } from "@/lib/types";
import type { Anomaly, AnomalyType } from "@/app/api/anomalies/route";

const REFRESH_MS = parseInt(
  process.env.NEXT_PUBLIC_REFRESH_INTERVAL ?? "30000",
  10
);

const TYPE_LABEL: Record<AnomalyType, string> = {
  long_session:     "Lång session",
  high_data:        "Hög datamängd",
  high_rate:        "Hög bandbredd",
  rapid_reconnect:  "Återanslutningar",
};

const TYPE_ICON: Record<AnomalyType, string> = {
  long_session:     "⏱",
  high_data:        "📦",
  high_rate:        "⚡",
  rapid_reconnect:  "🔄",
};

export default function AnomaliesWidget() {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/anomalies", { cache: "no-store" });
      if (!res.ok) throw new Error("Kunde inte hämta data");
      setAnomalies(await res.json());
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

  const critCount = anomalies.filter((a) => a.severity === "critical").length;
  const warnCount = anomalies.filter((a) => a.severity === "warning").length;

  const titleSuffix = anomalies.length === 0
    ? ""
    : ` (${critCount > 0 ? `${critCount} kritiska` : ""}${critCount > 0 && warnCount > 0 ? ", " : ""}${warnCount > 0 ? `${warnCount} varningar` : ""})`;

  return (
    <WidgetShell
      title={`Anomalier${titleSuffix}`}
      loading={loading}
      error={error}
      onRefresh={fetch_}
    >
      {anomalies.length === 0 && !loading ? (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-emerald-500">
          <span className="text-2xl">✓</span>
          <span className="text-sm font-medium">Inga larm aktiva</span>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 overflow-auto h-full">
          {anomalies.map((a, i) => (
            <div
              key={i}
              className={`flex items-start gap-3 px-3 py-2 rounded-lg border ${
                a.severity === "critical"
                  ? "bg-red-500/10 border-red-500/30"
                  : "bg-amber-500/10 border-amber-500/30"
              }`}
            >
              {/* Severity bar */}
              <div className={`w-1 self-stretch rounded-full shrink-0 ${
                a.severity === "critical" ? "bg-red-500" : "bg-amber-400"
              }`} />

              {/* Icon + type */}
              <div className="shrink-0 text-base leading-none mt-0.5">
                {TYPE_ICON[a.type]}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-white truncate" title={a.username}>
                    {formatUsername(a.username)}
                  </span>
                  <span className={`text-xs font-mono shrink-0 ${
                    a.severity === "critical" ? "text-red-400" : "text-amber-400"
                  }`}>
                    {a.value}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {TYPE_LABEL[a.type]} — {a.detail}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}
