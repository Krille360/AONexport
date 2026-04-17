import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { withCache } from "@/lib/cache";
import type { DashboardStats } from "@/lib/types";

const CACHE_TTL = 25_000;

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = await withCache("stats", CACHE_TTL, async () => {
    const [[active], [today], [totals]] = await Promise.all([
      query<{ active_users: number }>(`
        SELECT COUNT(*) AS active_users FROM vpn_active_sessions
      `),
      query<{ total_today: number; avg_duration_min: number }>(`
        SELECT
          COUNT(DISTINCT username)        AS total_today,
          ROUND(AVG(max_duration_min), 1) AS avg_duration_min
        FROM vpn_daily_summary
        WHERE dag = CURDATE()
      `),
      query<{ total_bps_in: number; total_bps_out: number }>(`
        WITH active_sets AS (
          SELECT client_ip, connected_since FROM vpn_active_sessions
        ),
        ranked AS (
          SELECT
            ss.client_ip, ss.connected_since, ss.sampled_at, ss.bytes_in, ss.bytes_out,
            LAG(ss.bytes_in)   OVER (PARTITION BY ss.client_ip, ss.connected_since ORDER BY ss.sampled_at) AS prev_bytes_in,
            LAG(ss.bytes_out)  OVER (PARTITION BY ss.client_ip, ss.connected_since ORDER BY ss.sampled_at) AS prev_bytes_out,
            LAG(ss.sampled_at) OVER (PARTITION BY ss.client_ip, ss.connected_since ORDER BY ss.sampled_at) AS prev_sampled_at
          FROM vpn_session_samples ss
          INNER JOIN active_sets a ON a.client_ip = ss.client_ip AND a.connected_since = ss.connected_since
          WHERE ss.sampled_at >= NOW() - INTERVAL 3 MINUTE
        ),
        rates AS (
          SELECT
            AVG(CASE WHEN bytes_in  >= prev_bytes_in  THEN bytes_in  - prev_bytes_in  ELSE 0 END
                / NULLIF(UNIX_TIMESTAMP(sampled_at) - UNIX_TIMESTAMP(prev_sampled_at), 0)) AS avg_bps_in,
            AVG(CASE WHEN bytes_out >= prev_bytes_out THEN bytes_out - prev_bytes_out ELSE 0 END
                / NULLIF(UNIX_TIMESTAMP(sampled_at) - UNIX_TIMESTAMP(prev_sampled_at), 0)) AS avg_bps_out
          FROM ranked
          WHERE prev_bytes_in IS NOT NULL
          GROUP BY client_ip, connected_since
        )
        SELECT
          COALESCE(SUM(avg_bps_in),  0) AS total_bps_in,
          COALESCE(SUM(avg_bps_out), 0) AS total_bps_out
        FROM rates
      `),
    ]);

    const result: DashboardStats = {
      active_users:     Number(active?.active_users)    ?? 0,
      total_today:      Number(today?.total_today)       ?? 0,
      avg_duration_min: Number(today?.avg_duration_min)  ?? 0,
      total_bps_in:     Number(totals?.total_bps_in)     ?? 0,
      total_bps_out:    Number(totals?.total_bps_out)    ?? 0,
    };
    return result;
    }); // withCache

    return NextResponse.json(stats);
  } catch (err) {
    console.error("stats error:", err);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
