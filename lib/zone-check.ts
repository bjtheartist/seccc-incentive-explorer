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
 */
export async function checkZones(
  lat: number,
  lon: number
): Promise<LookupResult> {
  const pt = turf.point([lon, lat]);
  const zones: Record<string, boolean> = {};
  let incentiveCount = 0;

  await Promise.all(
    ZONE_KEYS.map(async (key) => {
      try {
        const fc = await loadZone(key);
        let inZone = false;
        for (const feature of fc.features) {
          if (feature.geometry && turf.booleanPointInPolygon(pt, feature as Feature<Polygon | MultiPolygon>)) {
            inZone = true;
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
    incentiveCount,
  };
}
