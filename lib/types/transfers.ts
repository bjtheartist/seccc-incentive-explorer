import type { Provenance } from "@/lib/ingest/types";

/**
 * Raw Illinois MyDec / PTAX-203 declaration record (`it54-y4c6`).
 *
 * Per-declaration deed/instrument detail. Only the fields the Transfers domain
 * consumes are typed; the upstream record carries many more PTAX-203 line items
 * which are preserved verbatim in `raw_json`.
 */
export interface RawTransfer {
  declaration_id?: string;
  document_number?: string;
  date_recorded?: string;
  line_4_instrument_date?: string;
  line_5_instrument_type?: string;
  line_11_full_consideration?: string;
  line_13_net_consideration?: string;
  line_1_primary_pin?: string;
  line_1_county?: string;
  line_1_zip_code?: string;
  line_2_total_parcels?: string;
  line_3_additional_pins?: boolean;
  full_address?: string;
  line_1_street?: string;
  line_1_city?: string;
  step_4_seller_name?: string;
  step_4_buyer_name?: string;
}

/**
 * A recorded property transfer (Illinois MyDec / PTAX-203, `it54-y4c6`).
 *
 * Keyed by `transferId` (the declaration/document number). Deed/instrument
 * detail that the Ownership `parcel_sales` spine does not capture.
 */
export interface PropertyTransfer {
  transferId: string;
  pin: string | null;
  recordedDate: string | null;
  instrumentDate: string | null;
  instrumentType: string | null;
  docNumber: string | null;
  considerationAmount: number | null;
  netConsideration: number | null;
  seller: string | null;
  buyer: string | null;
  county: string | null;
  fullAddress: string | null;
  isMultisale: boolean;
  numParcels: number | null;
  source: string;
}

/** A normalized transfer row ready for `property_transfers`, with provenance. */
export interface TransferRow extends PropertyTransfer {
  provenance: Provenance;
}
