/**
 * CookViewer deep-links — Cook County's official parcel viewer
 * (https://maps.cookcountyil.gov/cookviewer/) is the Explorer's canonical
 * ownership-verification destination. Linking out to it means shareable
 * surfaces never have to import or maintain owner names, staying consistent
 * with the existing records-indicate / anonymized-owner-type doctrine.
 *
 * Client-safe and dependency-free — importable from server components, client
 * components, and the pure jsPDF builders alike.
 *
 * Verified live in a real browser:
 *   ?pin14=20363230080000 -> "PIN: 20-36-323-008-0000, 8525 S EUCLID AVE"
 *   ?pin14=21322110390000 -> "PIN: 21-32-211-039-0000, 8558 S GREEN BAY AVE"
 */

const COOK_VIEWER_BASE = "https://maps.cookcountyil.gov/cookviewer/";

/** Current CookViewer parcel polygon and characteristics service. */
export const COOK_COUNTY_CURRENT_PARCELS_QUERY_URL =
  "https://gis.cookcountyil.gov/traditional/rest/services/parcel_current_beta/FeatureServer/0/query";

/**
 * Normalize a parcel PIN to Cook County's 14-digit `pin14` form.
 *
 * The PIN is ALWAYS treated as a STRING and is NEVER converted to a number —
 * leading zeros are significant (a number literal drops them) and a PIN is an
 * identifier, not a quantity, so it should never be subject to numeric
 * coercion or arithmetic. Only a `string` can normalize; every other input
 * type (a `number` included, on purpose) returns `null`.
 *
 * Accepts a dashed PIN ("21-32-211-039-0000") or a digits-only PIN; strips
 * dashes and surrounding/interior whitespace, then returns the 14-digit string
 * iff exactly 14 digits remain, otherwise `null`.
 */
export function normalizePin14(pin: unknown): string | null {
  if (typeof pin !== "string") return null;
  const digits = pin.replace(/[\s-]/g, "");
  return /^\d{14}$/.test(digits) ? digits : null;
}

/** Human-readable Cook County PIN that preserves all leading zeroes. */
export function formatPin14(pin: unknown): string | null {
  const pin14 = normalizePin14(pin);
  if (pin14 === null) return null;
  return `${pin14.slice(0, 2)}-${pin14.slice(2, 4)}-${pin14.slice(4, 7)}-${pin14.slice(7, 10)}-${pin14.slice(10)}`;
}

/**
 * Build the CookViewer deep-link for a parcel PIN, or `null` when the PIN is
 * not a valid 14-digit string (see {@link normalizePin14}). Null-safe: pass a
 * parcel's own `pin` straight through. The URL is ALWAYS built from a PIN,
 * never from an address, and never coerces a number.
 */
export function cookViewerUrl(pin: unknown): string | null {
  const pin14 = normalizePin14(pin);
  if (pin14 === null) return null;
  return `${COOK_VIEWER_BASE}?pin14=${encodeURIComponent(pin14)}`;
}

const ASSESSOR_RECORD_BASE = "https://www.cookcountyassessoril.gov/pin";

/**
 * Build the Cook County Assessor property-record deep-link for a parcel PIN,
 * or `null` when the PIN is not a valid 14-digit string. Keeping this beside
 * the CookViewer and Clerk helpers gives every Matchmaker surface one shared
 * three-link parcel-record contract.
 */
export function assessorRecordUrl(pin: unknown): string | null {
  const pin14 = normalizePin14(pin);
  if (pin14 === null) return null;
  return `${ASSESSOR_RECORD_BASE}/${encodeURIComponent(pin14)}`;
}

const CLERK_RECORDS_BASE = "https://crs.cookcountyclerkil.gov/Search/ResultByPin";

/**
 * Build the Cook County Clerk recordings-search deep-link for a parcel PIN —
 * the parcel's recorded-documents list (deeds, grantors, grantees, liens,
 * releases) — or `null` when the PIN is not a valid 14-digit string (see
 * {@link normalizePin14}). Same rules as {@link cookViewerUrl}: string-only,
 * NEVER a number, always built from a PIN and never from an address.
 *
 * Verified live in a real browser:
 *   ?id1=21322110390000 -> PIN + address + recorded-document table.
 *
 * Governance: the Explorer only LINKS to the Clerk's search — it never scrapes
 * or auto-displays owners, and never implies it performed a title search. Any
 * future copy referencing what the Clerk shows must say "latest recorded
 * grantee", never a title determination.
 */
export function clerkRecordsUrl(pin: unknown): string | null {
  const pin14 = normalizePin14(pin);
  if (pin14 === null) return null;
  return `${CLERK_RECORDS_BASE}?id1=${encodeURIComponent(pin14)}`;
}
