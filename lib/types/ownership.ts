import type { Provenance } from "@/lib/ingest/types";

/** A recorded parcel sale (Cook County Assessor Parcel Sales, `wvhk-k5uv`). */
export interface ParcelSale {
  pin: string;
  saleDate: string;
  salePrice: number | null;
  deedType: string | null;
  seller: string | null;
  buyer: string | null;
  documentNumber: string;
  source: string;
}

/** A normalized sale row ready for `parcel_sales`, carrying provenance. */
export interface ParcelSaleRow extends ParcelSale {
  provenance: Provenance;
}

/** One prior-year assessed-value observation for `parcel_valuations`. */
export interface ParcelValuation {
  pin: string;
  taxYear: string;
  assessedLand: number | null;
  assessedBuilding: number | null;
  assessedTotal: number | null;
  source: string;
}

/** A normalized valuation row carrying provenance. */
export interface ParcelValuationRow extends ParcelValuation {
  provenance: Provenance;
}
