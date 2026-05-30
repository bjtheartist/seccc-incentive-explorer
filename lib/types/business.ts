/**
 * Domain types for the "Business activity" data domain.
 *
 * Mirrors the City of Chicago Business Licenses dataset (`r5kz-chrr`) as
 * persisted in the `business_licenses` table, plus derived activity metrics
 * (tenure, openings, closures). Kept separate from `lib/types.ts`.
 */

/** A persisted business-license row (one per license period). */
export interface BusinessLicense {
  /** Socrata `id`: license_number + start date. Stable per-row PK. */
  licenseId: string;
  accountNumber: string | null;
  legalName: string | null;
  dbaName: string | null;
  address: string | null;
  zip: string | null;
  licenseCode: string | null;
  licenseDescription: string | null;
  applicationType: string | null;
  /** Raw upstream status: AAI (active), AAC (cancelled), REV (revoked), ... */
  licenseStatus: string | null;
  licenseStartDate: string | null;
  expirationDate: string | null;
  dateIssued: string | null;
  lat: number | null;
  lon: number | null;
}

/** Per-address tenure summary derived from license history. */
export interface AddressTenure {
  address: string;
  /** Earliest license_start_date observed at the address (ISO date). */
  earliestStart: string;
  /** Most recent expiration_date observed at the address (ISO date). */
  latestExpiration: string | null;
  /** Distinct licenses seen at the address. */
  licenseCount: number;
  /** Years between earliest start and now (rounded down). */
  tenureYears: number;
}

/** A license activity event (opening or closure). */
export interface ActivityEvent {
  kind: "opening" | "closure";
  licenseId: string;
  address: string | null;
  dbaName: string | null;
  /** Start date for openings; expiration date for closures. */
  date: string | null;
}
