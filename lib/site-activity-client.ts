/**
 * SITE ACTIVITY — CLIENT RESOLUTION for one point.
 *
 * The single client-side path to `GET /api/site-activity?lat=&lon=` (the PUBLIC
 * route shipped with the report card), shared by the report card and by the
 * Vacant Sites map card's compact variant. Modeled on lib/vacancy-site-zones.ts:
 * a four-state union, a per-coordinate memo so re-clicking the same dot never
 * re-queries, and a promise that NEVER rejects.
 *
 * Honesty rails, and the reason parsing lives here rather than in a `as` cast:
 *   • A lookup that did not complete resolves to `{status:"error"}`, which every
 *     surface renders as "could not check" — never as an absence of activity.
 *   • A body that does not parse cleanly is an ERROR, not a set of empty
 *     measures. A truncated or malformed response must not be able to print
 *     "No 'L' station within 0.5 mi" over a neighborhood that has one, so a
 *     measure that is PRESENT BUT MALFORMED rejects the whole payload instead
 *     of degrading to null (which would read as a genuine absence).
 *   • Only successful lookups are memoized; a failure is retried on the next
 *     click.
 *
 * Client-safe: no node:fs, no map runtime, values imported only from
 * lib/site-activity.ts's pure half (types + the disclosed radii).
 */

import type {
  ArterialMeasure,
  CatchmentMeasure,
  LicenseMeasure,
  RailMeasure,
  SiteActivityContext,
  SiteActivitySources,
  SourceRef,
} from "./site-activity";

/** What a surface knows about this point's public measurements right now. */
export type SiteActivityState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; context: SiteActivityContext; sources: SiteActivitySources };

export interface SiteActivityPayload {
  context: SiteActivityContext;
  sources: SiteActivitySources;
}

// ── Payload validation ───────────────────────────────────────────────────────

class MalformedPayload extends Error {}

function fail(field: string): never {
  throw new MalformedPayload(field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(field);
  return value;
}

function str(value: unknown, field: string): string {
  if (typeof value !== "string") fail(field);
  return value;
}

function nullableNum(value: unknown, field: string): number | null {
  return value === null ? null : num(value, field);
}

/** `null` = the engine found nothing in radius (a real answer). Anything else
 *  that is not a well-formed object is malformed, and throws. */
function optionalRecord(value: unknown, field: string): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) fail(field);
  return value;
}

function parseArterial(raw: unknown): ArterialMeasure | null {
  const r = optionalRecord(raw, "arterial");
  if (!r) return null;
  return {
    roadName: str(r.roadName, "arterial.roadName"),
    aadt: num(r.aadt, "arterial.aadt"),
    aadtYear: str(r.aadtYear, "arterial.aadtYear"),
    stationId: str(r.stationId, "arterial.stationId"),
    distanceMi: num(r.distanceMi, "arterial.distanceMi"),
  };
}

function parseRail(raw: unknown): RailMeasure[] {
  if (!Array.isArray(raw)) fail("rail");
  return raw.map((item, i) => {
    if (!isRecord(item)) fail(`rail[${i}]`);
    const lines = item.lines;
    if (!Array.isArray(lines) || lines.some((l) => typeof l !== "string")) fail(`rail[${i}].lines`);
    return {
      name: str(item.name, `rail[${i}].name`),
      lines: lines as string[],
      avgWeekdayEntries: num(item.avgWeekdayEntries, `rail[${i}].avgWeekdayEntries`),
      month: str(item.month, `rail[${i}].month`),
      priorYearAvgWeekdayEntries: nullableNum(
        item.priorYearAvgWeekdayEntries,
        `rail[${i}].priorYearAvgWeekdayEntries`,
      ),
      distanceMi: num(item.distanceMi, `rail[${i}].distanceMi`),
    };
  });
}

function parseCatchment(raw: unknown): CatchmentMeasure | null {
  const r = optionalRecord(raw, "catchment");
  if (!r) return null;
  return {
    population: num(r.population, "catchment.population"),
    jobs: num(r.jobs, "catchment.jobs"),
    blockGroups: num(r.blockGroups, "catchment.blockGroups"),
    acsVintage: str(r.acsVintage, "catchment.acsVintage"),
    lodesVintage: str(r.lodesVintage, "catchment.lodesVintage"),
  };
}

