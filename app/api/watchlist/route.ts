import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { getCurrentUserId } from "@/lib/current-user";
import { listWatchedAreas, unwatchArea, watchArea } from "@/lib/user-intel";

/** GET /api/watchlist — list the current user's watched areas. */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const areas = await listWatchedAreas(userId);
  return NextResponse.json({ areas });
}

/** POST /api/watchlist — add a watched area. */
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const areaType = typeof body.areaType === "string" ? body.areaType : null;
  const areaId = typeof body.areaId === "string" ? body.areaId : null;
  if (!areaType || !areaId) {
    return NextResponse.json(
      { error: "areaType and areaId are required" },
      { status: 400 }
    );
  }
  const areaLabel = typeof body.areaLabel === "string" ? body.areaLabel : null;

  const area = await watchArea(userId, { areaType, areaId, areaLabel });
  return NextResponse.json({ area }, { status: 201 });
}

/** DELETE /api/watchlist?areaType=&areaId= — remove a watched area. */
export async function DELETE(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const areaType = searchParams.get("areaType");
  const areaId = searchParams.get("areaId");
  if (!areaType || !areaId) {
    return NextResponse.json(
      { error: "areaType and areaId are required" },
      { status: 400 }
    );
  }

  const removed = await unwatchArea(userId, areaType, areaId);
  if (!removed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ removed: true });
}
