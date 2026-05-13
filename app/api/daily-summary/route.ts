import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { withCache } from "@/lib/cache";
import type { DailySummary } from "@/lib/types";

const CACHE_TTL = 25_000;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const day = searchParams.get("day"); // YYYY-MM-DD

  try {
    // No day param → return list of all available days
    if (!day) {
      const days = await withCache("daily-summary:days", CACHE_TTL, async () => {
        const rows = await query<{ dag: string }>(
          `SELECT DISTINCT DATE_FORMAT(DATE(COALESCE(connected_since, first_seen)), '%Y-%m-%d') AS dag
           FROM vpn_sessions
           ORDER BY dag DESC`
        );
        return rows.map((r) => r.dag);
      });
      return NextResponse.json(days);
    }

    // day param → return all rows for that day (no limit)
    const parsed = await withCache(`daily-summary:${day}`, CACHE_TTL, async () => {
      const rows = await query<DailySummary>(
        `SELECT
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
        WHERE dag = ?
        ORDER BY max_mb_in + max_mb_out DESC`,
        [day],
      );
      return rows.map((r) => ({
        ...r,
        max_duration_min: r.max_duration_min != null ? Number(r.max_duration_min) : null,
        max_mb_in:        r.max_mb_in        != null ? Number(r.max_mb_in)        : null,
        max_mb_out:       r.max_mb_out       != null ? Number(r.max_mb_out)       : null,
      }));
    });

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("daily-summary error:", err);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
