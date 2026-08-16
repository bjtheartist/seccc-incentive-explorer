/**
 * BOUNDED PARCEL ENRICHMENT for Site Matchmaker ranked cards and explicitly
 * opened full-map parcel dossiers.
 *
 * Repo doctrine is static-first: the shortlist's universe, sizes, ownership
 * axes, overlays, and rail distances all come from committed files. County
 * valuation and current-license conflict status are the facts that go stale
 * fastest and that a reader will act on, so they are fetched live only for a
 * bounded ranked set or a parcel the reader explicitly opens, never for the
 * whole screened pool.
 *
 * NEVER 500. Every upstream is optional: a failed class lookup, a failed
 * valuation lookup, and a failed license lookup each degrade that ONE field to
 * null and set `enrichmentUnavailable` on the item. The route's own contract is
 * a 200 with a per-item result, so the page can always render its static half.
 *
 * Sources
 *   • CookViewer current parcel service — exact-PIN class, lot area,
 *     assessor building area, and tax year (`BCLASS`, `LANDSF`, `BLDGSQFT`,
 *     `TAXYR`).
 *   • Cook County `uzyt-m557` — assessments by stage; the latest year with any
 *     of board_tot / certified_tot / mailed_tot populated, preferred in that
 *     order (a Board result supersedes a certified one, which supersedes the
 *     mailed notice).
 *   • Chicago `r5kz-chrr` — issued (`AAI`) business licenses, matched on the
 *     EXACT address string with `expiration_date` in the future. An address
 *     match is a SIGNAL, not proof of occupancy; the page says so.
 */

import { NextResponse } from "next/server";
import { socrataFetch } from "@/lib/socrata";
import {
  COOK_COUNTY_CURRENT_PARCELS_QUERY_URL,
  normalizePin14,
} from "@/lib/cook-viewer";
import {
  normalizeCountyArea,
  normalizeCountyClass,
  normalizeCountyTaxYear,
} from "@/lib/county-parcel-facts";
import { loadPrecomputedCountyParcelFacts } from "@/lib/shortlist-parcel-identity";
import { chicagoCalendarDay } from "@/lib/vacancy-evidence";
import {
  countyClassGloss,
  impliedMarketValue,
  type ShortlistEnrichmentFacts,
} from "@/lib/site-shortlist";

export const dynamic = "force-dynamic";

/** Hard cap on one request. Ranked pages remain below it; full-map dossiers
 * send exactly one parcel per explicit reader action. */
const MAX_ITEMS = 25;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/**
 * Next Data Cache window for the two SOCRATA lookups (assessment, licences).
 * The in-memory `cache` below is per serverless instance and dies with it;
 * this one is shared across instances, so a cold start no longer re-pays a
 * Socrata round trip for a value that changes at most a few times a year.
 * Deliberately NOT applied to the County ArcGIS fallback — that path is now
 * the rare exception (an unknown PIN), and its own freshness story is the
 * precompute, not a cache.
 */
const SOCRATA_REVALIDATE_SECONDS = 6 * 60 * 60;

const COUNTY_DOMAIN = "datacatalog.cookcountyil.gov";
const CITY_DOMAIN = "data.cityofchicago.org";

export interface ShortlistEnrichItem extends ShortlistEnrichmentFacts {
  key: string;
  /** True when at least one upstream lookup could not be completed. */
  enrichmentUnavailable: boolean;
}

interface CachedEntry {
  value: ShortlistEnrichItem;
  expiresAt: number;
}

// In-memory, per-instance. A serverless cold start simply refetches.
const cache = new Map<string, CachedEntry>();
const inFlight = new Map<string, Promise<ShortlistEnrichItem>>();

function cacheGet(cacheKey: string): ShortlistEnrichItem | null {
  const entry = cache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(cacheKey);
    return null;
  }
  return entry.value;
}

