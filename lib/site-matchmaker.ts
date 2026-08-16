import { PILOT_ZIPS } from "./pilot-zips";

export type SiteProjectUse =
  | "retail-service"
  | "food-hospitality"
  | "office-professional"
  | "production-manufacturing"
  | "distribution-logistics"
  | "community-facility"
  | "housing-mixed-use"
  | "other-commercial";

export type SitePropertyType = "existing-building" | "vacant-land" | "either";

export type SiteContextPreference =
  | "flexible"
  | "neighborhood-scale"
  | "commercial-corridor"
  | "mixed-use-center"
  | "industrial-employment";

export type SiteTransportationNeed =
  | "cta-rail"
  | "cta-bus"
  | "metra"
  | "expressway"
  | "freight-rail"
  | "bike-routes";

export type SiteTransportationDistance =
  | "flexible"
  | "quarter-mile"
  | "half-mile"
  | "one-mile";

export type SiteLocationPriority = "flexible" | "preferred" | "important";

/**
 * The opt-in zoning-alignment SCREEN (distinct from the always-on zoning
 * ORDER key `zoningBadgeFor` already drives — see lib/shortlist-engine.ts's
 * header). `"aligned-only"` is the only non-null value; anything else on the
 * wire decodes to `null`. Screens out `not-aligned`/`unresolved` candidates
 * ONLY when a project use is ALSO selected — with no project use there is no
 * badge to screen on, so this criterion cannot act and must be treated as
 * not-selected by the engine (see `SCREEN_HANDLERS["zoning-alignment"]`),
 * while still being surfaced honestly to the reader as a selected-but-inert
 * criterion (`selectedNonScoringCriteria` in lib/shortlist-criteria.ts).
 */
export type SiteZoningAlignment = "aligned-only";

export type SiteAmenityNeed =
  | "restaurants-retail"
  | "grocery"
  | "medical-health"
  | "schools"
  | "libraries"
  | "parks-open-space";

export interface SiteMatchOption<T extends string> {
  value: T;
  label: string;
  description: string;
}

export const SITE_PROJECT_USE_OPTIONS: readonly SiteMatchOption<SiteProjectUse>[] = [
  {
    value: "retail-service",
    label: "Retail or services",
    description: "Storefront retail, personal services, fitness, or customer-facing uses.",
  },
  {
    value: "food-hospitality",
    label: "Food or hospitality",
    description: "Restaurants, cafes, catering, lodging, or event-oriented uses.",
  },
  {
    value: "office-professional",
    label: "Office or professional",
    description: "Professional services, administrative work, studios, or flexible office space.",
  },
  {
    value: "production-manufacturing",
    label: "Production or manufacturing",
    description: "Fabrication, food production, assembly, or other production uses.",
  },
  {
    value: "distribution-logistics",
    label: "Distribution or logistics",
    description: "Storage, warehousing, delivery, fleet, or distribution operations.",
  },
  {
    value: "community-facility",
    label: "Community facility",
    description: "Nonprofit, cultural, education, health, or community-serving uses.",
  },
  {
    value: "housing-mixed-use",
    label: "Housing or mixed use",
    description: "Residential development or a project combining housing and commercial uses.",
  },
  {
    value: "other-commercial",
    label: "Other commercial project",
    description: "A project that does not fit the categories above.",
  },
];

export const SITE_PROPERTY_TYPE_OPTIONS: readonly SiteMatchOption<SitePropertyType>[] = [
  {
    value: "existing-building",
    label: "Existing building",
    description: "A structure to occupy, rehabilitate, or adapt.",
  },
  {
    value: "vacant-land",
    label: "Vacant land",
    description: "A parcel for new construction or site development.",
  },
  {
    value: "either",
    label: "Either",
    description: "Review both land and reported vacant-building records.",
  },
];

