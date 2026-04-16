import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

interface Row {
  username:           string;
  client_ip:          string;
  client_external_ip: string;
  tunnel_type:        string;
  auth_method:        string;
  connected_since:    string;
  last_seen:          string;
  duration_min:       string | number;
  total_bytes_in:     string | number;
  total_bytes_out:    string | number;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "300", 10), 1000);

  try {
    const rows = await query<Row>(`
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
      ORDER BY last_seen DESC
      LIMIT ?
    `, [limit]);

    return NextResponse.json(rows.map((r) => ({
      ...r,
      duration_min:    r.duration_min    != null ? Number(r.duration_min)    : null,
      total_bytes_in:  Number(r.total_bytes_in),
      total_bytes_out: Number(r.total_bytes_out),
    })));
  } catch (err) {
    console.error("session-history error:", err);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
