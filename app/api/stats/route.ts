import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { memCached } from "@/lib/redis";
import type { Stats } from "@/lib/types";
import { readFile } from "fs/promises";
import { join } from "path";

/**
 * GET /api/stats
 *
 * Returns aggregate stats: business counts, zone coverage, stacking distribution.
 */
async function getStaticStats(): Promise<Stats> {
  const file = join(process.cwd(), "public", "data", "stats.json");
  return JSON.parse(await readFile(file, "utf8")) as Stats;
}

export async function GET(_request: NextRequest) {
  const sql = getSQL();
  if (!sql) {
    return NextResponse.json(await getStaticStats(), {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
      },
    });
  }

  try {
    const data = await memCached("stats:all", 86400, async () => {
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
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
      },
    });
  } catch (err) {
    console.error("stats API error:", err);
    return NextResponse.json(await getStaticStats(), {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
      },
    });
  }
}