function cacheSet(cacheKey: string, value: ShortlistEnrichItem) {
  // Bound the map so a long-lived instance cannot grow without limit.
  if (cache.size > 2000) cache.clear();
  cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function soda(domain: string, dataset: string, params: Record<string, string>): string {
  return `https://${domain}/resource/${dataset}.json?${new URLSearchParams(params)}`;
}

/** Socrata string literals are single-quoted; escape any embedded quote. */
function sodaLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

interface CountyParcelFacts {
  countyClass: string | null;
  lotAreaSqft: number | null;
  assessorBuildingSqft: number | null;
  assessorBuildingYear: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Latest published CookViewer parcel facts for a PIN. `undefined` = lookup failed. */
async function fetchCountyParcelFacts(pin: string): Promise<CountyParcelFacts | undefined> {
  const url = new URL(COOK_COUNTY_CURRENT_PARCELS_QUERY_URL);
  url.searchParams.set("where", `PIN14='${pin}'`);
  url.searchParams.set("outFields", "PIN14,BCLASS,LANDSF,BLDGSQFT,TAXYR");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) {
        if (response.status >= 500 && attempt === 0) continue;
        return undefined;
      }
      const payload = record(await response.json());
      if (!payload || !Array.isArray(payload.features)) return undefined;
      const feature = record(payload.features[0]);
      const attributes = record(feature?.attributes);
      if (!attributes) {
        return {
          countyClass: null,
          lotAreaSqft: null,
          assessorBuildingSqft: null,
          assessorBuildingYear: null,
        };
      }
      // The SAME normalizers the offline precompute uses, so a snapshot fact
      // and a live fact for one parcel can never differ in shape.
      return {
        countyClass: normalizeCountyClass(attributes.BCLASS),
        lotAreaSqft: normalizeCountyArea(attributes.LANDSF),
        assessorBuildingSqft: normalizeCountyArea(attributes.BLDGSQFT),
        assessorBuildingYear: normalizeCountyTaxYear(attributes.TAXYR),
      };
    } catch {
      if (attempt === 1) return undefined;
    }
  }
  return undefined;
}

/** Latest assessed value + its year. `undefined` = lookup failed. */
async function fetchAssessedValue(
  pin: string,
): Promise<{
  value: number | null;
  year: string | null;
  stage: "board" | "certified" | "mailed" | null;
} | undefined> {
  const rows = await socrataFetch<Record<string, unknown>[]>(
    soda(COUNTY_DOMAIN, "uzyt-m557", {
      $where:
        `pin='${sodaLiteral(pin)}' AND ` +
        "(certified_tot IS NOT NULL OR mailed_tot IS NOT NULL OR board_tot IS NOT NULL)",
      $order: "year DESC",
      $limit: "1",
    }),
    undefined,
    { revalidateSeconds: SOCRATA_REVALIDATE_SECONDS },
  );
  if (rows === null) return undefined;
  const row = rows[0];
  if (!row) return { value: null, year: null, stage: null };
  const stages = [
    ["board", numeric(row.board_tot)],
    ["certified", numeric(row.certified_tot)],
    ["mailed", numeric(row.mailed_tot)],
  ] as const;
  const selected = stages.find(([, value]) => value !== null && value > 0) ?? null;
  return {
    value: selected?.[1] ?? null,
    year: text(row.year),
    stage: selected?.[0] ?? null,
  };
}