function parseLicenses(raw: unknown): LicenseMeasure | null {
  const r = optionalRecord(raw, "licenses");
  if (!r) return null;
  const byCategory = r.byCategory;
  if (!Array.isArray(byCategory)) fail("licenses.byCategory");
  return {
    total: num(r.total, "licenses.total"),
    byCategory: byCategory.map((item, i) => {
      if (!isRecord(item)) fail(`licenses.byCategory[${i}]`);
      return {
        category: str(item.category, `licenses.byCategory[${i}].category`),
        count: num(item.count, `licenses.byCategory[${i}].count`),
      };
    }),
  };
}

function parseSource(raw: unknown, field: string): SourceRef {
  if (!isRecord(raw)) fail(field);
  return {
    label: str(raw.label, `${field}.label`),
    datasetId: str(raw.datasetId, `${field}.datasetId`),
    url: str(raw.url, `${field}.url`),
    vintage: str(raw.vintage, `${field}.vintage`),
    retrieved: str(raw.retrieved, `${field}.retrieved`),
  };
}

function parsePayload(raw: unknown): SiteActivityPayload {
  if (!isRecord(raw)) fail("payload");
  const context = raw.context;
  if (!isRecord(context)) fail("context");
  const radii = context.radii;
  if (!isRecord(radii)) fail("context.radii");
  const sources = raw.sources;
  if (!isRecord(sources)) fail("sources");

  return {
    context: {
      arterial: parseArterial(context.arterial),
      rail: parseRail(context.rail),
      catchment: parseCatchment(context.catchment),
      licenses: parseLicenses(context.licenses),
      // The disclosed radii are rendered verbatim in every absence sentence, so
      // a body without them cannot be shown at all.
      radii: {
        arterialMi: num(radii.arterialMi, "radii.arterialMi"),
        railMi: num(radii.railMi, "radii.railMi"),
        catchmentMi: num(radii.catchmentMi, "radii.catchmentMi"),
        licenseMi: num(radii.licenseMi, "radii.licenseMi"),
      },
    },
    sources: {
      aadt: parseSource(sources.aadt, "sources.aadt"),
      rail: parseSource(sources.rail, "sources.rail"),
      catchment: parseSource(sources.catchment, "sources.catchment"),
      licenses: parseSource(sources.licenses, "sources.licenses"),
    },
  };
}

/** The route's answer, or null when the body is not a payload this UI may
 *  render. Never throws. */
export function normalizeSiteActivityPayload(raw: unknown): SiteActivityPayload | null {
  try {
    return parsePayload(raw);
  } catch {
    return null;
  }
}

// ── Fetch + per-coordinate memo ──────────────────────────────────────────────

/** Round to ~11 m so the several PINs that share one street address — and the
 *  jitter between a dot's geometry and its click point — share one lookup. */
export function siteActivityCacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)}:${lon.toFixed(4)}`;
}

const inFlight = new Map<string, Promise<SiteActivityState>>();
const resolved = new Map<string, SiteActivityState>();

/** Test seam — drops the memo so a suite can assert the fetch path twice. */
export function resetSiteActivityCache(): void {
  inFlight.clear();
  resolved.clear();
}

/** Already-resolved measurements for a point, or null when it must be fetched. */
export function cachedSiteActivity(lat: number, lon: number): SiteActivityState | null {
  return resolved.get(siteActivityCacheKey(lat, lon)) ?? null;
}

/**
 * Resolve the public measurements around a point. Never rejects: a non-OK
 * response (including the route's 422 for coordinates outside the Chicago
 * coverage area and its 503 when a feed is unreadable), a network failure, an
 * abort, or an unparseable body all resolve to `{status:"error"}` — rendered as
 * "could not check", never as an absence of activity.
 */
export async function fetchSiteActivity(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<SiteActivityState> {
  const cacheKey = siteActivityCacheKey(lat, lon);
  const done = resolved.get(cacheKey);
  if (done) return done;
  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const request = (async (): Promise<SiteActivityState> => {
    try {
      const res = await fetch(
        `/api/site-activity?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`,
        { signal },
      );
      if (!res.ok) return { status: "error" };
      const payload = normalizeSiteActivityPayload(await res.json());
      if (!payload) return { status: "error" };
      const state: SiteActivityState = { status: "loaded", ...payload };
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
