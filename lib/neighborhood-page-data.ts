/**
 * Build-time data module for static neighborhood incentive pages
 * (`app/neighborhoods/[slug]/incentives/page.tsx`).
 *
 * Every datum here is genuinely unique per community area:
 *  - top anchors (named institutions) from the neighborhood-economics export
 *  - real local business-support organizations (names, phones, websites)
 *  - vacant-property counts (normalized case match on community-area name)
 *  - a representative census tract (the tract polygon containing the centroid)
 *  - which incentive zones the centroid falls within (Turf point-in-polygon)
 *
 * The heavy JSON / GeoJSON files are large, so they are loaded ONCE (lazily, on
 * the first call) and every one of the 77 areas is precomputed into a single
 * module-level cache. Because `checkZonesTurf` is async, the cache is built
 * behind a memoized Promise. Everything is defensive: an area missing any data
 * source still produces a renderable record.
 */

import path from "node:path";
import { readFile } from "node:fs/promises";
import { booleanPointInPolygon, point } from "@turf/turf";
import type { Feature, Polygon, MultiPolygon } from "geojson";

import { CHICAGO_COMMUNITY_AREAS } from "@/lib/community-areas";
import { ZONE_LABELS } from "@/lib/constants";

/**
 * Zone key -> geojson filename under public/data/zones/. Mirrors the runtime
 * map in lib/zone-check.ts, but read from the filesystem so it works during
 * static build (the runtime version uses client-side fetch on relative URLs,
 * which does not resolve at build time).
 */
const ZONE_FILE_MAP: Record<string, string> = {
  tif: "tif-districts.geojson",
  federalOZ: "federal-oz.geojson",
  enterprise: "enterprise-zones.geojson",
  stateIncentiveZones: "edge-zones.geojson",
  ssa: "special-service-areas.geojson",
  highUnemployment: "high-unemployment.geojson",
  industrialCorridors: "industrial-corridors.geojson",
  microMarketRecovery: "micro-market-recovery.geojson",
  nof: "nof-corridors.geojson",
  ccsa: "ccsa-corridors.geojson",
  nmtcEligible: "nmtc-eligible.geojson",
  qct: "qct.geojson",
  landmarkDistricts: "landmark-districts.geojson",
  nrhpDistricts: "nrhp-districts.geojson",
  energyCommunities: "energy-communities.geojson",
  hubzone: "hubzone.geojson",
};

// ── Public types ────────────────────────────────────────────────────────────

export interface NeighborhoodAnchor {
  name: string;
  type: string;
  totalScore: number | null;
  impactTier: string | null;
  confidence: string | null;
}

export interface NeighborhoodSupportOrg {
  name: string;
  type: string | null;
  phone: string | null;
  website: string | null;
}

export interface NeighborhoodSupport {
  region: string | null;
  confidence: string | null;
  ssa: string | null;
  organizations: NeighborhoodSupportOrg[];
}

export interface NeighborhoodCensus {
  medianIncome: number | null;
  medianHomeValue: number | null;
  population: number | null;
  tractName: string | null;
}

export interface NeighborhoodPageData {
  anchors: NeighborhoodAnchor[];
  support: NeighborhoodSupport | null;
  vacancyCount: number;
  vacancyByType: Record<string, number>;
  census: NeighborhoodCensus | null;
  zones: string[];
  zoneCount: number;
}

// ── Raw file shapes (only the bits we read) ─────────────────────────────────

interface RawAnchor {
  name?: string;
  type?: string;
  totalScore?: number;
  impactTier?: string;
  confidence?: string;
}

interface RawSupportOrg {
  name?: string;
  primaryType?: string;
  phone?: string;
  website?: string;
}

interface RawAnchorsFile {
  byCommunityArea?: Record<string, { anchors?: RawAnchor[] }>;
}

interface RawSupportFile {
  byCommunityArea?: Record<
    string,
    {
      region?: string;
      confidence?: string;
      coverage?: { ssa?: string };
      organizations?: RawSupportOrg[];
    }
  >;
}

