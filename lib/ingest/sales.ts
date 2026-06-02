import { getSQL } from "@/lib/db";
import { socrataHeaders } from "@/lib/socrata";
import type { ParcelSaleRow } from "@/lib/types/ownership";
import type { FetchOpts, SourceAdapter, SQL } from "./types";

/**
 * Cook County Assessor Parcel Sales adapter (`wvhk-k5uv`).
 *
 * The dataset carries no ZIP, so scope is derived from in-scope PINs already
 * landed in `parcels` (the parcels foundation backfills the 3 SE-Chicago ZIPs).
 * Sales are fetched in PIN batches and appended to `parcel_sales`.
 */

const SOURCE_KEY = "parcel_sales";

const SALES_URL = "https://datacatalog.cookcountyil.gov/resource/wvhk-k5uv.json";

/** Raw Socrata Parcel Sales record. */
export interface RawSale {
  pin?: string;
  year?: string;
  sale_date?: string;
  sale_price?: string;
  doc_no?: string;
  deed_type?: string;
  mydec_deed_type?: string;
  seller_name?: string;
  buyer_name?: string;
}

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * PINs already in scope from the parcels table. The parcels foundation only
 * backfills the 3 SE-Chicago ZIPs, so its PIN set is the scope; `zips` is kept
 * for contract symmetry.
 */
async function inScopePins(_zips: string[]): Promise<string[]> {
  const sql = getSQL();
  if (!sql) return [];
  const rows = (await sql`SELECT pin FROM parcels`) as { pin: string }[];
  return rows.map((r) => r.pin).filter(Boolean);
}

async function fetchSalesForPins(pins: string[]): Promise<RawSale[]> {
  const out: RawSale[] = [];
  const batchSize = 100;
  for (let i = 0; i < pins.length; i += batchSize) {
    const batch = pins.slice(i, i + batchSize);
    const inClause = batch.map((p) => `'${p}'`).join(",");
    const where = encodeURIComponent(`pin in(${inClause})`);
    const url = `${SALES_URL}?$where=${where}&$limit=5000&$order=sale_date`;
    try {
      const res = await fetch(url, {
        headers: socrataHeaders(),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const page: RawSale[] = await res.json();
        out.push(...page);
      }
    } catch {
      // best-effort per batch
    }
  }
  return out;
}

export const salesAdapter: SourceAdapter<RawSale, ParcelSaleRow> = {
  sourceKey: SOURCE_KEY,
  targetTable: "parcel_sales",

  async fetch({ zips }: FetchOpts): Promise<RawSale[]> {
    const pins = await inScopePins(zips);
    if (pins.length === 0) return [];
    return fetchSalesForPins(pins);
  },

  normalize(raw: RawSale): ParcelSaleRow | null {
    const pin = raw.pin?.trim();
    if (!pin) return null;

    const saleDate = raw.sale_date?.slice(0, 10);
    if (!saleDate) return null;

    const documentNumber = raw.doc_no?.trim();
    if (!documentNumber) return null;

    return {
      pin,
      saleDate,
      salePrice: num(raw.sale_price),
      deedType: raw.deed_type || raw.mydec_deed_type || null,
      seller: raw.seller_name || null,
      buyer: raw.buyer_name || null,
      documentNumber,
      source: SOURCE_KEY,
      provenance: { source: SOURCE_KEY, raw_json: raw },
    };
  },

  async upsert(sql: SQL, rows: ParcelSaleRow[]): Promise<number> {
    let written = 0;
    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const payload = JSON.stringify(
        batch.map((r) => ({
          pin: r.pin,
          sale_date: r.saleDate,
          sale_price: r.salePrice,
          deed_type: r.deedType,
          seller: r.seller,
          buyer: r.buyer,
          document_number: r.documentNumber,
          source: r.source,
        }))
      );

      await sql`
        WITH rows AS (
          SELECT *
          FROM jsonb_to_recordset(${payload}::jsonb) AS r(
            pin TEXT,
            sale_date DATE,
            sale_price BIGINT,
            deed_type TEXT,
            seller TEXT,
            buyer TEXT,
            document_number TEXT,
            source TEXT
          )
        )
        INSERT INTO parcel_sales (
          pin, sale_date, sale_price, deed_type, seller, buyer,
          document_number, source, fetched_at
        )
        SELECT
          pin, sale_date, sale_price, deed_type, seller, buyer,
          document_number, source, NOW()
        FROM rows
        ON CONFLICT (pin, sale_date, document_number) DO NOTHING
      `;
      written += batch.length;
    }
    return written;
  },
};