export const SITE_CONTEXT_OPTIONS: readonly SiteMatchOption<SiteContextPreference>[] = [
  {
    value: "flexible",
    label: "Flexible context",
    description: "Carry no density or district preference into the review.",
  },
  {
    value: "neighborhood-scale",
    label: "Neighborhood scale",
    description: "Lower-intensity, neighborhood-serving surroundings.",
  },
  {
    value: "commercial-corridor",
    label: "Commercial corridor",
    description: "A business corridor with customer-facing activity and services.",
  },
  {
    value: "mixed-use-center",
    label: "Mixed-use center",
    description: "A denser setting with residential and commercial uses nearby.",
  },
  {
    value: "industrial-employment",
    label: "Industrial or employment district",
    description: "A setting oriented toward production, logistics, or larger work sites.",
  },
];

export const SITE_TRANSPORTATION_OPTIONS: readonly SiteMatchOption<SiteTransportationNeed>[] = [
  { value: "cta-rail", label: "CTA rail", description: "Proximity to an 'L' station." },
  { value: "cta-bus", label: "CTA bus", description: "Proximity to a bus stop or route." },
  { value: "metra", label: "Metra", description: "Proximity to a Metra station." },
  { value: "expressway", label: "Expressway", description: "Access to the expressway network." },
  { value: "freight-rail", label: "Freight rail", description: "Proximity to a freight rail line." },
  { value: "bike-routes", label: "Bike routes", description: "Proximity to a mapped bike route." },
];

export const SITE_TRANSPORTATION_DISTANCE_OPTIONS: readonly SiteMatchOption<SiteTransportationDistance>[] = [
  {
    value: "flexible",
    label: "Flexible distance",
    description: "Carry no maximum transportation distance into the site review.",
  },
  {
    value: "quarter-mile",
    label: "Within 1/4 mile",
    description: "Use a quarter-mile proximity preference when reviewing candidate sites.",
  },
  {
    value: "half-mile",
    label: "Within 1/2 mile",
    description: "Use a half-mile proximity preference when reviewing candidate sites.",
  },
  {
    value: "one-mile",
    label: "Within 1 mile",
    description: "Use a one-mile proximity preference when reviewing candidate sites.",
  },
];

export const SITE_LOCATION_PRIORITY_OPTIONS: readonly SiteMatchOption<SiteLocationPriority>[] = [
  {
    value: "flexible",
    label: "No preference",
    description: "Do not use this factor to narrow the discussion.",
  },
  {
    value: "preferred",
    label: "Preferred",
    description: "Review this factor when comparing possible sites.",
  },
  {
    value: "important",
    label: "Important",
    description: "Treat this as a required discussion item, subject to verification.",
  },
];

export const SITE_AMENITY_OPTIONS: readonly SiteMatchOption<SiteAmenityNeed>[] = [
  {
    value: "restaurants-retail",
    label: "Restaurants and retail",
    description: "Nearby licensed restaurants, cafes, and general retail.",
  },
  {
    value: "grocery",
    label: "Grocery",
    description: "Nearby licensed grocery businesses.",
  },
  {
    value: "medical-health",
    label: "Medical and health",
    description: "Nearby licensed medical or health services.",
  },
  {
    value: "schools",
    label: "Schools",
    description: "Proximity to a mapped K-12 school.",
  },
  {
    value: "libraries",
    label: "Libraries",
    description: "Proximity to a Chicago Public Library location.",
  },
  {
    value: "parks-open-space",
    label: "Parks and open space",
    description: "Proximity to mapped parks or open-space zoning.",
  },
];

export interface SiteMatchCriteria {
  zip: string | null;
  projectUse: SiteProjectUse | null;
  propertyType: SitePropertyType | null;
  minSquareFeet: number | null;
  maxSquareFeet: number | null;
  context: SiteContextPreference | null;
  transportation: readonly SiteTransportationNeed[];
  transportationDistance: SiteTransportationDistance | null;
  walkability: SiteLocationPriority | null;
  pedestrianActivity: SiteLocationPriority | null;
  amenities: readonly SiteAmenityNeed[];
  zoningAlignment: SiteZoningAlignment | null;
}

