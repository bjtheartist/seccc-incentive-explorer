import * as turf from "@turf/turf";
import { ZONE_KEYS } from "./constants";
import type { LookupResult } from "./types";
import type { FeatureCollection, Feature, Polygon, MultiPolygon } from "geojson";

const zoneFileMap: Record<string, string> = {
  tif: "/data/zones/tif-districts.geojson",
  federalOZ: "/data/zones/federal-oz.geojson",
  illinoisOZ: "/data/zones/illinois-oz.geojson",
  enterprise: "/data/zones/enterprise-zones.geojson",
  edge: "/data/zones/edge-zones.geojson",
  rev: "/data/zones/rev-zones.geojson",
  micro: "/data/zones/micro-zones.geojson",
  dataCenter: "/data/zones/data-center-zones.geojson",
  ssa: "/data/zones/special-service-areas.geojson",
  tripleBenefit: "/data/zones/triple-benefit-zones.geojson",
  highUnemployment: "/data/zones/high-unemployment.geojson",
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
 * Check which incentive zones a lat/lon point falls within.
 * Uses Turf.js booleanPointInPolygon against clipped GeoJSON layers.
 * Also extracts zone names and employment data from feature properties.
 */
export async function checkZones(
  lat: number,
  lon: number
): Promise<LookupResult> {
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
            const props = feature.properties || {};

            // Extract zone name from feature properties
            if (props.name) {
              zoneNames[key] = props.name;
            }

            // Extract employment data from high-unemployment zone.
            // In the GeoJSON export, "Census Tract ID" holds the unemployment
            // rate and "Area" holds the population.
            if (key === "highUnemployment") {
              const rate = props["Census Tract ID"]; // e.g. "34.3%"
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

  return {
    matched: false,
    address: "",
    lat,
    lon,
    zones,
    zoneNames,
    incentiveCount,
    employment,
  };
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
  // Already has rate data
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
