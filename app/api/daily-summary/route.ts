import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { withCache } from "@/lib/cache";
import type { DailySummary } from "@/lib/types";

const CACHE_TTL = 25_000;

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const parsed = await withCache("daily-summary", CACHE_TTL, async () => {
    const rows = await query<DailySummary>(`
      SELECT
        DATE_FORMAT(dag, '%Y-%m-%d') AS dag,
        username,
        antal_samples,
        DATE_FORMAT(forsta_anslutning, '%Y-%m-%dT%H:%i:%s') AS forsta_anslutning,
        DATE_FORMAT(senaste_aktivitet, '%Y-%m-%dT%H:%i:%s') AS senaste_aktivitet,
        max_duration_min,
        max_mb_in,
        max_mb_out,
        tunnel_type,
        auth_method
      FROM vpn_daily_summary
      ORDER BY dag DESC, max_mb_in + max_mb_out DESC
      LIMIT 200
    `);
    return rows.map((r) => ({
      ...r,
      max_duration_min: r.max_duration_min != null ? Number(r.max_duration_min) : null,
      max_mb_in:        r.max_mb_in        != null ? Number(r.max_mb_in)        : null,
      max_mb_out:       r.max_mb_out       != null ? Number(r.max_mb_out)       : null,
    }));
    }); // withCache
    return NextResponse.json(parsed);
  } catch (err) {
    console.error("daily-summary error:", err);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