export interface SiteMatchSummary {
  location: string;
  projectUse: string;
  propertyType: string;
  footprint: string;
  context: string;
  transportation: string;
  transportationDistance: string;
  walkability: string;
  pedestrianActivity: string;
  amenities: string;
  zoningAlignment: string;
}

const MIN_SQUARE_FEET = 100;
const MAX_SQUARE_FEET = 2_000_000;

const PARAMS = {
  version: "sm_v",
  /** Finding 5 (PR2 adversarial review): a SEPARATE version, stamped only on
   *  shortlist handoff links, for whether the RANKING SEMANTICS a bookmarked
   *  URL implies are still current — distinct from `sm_v`, which only covers
   *  whether the CRITERIA shape can be decoded. See
   *  `shortlistRankingModelVersionSupported` below and
   *  lib/shortlist-engine.ts's `RANKING_MODEL_VERSION` (a different,
   *  DATA-compatibility check against the loaded universe file). */
  rankingModelVersion: "sm_rv",
  zip: "zip",
  projectUse: "sm_use",
  propertyType: "sm_property",
  minSquareFeet: "sm_min_sqft",
  maxSquareFeet: "sm_max_sqft",
  context: "sm_context",
  transportation: "sm_transport",
  transportationDistance: "sm_transport_distance",
  walkability: "sm_walkability",
  pedestrianActivity: "sm_pedestrian_activity",
  amenities: "sm_amenities",
  /** The opt-in zoning-alignment screen. Only the literal value `"aligned"`
   *  is recognized; absent or anything else decodes to `null` — never a
   *  silent alias table, since this is a single boolean-shaped toggle. */
  zoningAlignment: "sm_zoning",
} as const;

/**
 * Every canonical `sm_*` CRITERIA key (not the version stamps, not `zip`).
 * The shortlist page and the vacancy-map handoff copy ONLY these keys out of
 * an incoming URL before decoding, so a criterion that is added to `PARAMS`
 * but not to this list would silently decode as "not selected". Derived from
 * `PARAMS` so it cannot drift; lib/__tests__/site-matchmaker.test.ts pins it.
 */
export const SITE_MATCH_CRITERIA_PARAM_KEYS = [
  PARAMS.projectUse,
  PARAMS.propertyType,
  PARAMS.minSquareFeet,
  PARAMS.maxSquareFeet,
  PARAMS.context,
  PARAMS.transportation,
  PARAMS.transportationDistance,
  PARAMS.walkability,
  PARAMS.pedestrianActivity,
  PARAMS.amenities,
  PARAMS.zoningAlignment,
] as const;

/** The version stamps a shortlist handoff URL carries alongside the criteria. */
export const SITE_MATCH_VERSION_PARAM_KEYS = [PARAMS.version, PARAMS.rankingModelVersion] as const;

const PROJECT_USE_ALIASES = [PARAMS.projectUse, "project", "use"] as const;
const PROPERTY_TYPE_ALIASES = [PARAMS.propertyType, "property", "propertyType"] as const;
const MIN_SQUARE_FEET_ALIASES = [PARAMS.minSquareFeet, "minSqFt"] as const;
const MAX_SQUARE_FEET_ALIASES = [PARAMS.maxSquareFeet, "maxSqFt"] as const;
const CONTEXT_ALIASES = [PARAMS.context, "density", "context"] as const;
const TRANSPORTATION_ALIASES = [PARAMS.transportation, "transport"] as const;
const TRANSPORTATION_DISTANCE_ALIASES = [
  PARAMS.transportationDistance,
  "transportDistance",
] as const;
const WALKABILITY_ALIASES = [PARAMS.walkability, "walkability"] as const;
const PEDESTRIAN_ACTIVITY_ALIASES = [
  PARAMS.pedestrianActivity,
  "pedestrianActivity",
] as const;
const AMENITY_ALIASES = [PARAMS.amenities, "amenities"] as const;

