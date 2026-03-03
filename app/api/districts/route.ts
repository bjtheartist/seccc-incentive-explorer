import { NextRequest, NextResponse } from "next/server";
import { cached, roundCoord } from "@/lib/redis";
import type { DistrictData } from "@/lib/types";

/**
 * Queries political/tax district boundaries for a given lat/lon.
 *
 * Fires all 5 district queries in parallel via Promise.allSettled:
 * - Ward (Chicago Data Portal SODA)
 * - Commissioner District (Cook County ArcGIS politicalBoundary Layer 1)
 * - Congressional District (Cook County ArcGIS politicalBoundary Layer 8)
 * - State House District (Cook County ArcGIS politicalBoundary Layer 6)
 * - State Senate District (Cook County ArcGIS politicalBoundary Layer 7)
 *
 * GET /api/districts?lat=41.75&lon=-87.58
 */

const CDN_HEADERS = {
  "Cache-Control": "public, s-maxage=2592000, stale-while-revalidate=86400",
};

const ARCGIS_BASE =
  "https://gis.cookcountyil.gov/traditional/rest/services/politicalBoundary/MapServer";

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

/** Query a Cook County ArcGIS politicalBoundary layer by point. */
async function queryArcGISLayer(
  layer: number,
  field: string,
  lat: number,
  lon: number
): Promise<string | null> {
  const url = new URL(`${ARCGIS_BASE}/${layer}/query`);
  url.searchParams.set(
    "geometry",
    JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } })
  );
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", field);
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");

  const res = await fetchWithRetry(url.toString(), {});
  if (!res.ok) return null;

  const data = await res.json();
  if (data.features && data.features.length > 0) {
    const val = data.features[0].attributes[field];
    return val != null ? String(val) : null;
  }
  return null;
}

/** Query Chicago ward via SODA within_circle. */
async function queryWard(lat: number, lon: number): Promise<string | null> {
  const url = `https://data.cityofchicago.org/resource/p293-wvbd.json?$where=within_circle(the_geom,${lat},${lon},10)&$limit=1&$select=ward`;
  const res = await fetchWithRetry(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;

  const data = await res.json();
  if (data && data.length > 0 && data[0].ward) {
    return String(data[0].ward);
  }
  return null;
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

  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);
  const cacheKey = `districts:${roundCoord(latNum)}:${roundCoord(lonNum)}`;

  const result = await cached<DistrictData>(cacheKey, 2592000, async () => {
    const [ward, commissioner, congressional, stateHouse, stateSenate] =
      await Promise.allSettled([
        queryWard(latNum, lonNum),
        queryArcGISLayer(1, "District_1", latNum, lonNum),
        queryArcGISLayer(8, "District_1", latNum, lonNum),
        queryArcGISLayer(6, "District_1", latNum, lonNum),
        queryArcGISLayer(7, "SenateNum", latNum, lonNum),
      ]);

    return {
      ward: ward.status === "fulfilled" ? ward.value : null,
      commissionerDistrict:
        commissioner.status === "fulfilled" ? commissioner.value : null,
      congressionalDistrict:
        congressional.status === "fulfilled" ? congressional.value : null,
      stateHouseDistrict:
        stateHouse.status === "fulfilled" ? stateHouse.value : null,
      stateSenateDistrict:
        stateSenate.status === "fulfilled" ? stateSenate.value : null,
    };
  });

  return NextResponse.json(result, { headers: CDN_HEADERS });
}
