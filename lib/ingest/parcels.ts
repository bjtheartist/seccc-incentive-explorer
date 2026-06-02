import {
  describeClassCode,
  isCommercialClass,
  isIndustrialClass,
  isVacantClass,
} from "@/lib/parcel-classes";
import { socrataHeaders } from "@/lib/socrata";
import type { FetchOpts, Provenance, SourceAdapter, SQL } from "./types";

/**
 * Reference adapter — Cook County parcels.
 *
 * Worked example that later domain adapters copy. Bulk source is the Socrata
 * Parcel Universe (`nj4t-kc8j`, ZIP-filterable, paginated). Each normalized
 * row is enriched with assessed values from the Cook County assessed-values
 * table (`uzyt-m557`). Upsert lands the snapshot in `parcels` and appends an
 * assessment row to `parcel_valuations`.
 */

const SOURCE_KEY = "parcels";

/** Socrata Parcel Universe dataset. */
const PARCEL_UNIVERSE_URL =
  "https://datacatalog.cookcountyil.gov/resource/nj4t-kc8j.json";
/** Cook County assessed-values enrichment dataset. */
const ASSESSOR_URL =
  "https://datacatalog.cookcountyil.gov/resource/uzyt-m557.json";

/** Raw Socrata Parcel Universe record, augmented with assessor enrichment. */
export interface RawParcel {
  pin?: string;
  year?: string;
  prop_address?: string;
  address?: string;
  class?: string;
  tax_code?: string;
  township_name?: string;
  land_square_footage?: string;
  building_square_footage?: string;
  age?: string;
  certified_land?: string;
  certified_building?: string;
  certified_total?: string;
  property_type?: string;
  lat?: string;
  lon?: string;
  latitude?: string;
  longitude?: string;
  zip_code?: string;
  /** Assessed-value enrichment (joined by PIN in `fetch`). */
  assessor?: AssessorRecord;
}

interface AssessorRecord {
  pin?: string;
  year?: string;
  certified_land?: string;
  certified_bldg?: string;
  certified_tot?: string;
}

/** Normalized, DB-ready parcel row. */
export interface ParcelRow {
  pin: string;
  address: string;
  zip: string | null;
  classCode: string;
  classDescription: string;
  taxCode: string | null;
  township: string | null;
  landSqft: number | null;
  bldgSqft: number | null;
  bldgAge: number | null;
  landValue: number | null;
  bldgValue: number | null;
  totalValue: number | null;
  parcelType: number | null;
  isCommercial: boolean;
  isIndustrial: boolean;
  isVacant: boolean;
  ownerName: string | null;
  ownerMailingAddress: string | null;
  ownerType: string | null;
  lat: number;
  lon: number;
  taxYear: string | null;
  assessedLand: number | null;
  assessedBuilding: number | null;
  assessedTotal: number | null;
  provenance: Provenance;
}

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanZip(zip: string | undefined): string | null {
  const value = zip?.trim() || "";
  return /^\d{5}$/.test(value) && value !== "00000" ? value : null;
}

