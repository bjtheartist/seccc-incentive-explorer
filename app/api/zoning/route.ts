import { NextRequest, NextResponse } from "next/server";

/**
 * Queries the City of Chicago zoning classification at a given lat/lon.
 *
 * Strategy:
 * 1. Chicago ArcGIS MapServer (primary) — with retry
 * 2. Socrata SODA API (fallback) — with retry
 * 3. Chicago Data Portal GeoJSON endpoint (second fallback)
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

/** Fetch with retry and exponential backoff. */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 2,
  baseDelay = 1000
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return res;
      // Non-retryable HTTP errors (4xx)
      if (res.status >= 400 && res.status < 500) return res;
    } catch (err) {
      lastError = err;
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, baseDelay * Math.pow(2, attempt)));
    }
  }
  throw lastError || new Error("fetchWithRetry exhausted");
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

  // Source 1: Chicago ArcGIS MapServer (primary, with retry)
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

    const res = await fetchWithRetry(arcgisUrl.toString(), {});
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

  // Source 2: Socrata SODA API (fallback, with retry)
  try {
    const sodaUrl = `https://data.cityofchicago.org/resource/7cra-3bfp.json?$where=within_circle(the_geom,${lat},${lon},10)&$limit=1`;
    const res = await fetchWithRetry(sodaUrl, {
      headers: { Accept: "application/json" },
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        const record = data[0];
        const zoneClass: string =
          record.zone_class || record.zone_type || null;
        if (zoneClass) {
          return NextResponse.json({
            zoneClass,
            zoneType: deriveZoneType(zoneClass),
          });
        }
      }
    }
  } catch {
    // Fall through to GeoJSON backup
  }

  // Source 3: Chicago Data Portal GeoJSON endpoint (second fallback)
  try {
    const geoUrl = `https://data.cityofchicago.org/resource/7cra-3bfp.geojson?$where=intersects(the_geom,'POINT(${lon} ${lat})')&$limit=1`;
    const res = await fetchWithRetry(geoUrl, {
      headers: { Accept: "application/json" },
    });

    if (res.ok) {
      const data = await res.json();
      if (data.features && data.features.length > 0) {
        const props = data.features[0].properties;
        const zoneClass: string =
          props.zone_class || props.zone_type || null;
        if (zoneClass) {
          return NextResponse.json({
            zoneClass,
            zoneType: deriveZoneType(zoneClass),
          });
        }
      }
    }
  } catch {
    // All sources failed
  }

  return NextResponse.json({ zoneClass: null, zoneType: null });
}