interface CensusTractProps {
  tractId?: string;
  name?: string;
  medianIncome?: number | null;
  medianHomeValue?: number | null;
  population?: number | null;
}

interface VacantProps {
  communityArea?: string;
  propertyType?: string;
}

// ── File loading (memoized) ─────────────────────────────────────────────────

const DATA_ROOT = process.cwd();

const ANCHORS_PATH = path.join(
  DATA_ROOT,
  "data/exports/chicago-neighborhood-economics/neighborhood_anchors_by_community_area.json",
);
const SUPPORT_PATH = path.join(
  DATA_ROOT,
  "data/exports/chicago-neighborhood-economics/local_business_support_by_community_area.json",
);
const VACANT_PATH = path.join(DATA_ROOT, "public/data/vacant-properties.json");
const CENSUS_PATH = path.join(DATA_ROOT, "public/data/census-tracts-2024.geojson");

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ── Per-source precompute helpers ───────────────────────────────────────────

function topAnchors(file: RawAnchorsFile, caId: number): NeighborhoodAnchor[] {
  const entry = file.byCommunityArea?.[String(caId)];
  const anchors = entry?.anchors ?? [];
  return anchors
    .filter((a): a is RawAnchor & { name: string } => Boolean(a && a.name))
    .slice(0, 5)
    .map((a) => ({
      name: a.name!,
      type: a.type ?? "Local anchor institution",
      totalScore: typeof a.totalScore === "number" ? a.totalScore : null,
      impactTier: a.impactTier ?? null,
      confidence: a.confidence ?? null,
    }));
}

function supportForArea(
  file: RawSupportFile,
  caId: number,
): NeighborhoodSupport | null {
  const entry = file.byCommunityArea?.[String(caId)];
  if (!entry) return null;
  const organizations = (entry.organizations ?? [])
    .filter((o): o is RawSupportOrg & { name: string } => Boolean(o && o.name))
    .slice(0, 4)
    .map((o) => ({
      name: o.name!,
      type: o.primaryType ?? null,
      phone: o.phone ?? null,
      website: o.website ?? null,
    }));
  if (
    organizations.length === 0 &&
    !entry.region &&
    !entry.coverage?.ssa
  ) {
    return null;
  }
  return {
    region: entry.region ?? null,
    confidence: entry.confidence ?? null,
    ssa: entry.coverage?.ssa ?? null,
    organizations,
  };
}

/**
 * Count vacant properties whose `communityArea` matches the area name,
 * comparing case-insensitively (the source data is case-inconsistent).
 * Returns total + a breakdown by `propertyType`.
 */
function buildVacancyIndex(
  features: { properties?: VacantProps }[],
): Map<string, { count: number; byType: Record<string, number> }> {
  const index = new Map<string, { count: number; byType: Record<string, number> }>();
  for (const f of features) {
    const rawName = f.properties?.communityArea;
    if (!rawName) continue;
    const key = rawName.toUpperCase().trim();
    let bucket = index.get(key);
    if (!bucket) {
      bucket = { count: 0, byType: {} };
      index.set(key, bucket);
    }
    bucket.count += 1;
    const type = f.properties?.propertyType || "unknown";
    bucket.byType[type] = (bucket.byType[type] || 0) + 1;
  }
  return index;
}

/**
 * Find the representative census tract: the tract polygon that CONTAINS the
 * community-area centroid. Honest framing — this is the tract at the
 * neighborhood's center point, not an area-wide aggregate.
 */
function representativeTract(
  features: Feature<Polygon | MultiPolygon, CensusTractProps>[],
  lat: number,
  lon: number,
): NeighborhoodCensus | null {
  const pt = point([lon, lat]);
  for (const tract of features) {
    if (!tract.geometry) continue;
    try {
      if (booleanPointInPolygon(pt, tract)) {
        const p = tract.properties || {};
        return {
          medianIncome: typeof p.medianIncome === "number" ? p.medianIncome : null,
          medianHomeValue:
            typeof p.medianHomeValue === "number" ? p.medianHomeValue : null,
          population: typeof p.population === "number" ? p.population : null,
          tractName: p.name ?? p.tractId ?? null,
        };
      }
    } catch {
      // skip malformed geometry
    }
  }
  return null;
}

