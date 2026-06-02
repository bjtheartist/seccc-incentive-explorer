import { NextRequest, NextResponse } from "next/server";
import citywideGrowthSnapshot from "@/data/exports/chicago-neighborhood-economics/neighborhood_economics_by_zip.json";
import southeastGrowthSnapshot from "@/data/exports/southeast-resilience/neighborhood_growth_signal.json";
import { getSQL } from "@/lib/db";
import {
  findGrowthSignalByZip,
  growthSignalToNeighborhoodEconomics,
  mergeCorridorMetricIntoNeighborhoodEconomics,
  type NeighborhoodCorridorMetricInput,
  type NeighborhoodGrowthSnapshot,
} from "@/lib/neighborhood-economic-context";

const citywideSnapshot = citywideGrowthSnapshot as NeighborhoodGrowthSnapshot;
const southeastSnapshot = southeastGrowthSnapshot as NeighborhoodGrowthSnapshot;

interface CorridorMetricRow {
  corridor_type: string;
  corridor_id: string;
  as_of: string | null;
  local_ownership_share: number | null;
  permit_count: number | null;
  details: unknown;
}

function isMissingCorridorTableError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "42P01"
  );
}

function parseDetails(details: unknown): NeighborhoodCorridorMetricInput["details"] {
  if (!details) return null;
  if (typeof details === "string") {
    try {
      return JSON.parse(details) as NeighborhoodCorridorMetricInput["details"];
    } catch {
      return null;
    }
  }
  return details as NeighborhoodCorridorMetricInput["details"];
}

async function latestCorridorMetric(zip: string): Promise<NeighborhoodCorridorMetricInput | null> {
  const sql = getSQL();
  if (!sql) return null;

  try {
    const rows = (await sql`
      SELECT corridor_type, corridor_id, as_of, local_ownership_share, permit_count, details
      FROM corridor_metrics
      WHERE corridor_type = 'zip' AND corridor_id = ${zip}
      ORDER BY as_of DESC
      LIMIT 1
    `) as CorridorMetricRow[];

    const row = rows[0];
    if (!row) return null;

    return {
      corridorType: row.corridor_type,
      corridorId: row.corridor_id,
      asOf: row.as_of,
      localOwnershipShare: row.local_ownership_share,
      permitCount: row.permit_count,
      details: parseDetails(row.details),
    };
  } catch (err) {
    if (isMissingCorridorTableError(err)) return null;
    throw err;
  }
}

function snapshotForZip(zip: string): { snapshot: NeighborhoodGrowthSnapshot; sourceLabel: string } {
  if (findGrowthSignalByZip(citywideSnapshot, zip)) {
    return { snapshot: citywideSnapshot, sourceLabel: "citywide-public-aggregate" };
  }
  return { snapshot: southeastSnapshot, sourceLabel: "southeast-proof-of-concept" };
}

/**
 * GET /api/neighborhood-economics?zip=60619
 *
 * Returns aggregate ZIP-level economic context for reports. This endpoint never
 * exposes row-level business, owner, parcel, or address records.
 */
export async function GET(request: NextRequest) {
  const zip = request.nextUrl.searchParams.get("zip")?.trim();

  if (!zip || !/^\d{5}$/.test(zip)) {
    return NextResponse.json(
      { error: "zip must be a 5-digit ZIP code" },
      { status: 400 }
    );
  }

  const { snapshot, sourceLabel } = snapshotForZip(zip);
  const signal = findGrowthSignalByZip(snapshot, zip);
  const baseEconomics = signal
    ? growthSignalToNeighborhoodEconomics(signal, snapshot)
    : null;
  const corridorMetric = await latestCorridorMetric(zip);
  const neighborhoodEconomics = mergeCorridorMetricIntoNeighborhoodEconomics(
    baseEconomics,
    corridorMetric
  );

  return NextResponse.json(
    {
      zip,
      availableZips: snapshot.zips,
      source: snapshot.source,
      artifactSource: sourceLabel,
      corridorMetricAvailable: Boolean(corridorMetric),
      neighborhoodEconomics,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
      },
    }
  );
}
