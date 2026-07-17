import { socrataHeaders } from "@/lib/socrata";
import { batchPins, pinInClause, toDashedPin, toDigitsOnlyPin } from "./pin-batch";
import type { FetchOpts, Provenance, SourceAdapter, SQL } from "./types";

/**
 * Cook County Treasurer Annual Tax Sale adapter (Phase-2 distress overlay —
 * see lib/corridor-owners.ts).
 *
 * Source: Socrata `55ju-2fs9` (datacatalog.cookcountyil.gov). PIN-keyed, same
 * batched `$where=pin in(...)` fetch strategy and PIN-format handling as
 * scavenger-sale.ts (see that file's header for the dashed-vs-digits-only
 * PIN detail, verified live against this dataset too).
 *
 * A single PIN can appear across multiple tax-sale years (verified live —
 * e.g. PIN 07-18-411-025-0000 in both 2013 and 2014), so the row key is
 * pin + year rather than pin alone.
 */

const SOURCE_KEY = "annual_tax_sale";

const ANNUAL_TAX_SALE_URL = "https://datacatalog.cookcountyil.gov/resource/55ju-2fs9.json";

/** Raw Socrata Annual Tax Sale record (subset we use). */
export interface RawAnnualTaxSaleEntry {
  tax_sale_year?: string;
  pin?: string;
  classification?: string;
  township_name?: string;
  sold_at_sale?: boolean;
  tax_amount_offered?: string;
  penalty_amount_offered?: string;
  total_tax_and_penalty_amount_offered?: string;
  location_1?: { latitude?: string; longitude?: string };
}

/** Normalized, DB-ready annual-tax-sale-entry row. */
export interface AnnualTaxSaleRow {
  entryId: string;
  pin: string;
  taxSaleYear: number | null;
  classification: string | null;
  townshipName: string | null;
  soldAtSale: boolean | null;
  taxAmountOffered: number | null;
  penaltyAmountOffered: number | null;
  totalTaxAndPenaltyAmountOffered: number | null;
  lat: number | null;
  lon: number | null;
  provenance: Provenance;
}

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function int(v: string | undefined): number | null {
  const n = num(v);
  return n == null ? null : Math.trunc(n);
}

export const annualTaxSaleAdapter: SourceAdapter<RawAnnualTaxSaleEntry, AnnualTaxSaleRow> = {
  sourceKey: SOURCE_KEY,
  targetTable: "annual_tax_sale_entries",

  async fetch(opts: FetchOpts): Promise<RawAnnualTaxSaleEntry[]> {
    const pins = (opts.pins ?? []).map(toDashedPin);
    if (pins.length === 0) return [];

    const all: RawAnnualTaxSaleEntry[] = [];
    const pageSize = 1000;

    for (const batch of batchPins(pins)) {
      const where = pinInClause(batch);
      for (let offset = 0; ; offset += pageSize) {
        const params = new URLSearchParams({
          $where: where,
          $limit: String(pageSize),
          $offset: String(offset),
        });
        const url = `${ANNUAL_TAX_SALE_URL}?${params.toString()}`;
        const res = await fetch(url, {
          headers: socrataHeaders(),
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) break;
        const page: RawAnnualTaxSaleEntry[] = await res.json();
        if (page.length === 0) break;
        all.push(...page);
        if (page.length < pageSize) break;
      }
    }

    return all;
  },

  normalize(raw: RawAnnualTaxSaleEntry): AnnualTaxSaleRow | null {
    const pin = raw.pin ? toDigitsOnlyPin(raw.pin) : null;
    if (!pin) return null;

    const taxSaleYear = int(raw.tax_sale_year);
    const entryId = `${pin}:${taxSaleYear ?? "na"}`;

    return {
      entryId,
      pin,
      taxSaleYear,
      classification: raw.classification?.trim() || null,
      townshipName: raw.township_name?.trim() || null,
      soldAtSale: typeof raw.sold_at_sale === "boolean" ? raw.sold_at_sale : null,
      taxAmountOffered: num(raw.tax_amount_offered),
      penaltyAmountOffered: num(raw.penalty_amount_offered),
      totalTaxAndPenaltyAmountOffered: num(raw.total_tax_and_penalty_amount_offered),
      lat: num(raw.location_1?.latitude),
      lon: num(raw.location_1?.longitude),
      provenance: { source: SOURCE_KEY, raw_json: raw },
    };
  },

  async upsert(sql: SQL, rows: AnnualTaxSaleRow[]): Promise<number> {
    let written = 0;
    for (const r of rows) {
      if (r.lat != null && r.lon != null) {
        await sql`
          INSERT INTO annual_tax_sale_entries (
            entry_id, pin, tax_sale_year, classification, township_name,
            sold_at_sale, tax_amount_offered, penalty_amount_offered,
            total_tax_and_penalty_amount_offered, lat, lon, geom,
            source, fetched_at, raw_json
          )
          VALUES (
            ${r.entryId}, ${r.pin}, ${r.taxSaleYear}, ${r.classification}, ${r.townshipName},
            ${r.soldAtSale}, ${r.taxAmountOffered}, ${r.penaltyAmountOffered},
            ${r.totalTaxAndPenaltyAmountOffered}, ${r.lat}, ${r.lon},
            ST_MakePoint(${r.lon}, ${r.lat})::geography,
            ${r.provenance.source}, NOW(), ${JSON.stringify(r.provenance.raw_json)}
          )
          ON CONFLICT (entry_id) DO UPDATE SET
            pin = EXCLUDED.pin,
            tax_sale_year = EXCLUDED.tax_sale_year,
            classification = EXCLUDED.classification,
            township_name = EXCLUDED.township_name,
            sold_at_sale = EXCLUDED.sold_at_sale,
            tax_amount_offered = EXCLUDED.tax_amount_offered,
            penalty_amount_offered = EXCLUDED.penalty_amount_offered,
            total_tax_and_penalty_amount_offered = EXCLUDED.total_tax_and_penalty_amount_offered,
            lat = EXCLUDED.lat,
            lon = EXCLUDED.lon,
            geom = EXCLUDED.geom,
            source = EXCLUDED.source,
            fetched_at = NOW(),
            raw_json = EXCLUDED.raw_json
        `;
      } else {
        await sql`
          INSERT INTO annual_tax_sale_entries (
            entry_id, pin, tax_sale_year, classification, township_name,
            sold_at_sale, tax_amount_offered, penalty_amount_offered,
            total_tax_and_penalty_amount_offered, lat, lon, geom,
            source, fetched_at, raw_json
          )
          VALUES (
            ${r.entryId}, ${r.pin}, ${r.taxSaleYear}, ${r.classification}, ${r.townshipName},
            ${r.soldAtSale}, ${r.taxAmountOffered}, ${r.penaltyAmountOffered},
            ${r.totalTaxAndPenaltyAmountOffered}, ${r.lat}, ${r.lon}, NULL,
            ${r.provenance.source}, NOW(), ${JSON.stringify(r.provenance.raw_json)}
          )
          ON CONFLICT (entry_id) DO UPDATE SET
            pin = EXCLUDED.pin,
            tax_sale_year = EXCLUDED.tax_sale_year,
            classification = EXCLUDED.classification,
            township_name = EXCLUDED.township_name,
            sold_at_sale = EXCLUDED.sold_at_sale,
            tax_amount_offered = EXCLUDED.tax_amount_offered,
            penalty_amount_offered = EXCLUDED.penalty_amount_offered,
            total_tax_and_penalty_amount_offered = EXCLUDED.total_tax_and_penalty_amount_offered,
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
    return written;
  },
};
