import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ users: [], ips: [] });

  // Word-boundary matching: only match at the START of a name segment.
  // Segments are separated by "." (between first/last name) or "-" (compound names).
  // Example searching "hans":
  //   p1 "hans%"    → hans.jansson@…          ✓ (first name)
  //   p2 "%.hans%"  → jon.hansson@…            ✓ (last name starts with hans)
  //   p3 "%-hans%"  → anders.larsson-hansson@… ✓ (compound part)
  //   none of these match dan.johansson@…       ✗ (no segment starts with hans)
  const p1 = `${q}%`;       // start of local part
  const p2 = `%.${q}%`;     // after a dot
  const p3 = `%-${q}%`;     // after a hyphen
  // "hans jan" → "hans.jan%" so users can type full names with spaces
  const p4 = q.includes(" ") ? `${q.replace(/\s+/g, ".")}%` : null;

  const userCondition = p4
    ? "username LIKE ? OR username LIKE ? OR username LIKE ? OR username LIKE ?"
    : "username LIKE ? OR username LIKE ? OR username LIKE ?";
  const userParams = p4 ? [p1, p2, p3, p4] : [p1, p2, p3];

  // IP search keeps substring matching (users often type partial octets)
  const ipLike = `%${q}%`;

  try {
    const [userRows, intIpRows, extIpRows] = await Promise.all([
      query<{ v: string }>(`
        SELECT DISTINCT username AS v FROM vpn_sessions        WHERE ${userCondition}
        UNION
        SELECT DISTINCT username AS v FROM vpn_active_sessions WHERE ${userCondition}
        LIMIT 10
      `, [...userParams, ...userParams]),
      query<{ v: string }>(`
        SELECT DISTINCT client_ip AS v FROM vpn_sessions        WHERE client_ip LIKE ?
        UNION
        SELECT DISTINCT client_ip AS v FROM vpn_active_sessions WHERE client_ip LIKE ?
        LIMIT 10
      `, [ipLike, ipLike]),
      query<{ v: string }>(`
        SELECT DISTINCT client_external_ip AS v FROM vpn_sessions
          WHERE client_external_ip IS NOT NULL AND client_external_ip LIKE ?
        UNION
        SELECT DISTINCT client_external_ip AS v FROM vpn_active_sessions
          WHERE client_external_ip IS NOT NULL AND client_external_ip LIKE ?
        LIMIT 10
      `, [ipLike, ipLike]),
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
