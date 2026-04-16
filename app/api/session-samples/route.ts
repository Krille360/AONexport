import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

interface Row {
  bucket:   string;
  mbps_in:  string | number;
  mbps_out: string | number;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientIp       = searchParams.get("client_ip");
  const connectedSince = searchParams.get("connected_since");

  if (!clientIp || !connectedSince) {
    return NextResponse.json(
      { error: "client_ip and connected_since required" },
      { status: 400 }
    );
  }

  try {
    const rows = await query<Row>(`
      WITH ranked AS (
        SELECT
          sampled_at, bytes_in, bytes_out,
          LAG(bytes_in)   OVER (ORDER BY sampled_at) AS prev_in,
          LAG(bytes_out)  OVER (ORDER BY sampled_at) AS prev_out,
          LAG(sampled_at) OVER (ORDER BY sampled_at) AS prev_at
        FROM vpn_session_samples
        WHERE client_ip = ? AND connected_since = ?
      )
      SELECT
        DATE_FORMAT(sampled_at, '%Y-%m-%dT%H:%i:%s') AS bucket,
        ROUND(
          CASE WHEN bytes_in  >= prev_in  THEN bytes_in  - prev_in  ELSE 0 END
          / NULLIF(UNIX_TIMESTAMP(sampled_at) - UNIX_TIMESTAMP(prev_at), 0)
          * 8 / 1000000
        , 3) AS mbps_in,
        ROUND(
          CASE WHEN bytes_out >= prev_out THEN bytes_out - prev_out ELSE 0 END
          / NULLIF(UNIX_TIMESTAMP(sampled_at) - UNIX_TIMESTAMP(prev_at), 0)
          * 8 / 1000000
        , 3) AS mbps_out
      FROM ranked
      WHERE prev_in IS NOT NULL
      ORDER BY sampled_at
    `, [clientIp, connectedSince]);

    return NextResponse.json(rows.map((r) => ({
      bucket:   r.bucket,
      mbps_in:  Number(r.mbps_in)  || 0,
      mbps_out: Number(r.mbps_out) || 0,
    })));
  } catch (err) {
    console.error("session-samples error:", err);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
