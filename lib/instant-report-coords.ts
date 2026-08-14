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
 *  app/report/page.tsx does, or `null` when the param is absent/empty —
 *  centralized so the parsing and the validation can never drift apart
 *  from what's actually tested here.
 *
 *  review6 S13 (HIGH): was `parseFloat(raw)`. `parseFloat` only requires
 *  a valid numeric PREFIX — it silently ignores everything after the
 *  number it manages to parse (`parseFloat("41.75garbage") === 41.75`),
 *  so a query string carrying trailing garbage after an
 *  otherwise-valid-looking number parsed as if it were clean input.
 *  `Number()` requires the ENTIRE (trimmed) string to be a valid numeric
 *  literal — any leading OR trailing non-numeric content produces `NaN`,
 *  which `isValidInstantCoordinatePair`'s `Number.isFinite` check then
 *  correctly rejects, same as a fully-malformed string always was. */
export function parseInstantCoordinateParam(raw: string | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return Number(trimmed);
}

export const INSTANT_MODE_COORDINATE_ERROR_MESSAGE =
  "This link's location could not be verified. Enter the address below to generate a report.";

/**
 * review6 S13 (HIGH): app/report/page.tsx's `wizardState` initializer had
 * TWO near-identical branches — one for `isInstantMode`, one for
 * `isRefineEntry` — that each independently wrote
 * `if (<mode> && instantLat && instantLon)` before seeding
 * `{ reportType: "site-incentives", address, lat, lon }`. `&&` on two
 * `number`s is a TRUTHY check: `0 && 0` is falsy, so a fully validated,
 * in-range `(0, 0)` pair (which `isValidInstantCoordinatePair` correctly
 * accepts — see its own doc comment) silently failed to seed
 * `wizardState.lat`/`.lon` even though the mode it belongs to (instant or
 * refine) had already engaged. That's the exact "internal inconsistency"
 * this finding names: the boolean gate (`isInstantMode`/`isRefineEntry`)
 * says "this coordinate is good," but the seeding step it gates
 * disagreed, for one specific input.
 *
 * Extracted here — not duplicated in each branch — so the two call sites
 * in page.tsx can never re-diverge on how they null-check, and so this
 * exact resolution is independently testable without needing either
 * mode's full branch tree or a rendered page. Returns `null` only when
 * either coordinate is genuinely absent (`!= null`, never `&&`); a valid
 * `(0, 0)` resolves to a real seed like any other in-range pair.
 */
export function resolveInstantWizardCoordinateSeed(
  address: string,
  lat: number | null,
  lon: number | null,
): { reportType: "site-incentives"; address: string; lat: number; lon: number } | null {
  if (lat == null || lon == null) return null;
  return { reportType: "site-incentives", address, lat, lon };
}
