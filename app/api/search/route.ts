import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ users: [], ips: [] });

  const like = `%${q}%`;

  try {
    const [userRows, intIpRows, extIpRows] = await Promise.all([
      query<{ v: string }>(`
        SELECT DISTINCT username AS v FROM vpn_sessions        WHERE username LIKE ?
        UNION
        SELECT DISTINCT username AS v FROM vpn_active_sessions WHERE username LIKE ?
        LIMIT 10
      `, [like, like]),
      query<{ v: string }>(`
        SELECT DISTINCT client_ip AS v FROM vpn_sessions        WHERE client_ip LIKE ?
        UNION
        SELECT DISTINCT client_ip AS v FROM vpn_active_sessions WHERE client_ip LIKE ?
        LIMIT 10
      `, [like, like]),
      query<{ v: string }>(`
        SELECT DISTINCT client_external_ip AS v FROM vpn_sessions
          WHERE client_external_ip IS NOT NULL AND client_external_ip LIKE ?
        UNION
        SELECT DISTINCT client_external_ip AS v FROM vpn_active_sessions
          WHERE client_external_ip IS NOT NULL AND client_external_ip LIKE ?
        LIMIT 10
      `, [like, like]),
    ]);

    const users = [...new Set(userRows.map((r) => r.v as string))].slice(0, 10);
    const ips   = [
      ...new Set([
        ...intIpRows.map((r) => r.v as string),
        ...extIpRows.map((r) => r.v as string),
      ].filter(Boolean)),
    ].slice(0, 10);

    return NextResponse.json({ users, ips });
  } catch (err) {
    console.error("search error:", err);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
