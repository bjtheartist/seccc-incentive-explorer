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

/**
 * Normalize a parcel PIN to Cook County's 14-digit `pin14` form.
 *
 * The PIN is ALWAYS treated as a STRING and is NEVER converted to a number —
 * leading zeros are significant and a 14-digit PIN exceeds the range that
 * survives numeric round-tripping. Only a `string` can normalize; every other
 * input type (a `number` included, on purpose) returns `null`.
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
