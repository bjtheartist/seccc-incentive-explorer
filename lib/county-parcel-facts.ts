/**
 * Normalizers for the four Cook County parcel facts the shortlist reads —
 * class, lot area, assessor building area, and building tax year.
 *
 * PURE, no fs, no network: the SAME functions run in
 * app/api/shortlist/enrich/route.ts (the live, per-PIN ArcGIS read) and in
 * lib/shortlist-parcel-identity-resolver.ts (the offline precompute that now
 * answers most of those reads). That shared use is the whole point: a fact
 * served from the snapshot and the same fact fetched live must be
 * byte-identical, or the two paths quietly disagree — one card saying
 * "2024", another "2024.0", for the same parcel.
 */

import { normalizePublishedArea } from "./published-area";

/** A published County class code. Non-strings and blanks are unknown
 *  (`null`), never a class — a numeric-looking class is still text
 *  ("100", "EX"), and a whitespace cell is not a published value. */
export function normalizeCountyClass(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** A published area in square feet. Delegates to the repo's single
 *  area rule (lib/published-area.ts): sentinel zeroes, negatives, NaN,
 *  infinities, blanks, and malformed strings are all unknown, never a real
 *  measurement. */
export function normalizeCountyArea(value: unknown): number | null {
  return normalizePublishedArea(value);
}

/**
 * A building tax year as a clean four-digit string.
 *
 * Cook County serializes the year inconsistently — `2024`, `"2024"`, and
 * `"2024.0"` all appear for the same field. The repo already had to fix a
 * "2026.0" leaking into the UI once (see `assessedYearLabel` in
 * lib/site-shortlist.ts); this normalizes at the SOURCE instead, so no
 * consumer has to. Anything that is not a plausible year is `null` rather
 * than passed through as unusable text.
 */
export function normalizeCountyTaxYear(value: unknown): string | null {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    text = String(value);
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    return null;
  }
  if (text === "") return null;
  const wholeYear = /^(\d{4})(?:\.0+)?$/.exec(text);
  return wholeYear?.[1] ?? null;
}