type ZoneLayer = {
  key: string;
  label: string;
  features: Feature<Polygon | MultiPolygon>[];
};

/** Load every zone geojson from the filesystem once (build-time safe). */
async function loadZoneLayers(): Promise<ZoneLayer[]> {
  const layers = await Promise.all(
    Object.entries(ZONE_FILE_MAP).map(async ([key, filename]) => {
      const filePath = path.join(DATA_ROOT, "public/data/zones", filename);
      const data = await readJson<{
        features?: Feature<Polygon | MultiPolygon>[];
      }>(filePath, { features: [] });
      return {
        key,
        label: ZONE_LABELS[key] || key,
        features: (data.features ?? []).filter((f) => f && f.geometry),
      };
    }),
  );
  return layers;
}

/** Human-readable labels for every zone layer whose polygon contains the point. */
function zonesForPoint(
  layers: ZoneLayer[],
  lat: number,
  lon: number,
): string[] {
  const pt = point([lon, lat]);
  const labels: string[] = [];
  for (const layer of layers) {
    // TIF is surfaced separately and accurately via the CA<->TIF polygon-overlap
    // map (lib/neighborhood-tif.ts). The centroid test under-claims TIF, so
    // excluding it here avoids contradicting the dedicated TIF section.
    if (layer.key === "tif") continue;
    for (const feature of layer.features) {
      try {
        if (booleanPointInPolygon(pt, feature)) {
          labels.push(layer.label);
          break;
        }
      } catch {
        // skip malformed geometry
      }
    }
  }
  return labels;
}

// ── Cache build (memoized Promise) ──────────────────────────────────────────

let cachePromise: Promise<Map<number, NeighborhoodPageData>> | null = null;

async function buildCache(): Promise<Map<number, NeighborhoodPageData>> {
  const [anchorsFile, supportFile, vacantFile, censusFile, zoneLayers] =
    await Promise.all([
      readJson<RawAnchorsFile>(ANCHORS_PATH, {}),
      readJson<RawSupportFile>(SUPPORT_PATH, {}),
      readJson<{ features?: { properties?: VacantProps }[] }>(VACANT_PATH, {
        features: [],
      }),
      readJson<{
        features?: Feature<Polygon | MultiPolygon, CensusTractProps>[];
      }>(CENSUS_PATH, { features: [] }),
      loadZoneLayers(),
    ]);

  const vacancyIndex = buildVacancyIndex(vacantFile.features ?? []);
  const censusFeatures = censusFile.features ?? [];

  const cache = new Map<number, NeighborhoodPageData>();

  for (const ca of CHICAGO_COMMUNITY_AREAS) {
    const zones = zonesForPoint(zoneLayers, ca.lat, ca.lon);
    const vacancy = vacancyIndex.get(ca.name.toUpperCase().trim());

    cache.set(ca.id, {
      anchors: topAnchors(anchorsFile, ca.id),
      support: supportForArea(supportFile, ca.id),
      vacancyCount: vacancy?.count ?? 0,
      vacancyByType: vacancy?.byType ?? {},
      census: representativeTract(censusFeatures, ca.lat, ca.lon),
      zones,
      zoneCount: zones.length,
    });
  }

  return cache;
}

/**
 * Memoized accessor: returns the precomputed record for a community area.
 * The whole 77-area cache is built once on the first call and reused.
 */
export async function getNeighborhoodPageData(
  caId: number,
): Promise<NeighborhoodPageData> {
  if (!cachePromise) {
    cachePromise = buildCache();
  }
  const cache = await cachePromise;
  return (
    cache.get(caId) ?? {
      anchors: [],
      support: null,
      vacancyCount: 0,
      vacancyByType: {},
      census: null,
      zones: [],
      zoneCount: 0,
    }
  );
}
