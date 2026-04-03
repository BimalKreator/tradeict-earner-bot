import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/server/db";

export const runtime = "nodejs";

/**
 * Verifies PostgreSQL connectivity. Used by ops and future health checks.
 * Does not require applying migrations if SELECT 1 succeeds; table presence is optional.
 */
export async function GET() {
  if (!db) {
    return NextResponse.json(
      { ok: false, reason: "DATABASE_URL not configured" },
      { status: 503 },
    );
  }

  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, reason: message }, { status: 503 });
  }
}