export function createEmptySiteMatchCriteria(): SiteMatchCriteria {
  return {
    zip: null,
    projectUse: null,
    propertyType: null,
    minSquareFeet: null,
    maxSquareFeet: null,
    context: null,
    transportation: [],
    transportationDistance: null,
    walkability: null,
    pedestrianActivity: null,
    amenities: [],
    zoningAlignment: null,
  };
}

function firstValue(params: URLSearchParams, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = params.get(key)?.trim();
    if (value) return value;
  }
  return null;
}

function selectedValue<T extends string>(
  value: string | null,
  options: readonly SiteMatchOption<T>[],
): T | null {
  return options.some((option) => option.value === value) ? (value as T) : null;
}

function selectedValues<T extends string>(
  params: URLSearchParams,
  keys: readonly string[],
  options: readonly SiteMatchOption<T>[],
): T[] {
  const requested = new Set(
    keys.flatMap((key) => params.getAll(key)).flatMap((value) => value.split(",")),
  );
  return options.map((option) => option.value).filter((value) => requested.has(value));
}

function normalizedSquareFeet(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(MAX_SQUARE_FEET, Math.max(MIN_SQUARE_FEET, Math.round(value)));
}

function parsedSquareFeet(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  return normalizedSquareFeet(Number(value));
}

function normalizedZip(value: string | null): string | null {
  return PILOT_ZIPS.some((entry) => entry.zip === value) ? value : null;
}

function normalizedList<T extends string>(
  values: readonly T[],
  options: readonly SiteMatchOption<T>[],
): T[] {
  const requested = new Set<string>(values);
  return options.map((option) => option.value).filter((value) => requested.has(value));
}

export function normalizeSiteMatchCriteria(criteria: SiteMatchCriteria): SiteMatchCriteria {
  let minSquareFeet = normalizedSquareFeet(criteria.minSquareFeet);
  let maxSquareFeet = normalizedSquareFeet(criteria.maxSquareFeet);
  if (minSquareFeet != null && maxSquareFeet != null && minSquareFeet > maxSquareFeet) {
    [minSquareFeet, maxSquareFeet] = [maxSquareFeet, minSquareFeet];
  }

  return {
    zip: normalizedZip(criteria.zip),
    projectUse: selectedValue(criteria.projectUse, SITE_PROJECT_USE_OPTIONS),
    propertyType: selectedValue(criteria.propertyType, SITE_PROPERTY_TYPE_OPTIONS),
    minSquareFeet,
    maxSquareFeet,
    context: selectedValue(criteria.context, SITE_CONTEXT_OPTIONS),
    transportation: normalizedList(criteria.transportation, SITE_TRANSPORTATION_OPTIONS),
    transportationDistance: selectedValue(
      criteria.transportationDistance,
      SITE_TRANSPORTATION_DISTANCE_OPTIONS,
    ),
    walkability: selectedValue(criteria.walkability, SITE_LOCATION_PRIORITY_OPTIONS),
    pedestrianActivity: selectedValue(
      criteria.pedestrianActivity,
      SITE_LOCATION_PRIORITY_OPTIONS,
    ),
    amenities: normalizedList(criteria.amenities, SITE_AMENITY_OPTIONS),
    zoningAlignment: criteria.zoningAlignment === "aligned-only" ? "aligned-only" : null,
  };
}

/**
 * The `sm_v` version this build's encode/decode contract speaks. Bumped
 * whenever the criteria shape changes in a way an old link could no longer
 * decode correctly.
 */
export const SITE_MATCH_CRITERIA_VERSION = "1";

/**
 * Whether the `sm_v` carried on a URL (if any) is one this build knows how
 * to decode. PR2 fixes the pre-PR2 gap the gpt5.6 matchmaker consult
 * flagged directly: `encodeSiteMatchCriteria` already stamps `sm_v=1` on
 * every link, but nothing ever branched on or rejected it — a link minted
 * by a future, incompatible version of this schema would silently decode as
 * if it were current instead of failing closed.
 *
 * An ABSENT `sm_v` is treated as supported (version 1 implicitly) for
 * back-compatibility with links minted before versioning existed or by
 * callers that never touch the wizard (e.g. a bare ZIP link) — only an
 * EXPLICIT, unrecognized value is rejected.
 */
