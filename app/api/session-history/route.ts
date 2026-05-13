import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { withCache } from "@/lib/cache";

const CACHE_TTL = 25_000;
const DEFAULT_PAGE_SIZE = 50;

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
  const limit  = Math.min(Math.max(parseInt(searchParams.get("limit")  ?? String(DEFAULT_PAGE_SIZE), 10), 1), 200);
  const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10), 0);
  const search = (searchParams.get("search") ?? "").trim();

  try {
    const cacheKey = `session-history:${limit}:${offset}:${search}`;
    const result = await withCache(cacheKey, CACHE_TTL, async () => {
      const searchClause = search
        ? " AND (username LIKE ? OR client_ip LIKE ? OR client_external_ip LIKE ?)"
        : "";
      const searchArgs: string[] = search
        ? [`%${search}%`, `%${search}%`, `%${search}%`]
        : [];

      const [countRows, rows] = await Promise.all([
        query<{ total: string }>(
          `SELECT COUNT(*) AS total FROM vpn_sessions WHERE last_seen < NOW() - INTERVAL 2 MINUTE${searchClause}`,
          searchArgs,
        ),
        query<Row>(
          `SELECT
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
          WHERE last_seen < NOW() - INTERVAL 2 MINUTE${searchClause}
          ORDER BY last_seen DESC
          LIMIT ? OFFSET ?`,
          [...searchArgs, limit, offset],
        ),
      ]);

      const total = parseInt(countRows[0].total, 10);
      const sessions = rows.map((r) => ({
        ...r,
        duration_min:    r.duration_min    != null ? Number(r.duration_min)    : null,
        total_bytes_in:  Number(r.total_bytes_in),
        total_bytes_out: Number(r.total_bytes_out),
      }));

      return { sessions, total };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("session-history error:", err);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
