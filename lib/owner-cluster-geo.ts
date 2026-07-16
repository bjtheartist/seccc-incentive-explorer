import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { OwnerClusterGeoRow } from "./corridor-owners";

/**
 * Loader for the private, admin-only per-parcel ownership-cluster geo export
 * (data/private/owner-clusters-geo.json — see data/private/README.md: never
 * moved into public/). Backs the admin-gated map layer toggle
 * (components/map/MapView.tsx) and the admin-only report ownership panel
 * (components/report/AdminOwnershipPanel.tsx), both served only through the
 * gated /api/owner-file/geo route.
 *
 * Loading pattern mirrors lib/corridor-citywide.ts (readFileSync +
 * existsSync guard + module-level cache + `process.cwd()`-relative path) —
 * the same convention already used in this repo for server-side JSON data
 * that lives outside public/ and must still be bundled into the Vercel
 * deployment via Next's build-time file tracing.
 */

export interface OwnerClusterGeoFeatureProperties {
  pin: string;
  address: string | null;
  vacant: boolean;
  zip: string;
  clusterKey: string;
  ownerName: string | null;
  ownerType: string | null;
  clusterParcelCount: number;
  clusterVacantCount: number;
  confidence: string;
}

export interface OwnerClusterGeoFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: OwnerClusterGeoFeatureProperties;
}

export interface OwnerClusterGeoMeta {
  /** Parcels skipped because lat/lng was null — a real count, never a silent drop. */
  skippedNullLatLng: number;
  /** ZIPs represented in this export. */
  zips: string[];
}

export interface OwnerClusterGeoFeatureCollection {
  type: "FeatureCollection";
  generatedAt: string;
  meta: OwnerClusterGeoMeta;
  features: OwnerClusterGeoFeature[];
}

const DATA_PATH = path.join(process.cwd(), "data/private/owner-clusters-geo.json");

// Module-level cache, read once per process.
// `undefined` = not attempted yet; `null` = attempted and file is absent or
// unparseable (a legitimate state before the export has been generated).
let cache: OwnerClusterGeoFeatureCollection | null | undefined = undefined;

function isValidCollection(value: unknown): value is OwnerClusterGeoFeatureCollection {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OwnerClusterGeoFeatureCollection>;
  return Array.isArray(candidate.features);
}

/**
 * Reads and parses the private geo export once per process, caching the
 * result. Returns `null` if the file does not exist (or fails to parse)
 * rather than throwing, so the gated API route can degrade to a clean 503
 * instead of a 500.
 */
export function loadOwnerClusterGeoFile(): OwnerClusterGeoFeatureCollection | null {
  if (cache !== undefined) return cache;

  try {
    if (!existsSync(DATA_PATH)) {
      cache = null;
      return cache;
    }
    const raw = readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    cache = isValidCollection(parsed) ? parsed : null;
  } catch {
    cache = null;
  }

  return cache;
}

/** Test-only: reset the module cache so tests can re-read the file after mutating it. */
export function __resetOwnerClusterGeoCacheForTests(): void {
  cache = undefined;
}

/**
 * Filter a loaded collection down to the given 5-digit ZIPs. A null/empty
 * `zips` returns the collection unfiltered.
 */
export function filterOwnerClusterGeoByZips(
  fc: OwnerClusterGeoFeatureCollection,
  zips?: string[] | null
): OwnerClusterGeoFeatureCollection {
  if (!zips || zips.length === 0) return fc;
  const zipSet = new Set(zips);
  return {
    ...fc,
    features: fc.features.filter((feature) => zipSet.has(feature.properties.zip)),
  };
}

/**
 * Pure builder: per-ZIP per-parcel DB rows (lib/corridor-owners.ts
 * fetchOwnerClusterGeoRows) -> the committed GeoJSON shape. Rows with null
 * lat/lon are skipped and counted in `meta.skippedNullLatLng` — never
 * silently dropped without a trace (corridor-metrics doctrine). Kept here
 * (rather than inline in the export script) so it is unit-testable without a
 * database connection.
 */
export function buildOwnerClusterGeoFeatureCollection(
  rowsByZip: Record<string, OwnerClusterGeoRow[]>,
  generatedAt: string
): OwnerClusterGeoFeatureCollection {
  const features: OwnerClusterGeoFeature[] = [];
  let skippedNullLatLng = 0;
  const zips = Object.keys(rowsByZip);

  for (const zip of zips) {
    for (const row of rowsByZip[zip] ?? []) {
      if (row.lat == null || row.lon == null) {
        skippedNullLatLng += 1;
        continue;
      }
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [row.lon, row.lat] },
        properties: {
          pin: row.pin,
          address: row.address,
          vacant: row.vacant,
          zip,
          clusterKey: row.clusterKey,
          ownerName: row.ownerName,
          ownerType: row.ownerType,
          clusterParcelCount: row.clusterParcelCount,
          clusterVacantCount: row.clusterVacantCount,
          confidence: row.confidence,
        },
      });
    }
  }

  return {
    type: "FeatureCollection",
    generatedAt,
    meta: { skippedNullLatLng, zips },
    features,
  };
}
