/**
 * Point-in-zone resolution shared by the report engine's /api/zones/check
 * route and the read-only Site Concierge tool. Extracted verbatim from the
 * route so both call the SAME logic (DB-backed with a malformed-geometry-safe
 * static fallback). No writes.
 */
import * as turf from "@turf/turf";
import { readFile } from "fs/promises";
import path from "path";
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";
import { getSQL } from "@/lib/db";
import { memCached, roundCoord } from "@/lib/redis";
import { CHECKABLE_ZONE_KEYS } from "@/lib/constants";
import {
  featureDisplayName,
  formatZoneFeatureName,
  parseZoneProperties,
} from "@/lib/zone-names";
import {
  getZoneLayerRegistryEntry,
  isLayerRevisionCurrent,
  ZONE_DATA_REVISION,
} from "@/lib/zone-layer-registry";

export interface ZoneMatch {
  key: string;
  name: string;
}

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

const zoneCache: Record<string, FeatureCollection> = {};

async function loadStaticZone(key: string): Promise<FeatureCollection> {
  if (zoneCache[key]) return zoneCache[key];

  const fileName = zoneFileMap[key];
  if (!fileName) throw new Error(`No static zone file configured for ${key}`);

  const filePath = path.join(process.cwd(), "public", "data", "zones", fileName);
  const raw = await readFile(filePath, "utf8");
  const data = JSON.parse(raw) as FeatureCollection;
  zoneCache[key] = data;
  return data;
}

/**
 * Point-in-polygon test that tolerates malformed source geometry (e.g. an
 * unclosed ring). Some shipped zone GeoJSON contains features that make turf
 * throw "First and last coordinates in a ring must be the same"; skip that one
 * feature and keep scanning instead of failing the whole lookup.
 */
