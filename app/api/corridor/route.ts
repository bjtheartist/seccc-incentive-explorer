import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

/**
 * GET /api/corridor?zip=60617
 *
 * Returns the latest corridor metrics snapshot per ZIP corridor.
 * Optional `zip` filter narrows to a single corridor.
 *
 * When DATABASE_URL is not configured the endpoint degrades gracefully and
 * returns an empty corridor list (matching the DB-optional pattern used by
 * other routes), rather than erroring.
 */

interface CorridorRow {
  corridor_type: string;
  corridor_id: string;
  as_of: string;
  vacancy_rate: number | null;
  turnover_rate: number | null;
  ownership_hhi: number | null;
  local_ownership_share: number | null;
  permit_count: number | null;
  incentive_coverage: number | null;
  computed_at: string;
  details: unknown;
}

function serialize(r: CorridorRow) {
  return {
    corridorType: r.corridor_type,
    corridorId: r.corridor_id,
    asOf: r.as_of,
    vacancyRate: r.vacancy_rate,
    turnoverRate: r.turnover_rate,
    ownershipHHI: r.ownership_hhi,
    localOwnershipShare: r.local_ownership_share,
    permitCount: r.permit_count,
    incentiveCoverage: r.incentive_coverage,
    computedAt: r.computed_at,
    details: typeof r.details === "string" ? JSON.parse(r.details) : r.details,
  };
}

function isMissingCorridorTableError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "42P01"
  );
}

export async function GET(request: NextRequest) {
  const zip = request.nextUrl.searchParams.get("zip");

  const sql = getSQL();
  if (!sql) {
    // DB not configured — return an empty, well-formed response.
    return NextResponse.json(
      { corridors: [] },
      {
        headers: {
          "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
        },
      }
    );
  }

  try {
    // DISTINCT ON returns only the most recent snapshot per corridor.
    const rows = (zip
      ? await sql`
          SELECT DISTINCT ON (corridor_type, corridor_id)
            corridor_type, corridor_id, as_of,
            vacancy_rate, turnover_rate, ownership_hhi,
            local_ownership_share, permit_count, incentive_coverage,
            computed_at, details
          FROM corridor_metrics
          WHERE corridor_type = 'zip' AND corridor_id = ${zip}
          ORDER BY corridor_type, corridor_id, as_of DESC
        `
      : await sql`
          SELECT DISTINCT ON (corridor_type, corridor_id)
            corridor_type, corridor_id, as_of,
            vacancy_rate, turnover_rate, ownership_hhi,
            local_ownership_share, permit_count, incentive_coverage,
            computed_at, details
          FROM corridor_metrics
          WHERE corridor_type = 'zip'
          ORDER BY corridor_type, corridor_id, as_of DESC
        `) as CorridorRow[];

    return NextResponse.json(
      { corridors: rows.map(serialize) },
      {
        headers: {
          "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
        },
      }
    );
  } catch (err) {
    if (isMissingCorridorTableError(err)) {
      return NextResponse.json(
        { corridors: [] },
        {
          headers: {
            "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=300",
          },
        }
      );
    }
    console.error("corridor API error:", err);
    return NextResponse.json({ error: "Database query failed" }, { status: 500 });
  }
}
