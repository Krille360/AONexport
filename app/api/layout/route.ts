import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

type LayoutRow = {
  profile_name:   string;
  is_active:      number;
  layouts:        string;
  hidden_widgets: string;
};

function getUser(hdrs: Awaited<ReturnType<typeof headers>>): string | null {
  return hdrs.get("x-remote-user") ?? hdrs.get("x-forwarded-user") ?? null;
}

/** Hämtar alla profiler för inloggad användare + aktiv profils layoutdata. */
export async function GET() {
  const hdrs = await headers();
  const username = getUser(hdrs);
  if (!username) {
    return NextResponse.json({ profiles: [], activeProfile: null, layouts: null, hidden: [] });
  }

  const rows = await query<LayoutRow>(
    `SELECT profile_name, is_active, layouts, hidden_widgets
     FROM vpn_user_layouts
     WHERE username = ?
     ORDER BY profile_name`,
    [username]
  );

  if (!rows.length) {
    return NextResponse.json({ profiles: [], activeProfile: null, layouts: null, hidden: [] });
  }

  const activeRow = rows.find((r) => r.is_active) ?? rows[0];
  return NextResponse.json({
    profiles:      rows.map((r) => r.profile_name),
    activeProfile: activeRow.profile_name,
    layouts:       JSON.parse(activeRow.layouts),
    hidden:        JSON.parse(activeRow.hidden_widgets),
  });
}

/** Hanterar save / activate / delete för layoutprofiler. */
export async function POST(req: Request) {
  const hdrs = await headers();
  const username = getUser(hdrs);
  if (!username) {
    return NextResponse.json({ error: "Ej autentiserad" }, { status: 401 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Ogiltig JSON" }, { status: 400 });
  }

  const { action, name, layouts, hidden } =
    body as { action?: string; name?: string; layouts?: unknown; hidden?: unknown };

  if (!action || !name) {
    return NextResponse.json({ error: "Saknade fält: action, name" }, { status: 400 });
  }

  // ── Spara / skapa profil ────────────────────────────────────────────────
  if (action === "save") {
    await query(
      `INSERT INTO vpn_user_layouts (username, profile_name, is_active, layouts, hidden_widgets)
       VALUES (?, ?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE
         is_active      = 1,
         layouts        = VALUES(layouts),
         hidden_widgets = VALUES(hidden_widgets),
         updated_at     = NOW()`,
      [username, name, JSON.stringify(layouts ?? {}), JSON.stringify(hidden ?? [])]
    );
    await query(
      `UPDATE vpn_user_layouts SET is_active = 0
       WHERE username = ? AND profile_name != ?`,
      [username, name]
    );
    const rows = await query<{ profile_name: string }>(
      `SELECT profile_name FROM vpn_user_layouts WHERE username = ? ORDER BY profile_name`,
      [username]
    );
    return NextResponse.json({ ok: true, profiles: rows.map((r) => r.profile_name) });
  }

  // ── Aktivera/byta profil ────────────────────────────────────────────────
  if (action === "activate") {
    const rows = await query<{ layouts: string; hidden_widgets: string }>(
      `SELECT layouts, hidden_widgets FROM vpn_user_layouts
       WHERE username = ? AND profile_name = ?`,
      [username, name]
    );
    if (!rows.length) {
      return NextResponse.json({ error: "Profil finns inte" }, { status: 404 });
    }
    await query(`UPDATE vpn_user_layouts SET is_active = 0 WHERE username = ?`, [username]);
    await query(
      `UPDATE vpn_user_layouts SET is_active = 1 WHERE username = ? AND profile_name = ?`,
      [username, name]
    );
    return NextResponse.json({
      ok:      true,
      layouts: JSON.parse(rows[0].layouts),
      hidden:  JSON.parse(rows[0].hidden_widgets),
    });
  }

  // ── Ta bort profil ──────────────────────────────────────────────────────
  if (action === "delete") {
    const countRows = await query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM vpn_user_layouts WHERE username = ?`,
      [username]
    );
    if (Number(countRows[0]?.cnt) <= 1) {
      return NextResponse.json({ error: "Kan inte ta bort sista profilen" }, { status: 400 });
    }
    const wasActive = await query<{ is_active: number }>(
      `SELECT is_active FROM vpn_user_layouts WHERE username = ? AND profile_name = ?`,
      [username, name]
    );
    await query(
      `DELETE FROM vpn_user_layouts WHERE username = ? AND profile_name = ?`,
      [username, name]
    );
    if (wasActive[0]?.is_active) {
      await query(
        `UPDATE vpn_user_layouts SET is_active = 1 WHERE username = ? ORDER BY profile_name LIMIT 1`,
        [username]
      );
    }
    const remaining = await query<LayoutRow>(
      `SELECT profile_name, is_active, layouts, hidden_widgets
       FROM vpn_user_layouts WHERE username = ? ORDER BY profile_name`,
      [username]
    );
    const activeRow = remaining.find((r) => r.is_active) ?? remaining[0];
    return NextResponse.json({
      ok:            true,
      profiles:      remaining.map((r) => r.profile_name),
      activeProfile: activeRow?.profile_name ?? null,
      layouts:       activeRow ? JSON.parse(activeRow.layouts) : null,
      hidden:        activeRow ? JSON.parse(activeRow.hidden_widgets) : [],
    });
  }

  return NextResponse.json({ error: "Okänd action" }, { status: 400 });
}
