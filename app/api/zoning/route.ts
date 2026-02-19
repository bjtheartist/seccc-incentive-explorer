import { NextRequest, NextResponse } from "next/server";

/**
 * Queries the City of Chicago Data Portal for the zoning classification
 * at a given lat/lon. Uses the "Boundaries - Zoning Districts (current)"
 * dataset via Socrata SODA API.
 *
 * GET /api/zoning?lat=41.75&lon=-87.58
 */
export async function GET(request: NextRequest) {
  const lat = request.nextUrl.searchParams.get("lat");
  const lon = request.nextUrl.searchParams.get("lon");

  if (!lat || !lon) {
    return NextResponse.json(
      { error: "lat and lon are required" },
      { status: 400 }
    );
  }

  try {
    const url = `https://data.cityofchicago.org/resource/7cra-3bfp.json?$where=within_circle(the_geom,${lat},${lon},10)&$limit=1`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Zoning service unavailable" },
        { status: 502 }
      );
    }

    const data = await res.json();

    if (!data || data.length === 0) {
      return NextResponse.json({ zoneClass: null, zoneType: null });
    }

    const record = data[0];
    const zoneClass: string = record.zone_class || record.zone_type || null;

    // Derive a human-readable zoning type from the zone class prefix
    let zoneType: string | null = null;
    if (zoneClass) {
      const prefix = zoneClass.replace(/[-\d.]+.*$/, "").toUpperCase();
      const ZONING_TYPE_MAP: Record<string, string> = {
        R: "Residential",
        RS: "Residential Single-Unit",
        RT: "Residential Two-Flat / Townhouse",
        RM: "Residential Multi-Unit",
        B: "Business",
        C: "Commercial",
        M: "Manufacturing",
        DS: "Downtown Service",
        DC: "Downtown Core",
        DX: "Downtown Mixed-Use",
        DR: "Downtown Residential",
        PD: "Planned Development",
        PMD: "Planned Manufacturing District",
        POS: "Parks & Open Space",
        T: "Transportation",
      };
      zoneType = ZONING_TYPE_MAP[prefix] || null;
    }

    return NextResponse.json({ zoneClass, zoneType });
  } catch {
    return NextResponse.json(
      { error: "Zoning lookup failed" },
      { status: 500 }
    );
  }
}
