/**
 * FINALIST ENRICHMENT for the Site Shortlist — the only request-time data in
 * the feature.
 *
 * Repo doctrine is static-first: the shortlist's universe, sizes, ownership
 * axes, overlays, and rail distances all come from committed files. County
 * valuation and active-license status are the two facts that go stale fastest
 * and that a reader will act on, so they are fetched live — but ONLY for the
 * ≤20 cards actually rendered, never for the whole screened pool.
 *
 * NEVER 500. Every upstream is optional: a failed class lookup, a failed
 * valuation lookup, and a failed license lookup each degrade that ONE field to
 * null and set `enrichmentUnavailable` on the item. The route's own contract is
 * a 200 with a per-item result, so the page can always render its static half.
 *
 * Sources
 *   • Cook County `nj4t-kc8j` — assessed-value / parcel-universe table; latest
 *     `year` for the PIN gives the current major class.
 *   • Cook County `uzyt-m557` — assessments by stage; the latest year with any
 *     of board_tot / certified_tot / mailed_tot populated, preferred in that
 *     order (a Board result supersedes a certified one, which supersedes the
 *     mailed notice).
 *   • Chicago `r5kz-chrr` — business licenses, matched on the EXACT address
 *     string with `expiration_date` in the future. An address match is a
 *     SIGNAL, not proof of occupancy; the page says so.
 */

import { NextResponse } from "next/server";
import { socrataFetch } from "@/lib/socrata";
import { normalizePin14 } from "@/lib/cook-viewer";
import {
  countyClassGloss,
  impliedMarketValue,
  type ShortlistEnrichmentFacts,
} from "@/lib/site-shortlist";

export const dynamic = "force-dynamic";

/** Hard cap on one request. The page renders at most SHORTLIST_TOP_N (20)
 *  cards as one ranked list (see lib/shortlist-engine.ts) — no tier split. */
const MAX_ITEMS = 25;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

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

/** Latest published major class for a PIN. `undefined` = lookup failed. */
async function fetchCountyClass(pin: string): Promise<string | null | undefined> {
  const rows = await socrataFetch<Record<string, unknown>[]>(
    soda(COUNTY_DOMAIN, "nj4t-kc8j", {
      $select: "class,year",
      $where: `pin='${sodaLiteral(pin)}'`,
      $order: "year DESC",
      $limit: "1",
    }),
  );
  if (rows === null) return undefined;
  return text(rows[0]?.class);
}

/** Latest assessed value + its year. `undefined` = lookup failed. */
async function fetchAssessedValue(
  pin: string,
): Promise<{ value: number | null; year: string | null } | undefined> {
  const rows = await socrataFetch<Record<string, unknown>[]>(
    soda(COUNTY_DOMAIN, "uzyt-m557", {
      $where:
        `pin='${sodaLiteral(pin)}' AND ` +
        "(certified_tot IS NOT NULL OR mailed_tot IS NOT NULL OR board_tot IS NOT NULL)",
      $order: "year DESC",
      $limit: "1",
    }),
  );
  if (rows === null) return undefined;
  const row = rows[0];
  if (!row) return { value: null, year: null };
  const value =
    numeric(row.board_tot) ?? numeric(row.certified_tot) ?? numeric(row.mailed_tot);
  return { value, year: text(row.year) };
}

/** Unexpired licenses recorded at the EXACT address. `undefined` = failed. */
async function fetchActiveLicenses(
  address: string,
): Promise<{ name: string; description: string }[] | undefined> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await socrataFetch<Record<string, unknown>[]>(
    soda(CITY_DOMAIN, "r5kz-chrr", {
      $select: "doing_business_as_name,license_description,expiration_date",
      $where: `address='${sodaLiteral(address)}' AND expiration_date>'${today}T00:00:00'`,
      $order: "expiration_date DESC",
      $limit: "5",
    }),
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
  const cacheKey = `${buildId}|${pin ?? ""}|${address.toUpperCase()}`;
  const cached = pin == null && address === "" ? null : cacheGet(cacheKey);
  if (cached) return { ...cached, key: item.key };

  const [classResult, valueResult, licenseResult] = await Promise.all([
    pin ? fetchCountyClass(pin) : Promise.resolve<string | null>(null),
    pin
      ? fetchAssessedValue(pin)
      : Promise.resolve<{ value: number | null; year: string | null }>({
          value: null,
          year: null,
        }),
    address ? fetchActiveLicenses(address) : Promise.resolve([]),
  ]);

  const countyClass = classResult === undefined ? null : classResult;
  const assessedValue = valueResult === undefined ? null : valueResult.value;
  const assessedYear = valueResult === undefined ? null : valueResult.year;
  const activeLicenses = licenseResult === undefined ? [] : licenseResult;

  const result: ShortlistEnrichItem = {
    key: item.key,
    countyClass,
    classGloss: countyClassGloss(countyClass),
    assessedValue,
    assessedYear,
    impliedMarketValue: impliedMarketValue(countyClass, assessedValue),
    activeLicenses,
    enrichmentUnavailable:
      classResult === undefined || valueResult === undefined || licenseResult === undefined,
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
    countyClass != null || assessedValue != null || activeLicenses.length > 0;
  if ((pin != null || address !== "") && !result.enrichmentUnavailable && hasAffirmativeData) {
    cacheSet(cacheKey, result);
  }
  return result;
}

export async function POST(request: Request) {
  let items: { key: string; pin: string | null; address: string | null }[] = [];
  let buildId = "";
  try {
    const body = (await request.json()) as { buildId?: unknown; items?: unknown };
    // An empty/missing buildId is still a valid (if less useful) cache
    // partition — every request from a client that hasn't been updated to
    // send one collapses into the same "" partition rather than failing;
    // it just cannot benefit from cross-build cache invalidation.
    buildId = typeof body?.buildId === "string" ? body.buildId.slice(0, 200) : "";
    if (Array.isArray(body?.items)) {
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
    items = [];
  }

  if (items.length === 0) {
    return NextResponse.json({ items: [] as ShortlistEnrichItem[] });
  }

  // Never 500: a rejection anywhere still answers with a shaped, honest body.
  try {
    const enriched = await Promise.all(items.map((item) => enrichOne(item, buildId)));
    return NextResponse.json(
      { items: enriched },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({
      items: items.map<ShortlistEnrichItem>((item) => ({
        key: item.key,
        countyClass: null,
        classGloss: null,
        assessedValue: null,
        assessedYear: null,
        impliedMarketValue: null,
        activeLicenses: [],
        enrichmentUnavailable: true,
      })),
    });
  }
}
