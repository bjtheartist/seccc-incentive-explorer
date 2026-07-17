import { socrataHeaders } from "@/lib/socrata";
import type { FetchOpts, Provenance, SourceAdapter, SQL } from "./types";

/**
 * Chicago Vacant/Abandoned Building Violations adapter (Phase-2 distress
 * overlay — see lib/corridor-owners.ts).
 *
 * Source: Socrata `u7si-yh3t` (data.cityofchicago.org). Separate dataset and
 * table from `building_violations` (22u3-xenr, lib/ingest/violations.ts) —
 * different upstream schema/PK, do not merge. Like 22u3-xenr, this dataset
 * has no ZIP or PIN column, so the fetch is scoped server-side by the same
 * bounding box covering the three SE-Chicago ZIPs (plus a recent
 * violation-date window) via `within_box(location, ...)` — mirrors
 * violations.ts exactly.
 *
 * Verified against the live endpoint (schema probe + sample rows): the PK
 * field is `id`; fields used here are `violation_code`,
 * `violation_description`, `violation_status`, `violation_date`, `address`,
 * `latitude`, `longitude`. No `zip` field exists upstream (unlike
 * 22u3-xenr's raw shape, which also lacks one) — `zip` stays null on every
 * row; the export-time join in lib/corridor-owners.ts matches by normalized
 * site address instead, the same technique already used for
 * building_violations and business licenses.
 */

const SOURCE_KEY = "vacant_building_violations";

const VACANT_VIOLATIONS_URL = "https://data.cityofchicago.org/resource/u7si-yh3t.json";

/** Bounding box covering ZIPs 60617/60619/60649 (SE Chicago) — same as violations.ts. */
const SE_BBOX = { north: 41.77, west: -87.63, south: 41.65, east: -87.51 };
/** Only pull reasonably recent violations to keep the backfill bounded. */
const SINCE_DATE = "2015-01-01";

/** Raw Socrata Vacant/Abandoned Building Violations record (subset we use). */
export interface RawVacantBuildingViolation {
  id?: string;
  violation_code?: string;
  violation_description?: string;
  violation_status?: string;
  violation_date?: string;
  address?: string;
  latitude?: string;
  longitude?: string;
}

/** Normalized, DB-ready vacant-building-violation row. */
export interface VacantBuildingViolationRow {
  violationId: string;
  address: string | null;
  zip: string | null;
  violationCode: string | null;
  violationDescription: string | null;
  violationStatus: string | null;
  violationDate: string | null;
  lat: number;
  lon: number;
  provenance: Provenance;
}

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const vacantBuildingViolationsAdapter: SourceAdapter<
  RawVacantBuildingViolation,
  VacantBuildingViolationRow
> = {
  sourceKey: SOURCE_KEY,
  targetTable: "vacant_building_violations",

  async fetch(_opts: FetchOpts): Promise<RawVacantBuildingViolation[]> {
    const all: RawVacantBuildingViolation[] = [];
    const pageSize = 1000;
    const box = `within_box(location,${SE_BBOX.north},${SE_BBOX.west},${SE_BBOX.south},${SE_BBOX.east})`;
    const where = encodeURIComponent(`${box} AND violation_date>'${SINCE_DATE}'`);

    for (let offset = 0; ; offset += pageSize) {
      const url = `${VACANT_VIOLATIONS_URL}?$where=${where}&$limit=${pageSize}&$offset=${offset}&$order=id`;
      const res = await fetch(url, {
        headers: socrataHeaders(),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) break;
      const page: RawVacantBuildingViolation[] = await res.json();
      if (page.length === 0) break;
      all.push(...page);
      if (page.length < pageSize) break;
    }

    return all;
  },

  normalize(raw: RawVacantBuildingViolation): VacantBuildingViolationRow | null {
    const violationId = raw.id?.trim();
    if (!violationId) return null;

    const lat = num(raw.latitude);
    const lon = num(raw.longitude);
    if (lat == null || lon == null || lat === 0 || lon === 0) return null;
    if (lat < 41.6 || lat > 42.1 || lon < -88.0 || lon > -87.4) return null;

    return {
      violationId,
      address: raw.address?.trim() || null,
      zip: null,
      violationCode: raw.violation_code?.trim() || null,
      violationDescription: raw.violation_description?.trim() || null,
      violationStatus: raw.violation_status?.trim() || null,
      violationDate: raw.violation_date || null,
      lat,
      lon,
      provenance: { source: SOURCE_KEY, raw_json: raw },
    };
  },

  async upsert(sql: SQL, rows: VacantBuildingViolationRow[]): Promise<number> {
    let written = 0;
    for (const r of rows) {
      await sql`
        INSERT INTO vacant_building_violations (
          violation_id, address, zip, violation_code, violation_description,
          violation_status, violation_date, lat, lon, geom,
          source, fetched_at, raw_json
        )
        VALUES (
          ${r.violationId}, ${r.address}, ${r.zip}, ${r.violationCode}, ${r.violationDescription},
          ${r.violationStatus}, ${r.violationDate}, ${r.lat}, ${r.lon},
          ST_MakePoint(${r.lon}, ${r.lat})::geography,
          ${r.provenance.source}, NOW(), ${JSON.stringify(r.provenance.raw_json)}
        )
        ON CONFLICT (violation_id) DO UPDATE SET
          address = EXCLUDED.address,
          zip = EXCLUDED.zip,
          violation_code = EXCLUDED.violation_code,
          violation_description = EXCLUDED.violation_description,
          violation_status = EXCLUDED.violation_status,
          violation_date = EXCLUDED.violation_date,
          lat = EXCLUDED.lat,
          lon = EXCLUDED.lon,
          geom = EXCLUDED.geom,
          source = EXCLUDED.source,
          fetched_at = NOW(),
          raw_json = EXCLUDED.raw_json
      `;
      written++;
    }
    return written;
  },
};
