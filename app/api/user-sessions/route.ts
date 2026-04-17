import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

interface ActiveRow {
  username:            string;
  client_ip:           string;
  client_external_ip:  string | null;
  tunnel_type:         string | null;
  auth_method:         string | null;
  connected_since:     string;
  last_seen:           string;
  duration_min:        string | number | null;
  total_bytes_in:      string | number;
  total_bytes_out:     string | number;
  user_activity_state: string | null;
  avg_bps_in:          string | number;
  avg_bps_out:         string | number;
}

interface HistoryRow {
  username:            string;
  client_ip:           string;
  client_external_ip:  string | null;
  tunnel_type:         string | null;
  auth_method:         string | null;
  connected_since:     string;
  last_seen:           string;
  duration_min:        string | number | null;
  total_bytes_in:      string | number;
  total_bytes_out:     string | number;
}

/** Build a rates CTE that only scans samples for the matched active sessions. */
function buildRatesCTE(filterClause: string): string {
  return `
  active_filter AS (
    SELECT client_ip, connected_since FROM vpn_active_sessions
    WHERE ${filterClause}
  ),
  last20 AS (
    SELECT ss.client_ip, ss.connected_since, ss.sampled_at, ss.bytes_in, ss.bytes_out,
      ROW_NUMBER() OVER (PARTITION BY ss.client_ip, ss.connected_since ORDER BY ss.sampled_at DESC) AS rn
    FROM vpn_session_samples ss
    INNER JOIN active_filter af ON af.client_ip = ss.client_ip AND af.connected_since = ss.connected_since
  ),
  ranked_rates AS (
    SELECT client_ip, connected_since, sampled_at, bytes_in, bytes_out,
      LAG(bytes_in)   OVER (PARTITION BY client_ip, connected_since ORDER BY sampled_at) AS prev_in,
      LAG(bytes_out)  OVER (PARTITION BY client_ip, connected_since ORDER BY sampled_at) AS prev_out,
      LAG(sampled_at) OVER (PARTITION BY client_ip, connected_since ORDER BY sampled_at) AS prev_at
    FROM last20 WHERE rn <= 20
  ),
  rates AS (
    SELECT client_ip, connected_since,
      AVG(CASE WHEN bytes_in  >= prev_in  THEN bytes_in  - prev_in  ELSE 0 END
          / NULLIF(UNIX_TIMESTAMP(sampled_at) - UNIX_TIMESTAMP(prev_at), 0)) AS avg_bps_in,
      AVG(CASE WHEN bytes_out >= prev_out THEN bytes_out - prev_out ELSE 0 END
          / NULLIF(UNIX_TIMESTAMP(sampled_at) - UNIX_TIMESTAMP(prev_at), 0)) AS avg_bps_out
    FROM ranked_rates WHERE prev_in IS NOT NULL
    GROUP BY client_ip, connected_since
  )
`;
}

const ACTIVE_SELECT = `
  SELECT
    a.username,
    a.client_ip,
    a.client_external_ip,
    a.tunnel_type,
    a.auth_method,
    DATE_FORMAT(a.connected_since, '%Y-%m-%dT%H:%i:%s') AS connected_since,
    DATE_FORMAT(a.last_seen,       '%Y-%m-%dT%H:%i:%s') AS last_seen,
    a.duration_min,
    a.total_bytes_in,
    a.total_bytes_out,
    a.user_activity_state,
    COALESCE(r.avg_bps_in,  0) AS avg_bps_in,
    COALESCE(r.avg_bps_out, 0) AS avg_bps_out
  FROM vpn_active_sessions a
  LEFT JOIN rates r ON r.client_ip = a.client_ip AND r.connected_since = a.connected_since
`;

const HISTORY_SELECT = `
  SELECT
    username,
    client_ip,
    client_external_ip,
    tunnel_type,
    auth_method,
    DATE_FORMAT(connected_since, '%Y-%m-%dT%H:%i:%s') AS connected_since,
    DATE_FORMAT(last_seen,       '%Y-%m-%dT%H:%i:%s') AS last_seen,
    duration_min,
    total_bytes_in,
    total_bytes_out
  FROM vpn_sessions
  WHERE last_seen < NOW() - INTERVAL 2 MINUTE
`;

function parseActive(rows: ActiveRow[]) {
  return rows.map((r) => ({
    ...r,
    duration_min:    r.duration_min    != null ? Number(r.duration_min)    : null,
    total_bytes_in:  Number(r.total_bytes_in),
    total_bytes_out: Number(r.total_bytes_out),
    avg_bps_in:      Number(r.avg_bps_in),
    avg_bps_out:     Number(r.avg_bps_out),
  }));
}

function parseHistory(rows: HistoryRow[]) {
  return rows.map((r) => ({
    ...r,
    duration_min:    r.duration_min != null ? Number(r.duration_min) : null,
    total_bytes_in:  Number(r.total_bytes_in),
    total_bytes_out: Number(r.total_bytes_out),
  }));
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type  = searchParams.get("type");  // "user" | "ip"
  const value = searchParams.get("value")?.trim();

  if (!type || !value || (type !== "user" && type !== "ip")) {
    return NextResponse.json({ error: "type and value required" }, { status: 400 });
  }

  try {
    if (type === "user") {
      const [active, history] = await Promise.all([
        query<ActiveRow>(`
          WITH ${buildRatesCTE("username = ?")}
          ${ACTIVE_SELECT}
          WHERE a.username = ?
          ORDER BY a.connected_since DESC
        `, [value, value]),
        query<HistoryRow>(`
          ${HISTORY_SELECT} AND username = ?
          ORDER BY last_seen DESC LIMIT 200
        `, [value]),
      ]);
      return NextResponse.json({ active: parseActive(active), history: parseHistory(history) });
    } else {
      // type === "ip" — match on internal OR external IP
      const [active, history] = await Promise.all([
        query<ActiveRow>(`
          WITH ${buildRatesCTE("client_ip = ? OR client_external_ip = ?")}
          ${ACTIVE_SELECT}
          WHERE a.client_ip = ? OR a.client_external_ip = ?
          ORDER BY a.connected_since DESC
        `, [value, value, value, value]),
        query<HistoryRow>(`
          ${HISTORY_SELECT} AND (client_ip = ? OR client_external_ip = ?)
          ORDER BY last_seen DESC LIMIT 200
        `, [value, value]),
      ]);
      return NextResponse.json({ active: parseActive(active), history: parseHistory(history) });
    }
  } catch (err) {
    console.error("user-sessions error:", err);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