export function siteMatchCriteriaVersionSupported(params: URLSearchParams): boolean {
  const raw = params.get(PARAMS.version);
  return raw == null || raw === SITE_MATCH_CRITERIA_VERSION;
}

/**
 * The ranking-semantics version stamped on every shortlist handoff link
 * (`sm_rv`) — Finding 5. Bumped whenever lib/shortlist-engine.ts's
 * screen/score/badge rules change in a way that would make an OLD,
 * bookmarked/shared shortlist URL produce meaningfully different results
 * than the reader remembers, without any signal that anything changed.
 *
 * This is intentionally a STRING kept in lockstep with
 * `RANKING_MODEL_VERSION` (lib/shortlist-engine.ts) by convention (both
 * bumped together in the same PR when ranking semantics change) rather than
 * imported from there — lib/site-matchmaker.ts is a foundational module
 * lib/shortlist-engine.ts itself depends on for criteria types, and a
 * reverse value import would form a real circular dependency.
 *
 * Bumped to "3" (zoning-alignment ordering: `zoningBadgeFor` becomes a
 * primary/tiebreak ORDER key, plus the opt-in `sm_zoning=aligned` SCREEN)
 * WITHOUT bumping `RANKING_MODEL_VERSION`/`RANKING_INPUTS_VERSION` — this is
 * the one legitimate way the two constants may diverge, per the "convention,
 * not an import" note above: this change reads only the `zoning` field the
 * committed universe rows already publish (the same field `zoningBadgeFor`
 * has always read for the badge), so no committed
 * data/exports/shortlist-universe/*.json file's shape or ranking-INPUTS
 * contract changed — only the ranking ALGORITHM applied to those same
 * inputs. `RANKING_MODEL_VERSION` is a zod `z.literal` cross-check against
 * every committed universe file's own `rankingInputsVersion`; bumping it
 * would fail-closed every already-published ZIP until every file is
 * regenerated, which this change does not warrant. `sm_rv` alone carries the
 * "an old shared link's order may have changed" signal here — see the
 * lockstep test in lib/__tests__/site-matchmaker.test.ts, updated to assert
 * `sm_rv` never falls BEHIND the data version rather than requiring exact
 * equality.
 */
export const SHORTLIST_RANKING_MODEL_VERSION = "3";

/**
 * Whether the `sm_rv` carried on a shortlist URL (if any) is one this build
 * still speaks. An ABSENT `sm_rv` is treated as supported — for
 * back-compatibility with links minted before this versioning existed, the
 * same convention `siteMatchCriteriaVersionSupported` uses for `sm_v` — only
 * an EXPLICIT, unrecognized value fails closed. This is a REQUEST-level
 * check (does this URL's own ranking-semantics claim match); it is
 * independent of whether the loaded universe FILE's `rankingInputsVersion`
 * happens to match the engine (that is lib/shortlist-engine.ts's own,
 * separate data-compatibility check).
 */
export function shortlistRankingModelVersionSupported(params: URLSearchParams): boolean {
  const raw = params.get(PARAMS.rankingModelVersion);
  return raw == null || raw === SHORTLIST_RANKING_MODEL_VERSION;
}

