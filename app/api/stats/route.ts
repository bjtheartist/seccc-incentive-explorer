import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

/**
 * GET /api/stats
 *
 * Returns aggregate stats: business counts, zone coverage, stacking distribution.
 */
export async function GET(_request: NextRequest) {
  const sql = getSQL();
  if (!sql) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  try {
    const rows = await sql`
      SELECT data FROM stats LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No stats data" },
        { status: 404 }
      );
    }

    const data = typeof rows[0].data === "string"
      ? JSON.parse(rows[0].data)
      : rows[0].data;

    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch (err) {
    console.error("stats API error:", err);
    return NextResponse.json(
      { error: "Database query failed" },
      { status: 500 }
    );
  }
}
