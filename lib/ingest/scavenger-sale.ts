import { socrataHeaders } from "@/lib/socrata";
import { batchPins, pinInClause, toDashedPin, toDigitsOnlyPin } from "./pin-batch";
import type { FetchOpts, Provenance, SourceAdapter, SQL } from "./types";

/**
 * Cook County Treasurer Scavenger Tax Sale adapter (Phase-2 distress
 * overlay — see lib/corridor-owners.ts).
 *
 * Source: Socrata `ydgz-vkrp` (datacatalog.cookcountyil.gov). PIN-keyed, no
 * ZIP/address column, so this doesn't scope by bbox/ZIP like the condition
 * domain adapters — it scopes by PIN, batching `opts.pins` (DISTINCT
 * `parcels.pin` for the sync footprint, populated by
 * scripts/sync-distress-overlay.ts) through `$where=pin in(...)` via
 * lib/ingest/pin-batch.ts.
 *
 * PIN format: `parcels.pin` is 14-digit digits-only (e.g.
 * "17213210180000"); this dataset stores the dashed 2-2-3-3-4 form (e.g.
 * "17-21-321-018-0000") — verified live: a digits-only `pin in(...)` filter
 * returns zero rows, the dashed form matches. `fetch()` dashes incoming pins
 * before querying; `normalize()` strips them back to digits-only for
 * storage, so the export-time PIN join in lib/corridor-owners.ts matches
 * `parcels.pin` directly.
 *
 * A single PIN can appear across multiple tax-sale years (verified live),
 * so the row key is a composite of pin + year + the from/to delinquency
 * window rather than pin alone.
 */

const SOURCE_KEY = "scavenger_sale";

const SCAVENGER_SALE_URL = "https://datacatalog.cookcountyil.gov/resource/ydgz-vkrp.json";

/** Raw Socrata Scavenger Tax Sale record (subset we use). */
export interface RawScavengerSaleEntry {
  tax_sale_year?: string;
  pin?: string;
  from_year?: string;
  to_year?: string;
  total_amount_paid?: string;
  sold_at_sale?: boolean;
  buyer_name?: string;
  location_1?: { latitude?: string; longitude?: string };
}

/** Normalized, DB-ready scavenger-sale-entry row. */
export interface ScavengerSaleRow {
  entryId: string;
  pin: string;
  taxSaleYear: number | null;
  fromYear: number | null;
  toYear: number | null;
  totalAmountPaid: number | null;
  soldAtSale: boolean | null;
  buyerName: string | null;
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

export const scavengerSaleAdapter: SourceAdapter<RawScavengerSaleEntry, ScavengerSaleRow> = {
  sourceKey: SOURCE_KEY,
  targetTable: "scavenger_sale_entries",

  async fetch(opts: FetchOpts): Promise<RawScavengerSaleEntry[]> {
    const pins = (opts.pins ?? []).map(toDashedPin);
    if (pins.length === 0) return [];

    const all: RawScavengerSaleEntry[] = [];
    const pageSize = 1000;

    for (const batch of batchPins(pins)) {
      const where = pinInClause(batch);
      for (let offset = 0; ; offset += pageSize) {
        const params = new URLSearchParams({
          $where: where,
          $limit: String(pageSize),
          $offset: String(offset),
        });
        const url = `${SCAVENGER_SALE_URL}?${params.toString()}`;
        const res = await fetch(url, {
          headers: socrataHeaders(),
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) break;
        const page: RawScavengerSaleEntry[] = await res.json();
        if (page.length === 0) break;
        all.push(...page);
        if (page.length < pageSize) break;
      }
    }

    return all;
  },

  normalize(raw: RawScavengerSaleEntry): ScavengerSaleRow | null {
    const pin = raw.pin ? toDigitsOnlyPin(raw.pin) : null;
    if (!pin) return null;

    const taxSaleYear = int(raw.tax_sale_year);
    const fromYear = int(raw.from_year);
    const toYear = int(raw.to_year);
    const entryId = `${pin}:${taxSaleYear ?? "na"}:${fromYear ?? "na"}:${toYear ?? "na"}`;

    return {
      entryId,
      pin,
      taxSaleYear,
      fromYear,
      toYear,
      totalAmountPaid: num(raw.total_amount_paid),
      soldAtSale: typeof raw.sold_at_sale === "boolean" ? raw.sold_at_sale : null,
      buyerName: raw.buyer_name?.trim() || null,
      lat: num(raw.location_1?.latitude),
      lon: num(raw.location_1?.longitude),
      provenance: { source: SOURCE_KEY, raw_json: raw },
    };
  },

  async upsert(sql: SQL, rows: ScavengerSaleRow[]): Promise<number> {
    let written = 0;
    for (const r of rows) {
      if (r.lat != null && r.lon != null) {
        await sql`
          INSERT INTO scavenger_sale_entries (
            entry_id, pin, tax_sale_year, from_year, to_year,
            total_amount_paid, sold_at_sale, buyer_name, lat, lon, geom,
            source, fetched_at, raw_json
          )
          VALUES (
            ${r.entryId}, ${r.pin}, ${r.taxSaleYear}, ${r.fromYear}, ${r.toYear},
            ${r.totalAmountPaid}, ${r.soldAtSale}, ${r.buyerName}, ${r.lat}, ${r.lon},
            ST_MakePoint(${r.lon}, ${r.lat})::geography,
            ${r.provenance.source}, NOW(), ${JSON.stringify(r.provenance.raw_json)}
          )
          ON CONFLICT (entry_id) DO UPDATE SET
            pin = EXCLUDED.pin,
            tax_sale_year = EXCLUDED.tax_sale_year,
            from_year = EXCLUDED.from_year,
            to_year = EXCLUDED.to_year,
            total_amount_paid = EXCLUDED.total_amount_paid,
            sold_at_sale = EXCLUDED.sold_at_sale,
            buyer_name = EXCLUDED.buyer_name,
            lat = EXCLUDED.lat,
            lon = EXCLUDED.lon,
            geom = EXCLUDED.geom,
            source = EXCLUDED.source,
            fetched_at = NOW(),
            raw_json = EXCLUDED.raw_json
        `;
      } else {
        await sql`
          INSERT INTO scavenger_sale_entries (
            entry_id, pin, tax_sale_year, from_year, to_year,
            total_amount_paid, sold_at_sale, buyer_name, lat, lon, geom,
            source, fetched_at, raw_json
          )
          VALUES (
            ${r.entryId}, ${r.pin}, ${r.taxSaleYear}, ${r.fromYear}, ${r.toYear},
            ${r.totalAmountPaid}, ${r.soldAtSale}, ${r.buyerName}, ${r.lat}, ${r.lon}, NULL,
            ${r.provenance.source}, NOW(), ${JSON.stringify(r.provenance.raw_json)}
          )
          ON CONFLICT (entry_id) DO UPDATE SET
            pin = EXCLUDED.pin,
            tax_sale_year = EXCLUDED.tax_sale_year,
            from_year = EXCLUDED.from_year,
            to_year = EXCLUDED.to_year,
            total_amount_paid = EXCLUDED.total_amount_paid,
            sold_at_sale = EXCLUDED.sold_at_sale,
            buyer_name = EXCLUDED.buyer_name,
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
