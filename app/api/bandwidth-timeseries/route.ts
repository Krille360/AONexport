import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

interface Row {
  bucket:   string;
  mbps_in:  string | number;
  mbps_out: string | number;
}

/** Choose bucket granularity based on query duration. */
function bucketExpr(durationMs: number): string {
  const h = durationMs / 3_600_000;
  if (h <= 2)   return "DATE_FORMAT(sampled_at, '%Y-%m-%d %H:%i:00')"; // per minute
  if (h <= 72)  return "DATE_FORMAT(sampled_at, '%Y-%m-%d %H:00:00')"; // per hour
  return               "DATE_FORMAT(sampled_at, '%Y-%m-%d 00:00:00')"; // per day
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to   = searchParams.get("to");

  if (!from || !to) {
    return NextResponse.json({ error: "from and to required" }, { status: 400 });
  }

  const durationMs = new Date(to).getTime() - new Date(from).getTime();
  if (durationMs <= 0) {
    return NextResponse.json({ error: "to must be after from" }, { status: 400 });
  }

  const bucket = bucketExpr(durationMs);

  try {
    const rows = await query<Row>(`
      WITH ranked AS (
        SELECT
          client_ip, connected_since,
          sampled_at, bytes_in, bytes_out,
          ${bucket} AS bucket,
          LAG(bytes_in)   OVER (PARTITION BY client_ip, connected_since ORDER BY sampled_at) AS prev_in,
          LAG(bytes_out)  OVER (PARTITION BY client_ip, connected_since ORDER BY sampled_at) AS prev_out,
          LAG(sampled_at) OVER (PARTITION BY client_ip, connected_since ORDER BY sampled_at) AS prev_at
        FROM vpn_session_samples
        WHERE sampled_at BETWEEN ? AND ?
      ),
      session_bucket_avg AS (
        SELECT
          bucket,
          client_ip,
          connected_since,
          AVG(CASE WHEN bytes_in  >= prev_in  THEN bytes_in  - prev_in  ELSE 0 END
              / NULLIF(UNIX_TIMESTAMP(sampled_at) - UNIX_TIMESTAMP(prev_at), 0)) AS avg_bps_in,
          AVG(CASE WHEN bytes_out >= prev_out THEN bytes_out - prev_out ELSE 0 END
              / NULLIF(UNIX_TIMESTAMP(sampled_at) - UNIX_TIMESTAMP(prev_at), 0)) AS avg_bps_out
        FROM ranked
        WHERE prev_in IS NOT NULL
        GROUP BY bucket, client_ip, connected_since
      )
      SELECT
        bucket,
        ROUND(SUM(avg_bps_in)  * 8 / 1000000, 3) AS mbps_in,
        ROUND(SUM(avg_bps_out) * 8 / 1000000, 3) AS mbps_out
      FROM session_bucket_avg
      GROUP BY bucket
      ORDER BY bucket
    `, [from, to]);

    return NextResponse.json(rows.map((r) => ({
      bucket:   r.bucket,
      mbps_in:  Number(r.mbps_in)  || 0,
      mbps_out: Number(r.mbps_out) || 0,
    })));
  } catch (err) {
    console.error("bandwidth-timeseries error:", err);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
