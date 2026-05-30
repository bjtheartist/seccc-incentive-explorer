import {
  describeClassCode,
  isCommercialClass,
  isIndustrialClass,
  isVacantClass,
} from "@/lib/parcel-classes";
import { classifyOwner } from "@/lib/owner-classify";
import { socrataHeaders } from "@/lib/socrata";
import type { FetchOpts, Provenance, SourceAdapter, SQL } from "./types";

/**
 * Reference adapter — Cook County parcels.
 *
 * Worked example that later domain adapters copy. Bulk source is the Socrata
 * Parcel Universe (`nj4t-kc8j`, ZIP-filterable, paginated). Each normalized
 * row is enriched with assessed values + ownership from the Cook County
 * Assessor (`uzyt-m557`). Upsert lands the snapshot in `parcels` and appends
 * an assessment row to `parcel_valuations`.
 */

const SOURCE_KEY = "parcels";

/** Socrata Parcel Universe dataset. */
const PARCEL_UNIVERSE_URL =
  "https://datacatalog.cookcountyil.gov/resource/nj4t-kc8j.json";
/** Cook County Assessor enrichment dataset. */
const ASSESSOR_URL =
  "https://datacatalog.cookcountyassessor.com/resource/uzyt-m557.json";

/** Raw Socrata Parcel Universe record, augmented with assessor enrichment. */
export interface RawParcel {
  pin?: string;
  prop_address?: string;
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
  latitude?: string;
  longitude?: string;
  zip_code?: string;
  /** Assessor enrichment (joined by PIN in `fetch`). */
  assessor?: AssessorRecord;
}

interface AssessorRecord {
  pin?: string;
  tax_year?: string;
  certified_tot_land?: string;
  certified_tot_bldg?: string;
  tax_bill_name?: string;
  taxpayer_name?: string;
  tax_bill_mailing_address?: string;
  tax_bill_city?: string;
  tax_bill_state?: string;
  tax_bill_zip?: string;
}

/** Normalized, DB-ready parcel row. */
export interface ParcelRow {
  pin: string;
  address: string;
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
    const url = `${ASSESSOR_URL}?$where=pin in(${encodeURIComponent(inClause)})&$limit=${batchSize}&$select=pin,tax_year,certified_tot_land,certified_tot_bldg,tax_bill_name,taxpayer_name,tax_bill_mailing_address,tax_bill_city,tax_bill_state,tax_bill_zip`;
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
    const pageSize = 1000;
    const zipList = zips.map((z) => `'${z}'`).join(",");

    for (let offset = 0; ; offset += pageSize) {
      const where = encodeURIComponent(`zip_code in(${zipList})`);
      const url = `${PARCEL_UNIVERSE_URL}?$where=${where}&$limit=${pageSize}&$offset=${offset}&$order=pin`;
      const res = await fetch(url, {
        headers: socrataHeaders(),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) break;
      const page: RawParcel[] = await res.json();
      if (page.length === 0) break;
      all.push(...page);
      if (page.length < pageSize) break;
    }

    const pins = all.map((r) => r.pin).filter((p): p is string => Boolean(p));
    const assessor = await fetchAssessorBatch(pins);
    for (const r of all) {
      if (r.pin && assessor.has(r.pin)) r.assessor = assessor.get(r.pin);
    }

    return all;
  },

  normalize(raw: RawParcel): ParcelRow | null {
    const pin = raw.pin?.trim();
    if (!pin) return null;

    const lat = num(raw.latitude);
    const lon = num(raw.longitude);
    if (lat == null || lon == null || lat === 0 || lon === 0) return null;
    if (lat < 41.6 || lat > 42.1 || lon < -88.0 || lon > -87.4) return null;

    const classCode = raw.class || "";
    const a = raw.assessor;

    const ownerName = a ? a.tax_bill_name || a.taxpayer_name || null : null;
    const mailingParts = a
      ? [a.tax_bill_mailing_address, a.tax_bill_city, a.tax_bill_state, a.tax_bill_zip].filter(Boolean)
      : [];
    const ownerMailingAddress = mailingParts.length > 0 ? mailingParts.join(", ") : null;
    const ownerType = ownerName ? classifyOwner(ownerName, ownerMailingAddress) : null;

    const assessedLand = a ? num(a.certified_tot_land) : null;
    const assessedBuilding = a ? num(a.certified_tot_bldg) : null;
    const assessedTotal =
      assessedLand != null && assessedBuilding != null
        ? assessedLand + assessedBuilding
        : null;

    return {
      pin,
      address: raw.prop_address || "",
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
      ownerName,
      ownerMailingAddress,
      ownerType,
      lat,
      lon,
      taxYear: a?.tax_year || null,
      assessedLand,
      assessedBuilding,
      assessedTotal,
      provenance: { source: SOURCE_KEY, raw_json: raw },
    };
  },

  async upsert(sql: SQL, rows: ParcelRow[]): Promise<number> {
    let written = 0;
    const batchSize = 50;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      for (const r of batch) {
        await sql`
          INSERT INTO parcels (
            pin, address, class_code, class_description, tax_code, township,
            land_sqft, bldg_sqft, bldg_age, land_value, bldg_value, total_value,
            parcel_type, is_commercial, is_industrial, is_vacant,
            owner_name, owner_mailing_address, owner_type,
            lat, lon, geom, source, fetched_at, raw_json
          )
          VALUES (
            ${r.pin}, ${r.address}, ${r.classCode}, ${r.classDescription}, ${r.taxCode}, ${r.township},
            ${r.landSqft}, ${r.bldgSqft}, ${r.bldgAge}, ${r.landValue}, ${r.bldgValue}, ${r.totalValue},
            ${r.parcelType}, ${r.isCommercial}, ${r.isIndustrial}, ${r.isVacant},
            ${r.ownerName}, ${r.ownerMailingAddress}, ${r.ownerType},
            ${r.lat}, ${r.lon}, ST_MakePoint(${r.lon}, ${r.lat})::geography,
            ${r.provenance.source}, NOW(), ${JSON.stringify(r.provenance.raw_json)}
          )
          ON CONFLICT (pin) DO UPDATE SET
            address = EXCLUDED.address,
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
        written++;

        if (r.taxYear) {
          await sql`
            INSERT INTO parcel_valuations (
              pin, tax_year, assessed_land, assessed_building, assessed_total, source, fetched_at
            )
            VALUES (
              ${r.pin}, ${r.taxYear}, ${r.assessedLand}, ${r.assessedBuilding}, ${r.assessedTotal}, ${r.provenance.source}, NOW()
            )
            ON CONFLICT (pin, tax_year) DO NOTHING
          `;
        }
      }
    }
    return written;
  },
};
