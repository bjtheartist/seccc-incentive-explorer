/**
 * Property-Condition domain types.
 *
 * Shapes for the three condition sources persisted by the ingest adapters
 * (`lib/ingest/permits.ts`, `violations.ts`, `service-requests.ts`) and read
 * back from Postgres. Kept separate from `lib/types.ts` (do not edit that).
 */

/** A row from `building_permits` (Chicago Building Permits, `ydr8-5enu`). */
export interface BuildingPermit {
  permitId: string;
  pin: string | null;
  address: string | null;
  zip: string | null;
  permitType: string | null;
  workDescription: string | null;
  issueDate: string | null;
  reportedCost: number | null;
  isDemolition: boolean;
  lat: number;
  lon: number;
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
