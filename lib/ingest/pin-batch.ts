/**
 * Helpers for PIN-keyed source adapters (Cook County Treasurer scavenger/
 * annual tax-sale datasets — see scavenger-sale.ts / annual-tax-sale.ts).
 *
 * Those datasets carry no ZIP or address column, so adapters can't scope a
 * fetch server-side by ZIP the way lib/ingest/violations.ts scopes by bbox.
 * Instead scripts/sync-distress-overlay.ts reads DISTINCT pins from the
 * already-ingested `parcels` table for the SYNC_ZIPS footprint and this
 * module batches that list into Socrata-safe `pin in(...)` filters.
 */

/** Default batch size for a Socrata `$where=pin in(...)` filter. */
export const DEFAULT_PIN_BATCH_SIZE = 400;

/**
 * Split `pins` into chunks of at most `batchSize`, trimming and dropping
 * blank entries first. Preserves input order.
 */
export function batchPins(pins: string[], batchSize: number = DEFAULT_PIN_BATCH_SIZE): string[][] {
  const clean = pins.map((p) => p.trim()).filter((p) => p.length > 0);
  if (batchSize <= 0) return clean.length > 0 ? [clean] : [];
  const batches: string[][] = [];
  for (let i = 0; i < clean.length; i += batchSize) {
    batches.push(clean.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Build a Socrata SoQL `pin in(...)` fragment for one batch: single-quotes
 * each PIN and escapes embedded single quotes per SoQL string-literal rules
 * (`'` -> `''`). The caller passes the whole `$where` value through
 * `URLSearchParams`, which handles the URL-encoding.
 */
export function pinInClause(pins: string[]): string {
  const quoted = pins.map((p) => `'${p.replace(/'/g, "''")}'`).join(",");
  return `pin in(${quoted})`;
}

/**
 * Convert a Cook County 14-digit PIN (digits-only — the `parcels.pin`
 * convention, e.g. "17213210180000") to the dashed 2-2-3-3-4 format the
 * Treasurer tax-sale datasets store (e.g. "17-21-321-018-0000").
 *
 * Verified live: querying ydgz-vkrp/55ju-2fs9 with a digits-only PIN via
 * `$where=pin in(...)` returns zero rows; the dashed form matches. Input
 * that isn't exactly 14 digits passes through unchanged (defensive — a query
 * that matches nothing beats one that throws on a malformed PIN).
 */
export function toDashedPin(pin: string): string {
  const digits = pin.replace(/\D/g, "");
  if (digits.length !== 14) return pin;
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 7)}-${digits.slice(7, 10)}-${digits.slice(10, 14)}`;
}

/**
 * Convert a dashed Treasurer-format PIN back to the digits-only
 * `parcels.pin` convention for storage, so the export-time join in
 * lib/corridor-owners.ts can match on PIN directly. Non-digit characters
 * (dashes) are simply stripped; already-clean input passes through.
 */
export function toDigitsOnlyPin(pin: string): string {
  return pin.replace(/\D/g, "");
}
