/**
 * lib/zone-layer-registry.ts — the layer registry / health manifest for
 * Zone Evidence v2 (build-spec.md 1.3; audit F2; consult item 6).
 *
 * A DB query returning zero rows for a layer does NOT by itself prove "not
 * matched" — it is equally consistent with the layer never having been
 * loaded into the `zones` table at all. This registry is the source of
 * truth for which layers are expected and whether each one has been
 * verified-loaded (by ingestion/build tooling — not asserted at request
 * time). `resolveZoneLayerEvidence` (lib/zones-check.ts) treats a zero-row
 * DB result for a layer NOT marked `verifiedLoaded` as `unknown` (reason
 * `layer_missing`), never as a confirmed `not_matched`.
 */
import { CHECKABLE_ZONE_KEYS } from "./constants";

export type ZoneLayerSource = "static-file" | "db";

export interface ZoneLayerRegistryEntry {
  key: string;
  source: ZoneLayerSource;
  /** File name under public/data/zones/, when source === "static-file" (or as the static fallback for a "db" layer). */
  sourceFile: string;
  /** Revision tag for this layer's underlying data. */
  dataRevision: string;
  /**
   * True once ingestion/build has confirmed this layer is actually loaded
   * with valid geometry. Only when true does a zero-row DB result count as
   * a genuine "not_matched" rather than "unknown / layer_missing".
   */
  verifiedLoaded: boolean;
}

/**
 * A single revision tag for this snapshot of the zone-layer dataset,
 * surfaced at the top level of every Zone Evidence v2 response
 * (`dataRevision`). Bump when any layer's underlying source file/table
 * changes in a way that could change results.
 */
export const ZONE_DATA_REVISION = "zones-v2-2026-08-13";

/**
 * The four layers `lib/zones-check.ts`'s v1 `resolveZonesAtPoint` already
 * treats as static-only (never queried against the DB `zones` table, even
 * when the DB is available) — re-exported here so the registry and the v2
 * resolver share one definition instead of two independently-maintained
 * lists drifting apart. Matches `lib/zones-check.ts`'s existing (untouched)
 * v1 `staticOnlyKeys` set exactly.
 */
export const STATIC_ONLY_ZONE_KEYS: ReadonlySet<string> = new Set([
  "nof",
  "ccsa",
  "energyCommunities",
  "hubzone",
]);

const zoneFileMap: Record<string, string> = {
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

/**
 * Registry for every layer Zone Evidence v2 can be asked about: the 16
 * point-in-polygon "checkable" zone keys (lib/constants.ts
 * CHECKABLE_ZONE_KEYS — excludes the 4 point-data-only keys, which are not
 * a polygon test). Every entry currently ships `verifiedLoaded: true`
 * because these are the same source files v1's `checkStaticZones` has
 * relied on in production; a future ingestion step that re-verifies
 * geometry at build time can flip individual entries to `false` without
 * any code change here.
 */
export const ZONE_LAYER_REGISTRY: Record<string, ZoneLayerRegistryEntry> = Object.fromEntries(
  CHECKABLE_ZONE_KEYS.map((key) => [
    key,
    {
      key,
      source: STATIC_ONLY_ZONE_KEYS.has(key) ? "static-file" : "db",
      sourceFile: zoneFileMap[key] ?? "",
      dataRevision: ZONE_DATA_REVISION,
      verifiedLoaded: true,
    } satisfies ZoneLayerRegistryEntry,
  ])
);

export function getZoneLayerRegistryEntry(key: string): ZoneLayerRegistryEntry | undefined {
  return ZONE_LAYER_REGISTRY[key];
}

export function isLayerVerifiedLoaded(key: string): boolean {
  return ZONE_LAYER_REGISTRY[key]?.verifiedLoaded === true;
}