export function decodeSiteMatchCriteria(params: URLSearchParams): SiteMatchCriteria {
  return normalizeSiteMatchCriteria({
    zip: params.get(PARAMS.zip),
    projectUse: selectedValue(firstValue(params, PROJECT_USE_ALIASES), SITE_PROJECT_USE_OPTIONS),
    propertyType: selectedValue(
      firstValue(params, PROPERTY_TYPE_ALIASES),
      SITE_PROPERTY_TYPE_OPTIONS,
    ),
    minSquareFeet: parsedSquareFeet(firstValue(params, MIN_SQUARE_FEET_ALIASES)),
    maxSquareFeet: parsedSquareFeet(firstValue(params, MAX_SQUARE_FEET_ALIASES)),
    context: selectedValue(firstValue(params, CONTEXT_ALIASES), SITE_CONTEXT_OPTIONS),
    transportation: selectedValues(
      params,
      TRANSPORTATION_ALIASES,
      SITE_TRANSPORTATION_OPTIONS,
    ),
    transportationDistance: selectedValue(
      firstValue(params, TRANSPORTATION_DISTANCE_ALIASES),
      SITE_TRANSPORTATION_DISTANCE_OPTIONS,
    ),
    walkability: selectedValue(
      firstValue(params, WALKABILITY_ALIASES),
      SITE_LOCATION_PRIORITY_OPTIONS,
    ),
    pedestrianActivity: selectedValue(
      firstValue(params, PEDESTRIAN_ACTIVITY_ALIASES),
      SITE_LOCATION_PRIORITY_OPTIONS,
    ),
    amenities: selectedValues(params, AMENITY_ALIASES, SITE_AMENITY_OPTIONS),
    zoningAlignment: params.get(PARAMS.zoningAlignment) === "aligned" ? "aligned-only" : null,
  });
}

export function encodeSiteMatchCriteria(criteria: SiteMatchCriteria): URLSearchParams {
  const normalized = normalizeSiteMatchCriteria(criteria);
  const values = new URLSearchParams();
  if (normalized.zip) values.set(PARAMS.zip, normalized.zip);
  if (normalized.projectUse) values.set(PARAMS.projectUse, normalized.projectUse);
  if (normalized.propertyType) values.set(PARAMS.propertyType, normalized.propertyType);
  if (normalized.minSquareFeet != null) {
    values.set(PARAMS.minSquareFeet, String(normalized.minSquareFeet));
  }
  if (normalized.maxSquareFeet != null) {
    values.set(PARAMS.maxSquareFeet, String(normalized.maxSquareFeet));
  }
  if (normalized.context) values.set(PARAMS.context, normalized.context);
  if (normalized.transportation.length > 0) {
    values.set(PARAMS.transportation, normalized.transportation.join(","));
  }
  if (normalized.transportationDistance) {
    values.set(PARAMS.transportationDistance, normalized.transportationDistance);
  }
  if (normalized.walkability) values.set(PARAMS.walkability, normalized.walkability);
  if (normalized.pedestrianActivity) {
    values.set(PARAMS.pedestrianActivity, normalized.pedestrianActivity);
  }
  if (normalized.amenities.length > 0) {
    values.set(PARAMS.amenities, normalized.amenities.join(","));
  }
  if (normalized.zoningAlignment === "aligned-only") {
    values.set(PARAMS.zoningAlignment, "aligned");
  }

  if (values.size === 0) return values;
  const versioned = new URLSearchParams([[PARAMS.version, "1"]]);
  values.forEach((value, key) => versioned.set(key, value));
  return versioned;
}

export function isSiteMatchCriteriaReady(criteria: SiteMatchCriteria): boolean {
  const normalized = normalizeSiteMatchCriteria(criteria);
  return Boolean(normalized.zip && normalized.projectUse && normalized.propertyType);
}

export function buildSiteMatchmakerHref(criteria: SiteMatchCriteria): string {
  const query = encodeSiteMatchCriteria(criteria).toString();
  return query ? `/locate?${query}` : "/locate";
}

/** The criteria query a /vacancy/[zip]/* handoff carries: everything except the
 *  ZIP, which the route itself supplies. */
function vacancyHandoffQuery(criteria: SiteMatchCriteria): URLSearchParams {
  const handoff = new URLSearchParams({ source: "site-matchmaker" });
  encodeSiteMatchCriteria(criteria).forEach((value, key) => {
    if (key !== PARAMS.zip) handoff.set(key, value);
  });
  return handoff;
}

export function buildVacancyHandoffHref(criteria: SiteMatchCriteria): string | null {
  const normalized = normalizeSiteMatchCriteria(criteria);
  if (!isSiteMatchCriteriaReady(normalized) || !normalized.zip) return null;

  return `/vacancy/${normalized.zip}/map?${vacancyHandoffQuery(normalized).toString()}`;
}

