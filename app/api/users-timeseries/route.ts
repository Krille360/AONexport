import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { withCache } from "@/lib/cache";

const CACHE_TTL = 25_000;

export const dynamic = "force-dynamic";

interface Row {
  bucket:          string;
  unika_anvandare: string | number;
}

interface BucketCfg {
  interval: string;   // SQL INTERVAL literal, e.g. '5 MINUTE'
  fmt:      string;   // DATE_FORMAT pattern
}

function bucketCfg(durationMs: number): BucketCfg {
  const h = durationMs / 3_600_000;
  if (h <= 2)  return { interval: "1 MINUTE",  fmt: "'%Y-%m-%d %H:%i:00'" };
  if (h <= 24) return { interval: "5 MINUTE",  fmt: "'%Y-%m-%d %H:%i:00'" };
  if (h <= 72) return { interval: "1 HOUR",    fmt: "'%Y-%m-%d %H:00:00'" };
  return             { interval: "1 DAY",     fmt: "'%Y-%m-%d 00:00:00'" };
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

  const { interval, fmt } = bucketCfg(durationMs);

  try {
    const result = await withCache(`users-ts:${from}:${to}`, CACHE_TTL, async () => {
      // relevant_sessions CTE pre-filters using idx_last_seen / idx_first_seen
      // before the recursive CTE join — avoids full table scan issues with
      // MariaDB's optimizer when joining against recursive CTEs.
      const rows = await query<Row>(`
        WITH RECURSIVE buckets AS (
          SELECT CAST(? AS DATETIME) AS t
          UNION ALL
          SELECT t + INTERVAL ${interval}
          FROM buckets
          WHERE t + INTERVAL ${interval} <= CAST(? AS DATETIME)
        ),
        relevant_sessions AS (
          SELECT username, connected_since, last_seen
          FROM vpn_sessions
          WHERE last_seen     >= CAST(? AS DATETIME)
            AND connected_since < CAST(? AS DATETIME)
        )
        SELECT
          DATE_FORMAT(b.t, ${fmt}) AS bucket,
          COUNT(DISTINCT s.username) AS unika_anvandare
        FROM buckets b
        LEFT JOIN relevant_sessions s
          ON  s.connected_since <  b.t + INTERVAL ${interval}
          AND s.last_seen        >= b.t
        GROUP BY b.t
        ORDER BY b.t
      `, [from, to, from, to]);

      return rows.map((r) => ({
        bucket:          r.bucket,
        unika_anvandare: Number(r.unika_anvandare),
      }));
    }); // withCache
    return NextResponse.json(result);
  } catch (err) {
    console.error("users-timeseries error:", err);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
