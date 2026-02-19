import { NextRequest, NextResponse } from "next/server";

/**
 * Queries the City of Chicago ArcGIS MapServer for the zoning classification
 * at a given lat/lon. Uses the official city GIS zoning layer.
 *
 * GET /api/zoning?lat=41.75&lon=-87.58
 */

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

function deriveZoneType(zoneClass: string): string | null {
  const prefix = zoneClass.replace(/[-\d.]+.*$/, "").toUpperCase();
  return ZONING_TYPE_MAP[prefix] || null;
}

export async function GET(request: NextRequest) {
  const lat = request.nextUrl.searchParams.get("lat");
  const lon = request.nextUrl.searchParams.get("lon");

  if (!lat || !lon) {
    return NextResponse.json(
      { error: "lat and lon are required" },
      { status: 400 }
    );
  }

  // Try the Chicago ArcGIS MapServer first (most reliable)
  try {
    const arcgisUrl = new URL(
      "https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/Zoning/MapServer/0/query"
    );
    arcgisUrl.searchParams.set("geometry", `${lon},${lat}`);
    arcgisUrl.searchParams.set("geometryType", "esriGeometryPoint");
    arcgisUrl.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    arcgisUrl.searchParams.set("outFields", "ZONE_CLASS,ZONE_TYPE");
    arcgisUrl.searchParams.set("returnGeometry", "false");
    arcgisUrl.searchParams.set("f", "json");

    const res = await fetch(arcgisUrl.toString(), {
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.features && data.features.length > 0) {
        const attrs = data.features[0].attributes;
        const zoneClass = attrs.ZONE_CLASS || attrs.ZONE_TYPE || null;
        if (zoneClass) {
          return NextResponse.json({
            zoneClass,
            zoneType: deriveZoneType(zoneClass),
          });
        }
      }
    }
  } catch {
    // Fall through to Socrata backup
  }

  // Fallback: Socrata SODA API
  try {
    const sodaUrl = `https://data.cityofchicago.org/resource/7cra-3bfp.json?$where=within_circle(the_geom,${lat},${lon},10)&$limit=1`;
    const res = await fetch(sodaUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        const record = data[0];
        const zoneClass: string = record.zone_class || record.zone_type || null;
        if (zoneClass) {
          return NextResponse.json({
            zoneClass,
            zoneType: deriveZoneType(zoneClass),
          });
        }
      }
    }
  } catch {
    // Fall through
  }

  return NextResponse.json({ zoneClass: null, zoneType: null });
}
