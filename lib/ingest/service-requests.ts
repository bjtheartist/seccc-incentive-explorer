import { socrataHeaders } from "@/lib/socrata";
import type { FetchOpts, Provenance, SourceAdapter, SQL } from "./types";

/**
 * Chicago 311 Service Requests adapter.
 *
 * Source: Socrata `v6vf-nfxy` (data.cityofchicago.org). Unlike permits and
 * violations, this dataset exposes a `zip_code` column, so the fetch is scoped
 * server-side by `zip_code in(...)` over the requested ZIPs.
 *
 * Verified against the live endpoint: PK is `sr_number`; fields are `sr_type`,
 * `status`, `created_date`, `street_address`, `zip_code`, `latitude`,
 * `longitude`.
 */

const SOURCE_KEY = "service_requests_311";

const SR_URL = "https://data.cityofchicago.org/resource/v6vf-nfxy.json";

/** Raw Socrata 311 Service Request record (subset we use). */
export interface RawServiceRequest {
  sr_number?: string;
  sr_type?: string;
  status?: string;
  created_date?: string;
  street_address?: string;
  zip_code?: string;
  latitude?: string;
  longitude?: string;
}

/** Normalized, DB-ready 311 row. */
export interface ServiceRequestRow {
  srNumber: string;
  srType: string | null;
  status: string | null;
  createdDate: string | null;
  address: string | null;
  zip: string | null;
  lat: number;
  lon: number;
  provenance: Provenance;
}

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const serviceRequestsAdapter: SourceAdapter<
  RawServiceRequest,
  ServiceRequestRow
> = {
  sourceKey: SOURCE_KEY,
  targetTable: "service_requests_311",

  async fetch({ zips }: FetchOpts): Promise<RawServiceRequest[]> {
    const all: RawServiceRequest[] = [];
    const pageSize = 1000;
    const zipList = zips.map((z) => `'${z}'`).join(",");

    for (let offset = 0; ; offset += pageSize) {
      const where = encodeURIComponent(`zip_code in(${zipList})`);
      const url = `${SR_URL}?$where=${where}&$limit=${pageSize}&$offset=${offset}&$order=sr_number`;
      const res = await fetch(url, {
        headers: socrataHeaders(),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) break;
      const page: RawServiceRequest[] = await res.json();
      if (page.length === 0) break;
      all.push(...page);
      if (page.length < pageSize) break;
    }

    return all;
  },

  normalize(raw: RawServiceRequest): ServiceRequestRow | null {
    const srNumber = raw.sr_number?.trim();
    if (!srNumber) return null;

    const lat = num(raw.latitude);
    const lon = num(raw.longitude);
    if (lat == null || lon == null || lat === 0 || lon === 0) return null;
    if (lat < 41.6 || lat > 42.1 || lon < -88.0 || lon > -87.4) return null;

    return {
      srNumber,
      srType: raw.sr_type?.trim() || null,
      status: raw.status?.trim() || null,
      createdDate: raw.created_date || null,
      address: raw.street_address?.trim() || null,
      zip: raw.zip_code?.trim() || null,
      lat,
      lon,
      provenance: { source: SOURCE_KEY, raw_json: raw },
    };
  },

  async upsert(sql: SQL, rows: ServiceRequestRow[]): Promise<number> {
    let written = 0;
    for (const r of rows) {
      await sql`
        INSERT INTO service_requests_311 (
          sr_number, sr_type, status, created_date, address, zip,
          lat, lon, geom, source, fetched_at, raw_json
        )
        VALUES (
          ${r.srNumber}, ${r.srType}, ${r.status}, ${r.createdDate}, ${r.address}, ${r.zip},
          ${r.lat}, ${r.lon}, ST_MakePoint(${r.lon}, ${r.lat})::geography,
          ${r.provenance.source}, NOW(), ${JSON.stringify(r.provenance.raw_json)}
        )
        ON CONFLICT (sr_number) DO UPDATE SET
          sr_type = EXCLUDED.sr_type,
          status = EXCLUDED.status,
          created_date = EXCLUDED.created_date,
          address = EXCLUDED.address,
          zip = EXCLUDED.zip,
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
