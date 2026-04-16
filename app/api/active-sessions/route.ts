import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { ActiveSession } from "@/lib/types";

export const dynamic = "force-dynamic";

interface ActiveSessionRow extends ActiveSession {
  avg_bps_in:  number;
  avg_bps_out: number;
}

export async function GET() {
  try {
    const rows = await query<ActiveSessionRow>(`
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
          client_ip,
          connected_since,
          AVG((bytes_in  - prev_bytes_in)  / NULLIF(UNIX_TIMESTAMP(sampled_at) - UNIX_TIMESTAMP(prev_sampled_at), 0)) AS avg_bps_in,
          AVG((bytes_out - prev_bytes_out) / NULLIF(UNIX_TIMESTAMP(sampled_at) - UNIX_TIMESTAMP(prev_sampled_at), 0)) AS avg_bps_out
        FROM ranked
        WHERE prev_bytes_in IS NOT NULL
        GROUP BY client_ip, connected_since
      )
      SELECT
        a.username,
        a.client_ip,
        a.client_external_ip,
        a.tunnel_type,
        a.auth_method,
        DATE_FORMAT(a.connected_since, '%Y-%m-%dT%H:%i:%s') AS connected_since,
        a.duration_min,
        a.total_bytes_in,
        a.total_bytes_out,
        a.user_activity_state,
        DATE_FORMAT(a.last_seen, '%Y-%m-%dT%H:%i:%s') AS last_seen,
        COALESCE(r.avg_bps_in,  0) AS avg_bps_in,
        COALESCE(r.avg_bps_out, 0) AS avg_bps_out
      FROM vpn_active_sessions a
      LEFT JOIN rates r ON r.client_ip = a.client_ip AND r.connected_since = a.connected_since
      ORDER BY a.duration_min DESC
    `);

    const parsed = rows.map((r) => ({
      ...r,
      total_bytes_in:  Number(r.total_bytes_in),
      total_bytes_out: Number(r.total_bytes_out),
      duration_min:    r.duration_min != null ? Number(r.duration_min) : null,
      avg_bps_in:      Number(r.avg_bps_in),
      avg_bps_out:     Number(r.avg_bps_out),
    }));

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("active-sessions error:", err);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
