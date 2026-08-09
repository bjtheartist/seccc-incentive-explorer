/**
 * Property-Condition domain types.
 *
 * Shapes for the three condition sources persisted by the ingest adapters
 * (`lib/ingest/permits.ts`, `violations.ts`, `service-requests.ts`) and read
 * back from Postgres. Kept separate from `lib/types.ts` (do not edit that).
 */

/**
 * A row from `building_permits` (Chicago Building Permits, `ydr8-5enu`).
 *
 * `lat`/`lon` are NULLABLE: the citywide ingest keeps a permit that carries a
 * PIN or a street address even when the city published no coordinates for it,
 * because those rows are exactly the ones the PIN and address match tiers can
 * still place. `zip` is always null — the dataset has no ZIP column (see
 * lib/ingest/permits.ts).
 *
 * `reportedCost` is the APPLICANT'S OWN ESTIMATE from the application form. It
 * is not an award, a commitment, or a spend, and it must never be summed into a
 * capital or investment total.
 */
export interface BuildingPermit {
  permitId: string;
  /** First entry of {@link pins}. */
  pin: string | null;
  /** Every PIN on the permit, digits-only. These are 10-digit PINs; `parcels`
   *  and the COLS inventory carry the 14-digit form. */
  pins: string[];
  address: string | null;
  zip: string | null;
  permitType: string | null;
  permitStatus: string | null;
  permitMilestone: string | null;
  workType: string | null;
  permitCondition: string | null;
  workDescription: string | null;
  issueDate: string | null;
  reportedCost: number | null;
  isDemolition: boolean;
  lat: number | null;
  lon: number | null;
}

/** A row from `building_violations` (Chicago Building Violations, `22u3-xenr`). */
export interface BuildingViolation {
  violationId: string;
  address: string | null;
  zip: string | null;
  violationCode: string | null;
  violationDescription: string | null;
  violationStatus: string | null;
  violationDate: string | null;
  lat: number;
  lon: number;
}

/** A row from `service_requests_311` (Chicago 311 Service Requests, `v6vf-nfxy`). */
export interface ServiceRequest311 {
  srNumber: string;
  srType: string | null;
  status: string | null;
  createdDate: string | null;
  address: string | null;
  zip: string | null;
  lat: number;
  lon: number;
}
