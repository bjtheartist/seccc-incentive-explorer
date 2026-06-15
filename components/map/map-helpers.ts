/**
 * Map helper constants, types, and utility functions.
 * Extracted from MapView.tsx to keep the main component focused on rendering and state.
 */

import mapboxgl from "mapbox-gl";
import { POINT_DATA_ZONE_KEYS, ZONE_META, ZONING_CATEGORIES } from "@/lib/constants";
import type { DistrictData } from "@/lib/types";
import type { SiteSignals } from "@/lib/site-signals";
import type { TransportAccess } from "@/lib/transport-access";
import { cachedFetch } from "@/lib/fetch-cache";

/* ── Zone file mapping (static fallback for keys without DB data) ───── */
export const ZONE_FILES: Record<string, string> = {
  tif: "tif-districts.geojson",
  federalOZ: "federal-oz.geojson",
  enterprise: "enterprise-zones.geojson",
  stateIncentiveZones: "edge-zones.geojson",
  ssa: "special-service-areas.geojson",
  highUnemployment: "high-unemployment.geojson",
  landmarkDistricts: "landmark-districts.geojson",
  nrhpDistricts: "nrhp-districts.geojson",
  industrialCorridors: "industrial-corridors.geojson",
  microMarketRecovery: "micro-market-recovery.geojson",
  nof: "nof-corridors.geojson",
  ccsa: "ccsa-corridors.geojson",
  nmtcEligible: "nmtc-eligible.geojson",
  qct: "qct.geojson",
  brownfields: "brownfield-sites.geojson",
  energyCommunities: "energy-communities.geojson",
  hubzone: "hubzone.geojson",
  lustSites: "lust-sites.geojson",
  nofFundedProjects: "nof-funded-projects.geojson",
  countyIncentiveParcels: "county-incentive-parcels.geojson",
};

/** Zone keys that use Point geometry and need circle layers instead of fill/line. */
export const POINT_ZONE_KEYS = new Set<string>(POINT_DATA_ZONE_KEYS);

/** Helper: check if a zone should be hidden by default. */
export function isZoneDefaultHidden(key: string): boolean {
  return !ZONE_META[key]?.defaultVisible;
}

/** Heavy-coverage layers get reduced opacity to avoid blocking the map. */
export const HEAVY_COVERAGE_KEYS = new Set([
  "nmtcEligible", "qct", "landmarkDistricts", "nrhpDistricts",
  "highUnemployment", "industrialCorridors", "stateIncentiveZones",
  "energyCommunities", "hubzone",
]);

/** Chicago 77 community areas GeoJSON endpoint (Data Portal). */
export const COMMUNITY_AREAS_URL = "https://data.cityofchicago.org/resource/igwz-8jzy.geojson?$limit=100";

/** Chicago zoning districts GeoJSON endpoint (Data Portal). */
export const CHICAGO_ZONING_URL = "https://data.cityofchicago.org/resource/dj47-wfun.geojson?$limit=50000";

/** Empty GeoJSON FeatureCollection used as initial/cleared data. */
export const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Cook County ArcGIS parcels endpoint (Layer 44). */
export const PARCELS_QUERY_BASE =
  "https://gis.cookcountyil.gov/traditional/rest/services/cookVwrDynmc/MapServer/44/query";

export function buildZoningColorExpression(): mapboxgl.Expression {
  const zoneClassProp: mapboxgl.Expression = ["get", "zone_class"];
  const sortedEntries: { prefix: string; color: string }[] = [];
  for (const cat of ZONING_CATEGORIES) {
    for (const prefix of cat.prefixes) {
      sortedEntries.push({ prefix, color: cat.color });
    }
  }
  sortedEntries.sort((a, b) => b.prefix.length - a.prefix.length);
  const cases: mapboxgl.Expression = ["case"];
  for (const { prefix, color } of sortedEntries) {
    (cases as unknown[]).push(
      ["==", ["slice", ["to-string", zoneClassProp], 0, prefix.length], prefix],
      color
    );
  }
  (cases as unknown[]).push("#C7C7CC");
  return cases;
}

/** Chicago bounding box — reject data outside this range (bad projections). */
export const CHI_BOUNDS = { minLon: -88.0, maxLon: -87.4, minLat: 41.6, maxLat: 42.1 };

export function isFeatureInChicago(feature: GeoJSON.Feature): boolean {
  try {
    const geom = feature.geometry;
    if (!geom || !("coordinates" in geom)) return false;
    const coords = JSON.stringify(geom.coordinates);
    const nums = coords.match(/-?\d+\.\d+/g);
    if (!nums || nums.length < 2) return false;
    const lon = parseFloat(nums[0]);
    const lat = parseFloat(nums[1]);
    return lon >= CHI_BOUNDS.minLon && lon <= CHI_BOUNDS.maxLon &&
           lat >= CHI_BOUNDS.minLat && lat <= CHI_BOUNDS.maxLat;
  } catch {
    return false;
  }
}

/** Module-level cache so toggling layers on/off/on is instant. */
const zoneGeoJSONCache = new Map<string, GeoJSON.FeatureCollection>();

