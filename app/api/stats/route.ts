import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { cached } from "@/lib/redis";

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
    const data = await cached("stats:all", 3600, async () => {
      const rows = await sql`
        SELECT data FROM stats LIMIT 1
      `;

      if (rows.length === 0) {
        return null;
      }

      return typeof rows[0].data === "string"
        ? JSON.parse(rows[0].data)
        : rows[0].data;
    });

    if (data === null) {
      return NextResponse.json(
        { error: "No stats data" },
        { status: 404 }
      );
    }

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    console.error("stats API error:", err);
    return NextResponse.json(
      { error: "Database query failed" },
      { status: 500 }
    );
  }
}
