/**
 * review5 S9 — "/report?instant=true with missing/malformed/out-of-range/
 * partial coordinates → validate finite pairs before enabling instant
 * mode; fall back to address entry with an error; never hang on
 * 'Generating Location Snapshot'."
 *
 * Pulled out of app/report/page.tsx as a pure, independently-testable
 * function on purpose — that file's own "Known gaps" note documents that
 * its live-renderer test harness requires exact useState call-order
 * matching across a 5000+ line file, which is why this exact validation
 * previously shipped "verified by code inspection only." A pure function
 * needs no such harness.
 *
 * Why this matters operationally: app/report/page.tsx's instant-mode
 * report-generation effect waits on SEVERAL independent async effects
 * (parcel lookup, city zoning, local business support, site signals,
 * transport access, mobility access) all reaching a resolved state before
 * it will generate a report. Those effects are keyed off `wizardState.lat`/
 * `wizardState.lon`. If a bad coordinate pair (NaN from a malformed query
 * param, an out-of-range value like lat=200, or a partial pair with only
 * one of lat/lon present) were ever allowed into `wizardState`, any ONE of
 * those effects failing to reach a defined "resolved" state for that
 * bogus point would leave "Generating Location Snapshot" spinning
 * forever, with no error and no way out for the visitor. Coordinates are
 * now validated BEFORE instant mode is allowed to engage at all — a
 * failure here means the page falls back to the normal address-entry
 * wizard instead of ever entering that effect chain.
 */

const MIN_LAT = -90;
const MAX_LAT = 90;
const MIN_LON = -180;
const MAX_LON = 180;

/**
 * True only for a genuinely usable coordinate pair: both values present
 * (not null/undefined), both finite (rejects NaN — a malformed query
 * param like `lat=abc` parses to NaN — and rejects ±Infinity), and both
 * within the valid global geographic range. A partial pair (only one of
 * lat/lon supplied) is rejected by the `!= null` checks on both.
 */
export function isValidInstantCoordinatePair(
  lat: number | null | undefined,
  lon: number | null | undefined,
): boolean {
  if (lat == null || lon == null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < MIN_LAT || lat > MAX_LAT) return false;
  if (lon < MIN_LON || lon > MAX_LON) return false;
  return true;
}

/** Parses a URL query param into a coordinate value the same way
 *  app/report/page.tsx does (`parseFloat` of the raw string, or `null`
 *  when the param is absent/empty) — centralized so the parsing and the
 *  validation can never drift apart from what's actually tested here. */
export function parseInstantCoordinateParam(raw: string | null): number | null {
  if (!raw) return null;
  return parseFloat(raw);
}

export const INSTANT_MODE_COORDINATE_ERROR_MESSAGE =
  "This link's location could not be verified. Enter the address below to generate a report.";