async function fetchLatestParcelYear(zipList: string): Promise<string | null> {
  const where = encodeURIComponent(`zip_code in(${zipList})`);
  const url = `${PARCEL_UNIVERSE_URL}?$select=max(year)&$where=${where}`;
  try {
    const res = await fetch(url, {
      headers: socrataHeaders(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const rows: Array<{ max_year?: string }> = await res.json();
    const latest = rows[0]?.max_year;
    if (!latest) return null;
    return String(Math.trunc(Number(latest)));
  } catch {
    return null;
  }
}

/** Batch-fetch assessor enrichment by PIN. Failures are non-fatal. */
async function fetchAssessorBatch(
  pins: string[]
): Promise<Map<string, AssessorRecord>> {
  const out = new Map<string, AssessorRecord>();
  if (pins.length === 0) return out;

  const batchSize = 50;
  for (let i = 0; i < pins.length; i += batchSize) {
    const batch = pins.slice(i, i + batchSize);
    const inClause = batch.map((p) => `'${p}'`).join(",");
    const url = `${ASSESSOR_URL}?$where=pin in(${encodeURIComponent(inClause)})&$limit=${batchSize * 5}&$select=pin,year,certified_land,certified_bldg,certified_tot&$order=year DESC`;
    try {
      const res = await fetch(url, {
        headers: socrataHeaders(),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data: AssessorRecord[] = await res.json();
        for (const a of data) {
          if (a.pin && !out.has(a.pin)) out.set(a.pin, a);
        }
      }
    } catch {
      // Enrichment is best-effort
    }
    if (i + batchSize < pins.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return out;
}

export const parcelsAdapter: SourceAdapter<RawParcel, ParcelRow> = {
  sourceKey: SOURCE_KEY,
  targetTable: "parcels",

  async fetch({ zips }: FetchOpts): Promise<RawParcel[]> {
    const all: RawParcel[] = [];
    const pageSize = 5000;
    const zipList = zips.map((z) => `'${z}'`).join(",");
    const latestYear = await fetchLatestParcelYear(zipList);
    if (!latestYear) return [];

    for (const zip of zips) {
      for (let offset = 0; ; offset += pageSize) {
        const where = encodeURIComponent(`zip_code='${zip}' AND year=${latestYear}`);
        const select = [
          "pin",
          "year",
          "class",
          "tax_code",
          "township_name",
          "lat",
          "lon",
          "zip_code",
        ].join(",");
        const url = `${PARCEL_UNIVERSE_URL}?$select=${select}&$where=${where}&$limit=${pageSize}&$offset=${offset}&$order=pin`;
        const res = await fetch(url, {
          headers: socrataHeaders(),
          signal: AbortSignal.timeout(60000),
        });
        if (!res.ok) break;
        const page: RawParcel[] = await res.json();
        if (page.length === 0) break;
        all.push(...page);
        if (page.length < pageSize) break;
      }
    }

    if (process.env.SKIP_PARCEL_ASSESSOR !== "1") {
      const pins = all.map((r) => r.pin).filter((p): p is string => Boolean(p));
      const assessor = await fetchAssessorBatch(pins);
      for (const r of all) {
        if (r.pin && assessor.has(r.pin)) r.assessor = assessor.get(r.pin);
      }
    }

    return all;
  },

  normalize(raw: RawParcel): ParcelRow | null {
    const pin = raw.pin?.trim();
    if (!pin) return null;

    const lat = num(raw.lat) ?? num(raw.latitude);
    const lon = num(raw.lon) ?? num(raw.longitude);
    if (lat == null || lon == null || lat === 0 || lon === 0) return null;
    if (lat < 41.6 || lat > 42.1 || lon < -88.0 || lon > -87.4) return null;

    const classCode = raw.class || "";
    const a = raw.assessor;

    const assessedLand = a ? num(a.certified_land) : null;
    const assessedBuilding = a ? num(a.certified_bldg) : null;
    const assessedTotal =
      (a ? num(a.certified_tot) : null) ??
      (assessedLand != null && assessedBuilding != null
        ? assessedLand + assessedBuilding
        : null);

    return {
      pin,
      address: raw.prop_address || raw.address || "",
      zip: cleanZip(raw.zip_code),
      classCode,
      classDescription: describeClassCode(classCode),
      taxCode: raw.tax_code || null,
      township: raw.township_name || null,
      landSqft: num(raw.land_square_footage),
      bldgSqft: num(raw.building_square_footage),
      bldgAge: num(raw.age),
      landValue: num(raw.certified_land),
      bldgValue: num(raw.certified_building),
      totalValue: num(raw.certified_total),
      parcelType: num(raw.property_type),
      isCommercial: isCommercialClass(classCode),
      isIndustrial: isIndustrialClass(classCode),
      isVacant: isVacantClass(classCode),
      ownerName: null,
      ownerMailingAddress: null,
      ownerType: null,
      lat,
      lon,
      taxYear: a?.year || null,
      assessedLand,
      assessedBuilding,
      assessedTotal,
      provenance: { source: SOURCE_KEY, raw_json: raw },
    };
  },

  async upsert(sql: SQL, rows: ParcelRow[]): Promise<number> {
    let written = 0;
    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const parcelPayload = JSON.stringify(
        batch.map((r) => ({
          pin: r.pin,
          address: r.address,
          zip: r.zip,
          class_code: r.classCode,
          class_description: r.classDescription,
          tax_code: r.taxCode,
          township: r.township,
          land_sqft: r.landSqft,
          bldg_sqft: r.bldgSqft,
          bldg_age: r.bldgAge,
          land_value: r.landValue,
          bldg_value: r.bldgValue,
          total_value: r.totalValue,
          parcel_type: r.parcelType,
          is_commercial: r.isCommercial,
          is_industrial: r.isIndustrial,
          is_vacant: r.isVacant,
          owner_name: r.ownerName,
          owner_mailing_address: r.ownerMailingAddress,
          owner_type: r.ownerType,
          lat: r.lat,
          lon: r.lon,
          source: r.provenance.source,
          raw_json: r.provenance.raw_json,
        }))
      );

      await sql`
        WITH rows AS (
          SELECT *
          FROM jsonb_to_recordset(${parcelPayload}::jsonb) AS r(
            pin TEXT,
            address TEXT,
            zip TEXT,
            class_code TEXT,
            class_description TEXT,
            tax_code TEXT,
            township TEXT,
            land_sqft DOUBLE PRECISION,
            bldg_sqft DOUBLE PRECISION,
            bldg_age INTEGER,
            land_value BIGINT,
            bldg_value BIGINT,
            total_value BIGINT,
            parcel_type INTEGER,
            is_commercial BOOLEAN,
            is_industrial BOOLEAN,
            is_vacant BOOLEAN,
            owner_name TEXT,
            owner_mailing_address TEXT,
            owner_type TEXT,
            lat DOUBLE PRECISION,
            lon DOUBLE PRECISION,
            source TEXT,
            raw_json JSONB
          )
        )
        INSERT INTO parcels (
          pin, address, zip, class_code, class_description, tax_code, township,
          land_sqft, bldg_sqft, bldg_age, land_value, bldg_value, total_value,
          parcel_type, is_commercial, is_industrial, is_vacant,
          owner_name, owner_mailing_address, owner_type,
          lat, lon, geom, source, fetched_at, raw_json
        )
        SELECT
          pin, address, zip, class_code, class_description, tax_code, township,
          land_sqft, bldg_sqft, bldg_age, land_value, bldg_value, total_value,
          parcel_type, is_commercial, is_industrial, is_vacant,
          owner_name, owner_mailing_address, owner_type,
          lat, lon, ST_MakePoint(lon, lat)::geography, source, NOW(), raw_json
        FROM rows
        ON CONFLICT (pin) DO UPDATE SET
          address = EXCLUDED.address,
          zip = EXCLUDED.zip,
          class_code = EXCLUDED.class_code,
          class_description = EXCLUDED.class_description,
          tax_code = EXCLUDED.tax_code,
          township = EXCLUDED.township,
          land_sqft = EXCLUDED.land_sqft,
          bldg_sqft = EXCLUDED.bldg_sqft,
          bldg_age = EXCLUDED.bldg_age,
          land_value = EXCLUDED.land_value,
          bldg_value = EXCLUDED.bldg_value,
          total_value = EXCLUDED.total_value,
          parcel_type = EXCLUDED.parcel_type,
          is_commercial = EXCLUDED.is_commercial,
          is_industrial = EXCLUDED.is_industrial,
          is_vacant = EXCLUDED.is_vacant,
          owner_name = EXCLUDED.owner_name,
          owner_mailing_address = EXCLUDED.owner_mailing_address,
          owner_type = EXCLUDED.owner_type,
          lat = EXCLUDED.lat,
          lon = EXCLUDED.lon,
          geom = EXCLUDED.geom,
          source = EXCLUDED.source,
          fetched_at = NOW(),
          raw_json = EXCLUDED.raw_json
      `;
      written += batch.length;

      const valuationPayload = JSON.stringify(
        batch
          .filter((r) => r.taxYear)
          .map((r) => ({
            pin: r.pin,
            tax_year: r.taxYear,
            assessed_land: r.assessedLand,
            assessed_building: r.assessedBuilding,
            assessed_total: r.assessedTotal,
            source: r.provenance.source,
          }))
      );

      if (valuationPayload !== "[]") {
        await sql`
          WITH rows AS (
            SELECT *
            FROM jsonb_to_recordset(${valuationPayload}::jsonb) AS r(
              pin TEXT,
              tax_year TEXT,
              assessed_land BIGINT,
              assessed_building BIGINT,
              assessed_total BIGINT,
              source TEXT
            )
          )
          INSERT INTO parcel_valuations (
            pin, tax_year, assessed_land, assessed_building, assessed_total, source, fetched_at
          )
          SELECT pin, tax_year, assessed_land, assessed_building, assessed_total, source, NOW()
          FROM rows
          ON CONFLICT (pin, tax_year) DO NOTHING
        `;
      }
    }
    return written;
  },
};
