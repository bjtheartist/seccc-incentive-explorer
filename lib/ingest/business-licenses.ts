import { socrataHeaders } from "@/lib/socrata";
import type { FetchOpts, Provenance, SourceAdapter, SQL } from "./types";

/**
 * Business Licenses adapter — City of Chicago.
 *
 * Source: Socrata `r5kz-chrr` on data.cityofchicago.org. ZIP-filterable
 * (`zip_code`) and paginated. Each upstream row is one license period; the
 * Socrata `id` (license_number + start date) is the stable per-row key, so
 * renewals append rather than overwrite. Lands rows in `business_licenses`.
 *
 * Dataset id + field names verified against the live endpoint:
 *   https://data.cityofchicago.org/resource/r5kz-chrr.json?$limit=2
 */

const SOURCE_KEY = "business_licenses";

const BUSINESS_LICENSES_URL =
  "https://data.cityofchicago.org/resource/r5kz-chrr.json";

/** Raw Socrata Business Licenses record (fields used here). */
export interface RawBusinessLicense {
  id?: string;
  license_id?: string;
  account_number?: string;
  legal_name?: string;
  doing_business_as_name?: string;
  address?: string;
  zip_code?: string;
  license_code?: string;
  license_description?: string;
  application_type?: string;
  license_status?: string;
  license_start_date?: string;
  expiration_date?: string;
  date_issued?: string;
  latitude?: string;
  longitude?: string;
}

