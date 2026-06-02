import { socrataHeaders } from "@/lib/socrata";
import type { RawTransfer, TransferRow } from "@/lib/types/transfers";
import type { FetchOpts, SourceAdapter, SQL } from "./types";

/**
 * Illinois MyDec / PTAX-203 transfers adapter (`it54-y4c6`).
 *
 * The Transfers domain owns deed/instrument-level detail — instrument type,
 * recorded date, consideration, transaction flags — which the Ownership
 * domain's `parcel_sales` spine (`wvhk-k5uv`) does not capture. MyDec is the
 * primary source here; rows land in `property_transfers` keyed by the
 * declaration/document number.
 *
 * Scope: Cook County declarations whose `line_1_zip_code` (9-digit) begins with
 * one of the requested 5-digit ZIPs, filtered server-side via SoQL `like`.
 */

const SOURCE_KEY = "transfers";

const MYDEC_URL = "https://data.illinois.gov/resource/it54-y4c6.json";

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Strip an ISO timestamp to a YYYY-MM-DD date, or null. */
function toDate(v: string | undefined): string | null {
  if (!v) return null;
  const d = v.slice(0, 10);
  return d.length === 10 ? d : null;
}

export const transfersAdapter: SourceAdapter<RawTransfer, TransferRow> = {
  sourceKey: SOURCE_KEY,
  targetTable: "property_transfers",

  async fetch({ zips }: FetchOpts): Promise<RawTransfer[]> {
    const all: RawTransfer[] = [];
    const pageSize = 1000;

    for (const zip of zips) {
      for (let offset = 0; ; offset += pageSize) {
        const where = `line_1_county='Cook' AND line_1_zip_code like '${zip}%'`;
        const params = new URLSearchParams({
          $where: where,
          $limit: String(pageSize),
          $offset: String(offset),
          $order: "date_recorded",
        });
        const url = `${MYDEC_URL}?${params.toString()}`;
        try {
          const res = await fetch(url, {
            headers: socrataHeaders(),
            signal: AbortSignal.timeout(30000),
          });
          if (!res.ok) break;
          const page: RawTransfer[] = await res.json();
          if (page.length === 0) break;
          all.push(...page);
          if (page.length < pageSize) break;
        } catch {
          // best-effort per ZIP page
          break;
        }
      }
    }

    return all;
  },

  normalize(raw: RawTransfer): TransferRow | null {
    const transferId =
      raw.document_number?.trim() || raw.declaration_id?.trim();
    if (!transferId) return null;

    // Normalize the dashed MyDec PIN to the codebase's 14-digit convention.
    const pinDigits = raw.line_1_primary_pin?.replace(/\D/g, "");
    const pin = pinDigits ? pinDigits : null;

    const numParcels = num(raw.line_2_total_parcels);
    const isMultisale = numParcels != null ? numParcels > 1 : false;

    const fullAddress =
      raw.full_address?.trim() ||
      [raw.line_1_street, raw.line_1_city].filter(Boolean).join(", ") ||
      null;

    return {
      transferId,
      pin,
      recordedDate: toDate(raw.date_recorded),
      instrumentDate: toDate(raw.line_4_instrument_date),
      instrumentType: raw.line_5_instrument_type || null,
      docNumber: raw.document_number?.trim() || null,
      considerationAmount: num(raw.line_11_full_consideration),
      netConsideration: num(raw.line_13_net_consideration),
      seller: raw.step_4_seller_name || null,
      buyer: raw.step_4_buyer_name || null,
      county: raw.line_1_county || null,
      fullAddress,
      isMultisale,
      numParcels: numParcels != null ? Math.trunc(numParcels) : null,
      source: SOURCE_KEY,
      provenance: { source: SOURCE_KEY, raw_json: raw },
    };
  },

  async upsert(sql: SQL, rows: TransferRow[]): Promise<number> {
    let written = 0;
    const batchSize = 50;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      for (const r of batch) {
        await sql`
          INSERT INTO property_transfers (
            transfer_id, pin, recorded_date, instrument_date, instrument_type,
            doc_number, consideration_amount, net_consideration,
            seller_name, buyer_name, county, full_address,
            is_multisale, num_parcels, source, fetched_at, raw_json
          )
          VALUES (
            ${r.transferId}, ${r.pin}, ${r.recordedDate}, ${r.instrumentDate}, ${r.instrumentType},
            ${r.docNumber}, ${r.considerationAmount}, ${r.netConsideration},
            ${r.seller}, ${r.buyer}, ${r.county}, ${r.fullAddress},
            ${r.isMultisale}, ${r.numParcels}, ${r.source}, NOW(), ${JSON.stringify(r.provenance.raw_json)}
          )
          ON CONFLICT (transfer_id) DO UPDATE SET
            pin = EXCLUDED.pin,
            recorded_date = EXCLUDED.recorded_date,
            instrument_date = EXCLUDED.instrument_date,
            instrument_type = EXCLUDED.instrument_type,
            doc_number = EXCLUDED.doc_number,
            consideration_amount = EXCLUDED.consideration_amount,
            net_consideration = EXCLUDED.net_consideration,
            seller_name = EXCLUDED.seller_name,
            buyer_name = EXCLUDED.buyer_name,
            county = EXCLUDED.county,
            full_address = EXCLUDED.full_address,
            is_multisale = EXCLUDED.is_multisale,
            num_parcels = EXCLUDED.num_parcels,
            source = EXCLUDED.source,
            fetched_at = NOW(),
            raw_json = EXCLUDED.raw_json
        `;
        written++;
      }
    }
    return written;
  },
};
