import * as turf from "@turf/turf";
import { ZONE_KEYS } from "./constants";
import { normalizeZoneCheckResponse } from "./zone-response";
import { featureDisplayName } from "./zone-names";
import type { LookupResult, CityZoning, CensusData, ZoneCheckResult } from "./types";
import type { FeatureCollection, Feature, Polygon, MultiPolygon } from "geojson";

const zoneFileMap: Record<string, string> = {
  tif: "/data/zones/tif-districts.geojson",
  federalOZ: "/data/zones/federal-oz.geojson",
  enterprise: "/data/zones/enterprise-zones.geojson",
  stateIncentiveZones: "/data/zones/edge-zones.geojson",
  ssa: "/data/zones/special-service-areas.geojson",
  highUnemployment: "/data/zones/high-unemployment.geojson",
  industrialCorridors: "/data/zones/industrial-corridors.geojson",
  microMarketRecovery: "/data/zones/micro-market-recovery.geojson",
  nof: "/data/zones/nof-corridors.geojson",
  ccsa: "/data/zones/ccsa-corridors.geojson",
  nmtcEligible: "/data/zones/nmtc-eligible.geojson",
  qct: "/data/zones/qct.geojson",
  landmarkDistricts: "/data/zones/landmark-districts.geojson",
  nrhpDistricts: "/data/zones/nrhp-districts.geojson",
};

// Cache loaded GeoJSON in memory
const zoneCache: Record<string, FeatureCollection> = {};

async function loadZone(key: string): Promise<FeatureCollection> {
  if (zoneCache[key]) return zoneCache[key];
  const res = await fetch(zoneFileMap[key]);
  const data = await res.json();
  zoneCache[key] = data;
  return data;
}

/**
 * Try DB-first zone check via /api/zones/check endpoint.
 * Returns null if the API is unavailable (falls through to Turf.js).
 */
async function checkZonesDB(
  lat: number,
  lon: number
): Promise<{ zones: Record<string, boolean>; zoneNames: Record<string, string>; incentiveCount: number } | null> {
  try {
    const res = await fetch(`/api/zones/check?lat=${lat}&lon=${lon}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const results: ZoneCheckResult[] = await res.json();
    return normalizeZoneCheckResponse(results);
  } catch {
    return null;
  }
}

/**
 * Try DB-first census lookup via /api/census endpoint.
 */
async function getCensusDB(lat: number, lon: number): Promise<CensusData | null> {
  try {
    const res = await fetch(`/api/census?lat=${lat}&lon=${lon}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch {
    return null;
  }
}

/**
 * Turf.js fallback — check zones using client-side GeoJSON point-in-polygon.
 */
async function checkZonesTurf(
  lat: number,
  lon: number
): Promise<{ zones: Record<string, boolean>; zoneNames: Record<string, string>; incentiveCount: number; employment?: LookupResult["employment"] }> {
  const pt = turf.point([lon, lat]);
  const zones: Record<string, boolean> = {};
  const zoneNames: Record<string, string> = {};
  let incentiveCount = 0;
  let employment: LookupResult["employment"] = undefined;

  await Promise.all(
    ZONE_KEYS.map(async (key) => {
      try {
        const fc = await loadZone(key);
        let inZone = false;
        for (const feature of fc.features) {
          if (feature.geometry && turf.booleanPointInPolygon(pt, feature as Feature<Polygon | MultiPolygon>)) {
            inZone = true;

            const name = featureDisplayName(key, feature);
            if (name) zoneNames[key] = name;

            if (key === "highUnemployment") {
              const props = feature.properties || {};
              const rate = props["Census Tract ID"];
              const pop = parseInt(props["Area"], 10);
              if (rate) {
                employment = {
                  censusTract: props.name || props.description || "",
                  unemploymentRate: rate,
                  population: isNaN(pop) ? 0 : pop,
                };
              }
            }

            break;
          }
        }
        zones[key] = inZone;
        if (inZone) incentiveCount++;
      } catch {
        zones[key] = false;
      }
    })
  );

  return { zones, zoneNames, incentiveCount, employment };
}

/**
 * Check which incentive zones a lat/lon point falls within.
 *
 * Strategy: DB-first via PostGIS, with Turf.js fallback.
 * Also fetches census data and city zoning classification.
 */
export async function checkZones(
  lat: number,
  lon: number
): Promise<LookupResult> {
  // Try DB first, fallback to Turf.js
  let zones: Record<string, boolean>;
  let zoneNames: Record<string, string>;
  let incentiveCount: number;
  let employment: LookupResult["employment"] = undefined;

  const dbResult = await checkZonesDB(lat, lon);
  if (dbResult) {
    zones = dbResult.zones;
    zoneNames = dbResult.zoneNames;
    incentiveCount = dbResult.incentiveCount;
  } else {
    const turfResult = await checkZonesTurf(lat, lon);
    zones = turfResult.zones;
    zoneNames = turfResult.zoneNames;
    incentiveCount = turfResult.incentiveCount;
    employment = turfResult.employment;
  }

  // Fetch census data and city zoning in parallel
  const [census, cityZoning] = await Promise.all([
    getCensusDB(lat, lon),
    fetchCityZoning(lat, lon),
  ]);

  return {
    matched: false,
    address: "",
    lat,
    lon,
    zones,
    zoneNames,
    incentiveCount,
    cityZoning: cityZoning ?? undefined,
    employment,
    census: census ?? undefined,
  };
}

/**
 * Fetch city zoning classification (non-blocking, with retry).
 */
async function fetchCityZoning(lat: number, lon: number): Promise<CityZoning | null> {
  const attempt = async (n: number): Promise<CityZoning | null> => {
    try {
      const zRes = await fetch(`/api/zoning?lat=${lat}&lon=${lon}`, {
        signal: AbortSignal.timeout(12000),
      });
      if (zRes.ok) {
        const zData = await zRes.json();
        if (zData.zoneClass) {
          return { zoneClass: zData.zoneClass, zoneType: zData.zoneType };
        }
      }
    } catch {
      if (n < 1) {
        await new Promise((r) => setTimeout(r, 1500));
        return attempt(n + 1);
      }
    }
    return null;
  };
  return attempt(0);
}

/**
 * Enrich a LookupResult with employment data from the high-unemployment
 * GeoJSON, using the result's lat/lon. This is used for business matches
 * where zone-check wasn't run but the business is in a high-unemployment area.
 */
export async function enrichEmployment(
  result: LookupResult
): Promise<LookupResult> {
  if (!result.zones.highUnemployment || result.lat === 0) return result;
  if (result.employment?.unemploymentRate) return result;

  try {
    const pt = turf.point([result.lon, result.lat]);
    const fc = await loadZone("highUnemployment");
    for (const feature of fc.features) {
      if (feature.geometry && turf.booleanPointInPolygon(pt, feature as Feature<Polygon | MultiPolygon>)) {
        const props = feature.properties || {};
        const rate = props["Census Tract ID"];
        const pop = parseInt(props["Area"], 10);
        if (rate) {
          return {
            ...result,
            employment: {
              censusTract: props.name || props.description || "",
              unemploymentRate: rate,
              population: isNaN(pop) ? 0 : pop,
            },
          };
        }
        break;
      }
    }
  } catch {
    // Fall through — return original result without enrichment
  }
  return result;
}