/** Unexpired licenses recorded at the EXACT address. `undefined` = failed. */
async function fetchActiveLicenses(
  address: string,
): Promise<{ name: string; description: string }[] | undefined> {
  const today = chicagoCalendarDay();
  const rows = await socrataFetch<Record<string, unknown>[]>(
    soda(CITY_DOMAIN, "r5kz-chrr", {
      $select: "doing_business_as_name,license_description,expiration_date,license_status",
      $where:
        `address='${sodaLiteral(address)}' AND ` +
        `license_status='AAI' AND expiration_date>'${today}T00:00:00'`,
      $order: "expiration_date DESC",
      $limit: "5",
    }),
    undefined,
    { revalidateSeconds: SOCRATA_REVALIDATE_SECONDS },
  );
  if (rows === null) return undefined;

  const seen = new Set<string>();
  const licenses: { name: string; description: string }[] = [];
  for (const row of rows) {
    const name = text(row.doing_business_as_name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    licenses.push({ name, description: text(row.license_description) ?? "" });
  }
  return licenses;
}

async function enrichOne(
  item: {
    key: string;
    pin: string | null;
    address: string | null;
  },
  buildId: string,
): Promise<ShortlistEnrichItem> {
  const pin = normalizePin14(item.pin);
  const address = item.address?.trim() ?? "";
  // buildId is part of the key (Finding 4, Q6.2): a universe regeneration
  // (new export, new PIN/address facts) must never serve a value cached
  // under a PRIOR build — there is otherwise no signal anything changed.
  // `buildId` is guaranteed non-empty here: the route rejects a missing or
  // empty buildId with 400 before this function is ever called (re-review
  // Finding 4 — a request-level partition is only meaningful if every
  // caller is actually required to supply one, not merely invited to).
  const cacheKey = `${buildId}|${pin ?? ""}|${address.toUpperCase()}`;
  const cached = pin == null && address === "" ? null : cacheGet(cacheKey);
  if (cached) return { ...cached, key: item.key };

  const pending = inFlight.get(cacheKey);
  if (pending) return { ...(await pending), key: item.key };

  const request = (async (): Promise<ShortlistEnrichItem> => {

  // ── The County parcel read, precomputed where possible ──────────────────
  // The offline run (scripts/resolve-shortlist-universe-parcels.ts) already
  // read class, lot area, assessor building area, and tax year for ~every
  // PIN this shortlist can surface, bound to THIS universe buildId. When the
  // snapshot has the PIN, the ArcGIS server is not contacted at all, and the
  // result is a genuine successful read — its statuses are the same
  // available/not_published a live lookup would produce, never "unavailable".
  // An unknown PIN (or a buildId the snapshot does not recognize) falls
  // through to the live lookup, unchanged.
  const precomputedFacts = pin ? loadPrecomputedCountyParcelFacts(buildId).get(pin) : undefined;

  const [parcelResult, valueResult, licenseResult] = await Promise.all([
    precomputedFacts
      ? Promise.resolve<CountyParcelFacts>({
          countyClass: precomputedFacts.countyClass,
          lotAreaSqft: precomputedFacts.lotAreaSqft,
          assessorBuildingSqft: precomputedFacts.assessorBuildingSqft,
          assessorBuildingYear: precomputedFacts.assessorBuildingYear,
        })
      : pin
      ? fetchCountyParcelFacts(pin)
      : Promise.resolve<CountyParcelFacts>({
          countyClass: null,
          lotAreaSqft: null,
          assessorBuildingSqft: null,
          assessorBuildingYear: null,
        }),
    pin
      ? fetchAssessedValue(pin)
      : Promise.resolve<{
          value: number | null;
          year: string | null;
          stage: "board" | "certified" | "mailed" | null;
        }>({
          value: null,
          year: null,
          stage: null,
        }),
    address ? fetchActiveLicenses(address) : Promise.resolve([]),
  ]);

  const countyClass = parcelResult === undefined ? null : parcelResult.countyClass;
  const lotAreaSqft = parcelResult === undefined ? null : parcelResult.lotAreaSqft;
  const assessorBuildingSqft =
    parcelResult === undefined ? null : parcelResult.assessorBuildingSqft;
  const assessorBuildingYear =
    parcelResult === undefined ? null : parcelResult.assessorBuildingYear;
  const countyFactsSource = precomputedFacts ? "precomputed_snapshot" : "live_county";
  // Only claim a check instant when a County parcel read actually happened:
  // the snapshot's own instant, or now for a successful live lookup.
  const countyFactsCheckedAt =
    precomputedFacts?.checkedAt ??
    (pin !== null && parcelResult !== undefined ? new Date().toISOString() : null);
  const assessedValue = valueResult === undefined ? null : valueResult.value;
  const assessedYear = valueResult === undefined ? null : valueResult.year;
  const assessedStage = valueResult === undefined ? null : valueResult.stage;
  const activeLicenses = licenseResult === undefined ? [] : licenseResult;

  const result: ShortlistEnrichItem = {
    key: item.key,
    countyClass,
    classGloss: countyClassGloss(countyClass),
    countyClassStatus:
      pin === null ? "not_requested" : parcelResult === undefined ? "unavailable" : countyClass === null ? "not_published" : "available",
    lotAreaSqft,
    lotAreaStatus:
      pin === null ? "not_requested" : parcelResult === undefined ? "unavailable" : lotAreaSqft === null ? "not_published" : "available",
    assessorBuildingSqft,
    assessorBuildingYear,
    assessorBuildingAreaStatus:
      pin === null ? "not_requested" : parcelResult === undefined ? "unavailable" : assessorBuildingSqft === null ? "not_published" : "available",
    assessedValue,
    assessedYear,
    assessedStage,
    assessedValueStatus:
      pin === null ? "not_requested" : valueResult === undefined ? "unavailable" : assessedValue === null ? "not_published" : "available",
    impliedMarketValue: impliedMarketValue(countyClass, assessedValue),
    activeLicenses,
    activeLicenseStatus:
      address === "" ? "not_requested" : licenseResult === undefined ? "unavailable" : activeLicenses.length === 0 ? "not_found" : "available",
    countyFactsSource,
    countyFactsCheckedAt,
    enrichmentUnavailable:
      parcelResult === undefined || valueResult === undefined || licenseResult === undefined,
  };

  // Cache only AFFIRMATIVE results — a genuine, populated fact was found
  // (Finding 4, Q6.2: "do not treat an empty HTTP 200 as a trustworthy 'no
  // data'"). A result where every upstream succeeded but returned nothing
  // (no class, no assessed value, no licenses) is NOT cached: it is
  // indistinguishable at this layer from "not yet indexed" or "about to
  // change", and the cost of re-querying it next time is one Socrata round
  // trip, not a correctness risk. Only a genuinely negative result earning
  // its own confident cache entry would need a TTL long enough to matter;
  // this repo does not have one, so simply not caching "found nothing" is
  // the conservative, correct default.
  const hasAffirmativeData =
    countyClass != null || lotAreaSqft != null || assessorBuildingSqft != null || assessedValue != null || activeLicenses.length > 0;
  if ((pin != null || address !== "") && !result.enrichmentUnavailable && hasAffirmativeData) {
    cacheSet(cacheKey, result);
  }
  return result;
  })();

  inFlight.set(cacheKey, request);
  try {
    return { ...(await request), key: item.key };
  } finally {
    inFlight.delete(cacheKey);
  }
}

export async function POST(request: Request) {
  let items: { key: string; pin: string | null; address: string | null }[] = [];
  let buildId = "";
  let requestedCount = 0;
  let parsedOk = true;
  try {
    const body = (await request.json()) as { buildId?: unknown; items?: unknown };
    buildId = typeof body?.buildId === "string" ? body.buildId.trim().slice(0, 200) : "";
    if (Array.isArray(body?.items)) {
      requestedCount = body.items.length;
      items = body.items
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
        .map((entry) => ({
          key: typeof entry.key === "string" ? entry.key : "",
          pin: typeof entry.pin === "string" ? entry.pin : null,
          address: typeof entry.address === "string" ? entry.address.slice(0, 200) : null,
        }))
        .filter((entry) => entry.key !== "")
        .slice(0, MAX_ITEMS);
    }
  } catch {
    parsedOk = false;
    items = [];
  }

  // REJECT a missing/empty buildId (re-review Finding 4). The pre-fix
  // version accepted "" as a valid (if degraded) cache partition — but an
  // optional field a caller can simply omit defeats cross-build cache
  // isolation for exactly the callers most likely to omit it (an
  // unmaintained integration, a stale client bundle). The ONE client this
  // route has (components/vacancy/SiteShortlistResults.tsx) already always
  // sends the loaded universe's own buildId, so this is not a breaking
  // change for it — only for a caller that was never sending one honestly.
  if (parsedOk && buildId === "") {
    return NextResponse.json({ error: "buildId is required" }, { status: 400 });
  }

  if (items.length === 0) {
    return NextResponse.json({
      items: [] as ShortlistEnrichItem[],
      request: {
        requested: requestedCount,
        accepted: 0,
        truncated: Math.max(0, requestedCount),
      },
    });
  }

  // Never 500: a rejection anywhere still answers with a shaped, honest body.
  try {
    const enriched = await Promise.all(items.map((item) => enrichOne(item, buildId)));
    return NextResponse.json(
      {
        items: enriched,
        request: {
          requested: requestedCount,
          accepted: items.length,
          truncated: Math.max(0, requestedCount - items.length),
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({
      items: items.map<ShortlistEnrichItem>((item) => ({
        key: item.key,
        countyClass: null,
        classGloss: null,
        countyClassStatus: item.pin ? "unavailable" : "not_requested",
        lotAreaSqft: null,
        lotAreaStatus: item.pin ? "unavailable" : "not_requested",
        assessorBuildingSqft: null,
        assessorBuildingYear: null,
        assessorBuildingAreaStatus: item.pin ? "unavailable" : "not_requested",
        assessedValue: null,
        assessedYear: null,
        assessedStage: null,
        assessedValueStatus: item.pin ? "unavailable" : "not_requested",
        impliedMarketValue: null,
        activeLicenses: [],
        activeLicenseStatus: item.address ? "unavailable" : "not_requested",
        countyFactsSource: "live_county",
        countyFactsCheckedAt: null,
        enrichmentUnavailable: true,
      })),
      request: {
        requested: requestedCount,
        accepted: items.length,
        truncated: Math.max(0, requestedCount - items.length),
      },
    });
  }
}