/**
 * The ranked-shortlist handoff — the Site Matchmaker's PRIMARY destination.
 * Same criteria contract as the map handoff (so the two stay interchangeable
 * and a reader can move between them without rebuilding a brief), pointed at
 * the screened, ranked result instead of the raw pin cloud.
 *
 * Stamps `sm_rv` (Finding 5) — ONLY here, not on the map handoff or the bare
 * wizard URL, since ranking semantics are a shortlist-specific concern. The
 * page rejects an explicit, unrecognized `sm_rv` the same way it rejects an
 * unrecognized `sm_v`.
 */
export function buildShortlistHref(criteria: SiteMatchCriteria): string | null {
  const normalized = normalizeSiteMatchCriteria(criteria);
  if (!isSiteMatchCriteriaReady(normalized) || !normalized.zip) return null;

  const query = vacancyHandoffQuery(normalized);
  query.set(PARAMS.rankingModelVersion, SHORTLIST_RANKING_MODEL_VERSION);
  return `/vacancy/${normalized.zip}/shortlist?${query.toString()}`;
}

function labelFor<T extends string>(
  value: T | null,
  options: readonly SiteMatchOption<T>[],
  fallback: string,
): string {
  return options.find((option) => option.value === value)?.label ?? fallback;
}

function labelsFor<T extends string>(
  values: readonly T[],
  options: readonly SiteMatchOption<T>[],
  fallback: string,
): string {
  const labels = options
    .filter((option) => values.includes(option.value))
    .map((option) => option.label);
  return labels.length > 0 ? labels.join(", ") : fallback;
}

function footprintSummary(minimum: number | null, maximum: number | null): string {
  if (minimum != null && maximum != null) {
    return `${minimum.toLocaleString("en-US")} - ${maximum.toLocaleString("en-US")} sq ft`;
  }
  if (minimum != null) return `At least ${minimum.toLocaleString("en-US")} sq ft`;
  if (maximum != null) return `Up to ${maximum.toLocaleString("en-US")} sq ft`;
  return "Flexible footprint";
}

export function summarizeSiteMatchCriteria(criteria: SiteMatchCriteria): SiteMatchSummary {
  const normalized = normalizeSiteMatchCriteria(criteria);
  const area = PILOT_ZIPS.find((entry) => entry.zip === normalized.zip);
  return {
    location: area ? `${area.primaryNeighborhood} (${area.zip})` : "Area not selected",
    projectUse: labelFor(
      normalized.projectUse,
      SITE_PROJECT_USE_OPTIONS,
      "Project use not selected",
    ),
    propertyType: labelFor(
      normalized.propertyType,
      SITE_PROPERTY_TYPE_OPTIONS,
      "Property type not selected",
    ),
    footprint: footprintSummary(normalized.minSquareFeet, normalized.maxSquareFeet),
    context: labelFor(normalized.context, SITE_CONTEXT_OPTIONS, "Flexible context"),
    transportation: labelsFor(
      normalized.transportation,
      SITE_TRANSPORTATION_OPTIONS,
      "No transportation preference selected",
    ),
    transportationDistance: labelFor(
      normalized.transportationDistance,
      SITE_TRANSPORTATION_DISTANCE_OPTIONS,
      "Flexible distance",
    ),
    walkability: labelFor(
      normalized.walkability,
      SITE_LOCATION_PRIORITY_OPTIONS,
      "No preference",
    ),
    pedestrianActivity: labelFor(
      normalized.pedestrianActivity,
      SITE_LOCATION_PRIORITY_OPTIONS,
      "No preference",
    ),
    amenities: labelsFor(
      normalized.amenities,
      SITE_AMENITY_OPTIONS,
      "No nearby amenity preference selected",
    ),
    zoningAlignment:
      normalized.zoningAlignment === "aligned-only"
        ? "Aligned zoning families only"
        : "Zoning-alignment filter not selected",
  };
}
