/**
 * lib/zone-layer-registry.ts — the layer registry / health manifest for
 * Zone Evidence v2 (build-spec.md 1.3; audit F2; consult item 6; review1
 * R2).
 *
 * A DB query returning zero rows for a layer does NOT by itself prove "not
 * matched" — it is equally consistent with the layer never having been
 * loaded into the `zones` table at all. A static file loading successfully
 * does NOT by itself prove its geometry is current — a boundary can be
 * shipped, parseable, and stale at the same time (microMarketRecovery's own
 * `boundaryDisclaimer` says exactly this: 13 legacy MMRP areas vs. the
 * City's 11 current CNRP target areas).
 *
 * Negative-assertion rights (the right for a layer to return `not_matched`
 * rather than `unknown`) are therefore tied to EVIDENCE gathered at
 * resolution time, not to a blanket static flag:
 *   - DB layers: `not_matched` only after confirming, via a real existence
 *     check at resolution time (see `resolveZoneLayerEvidence` in
 *     lib/zones-check.ts), that the layer has ANY rows loaded at all.
 *   - Static layers: `not_matched` only when the source file loaded, is a
 *     well-formed non-empty FeatureCollection, AND its registry
 *     `dataRevision` matches the current known-good snapshot
 *     (`isLayerRevisionCurrent`). A layer whose revision is pinned to a
 *     known-stale snapshot (see `STALE_LAYER_REVISIONS`) can still report a
 *     real `matched` hit, but never a confident negative.
 */
import { CHECKABLE_ZONE_KEYS } from "./constants";

export type ZoneLayerSource = "static-file" | "db";

export interface ZoneLayerRegistryEntry {
  key: string;
  source: ZoneLayerSource;
  /** File name under public/data/zones/, when source === "static-file" (or as the static fallback for a "db" layer). */
  sourceFile: string;
  /**
   * Revision tag for this specific layer's underlying data. Compared
   * against a "current known-good" revision (normally `ZONE_DATA_REVISION`)
   * to decide whether this layer may assert a confident `not_matched` — see
   * `isLayerRevisionCurrent`. Layers pinned to an older tag in
   * `STALE_LAYER_REVISIONS` never satisfy that check.
   */
  dataRevision: string;
}

/**
 * The current known-good revision tag for the zone-layer dataset,
 * surfaced at the top level of every Zone Evidence v2 response
 * (`dataRevision`). Bump when any layer's underlying source file/table
 * changes in a way that could change results.
 */
export const ZONE_DATA_REVISION = "zones-v2-2026-08-13";

/**
 * Layers whose registry revision is deliberately pinned OLDER than
 * `ZONE_DATA_REVISION`, because the underlying boundary is known-stale.
 * `isLayerRevisionCurrent()` returns false for these, so
 * `checkStaticZoneV2` (lib/zones-check.ts) can still report a real
 * geometry match on them but can never assert a confident `not_matched` —
 * a stale boundary proves nothing about points it doesn't cover.
 *
 *   microMarketRecovery: the shipped micro-market-recovery.geojson holds
 *   13 legacy MMRP areas; the City now publishes 11 CNRP target areas that
 *   have not been re-mapped here (see the program record's own
 *   `boundaryDisclaimer` in data/programs-internal.json). A point outside
 *   the 13 legacy polygons could easily be inside one of the un-mapped
 *   current 11 — asserting `not_matched` there would be an unsupported
 *   negative claim (review1 R2).
 */
const STALE_LAYER_REVISIONS: Partial<Record<string, string>> = {
  microMarketRecovery: "zones-v1-legacy-mmrp-13-areas-2022",
};

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
 * a polygon test).
 */
export const ZONE_LAYER_REGISTRY: Record<string, ZoneLayerRegistryEntry> = Object.fromEntries(
  CHECKABLE_ZONE_KEYS.map((key) => [
    key,
    {
      key,
      source: STATIC_ONLY_ZONE_KEYS.has(key) ? "static-file" : "db",
      sourceFile: zoneFileMap[key] ?? "",
      dataRevision: STALE_LAYER_REVISIONS[key] ?? ZONE_DATA_REVISION,
    } satisfies ZoneLayerRegistryEntry,
  ])
);

export function getZoneLayerRegistryEntry(key: string): ZoneLayerRegistryEntry | undefined {
  return ZONE_LAYER_REGISTRY[key];
}

/**
 * True when `key`'s registered data revision matches the current
 * known-good snapshot — i.e. the layer is allowed to assert a confident
 * `not_matched`. False for an unregistered key or a layer pinned to a
 * known-stale revision (`STALE_LAYER_REVISIONS`); such a layer may still
 * report a real `matched` hit, but a "no match found" result there
 * degrades to `unknown` instead.
 */
export function isLayerRevisionCurrent(
  key: string,
  currentRevision: string = ZONE_DATA_REVISION
): boolean {
  const entry = ZONE_LAYER_REGISTRY[key];
  return entry !== undefined && entry.dataRevision === currentRevision;
}
