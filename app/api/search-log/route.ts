import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { getCurrentUserId } from "@/lib/current-user";
import { logSearch } from "@/lib/user-intel";

/**
 * POST /api/search-log — log a search event.
 * Anonymous logging allowed (user_id is set when a session exists).
 */
export async function POST(req: NextRequest) {
  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const userId = await getCurrentUserId();
  const body = await req.json().catch(() => ({}));

  const query = typeof body.query === "string" ? body.query : null;
  const address = typeof body.address === "string" ? body.address : null;
  const lat = typeof body.lat === "number" ? body.lat : null;
  const lon = typeof body.lon === "number" ? body.lon : null;
  const resultCount =
    typeof body.resultCount === "number" ? Math.trunc(body.resultCount) : null;

  const id = await logSearch({ userId, query, address, lat, lon, resultCount });

  return NextResponse.json({ id }, { status: 201 });
}
