import { cached, roundCoord } from "@/lib/redis";
import type { DistrictData } from "@/lib/types";

export const DISTRICT_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

const ARCGIS_BASE =
  "https://gis.cookcountyil.gov/traditional/rest/services/politicalBoundary/MapServer";

export function parseLatLon(
  lat: string | null,
  lon: string | null,
): { latNum: number; lonNum: number; error?: never } | { error: string } {
  if (!lat || !lon) return { error: "lat and lon are required" };

  const latNum = Number.parseFloat(lat);
  const lonNum = Number.parseFloat(lon);
  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
    return { error: "lat and lon must be valid numbers" };
  }

  return { latNum, lonNum };
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = 2,
  baseDelay = 1000,
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
      await new Promise((resolve) => setTimeout(resolve, baseDelay * Math.pow(2, attempt)));
    }
  }
  throw lastError || new Error("fetchWithRetry exhausted");
}

async function queryArcGISLayer(
  layer: number,
  field: string,
  lat: number,
  lon: number,
): Promise<string | null> {
  const url = new URL(`${ARCGIS_BASE}/${layer}/query`);
  url.searchParams.set(
    "geometry",
    JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
  );
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", field);
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");

  const res = await fetchWithRetry(url.toString());
  if (!res.ok) return null;

  const data = await res.json();
  if (data.features && data.features.length > 0) {
    const val = data.features[0].attributes[field];
    return val != null ? String(val) : null;
  }
  return null;
}

async function queryWard(lat: number, lon: number): Promise<string | null> {
  const url = new URL("https://data.cityofchicago.org/resource/p293-wvbd.json");
  url.searchParams.set("$where", `intersects(the_geom, 'POINT (${lon} ${lat})')`);
  url.searchParams.set("$limit", "1");
  url.searchParams.set("$select", "ward");

  const res = await fetchWithRetry(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;

  const data = await res.json();
  if (data && data.length > 0 && data[0].ward) {
    return String(data[0].ward);
  }
  return null;
}

/**
 * City of Chicago "Boundaries - Police Districts" (Socrata `9vmg-9p8p`),
 * queried live the same way `queryWard` reads `p293-wvbd` — no committed
 * boundary file, no client-side geometry work; Socrata does the
 * intersects() test server-side. `DIST_NUM="31"` is excluded: it is not one
 * of the 22 current geographic patrol districts (verified against the
 * dataset's own row count — see lib/__tests__/district-lookup.test.ts).
 */
async function queryPoliceDistrict(lat: number, lon: number): Promise<string | null> {
  const url = new URL("https://data.cityofchicago.org/resource/9vmg-9p8p.json");
  url.searchParams.set(
    "$where",
    `intersects(the_geom, 'POINT (${lon} ${lat})') AND DIST_NUM != '31'`,
  );
  url.searchParams.set("$limit", "1");
  url.searchParams.set("$select", "DIST_NUM");

  const res = await fetchWithRetry(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;

  const data = await res.json();
  if (data && data.length > 0 && data[0].DIST_NUM) {
    return String(data[0].DIST_NUM);
  }
  return null;
}

export async function getDistrictData(lat: number, lon: number): Promise<DistrictData> {
  const cacheKey = `districts:v4:${roundCoord(lat)}:${roundCoord(lon)}`;

  return cached<DistrictData>(cacheKey, DISTRICT_CACHE_TTL_SECONDS, async () => {
    const [ward, commissioner, congressional, stateHouse, stateSenate, policeDistrict] =
      await Promise.allSettled([
        queryWard(lat, lon),
        queryArcGISLayer(9, "DISTRICT_INT", lat, lon),
        queryArcGISLayer(13, "DISTRICT_INT", lat, lon),
        queryArcGISLayer(11, "DISTRICT_INT", lat, lon),
        queryArcGISLayer(12, "DISTRICT_INT", lat, lon),
        queryPoliceDistrict(lat, lon),
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
      policeDistrict:
        policeDistrict.status === "fulfilled" ? policeDistrict.value : null,
    };
  });
}
