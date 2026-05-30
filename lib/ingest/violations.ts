import { socrataHeaders } from "@/lib/socrata";
import type { FetchOpts, Provenance, SourceAdapter, SQL } from "./types";

/**
 * Chicago Building Violations adapter.
 *
 * Source: Socrata `22u3-xenr` (data.cityofchicago.org). The dataset has no
 * ZIP column, so the fetch is scoped server-side by a bounding box covering
 * the three SE-Chicago ZIPs (plus a recent violation-date window) via
 * `within_box(location, ...)`.
 *
 * Verified against the live endpoint: the PK field is `id`; fields are
 * `violation_code`, `violation_description`, `violation_status`,
 * `violation_date`, `address`, `latitude`, `longitude`.
 */

const SOURCE_KEY = "building_violations";

const VIOLATIONS_URL = "https://data.cityofchicago.org/resource/22u3-xenr.json";

/** Bounding box covering ZIPs 60617/60619/60649 (SE Chicago). */
const SE_BBOX = { north: 41.77, west: -87.63, south: 41.65, east: -87.51 };
/** Only pull reasonably recent violations to keep the backfill bounded. */
const SINCE_DATE = "2015-01-01";

/** Raw Socrata Building Violations record (subset we use). */
export interface RawViolation {
  id?: string;
  violation_code?: string;
  violation_description?: string;
  violation_status?: string;
  violation_date?: string;
  address?: string;
  zip?: string;
  latitude?: string;
  longitude?: string;
}

/** Normalized, DB-ready violation row. */
export interface ViolationRow {
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

export const violationsAdapter: SourceAdapter<RawViolation, ViolationRow> = {
  sourceKey: SOURCE_KEY,
  targetTable: "building_violations",

  async fetch(_opts: FetchOpts): Promise<RawViolation[]> {
    const all: RawViolation[] = [];
    const pageSize = 1000;
    const box = `within_box(location,${SE_BBOX.north},${SE_BBOX.west},${SE_BBOX.south},${SE_BBOX.east})`;
    const where = encodeURIComponent(`${box} AND violation_date>'${SINCE_DATE}'`);

    for (let offset = 0; ; offset += pageSize) {
      const url = `${VIOLATIONS_URL}?$where=${where}&$limit=${pageSize}&$offset=${offset}&$order=id`;
      const res = await fetch(url, {
        headers: socrataHeaders(),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) break;
      const page: RawViolation[] = await res.json();
      if (page.length === 0) break;
      all.push(...page);
      if (page.length < pageSize) break;
    }

    return all;
  },

  normalize(raw: RawViolation): ViolationRow | null {
    const violationId = raw.id?.trim();
    if (!violationId) return null;

    const lat = num(raw.latitude);
    const lon = num(raw.longitude);
    if (lat == null || lon == null || lat === 0 || lon === 0) return null;
    if (lat < 41.6 || lat > 42.1 || lon < -88.0 || lon > -87.4) return null;

    return {
      violationId,
      address: raw.address?.trim() || null,
      zip: raw.zip?.trim() || null,
      violationCode: raw.violation_code?.trim() || null,
      violationDescription: raw.violation_description?.trim() || null,
      violationStatus: raw.violation_status?.trim() || null,
      violationDate: raw.violation_date || null,
      lat,
      lon,
      provenance: { source: SOURCE_KEY, raw_json: raw },
    };
  },

  async upsert(sql: SQL, rows: ViolationRow[]): Promise<number> {
    let written = 0;
    for (const r of rows) {
      await sql`
        INSERT INTO building_violations (
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
