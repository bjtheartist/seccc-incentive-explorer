import { getSQL } from "@/lib/db";
import { socrataHeaders } from "@/lib/socrata";
import type { ParcelValuationRow } from "@/lib/types/ownership";
import type { FetchOpts, SourceAdapter, SQL } from "./types";

/**
 * Assessed-value history adapter — Cook County Assessor "Assessed Values"
 * (`uzyt-m557`, years 1999–present). Backfills MULTIPLE prior years into the
 * existing `parcel_valuations` table (the parcels foundation only lands the
 * current year). Append-only: ON CONFLICT (pin, tax_year) DO NOTHING.
 *
 * The dataset carries no ZIP, so scope is the PIN set already in `parcels`.
 */

const SOURCE_KEY = "valuation_history";

const ASSESSED_VALUES_URL =
  "https://datacatalog.cookcountyil.gov/resource/uzyt-m557.json";

/** Raw Socrata Assessed Values record. */
export interface RawValuation {
  pin?: string;
  year?: string;
  certified_land?: string;
  certified_bldg?: string;
  certified_tot?: string;
}

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** PINs already in scope from the parcels table (the 3 SE-Chicago ZIPs). */
async function inScopePins(_zips: string[]): Promise<string[]> {
  const sql = getSQL();
  if (!sql) return [];
  const rows = (await sql`SELECT pin FROM parcels`) as { pin: string }[];
  return rows.map((r) => r.pin).filter(Boolean);
}

async function fetchValuationsForPins(
  pins: string[]
): Promise<RawValuation[]> {
  const out: RawValuation[] = [];
  const batchSize = 50;
  const select = "pin,year,certified_land,certified_bldg,certified_tot";
  for (let i = 0; i < pins.length; i += batchSize) {
    const batch = pins.slice(i, i + batchSize);
    const inClause = batch.map((p) => `'${p}'`).join(",");
    const where = encodeURIComponent(`pin in(${inClause})`);
    const url = `${ASSESSED_VALUES_URL}?$where=${where}&$select=${select}&$limit=50000&$order=year`;
    try {
      const res = await fetch(url, {
        headers: socrataHeaders(),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const page: RawValuation[] = await res.json();
        out.push(...page);
      }
    } catch {
      // best-effort per batch
    }
    if (i + batchSize < pins.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return out;
}

export const valuationHistoryAdapter: SourceAdapter<
  RawValuation,
  ParcelValuationRow
> = {
  sourceKey: SOURCE_KEY,
  targetTable: "parcel_valuations",

  async fetch({ zips }: FetchOpts): Promise<RawValuation[]> {
    const pins = await inScopePins(zips);
    if (pins.length === 0) return [];
    return fetchValuationsForPins(pins);
  },

  normalize(raw: RawValuation): ParcelValuationRow | null {
    const pin = raw.pin?.trim();
    if (!pin) return null;

    const taxYear = raw.year?.trim();
    if (!taxYear) return null;

    const assessedLand = num(raw.certified_land);
    const assessedBuilding = num(raw.certified_bldg);
    const assessedTotal =
      num(raw.certified_tot) ??
      (assessedLand != null && assessedBuilding != null
        ? assessedLand + assessedBuilding
        : null);

    if (assessedLand == null && assessedBuilding == null && assessedTotal == null) {
      return null;
    }

    return {
      pin,
      taxYear,
      assessedLand,
      assessedBuilding,
      assessedTotal,
      source: SOURCE_KEY,
      provenance: { source: SOURCE_KEY, raw_json: raw },
    };
  },

  async upsert(sql: SQL, rows: ParcelValuationRow[]): Promise<number> {
    let written = 0;
    const batchSize = 50;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      for (const r of batch) {
        await sql`
          INSERT INTO parcel_valuations (
            pin, tax_year, assessed_land, assessed_building, assessed_total,
            source, fetched_at
          )
          VALUES (
            ${r.pin}, ${r.taxYear}, ${r.assessedLand}, ${r.assessedBuilding},
            ${r.assessedTotal}, ${r.source}, NOW()
          )
          ON CONFLICT (pin, tax_year) DO NOTHING
        `;
        written++;
      }
    }
    return written;
  },
};
