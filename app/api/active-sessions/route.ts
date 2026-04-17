import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { withCache } from "@/lib/cache";
import type { ActiveSession } from "@/lib/types";

const CACHE_TTL = 25_000;

export const dynamic = "force-dynamic";

interface ActiveSessionRow extends ActiveSession {
  avg_bps_in:  number;
  avg_bps_out: number;
}

export async function GET() {
  try {
    const parsed = await withCache("active-sessions", CACHE_TTL, async () => {
    const rows = await query<ActiveSessionRow>(`
      WITH last20 AS (
        SELECT
          ss.client_ip, ss.connected_since, ss.sampled_at, ss.bytes_in, ss.bytes_out,
          ROW_NUMBER() OVER (PARTITION BY ss.client_ip, ss.connected_since ORDER BY ss.sampled_at DESC) AS rn
        FROM vpn_session_samples ss
        INNER JOIN vpn_active_sessions act
          ON act.client_ip = ss.client_ip AND act.connected_since = ss.connected_since
      ),
      ranked AS (
        SELECT
          client_ip, connected_since, sampled_at, bytes_in, bytes_out,
          LAG(bytes_in)   OVER (PARTITION BY client_ip, connected_since ORDER BY sampled_at) AS prev_bytes_in,
          LAG(bytes_out)  OVER (PARTITION BY client_ip, connected_since ORDER BY sampled_at) AS prev_bytes_out,
          LAG(sampled_at) OVER (PARTITION BY client_ip, connected_since ORDER BY sampled_at) AS prev_sampled_at
        FROM last20
        WHERE rn <= 20
      ),
      rates AS (
        SELECT
          client_ip,
          connected_since,
          AVG(CASE WHEN bytes_in  >= prev_bytes_in  THEN bytes_in  - prev_bytes_in  ELSE 0 END
              / NULLIF(UNIX_TIMESTAMP(sampled_at) - UNIX_TIMESTAMP(prev_sampled_at), 0)) AS avg_bps_in,
          AVG(CASE WHEN bytes_out >= prev_bytes_out THEN bytes_out - prev_bytes_out ELSE 0 END
              / NULLIF(UNIX_TIMESTAMP(sampled_at) - UNIX_TIMESTAMP(prev_sampled_at), 0)) AS avg_bps_out
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

    return rows.map((r) => ({
      ...r,
      total_bytes_in:  Number(r.total_bytes_in),
      total_bytes_out: Number(r.total_bytes_out),
      duration_min:    r.duration_min != null ? Number(r.duration_min) : null,
      avg_bps_in:      Number(r.avg_bps_in),
      avg_bps_out:     Number(r.avg_bps_out),
    }));
    }); // withCache

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("active-sessions error:", err);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
