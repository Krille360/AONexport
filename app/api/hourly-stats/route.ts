import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { HourlyStat } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await query<HourlyStat>(`
      SELECT
        DATE_FORMAT(dag, '%Y-%m-%d') AS dag,
        timme,
        unika_anvandare,
        antal_samples
      FROM vpn_hourly_users
      ORDER BY dag DESC, timme ASC
      LIMIT 168
    `);
    return NextResponse.json(rows);
  } catch (err) {
    console.error("hourly-stats error:", err);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
