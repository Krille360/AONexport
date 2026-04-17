import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { withCache } from "@/lib/cache";

const CACHE_TTL = 25_000;

export const dynamic = "force-dynamic";

interface Row {
  username: string;
  bucket:   string;
  mbps_in:  string | number;
  mbps_out: string | number;
}

function bucketExpr(durationMs: number): string {
  const h = durationMs / 3_600_000;
  if (h <= 2)   return "DATE_FORMAT(ss.sampled_at, '%Y-%m-%d %H:%i:00')";
  if (h <= 24)  return "DATE_FORMAT(DATE_SUB(ss.sampled_at, INTERVAL MINUTE(ss.sampled_at) MOD 5 MINUTE), '%Y-%m-%d %H:%i:00')";
  if (h <= 72)  return "DATE_FORMAT(ss.sampled_at, '%Y-%m-%d %H:00:00')";
  return               "DATE_FORMAT(ss.sampled_at, '%Y-%m-%d 00:00:00')";
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
    const result = await withCache(`bw-pu:${from}:${to}`, CACHE_TTL, async () => {
    const rows = await query<Row>(`
      WITH ranked AS (
        SELECT
          s.username,
          ss.client_ip, ss.connected_since,
          ss.sampled_at, ss.bytes_in, ss.bytes_out,
          ${bucket} AS bucket,
          LAG(ss.bytes_in)   OVER (PARTITION BY ss.client_ip, ss.connected_since ORDER BY ss.sampled_at) AS prev_in,
          LAG(ss.bytes_out)  OVER (PARTITION BY ss.client_ip, ss.connected_since ORDER BY ss.sampled_at) AS prev_out,
          LAG(ss.sampled_at) OVER (PARTITION BY ss.client_ip, ss.connected_since ORDER BY ss.sampled_at) AS prev_at
        FROM vpn_session_samples ss
        JOIN vpn_sessions s
          ON s.client_ip = ss.client_ip AND s.connected_since = ss.connected_since
        WHERE ss.sampled_at BETWEEN ? AND ?
      ),
      session_bucket_avg AS (
        SELECT
          username, bucket, client_ip, connected_since,
          AVG(CASE WHEN bytes_in  >= prev_in  THEN bytes_in  - prev_in  ELSE 0 END
              / NULLIF(UNIX_TIMESTAMP(sampled_at) - UNIX_TIMESTAMP(prev_at), 0)) AS avg_bps_in,
          AVG(CASE WHEN bytes_out >= prev_out THEN bytes_out - prev_out ELSE 0 END
              / NULLIF(UNIX_TIMESTAMP(sampled_at) - UNIX_TIMESTAMP(prev_at), 0)) AS avg_bps_out
        FROM ranked
        WHERE prev_in IS NOT NULL
        GROUP BY username, bucket, client_ip, connected_since
      ),
      top10 AS (
        SELECT username FROM (
          SELECT username, SUM(avg_bps_in + avg_bps_out) AS total_bps
          FROM session_bucket_avg
          GROUP BY username
          ORDER BY total_bps DESC
          LIMIT 10
        ) _t
      )
      SELECT
        r.username,
        r.bucket,
        ROUND(SUM(r.avg_bps_in)  * 8 / 1000000, 3) AS mbps_in,
        ROUND(SUM(r.avg_bps_out) * 8 / 1000000, 3) AS mbps_out
      FROM session_bucket_avg r
      JOIN top10 t ON t.username = r.username
      GROUP BY r.username, r.bucket
      ORDER BY r.bucket, r.username
    `, [from, to]);

    return rows.map((r) => ({
      username: r.username,
      bucket:   r.bucket,
      mbps_in:  Number(r.mbps_in)  || 0,
      mbps_out: Number(r.mbps_out) || 0,
    }));
    }); // withCache
    return NextResponse.json(result);
  } catch (err) {
    console.error("bandwidth-per-user error:", err);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
