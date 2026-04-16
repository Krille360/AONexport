import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { DashboardStats } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
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
        WITH ranked AS (
          SELECT
            client_ip, connected_since, sampled_at, bytes_in, bytes_out,
            LAG(bytes_in)   OVER (PARTITION BY client_ip, connected_since ORDER BY sampled_at) AS prev_bytes_in,
            LAG(bytes_out)  OVER (PARTITION BY client_ip, connected_since ORDER BY sampled_at) AS prev_bytes_out,
            LAG(sampled_at) OVER (PARTITION BY client_ip, connected_since ORDER BY sampled_at) AS prev_sampled_at
          FROM vpn_session_samples
        ),
        rates AS (
          SELECT
            AVG((bytes_in  - prev_bytes_in)  / NULLIF(UNIX_TIMESTAMP(sampled_at) - UNIX_TIMESTAMP(prev_sampled_at), 0)) AS avg_bps_in,
            AVG((bytes_out - prev_bytes_out) / NULLIF(UNIX_TIMESTAMP(sampled_at) - UNIX_TIMESTAMP(prev_sampled_at), 0)) AS avg_bps_out
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

    const stats: DashboardStats = {
      active_users:     Number(active?.active_users)    ?? 0,
      total_today:      Number(today?.total_today)       ?? 0,
      avg_duration_min: Number(today?.avg_duration_min)  ?? 0,
      total_bps_in:     Number(totals?.total_bps_in)     ?? 0,
      total_bps_out:    Number(totals?.total_bps_out)    ?? 0,
    };

    return NextResponse.json(stats);
  } catch (err) {
    console.error("stats error:", err);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
