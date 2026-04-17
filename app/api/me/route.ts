import { NextResponse } from "next/server";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

/** Returnerar den inloggade användaren från Nexus DA-headern X-Remote-User. */
export async function GET() {
  const hdrs = await headers();
  const username =
    hdrs.get("x-remote-user") ??
    hdrs.get("x-forwarded-user") ??
    null;
  return NextResponse.json({ username });
}