function pointInPolygonSafe(
  point: ReturnType<typeof turf.point>,
  key: string,
  feature: Feature<Polygon | MultiPolygon>
): boolean {
  try {
    return turf.booleanPointInPolygon(point, feature);
  } catch (err) {
    console.warn(
      `[zones/check] skipping malformed feature in zone "${key}" (${
        (feature.properties as Record<string, unknown> | null)?.name ??
        (feature.properties as Record<string, unknown> | null)?.NAME ??
        "unknown feature"
      }):`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/**
 * True if the point falls inside ANY of the given static zone layers.
 * Cheaper than checkStaticZones when only specific layers matter (e.g. the
 * SSA/CCSA corridor check that reorders local support for storefront work).
 */
export async function pointInAnyZone(
  lat: number,
  lon: number,
  keys: string[]
): Promise<boolean> {
  const point = turf.point([lon, lat]);
  for (const key of keys) {
    const collection = await loadStaticZone(key);
    const hit = collection.features.some(
      (feature) =>
        Boolean(feature.geometry) &&
        pointInPolygonSafe(point, key, feature as Feature<Polygon | MultiPolygon>)
    );
    if (hit) return true;
  }
  return false;
}

export async function checkStaticZones(
  lat: number,
  lon: number
): Promise<ZoneMatch[]> {
  const point = turf.point([lon, lat]);
  const matches: ZoneMatch[] = [];

  await Promise.all(
    CHECKABLE_ZONE_KEYS.map(async (key) => {
      const collection = await loadStaticZone(key);
      const match = collection.features.find(
        (feature): feature is Feature<Polygon | MultiPolygon> =>
          Boolean(feature.geometry) &&
          pointInPolygonSafe(
            point,
            key,
            feature as Feature<Polygon | MultiPolygon>
          )
      );

      if (match) {
        matches.push({ key, name: featureDisplayName(key, match) });
      }
    })
  );

  return matches;
}

async function checkStaticZone(
  key: string,
  lat: number,
  lon: number
): Promise<ZoneMatch | null> {
  const collection = await loadStaticZone(key);
  const point = turf.point([lon, lat]);
  const match = collection.features.find(
    (feature): feature is Feature<Polygon | MultiPolygon> =>
      Boolean(feature.geometry) &&
      pointInPolygonSafe(point, key, feature as Feature<Polygon | MultiPolygon>)
  );

  return match ? { key, name: featureDisplayName(key, match) } : null;
}

/**
 * Static point-in-polygon over a NAMED SUBSET of layers, returning each hit's
 * feature name. `checkStaticZones` scans all sixteen checkable layers (7.4 MB
 * of NMTC tracts among them); the Site Shortlist only needs the four corridor
 * and financing overlays it renders, run once per candidate, so scanning the
 * rest would be pure cost. Unknown keys and unreadable layers are skipped
 * rather than thrown — a missing overlay file must degrade to "none mapped",
 * never to a failed page.
 */
export async function checkStaticZoneKeys(
  lat: number,
  lon: number,
  keys: readonly string[]
): Promise<ZoneMatch[]> {
  const matches = await Promise.all(
    keys.map((key) => checkStaticZone(key, lat, lon).catch(() => null))
  );
  return matches.filter((match): match is ZoneMatch => Boolean(match));
}

/**
 * Resolve which incentive zones cover a point. DB-backed when the SQL client is
 * available, with a static point-in-polygon fallback. Cached per rounded
 * coordinate. This is the exact logic the report engine relies on.
 */
export async function resolveZonesAtPoint(
  lat: number,
  lon: number
): Promise<ZoneMatch[]> {
  const rLat = roundCoord(lat);
  const rLon = roundCoord(lon);
  const cacheKey = `zones:check:v2:${rLat}:${rLon}`;
  const sql = getSQL();

  return memCached(cacheKey, 604800, async () => {
    if (!sql) {
      return checkStaticZones(lat, lon);
    }

    const rows = await sql`
      WITH point AS (
        SELECT ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326) AS geom
      )
      SELECT z.zone_key, z.feature_name, z.feature_properties
      FROM zones z, point p
      WHERE z.geom::geometry && p.geom
        AND ST_Covers(ST_Buffer(z.geom::geometry, 0), p.geom)
    `;

    const staticOnlyKeys = new Set([
      "nof",
      "ccsa",
      "energyCommunities",
      "hubzone",
    ]);
    const dbMatches = rows
      .filter((r: Record<string, unknown>) => !staticOnlyKeys.has(String(r.zone_key)))
      .map((r: Record<string, unknown>) => ({
        key: String(r.zone_key),
        name: formatZoneFeatureName(String(r.zone_key), {
          ...parseZoneProperties(r.feature_properties),
          name: r.feature_name,
        }),
      }));
    const staticMatches = (
      await Promise.all(
        Array.from(staticOnlyKeys).map((key) =>
          checkStaticZone(key, lat, lon).catch(() => null)
        )
      )
    ).filter((match): match is ZoneMatch => Boolean(match));

    return [...dbMatches, ...staticMatches];
  });
}

/* ════════════════════════════════════════════════════════════════════════
 * Zone Evidence v2 (build-spec.md 1.3; audit F2; consult item 6; review1
 * R2 + R5)
 *
 * Everything below is NEW code for the new /api/zones/check/v2 route. It
 * does not modify or call into any of the v1 functions above — v1's route
 * and behavior are untouched in PR1. The core difference from v1: a layer
 * that cannot be confidently resolved produces an explicit `unknown`
 * result with a reason, never a silent `false`/omission — and,
 * critically, "confidently resolved" is decided from EVIDENCE gathered at
 * resolution time (a real DB existence check; a real, current, non-empty
 * static collection), not from a blanket static flag. A known match on
 * one layer is never affected by another layer's failure — each layer is
 * resolved independently, with its own try/catch, so one bad layer can
 * never fail the whole resolver.
 * ════════════════════════════════════════════════════════════════════════ */

export type ZoneLayerState = "matched" | "not_matched" | "unknown";
export type ZoneUnknownReason =
  | "source_unavailable"
  | "malformed_geometry"
  | "layer_missing"
  | "stale_source"
  | "redesignated_area_expired";

export interface ZoneLayerEvidence {
  state: ZoneLayerState;
  name?: string;
  reason?: ZoneUnknownReason;
}

/** Injectable per-key DB lookup so tests never need a live database (Hard Rule: mock at the getSQL boundary). */
export type ZoneDbLayerQuery = (
  key: string,
  lat: number,
  lon: number
) => Promise<{ name: string } | null>;

/** Injectable "does this layer have ANY rows loaded at all" check — the DB-path negative-assertion gate (review1 R2). */
export type ZoneDbLayerExistsCheck = (key: string) => Promise<boolean>;

/** Injectable static-file loader — lets tests exercise real failure paths (missing file, invalid JSON, wrong shape) against a REGISTERED key (review1 R5). */
export type ZoneFileLoader = (key: string) => Promise<unknown>;

export interface ZoneEvidenceOpts {
  sql?: ReturnType<typeof getSQL> | null;
  dbLayerQuery?: ZoneDbLayerQuery;
  dbLayerExists?: ZoneDbLayerExistsCheck;
  loadZoneFile?: ZoneFileLoader;
  /** Current known-good revision to compare each static layer's registry entry against (defaults to ZONE_DATA_REVISION). */
  currentRevision?: string;
}

async function defaultDbLayerQuery(
  key: string,
  lat: number,
  lon: number
): Promise<{ name: string } | null> {
  const sql = getSQL();
  if (!sql) return null;

  const rows = await sql`
    WITH point AS (
      SELECT ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326) AS geom
    )
    SELECT z.feature_name, z.feature_properties
    FROM zones z, point p
    WHERE z.zone_key = ${key}
      AND z.geom::geometry && p.geom
      AND ST_Covers(ST_Buffer(z.geom::geometry, 0), p.geom)
    LIMIT 1
  `;

  if (rows.length === 0) return null;
  const row = rows[0] as Record<string, unknown>;
  return {
    name: formatZoneFeatureName(key, {
      ...parseZoneProperties(row.feature_properties),
      name: row.feature_name,
    }),
  };
}

/**
 * Does layer `key` have ANY rows loaded in the `zones` table at all,
 * anywhere — independent of the query point? Only when this is true does a
 * zero-row point query count as a genuine `not_matched`; otherwise a
 * never-populated table would silently read as "no incentive here" for
 * every address, forever (review1 R2 — "DB rows verified present for that
 * layer at resolution time").
 */
async function defaultDbLayerExists(key: string): Promise<boolean> {
  const sql = getSQL();
  if (!sql) return false;
  const rows = await sql`SELECT 1 FROM zones WHERE zone_key = ${key} LIMIT 1`;
  return rows.length > 0;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Validates the loaded value is actually a GeoJSON FeatureCollection shape (review1 R5 — "validate collection shape"). */
function isValidFeatureCollection(value: unknown): value is FeatureCollection {
  return (
    isRecordLike(value) &&
    value.type === "FeatureCollection" &&
    Array.isArray((value as { features?: unknown }).features)
  );
}

/**
 * Per-feature geometry evaluation that distinguishes three outcomes the v1
 * `pointInPolygonSafe` above collapses into one (`false`): a clean match, a
 * clean non-match, and "this feature's geometry could not be evaluated at
 * all" (null/missing geometry, wrong geometry type, or a thrown turf
 * error — review1 R5: "null/unevaluable geometry -> malformed_geometry").
 */
function evaluateFeatureGeometry(
  point: ReturnType<typeof turf.point>,
  key: string,
  feature: unknown
): { matched: boolean; malformed: boolean } {
  // review1 R10: validate the FEATURE ITSELF before dereferencing
  // `.geometry` — R5's collection-shape check only validated that
  // `features` is an array, not that every element in it is a real
  // object. `features: [null]` (or a scalar entry) previously threw here
  // uncaught, which the aggregate resolver's per-key try/catch (review1
  // R5) masked as `source_unavailable` instead of the more accurate
  // `malformed_geometry`.
  if (!isRecordLike(feature)) {
    console.warn(`[zones/check/v2] null/non-object feature entry in zone "${key}"`);
    return { matched: false, malformed: true };
  }
  const geometry = feature.geometry as { type?: string } | null | undefined;
  if (!geometry || typeof geometry.type !== "string") {
    console.warn(`[zones/check/v2] null/missing geometry on a feature in zone "${key}"`);
    return { matched: false, malformed: true };
  }
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
    console.warn(
      `[zones/check/v2] unexpected geometry type "${geometry.type}" on a feature in zone "${key}"`
    );
    return { matched: false, malformed: true };
  }
  try {
    return {
      matched: turf.booleanPointInPolygon(point, feature as unknown as Feature<Polygon | MultiPolygon>),
      malformed: false,
    };
  } catch (err) {
    console.warn(
      `[zones/check/v2] skipping malformed feature in zone "${key}":`,
      err instanceof Error ? err.message : err
    );
    return { matched: false, malformed: true };
  }
}

/**
 * Layers whose downgrade rule depends on seeing EVERY match at a point,
 * not just the first one a scan happens to hit — first-match
 * short-circuiting is unsafe for these. Currently only "hubzone": at a
 * shared tract boundary a point can fall inside both a currently-valid
 * qualified tract AND an expired redesignated tract (review1 R8 —
 * verified against the real shipped hubzone.geojson: (42.0047, -87.6901)
 * matches qualified tract 17031020500 before expired redesignated tract
 * 17031020602 in file order). Returning on the first match alone would
 * silently prefer whichever tract happens to be scanned first.
 */
const FULL_SCAN_REQUIRED_KEYS: ReadonlySet<string> = new Set(["hubzone"]);

/**
 * Classify a layer's match(es) together, applying any layer-specific
 * downgrade rules. HUBZone: 66 of its shipped tracts are `category:
 * "redesignated"`, and the program catalog's own record says these lost
 * eligibility as of 2026-07-01 (the shipped geometry carries no expiry
 * date itself, so this cross-cutting fact can only be applied here, at
 * the layer-key level). If ANY match at this point is `category:
 * "redesignated"`, the WHOLE result downgrades to
 * `unknown/redesignated_area_expired` — even when another match at the
 * exact same point is a currently-valid qualified tract (review1 R2 +
 * R8). A point inside a redesignated tract must never come back as a
 * plain `matched`.
 */
function classifyStaticMatches(
  key: string,
  matches: Feature<Polygon | MultiPolygon>[]
): ZoneLayerEvidence {
  if (key === "hubzone") {
    const redesignated = matches.find(
      (feature) => (feature.properties as Record<string, unknown> | null)?.category === "redesignated"
    );
    if (redesignated) {
      return {
        state: "unknown",
        reason: "redesignated_area_expired",
        name: featureDisplayName(key, redesignated),
      };
    }
  }
  return { state: "matched", name: featureDisplayName(key, matches[0]) };
}

/**
 * Static-file evidence for one layer. A real match always wins outright
 * (subject to `classifyStaticMatch`'s per-layer downgrade rules). Absent a
 * match: an unreadable/missing/malformed-shape source file is `unknown`
 * (`source_unavailable`); a well-formed but EMPTY collection for a
 * registered layer is `unknown` (`layer_missing` — nothing was actually
 * loaded to test against, review1 R5); at least one unevaluable feature
 * among otherwise-clean results is `unknown` (`malformed_geometry`); and a
 * clean scan with zero matches on a layer whose registry revision is not
 * current is `unknown` (`stale_source` — review1 R2, e.g.
 * microMarketRecovery). Only a clean scan on a current-revision layer
 * returns a confident `not_matched`.
 */
async function checkStaticZoneV2(
  key: string,
  lat: number,
  lon: number,
  opts: Pick<ZoneEvidenceOpts, "loadZoneFile" | "currentRevision"> = {}
): Promise<ZoneLayerEvidence> {
  const loader = opts.loadZoneFile ?? loadStaticZone;
  let collection: FeatureCollection;
  try {
    const loaded = await loader(key);
    if (!isValidFeatureCollection(loaded)) {
      console.warn(`[zones/check/v2] static layer "${key}" is not a well-formed FeatureCollection`);
      return { state: "unknown", reason: "source_unavailable" };
    }
    collection = loaded;
  } catch (err) {
    console.warn(
      `[zones/check/v2] static layer "${key}" unavailable:`,
      err instanceof Error ? err.message : err
    );
    return { state: "unknown", reason: "source_unavailable" };
  }

  if (collection.features.length === 0) {
    return { state: "unknown", reason: "layer_missing" };
  }

  const point = turf.point([lon, lat]);
  let sawMalformed = false;
  const matches: Feature<Polygon | MultiPolygon>[] = [];
  const fullScan = FULL_SCAN_REQUIRED_KEYS.has(key);

  for (const feature of collection.features) {
    const evaluation = evaluateFeatureGeometry(point, key, feature);
    if (evaluation.malformed) {
      sawMalformed = true;
      continue;
    }
    if (evaluation.matched) {
      matches.push(feature as Feature<Polygon | MultiPolygon>);
      // review1 R8: layers with no multi-match downgrade rule keep the
      // original first-match-wins short circuit; FULL_SCAN_REQUIRED_KEYS
      // (hubzone) must see every match at this point before classifying,
      // since a later redesignated match can downgrade an earlier
      // qualified one.
      if (!fullScan) break;
    }
  }

  if (matches.length > 0) {
    return classifyStaticMatches(key, matches);
  }

  if (sawMalformed) {
    return { state: "unknown", reason: "malformed_geometry" };
  }

  if (!isLayerRevisionCurrent(key, opts.currentRevision ?? ZONE_DATA_REVISION)) {
    return { state: "unknown", reason: "stale_source" };
  }

  return { state: "not_matched" };
}

/**
 * Resolve one layer's evidence for a point. `opts.sql`/`opts.dbLayerQuery`/
 * `opts.dbLayerExists`/`opts.loadZoneFile` are all injectable so tests can
 * simulate DB failure, an unverified zero-row layer, a verified zero-row
 * layer, and every static-file failure mode without any live database or
 * real broken fixture files (Hard Rule: no DB in this task; mock at the
 * boundary).
 */
export async function resolveZoneLayerEvidence(
  key: string,
  lat: number,
  lon: number,
  opts: ZoneEvidenceOpts = {}
): Promise<ZoneLayerEvidence> {
  const registryEntry = getZoneLayerRegistryEntry(key);
  if (!registryEntry) {
    return { state: "unknown", reason: "layer_missing" };
  }

  const sql = opts.sql !== undefined ? opts.sql : getSQL();
  const useDb = registryEntry.source === "db" && Boolean(sql);

  if (useDb) {
    try {
      const dbQuery = opts.dbLayerQuery ?? defaultDbLayerQuery;
      const match = await dbQuery(key, lat, lon);
      if (match) {
        return { state: "matched", name: match.name };
      }
      // Zero rows at THIS point. Verify — at resolution time, not from a
      // static flag — that the layer has ANY rows loaded anywhere before
      // trusting that as a genuine not_matched (review1 R2).
      const existsCheck = opts.dbLayerExists ?? defaultDbLayerExists;
      const layerHasAnyRows = await existsCheck(key);
      if (!layerHasAnyRows) {
        return { state: "unknown", reason: "layer_missing" };
      }
      return { state: "not_matched" };
    } catch (err) {
      console.warn(
        `[zones/check/v2] DB query failed for layer "${key}":`,
        err instanceof Error ? err.message : err
      );
      return { state: "unknown", reason: "source_unavailable" };
    }
  }

  return checkStaticZoneV2(key, lat, lon, {
    loadZoneFile: opts.loadZoneFile,
    currentRevision: opts.currentRevision,
  });
}

/**
 * Resolve evidence for every requested layer independently — a per-key
 * try/catch (on top of resolveZoneLayerEvidence's own internal handling)
 * guarantees one layer's unexpected failure can never reject the whole
 * resolver or affect any other layer's result (review1 R5).
 */
export async function resolveZoneEvidenceV2(
  lat: number,
  lon: number,
  keys: readonly string[],
  opts: ZoneEvidenceOpts = {}
): Promise<Record<string, ZoneLayerEvidence>> {
  const entries = await Promise.all(
    keys.map(async (key) => {
      try {
        return [key, await resolveZoneLayerEvidence(key, lat, lon, opts)] as const;
      } catch (err) {
        console.warn(
          `[zones/check/v2] unexpected failure resolving layer "${key}":`,
          err instanceof Error ? err.message : err
        );
        return [
          key,
          { state: "unknown", reason: "source_unavailable" } as ZoneLayerEvidence,
        ] as const;
      }
    })
  );
  return Object.fromEntries(entries);
}
