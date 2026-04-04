import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Lightweight liveness check for uptime monitors (e.g. UptimeRobot).
 * Does not hit the database — use `GET /api/health/db` for DB connectivity.
 */
export async function GET() {
  return NextResponse.json(
    { status: "healthy", timestamp: new Date().toISOString() },
    {
      status: 200,
      headers: { "Cache-Control": "no-store, max-age=0" },
    },
  );
}
