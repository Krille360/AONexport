import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { withCache } from "@/lib/cache";

const CACHE_TTL = 25_000;

export const dynamic = "force-dynamic";

export type AnomalySeverity = "warning" | "critical";
export type AnomalyType     = "long_session" | "high_data" | "high_rate";

export interface Anomaly {
  type:     AnomalyType;
  severity: AnomalySeverity;
  username: string;
  value:    string;
  detail:   string;
}

// Tröskelvärden
const THRESHOLDS = {
  session_warn_h:    8,    // timmar
  session_crit_h:   24,
  data_warn_gb:      5,    // GB totalt (in+out) per aktiv session
  data_crit_gb:     20,
  daily_warn_gb:    10,    // GB totalt i daglig sammanfattning
  daily_crit_gb:    50,
  rate_warn_mbps:   50,    // Mbit/s genomsnitt
  rate_crit_mbps:  200,
};

function fmtBytes(bytes: number): string {
  const gb = bytes / 1_073_741_824;
  if (gb >= 1) return gb.toFixed(2) + " GB";
  return (bytes / 1_048_576).toFixed(0) + " MB";
}

function fmtMbits(bps: number): string {
  return (bps * 8 / 1_000_000).toFixed(1) + " Mbit/s";
}

export async function GET() {
  try {
    const anomalies = await withCache("anomalies", CACHE_TTL, async () => {
    const [activeSessions, dailySummary] = await Promise.all([
      query<{
        username: string;
        duration_min: number | null;
        total_bytes_in: number;
        total_bytes_out: number;
        avg_bps_in: number;
        avg_bps_out: number;
      }>(`
        WITH ranked AS (
          SELECT ss.client_ip, ss.connected_since, ss.sampled_at, ss.bytes_in, ss.bytes_out,
            LAG(ss.bytes_in)   OVER (PARTITION BY ss.client_ip, ss.connected_since ORDER BY ss.sampled_at) AS prev_bytes_in,
            LAG(ss.bytes_out)  OVER (PARTITION BY ss.client_ip, ss.connected_since ORDER BY ss.sampled_at) AS prev_bytes_out,
            LAG(ss.sampled_at) OVER (PARTITION BY ss.client_ip, ss.connected_since ORDER BY ss.sampled_at) AS prev_sampled_at
          FROM vpn_session_samples ss
          INNER JOIN vpn_active_sessions act
            ON act.client_ip = ss.client_ip AND act.connected_since = ss.connected_since
        ),
        rates AS (
          SELECT client_ip, connected_since,
            AVG(CASE WHEN bytes_in  >= prev_bytes_in  THEN bytes_in  - prev_bytes_in  ELSE 0 END
                / NULLIF(UNIX_TIMESTAMP(sampled_at) - UNIX_TIMESTAMP(prev_sampled_at), 0)) AS avg_bps_in,
            AVG(CASE WHEN bytes_out >= prev_bytes_out THEN bytes_out - prev_bytes_out ELSE 0 END
                / NULLIF(UNIX_TIMESTAMP(sampled_at) - UNIX_TIMESTAMP(prev_sampled_at), 0)) AS avg_bps_out
          FROM ranked WHERE prev_bytes_in IS NOT NULL
          GROUP BY client_ip, connected_since
        )
        SELECT a.username,
          a.duration_min,
          a.total_bytes_in,
          a.total_bytes_out,
          COALESCE(r.avg_bps_in,  0) AS avg_bps_in,
          COALESCE(r.avg_bps_out, 0) AS avg_bps_out
        FROM vpn_active_sessions a
        LEFT JOIN rates r ON r.client_ip = a.client_ip AND r.connected_since = a.connected_since
      `),
      query<{ username: string; total_mb: number }>(`
        SELECT username,
          MAX(max_mb_in) + MAX(max_mb_out) AS total_mb
        FROM vpn_daily_summary
        WHERE dag = CURDATE()
          AND forsta_anslutning >= CURDATE()
        GROUP BY username
      `),
    ]);

    const anomalyList: Anomaly[] = [];

    for (const s of activeSessions) {
      const durMin  = Number(s.duration_min) || 0;
      const durH    = durMin / 60;
      const totalBytes = Number(s.total_bytes_in) + Number(s.total_bytes_out);
      const totalGb    = totalBytes / 1_073_741_824;
      const bpsIn      = Number(s.avg_bps_in);
      const bpsOut     = Number(s.avg_bps_out);
      const maxMbps    = Math.max(bpsIn, bpsOut) * 8 / 1_000_000;

      // Sessionstid
      if (durH >= THRESHOLDS.session_crit_h) {
        anomalyList.push({
          type: "long_session", severity: "critical", username: s.username,
          value: `${Math.floor(durH)}t ${Math.round(durMin % 60)}m`,
          detail: `Aktiv session > ${THRESHOLDS.session_crit_h}h`,
        });
      } else if (durH >= THRESHOLDS.session_warn_h) {
        anomalyList.push({
          type: "long_session", severity: "warning", username: s.username,
          value: `${Math.floor(durH)}t ${Math.round(durMin % 60)}m`,
          detail: `Aktiv session > ${THRESHOLDS.session_warn_h}h`,
        });
      }

      // Datamängd (aktiv session)
      if (totalGb >= THRESHOLDS.data_crit_gb) {
        anomalyList.push({
          type: "high_data", severity: "critical", username: s.username,
          value: fmtBytes(totalBytes),
          detail: `Sessionstrafik > ${THRESHOLDS.data_crit_gb} GB`,
        });
      } else if (totalGb >= THRESHOLDS.data_warn_gb) {
        anomalyList.push({
          type: "high_data", severity: "warning", username: s.username,
          value: fmtBytes(totalBytes),
          detail: `Sessionstrafik > ${THRESHOLDS.data_warn_gb} GB`,
        });
      }

      // Bandbredd
      if (maxMbps >= THRESHOLDS.rate_crit_mbps) {
        anomalyList.push({
          type: "high_rate", severity: "critical", username: s.username,
          value: fmtMbits(Math.max(bpsIn, bpsOut)),
          detail: `Bandbredd > ${THRESHOLDS.rate_crit_mbps} Mbit/s`,
        });
      } else if (maxMbps >= THRESHOLDS.rate_warn_mbps) {
        anomalyList.push({
          type: "high_rate", severity: "warning", username: s.username,
          value: fmtMbits(Math.max(bpsIn, bpsOut)),
          detail: `Bandbredd > ${THRESHOLDS.rate_warn_mbps} Mbit/s`,
        });
      }
    }

    // Daglig datamängd
    for (const d of dailySummary) {
      const totalGb = Number(d.total_mb) / 1_024;
      if (totalGb >= THRESHOLDS.daily_crit_gb) {
        anomalyList.push({
          type: "high_data", severity: "critical", username: d.username,
          value: `${totalGb.toFixed(1)} GB idag`,
          detail: `Daglig trafik > ${THRESHOLDS.daily_crit_gb} GB`,
        });
      } else if (totalGb >= THRESHOLDS.daily_warn_gb) {
        anomalyList.push({
          type: "high_data", severity: "warning", username: d.username,
          value: `${totalGb.toFixed(1)} GB idag`,
          detail: `Daglig trafik > ${THRESHOLDS.daily_warn_gb} GB`,
        });
      }
    }

    // Sortera: critical först, sedan per typ
    anomalyList.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
      return a.username.localeCompare(b.username);
    });

    return anomalyList;
    }); // withCache

    return NextResponse.json(anomalies);
  } catch (err) {
    console.error("anomalies error:", err);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
