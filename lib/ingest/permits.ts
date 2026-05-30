import { socrataHeaders } from "@/lib/socrata";
import type { FetchOpts, Provenance, SourceAdapter, SQL } from "./types";

/**
 * Chicago Building Permits adapter.
 *
 * Source: Socrata `ydr8-5enu` (data.cityofchicago.org). The dataset has no
 * ZIP column, so the fetch is scoped server-side by a bounding box covering
 * the three SE-Chicago ZIPs (plus a recent-issue-date window) via
 * `within_box(location, ...)`. PIN is taken from the first entry of the
 * semicolon-separated `pin_list`. `is_demolition` is derived from a
 * "DEMOLITION" substring in `permit_type`.
 *
 * Verified against the live endpoint (`$limit`/`within_box` probes): the PK
 * field is `permit_` and coordinates live in `latitude`/`longitude`.
 */

const SOURCE_KEY = "building_permits";

const PERMITS_URL = "https://data.cityofchicago.org/resource/ydr8-5enu.json";

/**
 * Bounding box covering ZIPs 60617/60619/60649 (SE Chicago).
 * within_box(location, north_lat, west_lon, south_lat, east_lon).
 */
const SE_BBOX = { north: 41.77, west: -87.63, south: 41.65, east: -87.51 };
/** Only pull reasonably recent permits to keep the backfill bounded. */
const SINCE_DATE = "2015-01-01";

/** Raw Socrata Building Permits record (subset we use). */
export interface RawPermit {
  permit_?: string;
  permit_type?: string;
  work_description?: string;
  issue_date?: string;
  reported_cost?: string;
  pin_list?: string;
  street_number?: string;
  street_direction?: string;
  street_name?: string;
  zip?: string;
  latitude?: string;
  longitude?: string;
}

/** Normalized, DB-ready permit row. */
export interface PermitRow {
  permitId: string;
  pin: string | null;
  address: string | null;
  zip: string | null;
  permitType: string | null;
  workDescription: string | null;
  issueDate: string | null;
  reportedCost: number | null;
  isDemolition: boolean;
  lat: number;
  lon: number;
  provenance: Provenance;
}

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bigint(v: string | undefined): number | null {
  const n = num(v);
  return n == null ? null : Math.round(n);
}

/** Compose a street address from the parts the dataset provides. */
function joinAddress(r: RawPermit): string | null {
  const parts = [r.street_number, r.street_direction, r.street_name].filter(
    (p) => p != null && p !== ""
  );
  return parts.length > 0 ? parts.join(" ") : null;
}

export const permitsAdapter: SourceAdapter<RawPermit, PermitRow> = {
  sourceKey: SOURCE_KEY,
  targetTable: "building_permits",

  async fetch(_opts: FetchOpts): Promise<RawPermit[]> {
    const all: RawPermit[] = [];
    const pageSize = 1000;
    const box = `within_box(location,${SE_BBOX.north},${SE_BBOX.west},${SE_BBOX.south},${SE_BBOX.east})`;
    const where = encodeURIComponent(`${box} AND issue_date>'${SINCE_DATE}'`);

    for (let offset = 0; ; offset += pageSize) {
      const url = `${PERMITS_URL}?$where=${where}&$limit=${pageSize}&$offset=${offset}&$order=permit_`;
      const res = await fetch(url, {
        headers: socrataHeaders(),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) break;
      const page: RawPermit[] = await res.json();
      if (page.length === 0) break;
      all.push(...page);
      if (page.length < pageSize) break;
    }

    return all;
  },

  normalize(raw: RawPermit): PermitRow | null {
    const permitId = raw.permit_?.trim();
    if (!permitId) return null;

    const lat = num(raw.latitude);
    const lon = num(raw.longitude);
    if (lat == null || lon == null || lat === 0 || lon === 0) return null;
    if (lat < 41.6 || lat > 42.1 || lon < -88.0 || lon > -87.4) return null;

    const permitType = raw.permit_type?.trim() || null;
    const isDemolition = (permitType ?? "").toUpperCase().includes("DEMOLITION");

    const pin = raw.pin_list?.split(/[;,\s]+/).find((p) => p.trim())?.trim() || null;

    return {
      permitId,
      pin,
      address: joinAddress(raw),
      zip: raw.zip?.trim() || null,
      permitType,
      workDescription: raw.work_description?.trim() || null,
      issueDate: raw.issue_date || null,
      reportedCost: bigint(raw.reported_cost),
      isDemolition,
      lat,
      lon,
      provenance: { source: SOURCE_KEY, raw_json: raw },
    };
  },

  async upsert(sql: SQL, rows: PermitRow[]): Promise<number> {
    let written = 0;
    for (const r of rows) {
      await sql`
        INSERT INTO building_permits (
          permit_id, pin, address, zip, permit_type, work_description,
          issue_date, reported_cost, is_demolition, lat, lon, geom,
          source, fetched_at, raw_json
        )
        VALUES (
          ${r.permitId}, ${r.pin}, ${r.address}, ${r.zip}, ${r.permitType}, ${r.workDescription},
          ${r.issueDate}, ${r.reportedCost}, ${r.isDemolition}, ${r.lat}, ${r.lon},
          ST_MakePoint(${r.lon}, ${r.lat})::geography,
          ${r.provenance.source}, NOW(), ${JSON.stringify(r.provenance.raw_json)}
        )
        ON CONFLICT (permit_id) DO UPDATE SET
          pin = EXCLUDED.pin,
          address = EXCLUDED.address,
          zip = EXCLUDED.zip,
          permit_type = EXCLUDED.permit_type,
          work_description = EXCLUDED.work_description,
          issue_date = EXCLUDED.issue_date,
          reported_cost = EXCLUDED.reported_cost,
          is_demolition = EXCLUDED.is_demolition,
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
