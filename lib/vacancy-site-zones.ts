/**
 * PLACE-BASED INCENTIVE GEOGRAPHIES FOR ONE SITE — the same point-in-zone
 * resolution the ADDRESS REPORT runs, made available to the public Property
 * Map's site card.
 *
 * Why this exists: the vacancy export stamps an `incentiveCount` onto tracked
 * sites, but the reconciled VACANT LAND series carries none (every land dot
 * ships `incentiveCount: 0`). The card read that literal zero as evidence and
 * printed "Not inside a mapped incentive geography" — which is factually wrong
 * for, e.g., 4048 W MADISON ST in West Garfield Park, a point that sits inside
 * the Madison/Austin Corridor TIF, SSA #77, Chicago Enterprise Zone V, a
 * federal Opportunity Zone, an NMTC-eligible tract, a HUD Qualified Census
 * Tract, an IRA Energy Community, and an SBA HUBZone.
 *
 * Resolution path: `GET /api/zones/check?lat=&lon=` — the SAME endpoint
 * app/report/page.tsx calls, backed by lib/zones-check.ts (PostGIS when the DB
 * is reachable, malformed-geometry-safe static point-in-polygon otherwise) and
 * cached for a week at the edge. Deliberately NOT a client-side load of
 * public/data/zones/*.geojson: those total ~20 MB (tif-districts alone is
 * 3.2 MB, nmtc-eligible 7.4 MB) and would be a catastrophic payload on a map
 * page. Deliberately NOT an export-time stamp either — regenerating
 * vacancy-index.json needs Neon, which is out of reach here.
 *
 * Honesty rails:
 *   • "Not inside a mapped incentive geography" is only ever claimed from a
 *     lookup that SUCCEEDED and returned nothing (`status: "loaded"` with an
 *     empty list). A failed or unattempted lookup says so instead.
 *   • Zones are reported as MAPPED GEOGRAPHIES, never as eligibility or an
 *     award. The card links out to the full address report for the program
 *     layer, exactly as the report's own zone pills do.
 *
 * Client-safe: no `node:fs`, no map runtime. lib/constants.ts is value-imported
 * (MapView, a client component, already does the same).
 */

import { CHECKABLE_ZONE_KEYS, ZONE_LABELS, ZONE_META } from "./constants";

/** One place-based geography containing the site, ready to render. */
export interface SiteZoneMatch {
  /** Canonical zone key (ZONE_LABELS / ZONE_META). */
  key: string;
  /** Human layer label, e.g. "TIF District" — the report's own wording. */
  label: string;
  /** The specific feature name, e.g. "Madison/Austin Corridor TIF (T-75)".
   *  Empty string when the source feature carries no usable name. */
  name: string;
}

/** The card's knowledge of this site's zone coverage at render time. */
export type SiteZoneState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; matches: SiteZoneMatch[] };

const CHECKABLE = new Set<string>(CHECKABLE_ZONE_KEYS);

/** Display order = the map/legend order in ZONE_META (TIF, SSA, Enterprise,
 *  Opportunity Zone, state incentive zones, NOF, … ), unknown keys last. */
function sortOrder(key: string): number {
  return ZONE_META[key]?.sortOrder ?? 999;
}

/**
 * Normalize whatever `/api/zones/check` returned into a deduped, ordered list.
 * The route answers with `[{key, name}]`; anything else (an error object, a
 * truncated body, a hand-edited response) yields an empty list rather than a
 * throw. Unknown / point-data keys are dropped — only the checkable polygon
 * layers describe a geography that CONTAINS the point.
 */
export function normalizeSiteZoneMatches(raw: unknown): SiteZoneMatch[] {
  if (!Array.isArray(raw)) return [];

  const byKey = new Map<string, SiteZoneMatch>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const key = (item as { key?: unknown }).key;
    if (typeof key !== "string" || !CHECKABLE.has(key)) continue;
    const rawName = (item as { name?: unknown }).name;
    const name = typeof rawName === "string" ? rawName.trim() : "";
    const existing = byKey.get(key);
    // First win, but a later entry that actually carries a name upgrades it.
    if (existing && (existing.name || !name)) continue;
    byKey.set(key, { key, label: ZONE_LABELS[key] ?? key, name });
  }

  return Array.from(byKey.values()).sort(
    (a, b) => sortOrder(a.key) - sortOrder(b.key) || a.key.localeCompare(b.key),
  );
}

/** "Inside 8 mapped incentive geographies." / "Inside 1 mapped incentive
 *  geography." / the honest empty statement. Never claims eligibility. */
export function siteZonesSummary(matches: readonly SiteZoneMatch[]): string {
  if (matches.length === 0) return "Not inside a mapped incentive geography.";
  return `Inside ${matches.length} mapped incentive ${
    matches.length === 1 ? "geography" : "geographies"
  }:`;
}

/** One rendered line: "TIF District — Madison/Austin Corridor TIF (T-75)", or
 *  just the layer label when the source feature is unnamed. */
export function siteZoneLine(match: SiteZoneMatch): string {
  return match.name ? `${match.label} — ${match.name}` : match.label;
}

/**
 * The canonical instant-report deep link (identical shape to the one
 * ReportDisplay and MapPolygonPanel build) so the card hands a reader straight
 * to the full program layer for this exact point.
 */
export function siteReportHref(
  lat: number,
  lon: number,
  address: string | null,
): string {
  return `/report?instant=true&lat=${lat.toFixed(5)}&lon=${lon.toFixed(
    5,
  )}&addr=${encodeURIComponent(address ?? "")}`;
}

// ── Fetch + per-coordinate memo ──────────────────────────────────────────────

/** Round to ~11 m, matching the server cache's own coordinate rounding, so the
 *  three PINs that share one street address share one lookup. */
export function siteZoneCacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)}:${lon.toFixed(4)}`;
}

const inFlight = new Map<string, Promise<SiteZoneState>>();
const resolved = new Map<string, SiteZoneState>();

/** Test seam — drops the memo so a suite can assert the fetch path twice. */
export function resetSiteZoneCache(): void {
  inFlight.clear();
  resolved.clear();
}

/** Already-resolved coverage for a point, or null when it must be fetched. */
export function cachedSiteZones(lat: number, lon: number): SiteZoneState | null {
  return resolved.get(siteZoneCacheKey(lat, lon)) ?? null;
}

/**
 * Resolve the geographies containing a point. Never throws and never rejects:
 * a non-OK response, a network failure, or an abort all resolve to
 * `{status:"error"}`, which the card renders as "could not check" rather than
 * as an absence of coverage. Successful lookups (including genuinely-empty
 * ones) are memoized for the life of the page; errors are not, so a later
 * click retries.
 */
export async function fetchSiteZones(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<SiteZoneState> {
  const cacheKey = siteZoneCacheKey(lat, lon);
  const done = resolved.get(cacheKey);
  if (done) return done;
  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const request = (async (): Promise<SiteZoneState> => {
    try {
      const res = await fetch(
        `/api/zones/check?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`,
        { signal },
      );
      if (!res.ok) return { status: "error" };
      const state: SiteZoneState = {
        status: "loaded",
        matches: normalizeSiteZoneMatches(await res.json()),
      };
      resolved.set(cacheKey, state);
      return state;
    } catch {
      return { status: "error" };
    } finally {
      inFlight.delete(cacheKey);
    }
  })();

  inFlight.set(cacheKey, request);
  return request;
}