/** Normalized, DB-ready business-license row. */
export interface BusinessLicenseRow {
  licenseId: string;
  accountNumber: string | null;
  legalName: string | null;
  dbaName: string | null;
  address: string | null;
  zip: string | null;
  licenseCode: string | null;
  licenseDescription: string | null;
  applicationType: string | null;
  licenseStatus: string | null;
  licenseStartDate: string | null;
  expirationDate: string | null;
  dateIssued: string | null;
  lat: number | null;
  lon: number | null;
  provenance: Provenance;
}

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: string | undefined): string | null {
  if (v == null) return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

/** Socrata floating timestamps → ISO date (YYYY-MM-DD), or null. */
function dateOnly(v: string | undefined): string | null {
  const s = str(v);
  if (!s) return null;
  return s.slice(0, 10);
}

export const businessLicensesAdapter: SourceAdapter<
  RawBusinessLicense,
  BusinessLicenseRow
> = {
  sourceKey: SOURCE_KEY,
  targetTable: "business_licenses",

  async fetch({ zips }: FetchOpts): Promise<RawBusinessLicense[]> {
    const all: RawBusinessLicense[] = [];
    const pageSize = 1000;
    const zipList = zips.map((z) => `'${z}'`).join(",");

    for (let offset = 0; ; offset += pageSize) {
      const where = encodeURIComponent(`zip_code in(${zipList})`);
      const url = `${BUSINESS_LICENSES_URL}?$where=${where}&$limit=${pageSize}&$offset=${offset}&$order=id`;
      const res = await fetch(url, {
        headers: socrataHeaders(),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) break;
      const page: RawBusinessLicense[] = await res.json();
      if (page.length === 0) break;
      all.push(...page);
      if (page.length < pageSize) break;
    }

    return all;
  },

  normalize(raw: RawBusinessLicense): BusinessLicenseRow | null {
    // `id` is the stable per-row key; fall back to license_id if absent.
    const licenseId = str(raw.id) ?? str(raw.license_id);
    if (!licenseId) return null;

    const lat = num(raw.latitude);
    const lon = num(raw.longitude);
    // Coordinates are optional for a license; only drop clearly bogus zeros.
    const hasGeo = lat != null && lon != null && lat !== 0 && lon !== 0;
    const inBounds =
      hasGeo && lat >= 41.6 && lat <= 42.1 && lon >= -88.0 && lon <= -87.4;

    return {
      licenseId,
      accountNumber: str(raw.account_number),
      legalName: str(raw.legal_name),
      dbaName: str(raw.doing_business_as_name),
      address: str(raw.address),
      zip: str(raw.zip_code),
      licenseCode: str(raw.license_code),
      licenseDescription: str(raw.license_description),
      applicationType: str(raw.application_type),
      licenseStatus: str(raw.license_status),
      licenseStartDate: dateOnly(raw.license_start_date),
      expirationDate: dateOnly(raw.expiration_date),
      dateIssued: dateOnly(raw.date_issued),
      lat: inBounds ? lat : null,
      lon: inBounds ? lon : null,
      provenance: { source: SOURCE_KEY, raw_json: raw },
    };
  },

  async upsert(sql: SQL, rows: BusinessLicenseRow[]): Promise<number> {
    let written = 0;
    const batchSize = 50;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      for (const r of batch) {
        // geom is only set when in-bounds coordinates exist; ST_MakePoint
        // cannot take NULL args, so split on presence of geo.
        if (r.lat != null && r.lon != null) {
          await sql`
            INSERT INTO business_licenses (
              license_id, account_number, legal_name, dba_name, address, zip,
              license_code, license_description, application_type, license_status,
              license_start_date, expiration_date, date_issued,
              lat, lon, geom, source, fetched_at, raw_json
            )
            VALUES (
              ${r.licenseId}, ${r.accountNumber}, ${r.legalName}, ${r.dbaName}, ${r.address}, ${r.zip},
              ${r.licenseCode}, ${r.licenseDescription}, ${r.applicationType}, ${r.licenseStatus},
              ${r.licenseStartDate}, ${r.expirationDate}, ${r.dateIssued},
              ${r.lat}, ${r.lon}, ST_MakePoint(${r.lon}, ${r.lat})::geography,
              ${r.provenance.source}, NOW(), ${JSON.stringify(r.provenance.raw_json)}
            )
            ON CONFLICT (license_id) DO UPDATE SET
              account_number = EXCLUDED.account_number,
              legal_name = EXCLUDED.legal_name,
              dba_name = EXCLUDED.dba_name,
              address = EXCLUDED.address,
              zip = EXCLUDED.zip,
              license_code = EXCLUDED.license_code,
              license_description = EXCLUDED.license_description,
              application_type = EXCLUDED.application_type,
              license_status = EXCLUDED.license_status,
              license_start_date = EXCLUDED.license_start_date,
              expiration_date = EXCLUDED.expiration_date,
              date_issued = EXCLUDED.date_issued,
              lat = EXCLUDED.lat,
              lon = EXCLUDED.lon,
              geom = EXCLUDED.geom,
              source = EXCLUDED.source,
              fetched_at = NOW(),
              raw_json = EXCLUDED.raw_json
          `;
        } else {
          await sql`
            INSERT INTO business_licenses (
              license_id, account_number, legal_name, dba_name, address, zip,
              license_code, license_description, application_type, license_status,
              license_start_date, expiration_date, date_issued,
              lat, lon, geom, source, fetched_at, raw_json
            )
            VALUES (
              ${r.licenseId}, ${r.accountNumber}, ${r.legalName}, ${r.dbaName}, ${r.address}, ${r.zip},
              ${r.licenseCode}, ${r.licenseDescription}, ${r.applicationType}, ${r.licenseStatus},
              ${r.licenseStartDate}, ${r.expirationDate}, ${r.dateIssued},
              ${r.lat}, ${r.lon}, NULL,
              ${r.provenance.source}, NOW(), ${JSON.stringify(r.provenance.raw_json)}
            )
            ON CONFLICT (license_id) DO UPDATE SET
              account_number = EXCLUDED.account_number,
              legal_name = EXCLUDED.legal_name,
              dba_name = EXCLUDED.dba_name,
              address = EXCLUDED.address,
              zip = EXCLUDED.zip,
              license_code = EXCLUDED.license_code,
              license_description = EXCLUDED.license_description,
              application_type = EXCLUDED.application_type,
              license_status = EXCLUDED.license_status,
              license_start_date = EXCLUDED.license_start_date,
              expiration_date = EXCLUDED.expiration_date,
              date_issued = EXCLUDED.date_issued,
              lat = EXCLUDED.lat,
              lon = EXCLUDED.lon,
              geom = EXCLUDED.geom,
              source = EXCLUDED.source,
              fetched_at = NOW(),
              raw_json = EXCLUDED.raw_json
          `;
        }
        written++;
      }
    }
    return written;
  },
};