export async function fetchZoneGeoJSON(key: string): Promise<GeoJSON.FeatureCollection | null> {
  const cached = zoneGeoJSONCache.get(key);
  if (cached) return cached;
  const geojsonUrl =
    key === "nof"
      ? "/api/zones/geojson/nof?v=20260605-corridors"
      : `/api/zones/geojson/${key}`;

  try {
    const data = await cachedFetch<GeoJSON.FeatureCollection>(geojsonUrl);
    if (data?.features?.length > 0) {
      if (isFeatureInChicago(data.features[0])) {
        zoneGeoJSONCache.set(key, data);
        return data;
      }
      console.warn(`[MapView] DB data for "${key}" has out-of-range coordinates, falling back to static file`);
    }
  } catch {
    // Fall through to static
  }
  const file = ZONE_FILES[key];
  if (!file) return null;
  try {
    const data = await cachedFetch<GeoJSON.FeatureCollection>(`/data/zones/${file}`);
    if (data) {
      zoneGeoJSONCache.set(key, data);
      return data;
    }
  } catch {
    // No data available
  }
  return null;
}

/* ── POI layer config (Chicago Data Portal SODA) ─ */
export interface PoiConfig {
  label: string;
  color: string;
  icon: string;
  format: "geojson" | "json";
  url: string;
  latField?: string;
  lonField?: string;
  nameField?: string;
}

export const POI_LAYERS: Record<string, PoiConfig> = {
  ctaStations: {
    label: "CTA L Stations",
    color: "#e11d48",
    icon: "rail",
    format: "geojson",
    url: "https://data.cityofchicago.org/resource/8pix-ypme.geojson?$limit=400",
  },
  schools: {
    label: "K-12 Schools",
    color: "#d97706",
    icon: "school",
    format: "json",
    url: "https://data.cityofchicago.org/resource/kh4r-387c.json?$limit=800&$select=short_name,address,school_latitude,school_longitude,primary_category",
    latField: "school_latitude",
    lonField: "school_longitude",
    nameField: "short_name",
  },
  libraries: {
    label: "Libraries",
    color: "#7c3aed",
    icon: "library",
    format: "geojson",
    url: "https://data.cityofchicago.org/resource/x8fc-8rcq.geojson?$limit=100",
  },
};

/** Convert JSON array with lat/lon fields to GeoJSON FeatureCollection */
export function jsonToGeoJSON(
  rows: Record<string, string>[],
  latField: string,
  lonField: string
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: rows
      .filter((r) => r[latField] && r[lonField])
      .map((r) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [parseFloat(r[lonField]), parseFloat(r[latField])],
        },
        properties: r,
      })),
  };
}

/* ── Neighborhood stats type ─────────────── */
export interface AreaStats {
  medianHomePrice: string;
  medianIncome: string;
  walkScore: number;
  parcelPin?: string;
  parcelClass?: string;
  parcelClassDescription?: string;
  parcelValue?: string;
  parcelTaxCode?: string;
  parcelTownship?: string;
  parcelType?: string;
  districts?: DistrictData;
  districtsLoading?: boolean;
  assessedLand?: number | null;
  assessedBuilding?: number | null;
  assessedTotal?: number | null;
  taxYear?: string | null;
  priorYearTax?: number | null;
  ownerName?: string | null;
  ownerType?: string | null;
  siteSignals?: SiteSignals | null;
  transport?: TransportAccess | null;
}

export const DEFAULT_STATS: AreaStats = {
  medianHomePrice: "$142,000",
  medianIncome: "$38,500",
  walkScore: 11,
};

/* ── Map Presets ──────────────────────────── */
export interface MapPreset {
  id: string;
  label: string;
  zones?: string[] | "location" | "all";
  zoning?: boolean;
  vacancy?: boolean;
  parcels?: boolean;
}

export const MAP_PRESETS: MapPreset[] = [
  {
    id: "city",
    label: "City",
    zones: ["tif", "ssa", "nof", "ccsa", "industrialCorridors", "microMarketRecovery", "landmarkDistricts"],
    zoning: false,
    vacancy: false,
    parcels: false,
  },
  {
    id: "state",
    label: "State",
    zones: ["enterprise", "stateIncentiveZones", "lustSites"],
    zoning: false,
    vacancy: false,
    parcels: false,
  },
  {
    id: "federal",
    label: "Federal",
    zones: ["federalOZ", "highUnemployment", "nmtcEligible", "qct", "nrhpDistricts", "hubzone", "energyCommunities", "brownfields"],
    zoning: false,
    vacancy: false,
    parcels: false,
  },
  {
    id: "environmental",
    label: "Environmental",
    zones: ["brownfields", "lustSites", "energyCommunities", "enterprise", "stateIncentiveZones", "industrialCorridors", "countyIncentiveParcels"],
    zoning: false,
    vacancy: false,
    parcels: true,
  },
  {
    id: "zoning",
    label: "Zoning",
    zones: [],
    zoning: true,
    vacancy: false,
    parcels: true,
  },
  {
    id: "vacancy",
    label: "Vacancy",
    zones: [],
    zoning: false,
    vacancy: true,
    parcels: true,
  },
];
