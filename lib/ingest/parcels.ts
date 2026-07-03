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
/**
 * Row shape of the CURRENT Parcel Universe dataset (nj4t-kc8j, verified
 * 2026-07-03). The county restructured this dataset into a longitudinal
 * spine: one row per parcel per YEAR, geo/admin context only. The old
 * fields (prop_address, land_square_footage, certified_*, latitude/
 * longitude, property_type) no longer exist; situs address and valuations
 * now come only from the assessor dataset enrichment.
 */
export interface RawParcel {
  pin?: string;
  pin10?: string;
  year?: string;
  class?: string;
  tax_code?: string;
  township_name?: string;
  nbhd_code?: string;
  zip_code?: string;
  lat?: string;
  lon?: string;
  census_tract_geoid?: string;
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

/** Batch-fetch assessor enrichment by PIN. Failures are non-fatal. */
async function fetchAssessorBatch(
  pins: string[]
): Promise<Map<string, AssessorRecord>> {
  const out = new Map<string, AssessorRecord>();
  if (pins.length === 0) return out;

  const batchSize = 50;
  // Circuit breaker: if the assessor portal is down, N consecutive batch
  // failures abort the remaining enrichment loudly instead of burning a
  // timeout per batch (~1,000 batches for a 3-ZIP run). Enrichment is
  // re-runnable: the upsert refreshes owner fields on the next sync.
  const maxConsecutiveFailures = 3;
  let consecutiveFailures = 0;
  const totalBatches = Math.ceil(pins.length / batchSize);
  for (let i = 0; i < pins.length; i += batchSize) {
    const batch = pins.slice(i, i + batchSize);
    const inClause = batch.map((p) => `'${p}'`).join(",");
    const url = `${ASSESSOR_URL}?$where=pin in(${encodeURIComponent(inClause)})&$limit=${batchSize}&$select=pin,tax_year,certified_tot_land,certified_tot_bldg,tax_bill_name,taxpayer_name,tax_bill_mailing_address,tax_bill_city,tax_bill_state,tax_bill_zip`;
    try {
      const res = await fetch(url, {
        headers: socrataHeaders(),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data: AssessorRecord[] = await res.json();
        for (const a of data) {
          if (a.pin && !out.has(a.pin)) out.set(a.pin, a);
        }
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
      }
    } catch {
      consecutiveFailures++;
    }
    if (consecutiveFailures >= maxConsecutiveFailures) {
      const batchNo = Math.floor(i / batchSize) + 1;
      console.warn(
        `assessor enrichment aborted: ${maxConsecutiveFailures} consecutive failures at batch ${batchNo}/${totalBatches} (portal likely down); owner fields will backfill on the next sync`
      );
      break;
    }
    const batchNo = Math.floor(i / batchSize) + 1;
    if (batchNo % 100 === 0) {
      console.log(`  assessor enrichment: batch ${batchNo}/${totalBatches}, ${out.size} records`);
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

    // The dataset is one-row-per-parcel-per-YEAR; without a year filter a
    // 3-ZIP query returns every historical row (~1.6M). Pick the newest
    // year with substantive coverage. Probed with cheap per-year counts:
    // a GROUP BY over the full filtered set times out server-side.
    const maxRes = await fetch(`${PARCEL_UNIVERSE_URL}?$select=max(year)`, {
      headers: socrataHeaders(),
      signal: AbortSignal.timeout(30000),
    });
    if (!maxRes.ok) throw new Error("parcels: max(year) probe failed");
    const maxRow: Array<{ max_year?: string }> = await maxRes.json();
    const maxYear = Math.trunc(Number(maxRow[0]?.max_year));
    if (!Number.isFinite(maxYear)) throw new Error("parcels: could not parse max(year)");

    let dataYear: string | null = null;
    for (let y = maxYear; y >= maxYear - 4; y--) {
      const countUrl = `${PARCEL_UNIVERSE_URL}?$select=count(*)&$where=${encodeURIComponent(`zip_code in(${zipList}) AND year='${y}'`)}`;
      const countRes = await fetch(countUrl, {
        headers: socrataHeaders(),
        signal: AbortSignal.timeout(30000),
      });
      if (!countRes.ok) continue;
      const countRow: Array<{ count?: string }> = await countRes.json();
      const n = Number(countRow[0]?.count ?? 0);
      console.log(`  parcel universe year ${y}: ${n} rows for target ZIPs`);
      if (n >= 10000) {
        dataYear = String(y);
        break;
      }
    }
    if (!dataYear) {
      throw new Error("parcels: no year within 5 of max had substantive coverage for the target ZIPs");
    }
    console.log(`  parcel universe data year: ${dataYear}`);

    for (let offset = 0; ; offset += pageSize) {
      const where = encodeURIComponent(`zip_code in(${zipList}) AND year='${dataYear}'`);
      // $order=:id pages on Socrata's indexed internal row id; $order=pin forces
      // a server-side sort of the filtered scan and times out on this dataset.
      const url = `${PARCEL_UNIVERSE_URL}?$where=${where}&$limit=${pageSize}&$offset=${offset}&$order=:id`;
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

    const lat = num(raw.lat);
    const lon = num(raw.lon);
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
      // Situs address is no longer published in the Parcel Universe dataset;
      // the assessor enrichment carries only the owner's mailing address.
      address: "",
      zip: raw.zip_code?.trim() || null,
      classCode,
      classDescription: describeClassCode(classCode),
      taxCode: raw.tax_code || null,
      township: raw.township_name || null,
      landSqft: null,
      bldgSqft: null,
      bldgAge: null,
      landValue: assessedLand,
      bldgValue: assessedBuilding,
      totalValue: assessedTotal,
      parcelType: null,
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
    // Multi-row batches: one INSERT per row over the HTTP driver costs a
    // network round-trip each (~30 minutes for a 3-ZIP sync). Batching 400
    // rows per statement cuts the same sync to about two minutes.
    const q = sql as unknown as {
      query: (text: string, params: unknown[]) => Promise<unknown>;
    };
    let written = 0;
    const batchSize = 400;
    const PARAMS_PER_ROW = 24;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const params: unknown[] = [];
      const tuples = batch.map((r, j) => {
        const b = j * PARAMS_PER_ROW;
        params.push(
          r.pin, r.address, r.zip, r.classCode, r.classDescription, r.taxCode, r.township,
          r.landSqft, r.bldgSqft, r.bldgAge, r.landValue, r.bldgValue, r.totalValue,
          r.parcelType, r.isCommercial, r.isIndustrial, r.isVacant,
          r.ownerName, r.ownerMailingAddress, r.ownerType,
          r.lat, r.lon, r.provenance.source, JSON.stringify(r.provenance.raw_json)
        );
        const p = (n: number) => `$${b + n}`;
        // geom reuses the lon/lat params; explicit casts because HTTP-driver
        // params arrive untyped.
        return `(${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${p(8)}::double precision, ${p(9)}::double precision, ${p(10)}::integer, ${p(11)}::bigint, ${p(12)}::bigint, ${p(13)}::bigint, ${p(14)}::integer, ${p(15)}::boolean, ${p(16)}::boolean, ${p(17)}::boolean, ${p(18)}, ${p(19)}, ${p(20)}, ${p(21)}::double precision, ${p(22)}::double precision, ST_MakePoint(${p(22)}::double precision, ${p(21)}::double precision)::geography, ${p(23)}, NOW(), ${p(24)}::jsonb)`;
      });
      await q.query(
        `INSERT INTO parcels (
           pin, address, zip, class_code, class_description, tax_code, township,
           land_sqft, bldg_sqft, bldg_age, land_value, bldg_value, total_value,
           parcel_type, is_commercial, is_industrial, is_vacant,
           owner_name, owner_mailing_address, owner_type,
           lat, lon, geom, source, fetched_at, raw_json
         )
         VALUES ${tuples.join(",\n")}
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
           raw_json = EXCLUDED.raw_json`,
        params
      );
      written += batch.length;

      const withValuation = batch.filter((r) => r.taxYear);
      if (withValuation.length > 0) {
        const vParams: unknown[] = [];
        const vTuples = withValuation.map((r, j) => {
          const b = j * 6;
          vParams.push(
            r.pin, r.taxYear, r.assessedLand, r.assessedBuilding, r.assessedTotal, r.provenance.source
          );
          return `($${b + 1}, $${b + 2}, $${b + 3}::bigint, $${b + 4}::bigint, $${b + 5}::bigint, $${b + 6}, NOW())`;
        });
        await q.query(
          `INSERT INTO parcel_valuations (
             pin, tax_year, assessed_land, assessed_building, assessed_total, source, fetched_at
           )
           VALUES ${vTuples.join(",\n")}
           ON CONFLICT (pin, tax_year) DO NOTHING`,
          vParams
        );
      }
    }
    return written;
  },
};
