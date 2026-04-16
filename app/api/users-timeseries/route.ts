import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

interface Row {
  bucket:          string;
  unika_anvandare: string | number;
}

function bucketExpr(durationMs: number): string {
  const h = durationMs / 3_600_000;
  if (h <= 2)   return "DATE_FORMAT(ss.sampled_at, '%Y-%m-%d %H:%i:00')"; // per minute
  if (h <= 72)  return "DATE_FORMAT(ss.sampled_at, '%Y-%m-%d %H:00:00')"; // per hour
  return               "DATE_FORMAT(ss.sampled_at, '%Y-%m-%d 00:00:00')"; // per day
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
      SELECT
        ${bucket} AS bucket,
        COUNT(DISTINCT s.username) AS unika_anvandare
      FROM vpn_session_samples ss
      JOIN vpn_sessions s
        ON s.client_ip = ss.client_ip AND s.connected_since = ss.connected_since
      WHERE ss.sampled_at BETWEEN ? AND ?
      GROUP BY bucket
      ORDER BY bucket
    `, [from, to]);

    return NextResponse.json(rows.map((r) => ({
      bucket:          r.bucket,
      unika_anvandare: Number(r.unika_anvandare),
    })));
  } catch (err) {
    console.error("users-timeseries error:", err);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
