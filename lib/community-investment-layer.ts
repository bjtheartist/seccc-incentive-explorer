/**
 * Community Investment MAP-LAYER support — the client-safe half of the
 * admin-gated "Community investment" layer (components/map/MapView.tsx +
 * MapLegendPanel.tsx).
 *
 * lib/community-investment.ts is the DATA-CONTRACT + static loader and imports
 * `node:fs` / `node:path`, so it can only run server-side (the gated
 * /api/owner-file/investment route). This module carries everything the client
 * needs — endpoint, palette, year ranges, pure record→GeoJSON transforms, the
 * client-side year/funderType filter, the citywide summary, and the injectable
 * probe-then-fetch orchestration — importing ONLY types from the data contract
 * (type-only imports are erased at build time and never pull `node:fs` into the
 * browser bundle). Mirrors the split used for the ownership-cluster layer:
 * lib/owner-cluster-geo.ts (server) vs lib/owner-classify.ts (client-safe).
 *
 * The fetch orchestration mirrors lib/owner-file-report-context.ts
 * (fetchAdminOwnershipContext): a `fetchImpl` seam so the toggle's network
 * behavior is unit-testable in the node vitest env without rendering the map.
 */

import type {
  CommunityInvestmentExport,
  CommunityInvestmentRecord,
  FunderType,
  InvestmentStatus,
} from "@/lib/community-investment";
import type { FunderHq } from "@/lib/investment-deck-modes";

/** The gated dataset endpoint the layer fetches when toggled on. */
export const COMMUNITY_INVESTMENT_ENDPOINT = "/api/owner-file/investment";

/**
 * Canonical funder-type order wherever the three are listed together (legend
 * checkboxes, color key). Government first (the largest, most-mapped source),
 * private development last. Mirrors OWNER_TYPE_ORDER in lib/owner-classify.ts.
 */
export const FUNDER_TYPE_ORDER: FunderType[] = ["government", "philanthropic", "private_development"];

export const FUNDER_TYPE_LABELS: Record<FunderType, string> = {
  government: "Government",
  philanthropic: "Philanthropic",
  private_development: "Private development",
};

/**
 * Display labels for every InvestmentStatus — the ONE place status text is
 * humanized, shared by the map popup, the analysis "Major private developments"
 * section, and the print brief so the raw snake_case enum ("under_construction")
 * never reaches a reader. Exhaustive over INVESTMENT_STATUSES (a unit test guards
 * completeness).
 */
export const INVESTMENT_STATUS_LABELS: Record<InvestmentStatus, string> = {
  completed: "Completed",
  awarded: "Awarded",
  announced: "Announced",
  proposed: "Proposed",
  under_construction: "Under construction",
  partially_open: "Partially open",
  opened: "Opened",
  stalled: "Stalled",
  cancelled: "Cancelled",
};

/** Humanize a status for display; falls back to the raw value for an off-enum string. */
export function investmentStatusLabel(status: string | null | undefined): string {
  if (!status) return "";
  return INVESTMENT_STATUS_LABELS[status as InvestmentStatus] ?? status;
}

/**
 * Funder-type dot colors, drawn from the app's existing palette so the layer
 * reads as part of the same system:
 *   • government          #2563EB — the app's canonical government / City blue
 *     (LEVEL_COLORS, OWNER_TYPE_COLORS.city_public).
 *   • philanthropic       #059669 — the grantmaking / community green
 *     (enterprise zones, Community Assets, OWNER_TYPE_COLORS.local_private).
 *   • private_development  #7C3AED — the private-capital purple already used
 *     for investor ownership (OWNER_TYPE_COLORS.out_of_state, State level).
 */
export const FUNDER_TYPE_COLORS: Record<FunderType, string> = {
  government: "#2563EB",
  philanthropic: "#059669",
  private_development: "#7C3AED",
};

/** Fallback dot color for any unrecognized funderType (matches the paint fallback). */
export const INVESTMENT_FALLBACK_COLOR = "#9CA3AF";

export interface InvestmentYearRange {
  id: string;
  label: string;
  /** Inclusive lower bound, or null for the "All" chip (no year constraint). */
  min: number | null;
  /** Inclusive upper bound, or null for the "All" chip. */
  max: number | null;
}

/**
 * Year-range chips for the legend. "All" first (min/max null → no constraint),
 * then the four windows the task specifies. A record whose `year` is null (e.g.
 * a development project with no reliable single year) only ever shows under
 * "All" — it can never satisfy a bounded window.
 */
export const INVESTMENT_YEAR_RANGES: InvestmentYearRange[] = [
  { id: "all", label: "All", min: null, max: null },
  { id: "2017-2019", label: "2017–2019", min: 2017, max: 2019 },
  { id: "2020-2021", label: "2020–2021", min: 2020, max: 2021 },
  { id: "2022-2023", label: "2022–2023", min: 2022, max: 2023 },
  { id: "2024-2026", label: "2024–2026", min: 2024, max: 2026 },
];

export const DEFAULT_INVESTMENT_YEAR_RANGE = "all";

/**
 * Feature properties for one plotted community-investment point, carrying exactly
 * the fields the click popup renders (buildInvestmentPopupHtml in map-helpers.ts).
 * `sourceLink` is the first http(s) link flattened to a single string because
 * Mapbox serializes non-primitive feature properties to strings — keeping it a
 * scalar avoids a JSON.parse round-trip in the click handler.
 */
export interface InvestmentPointProps {
  id: string;
  recipient: string;
  funderName: string;
  funderType: FunderType;
  /** Real awarded dollars, or null — NEVER a derived figure. */
  amountAwarded: number | null;
  /**
   * Announced private DEVELOPMENT capital, or null — a SEPARATE measure from
   * amountAwarded, carried so the popup can label a development's figure
   * "Announced" (never "Awarded") and the Dots-mode radius can size a
   * development dot by it. Never combined with amountAwarded.
   */
  announcedInvestment: number | null;
  logLine: string | null;
  year: number | null;
  status: InvestmentStatus;
  /** First http(s) source link, or "" when the record carries none. */
  sourceLink: string;
  /**
   * Precomputed Dots-mode circle radius (px) for a DEVELOPMENT record, sized by
   * announcedInvestment over the development records only (sqrt-domain, 4–18px).
   * Absent on non-development points (they size by amountAwarded in the mapbox
   * paint). Stamped here rather than in the paint because a domain-normalized
   * scale needs the whole development set, which a per-feature mapbox expression
   * cannot see.
   */
  radiusPx?: number;
}

export type InvestmentPointFeature = GeoJSON.Feature<GeoJSON.Point, InvestmentPointProps>;

/** Dots-mode radius bounds for a DEVELOPMENT dot (px), sized by announcedInvestment. */
export const DEV_DOT_RADIUS_MIN = 4;
export const DEV_DOT_RADIUS_MAX = 18;

/**
 * Build a Dots-mode radius scale across the ACTUAL announced-capital domain of
 * the development records being plotted: sqrt(announcedInvestment) normalized
 * between the set's min and max, mapped to [4, 18] px. Mirrors
 * makeArcWidthScale (lib/investment-deck-modes.ts) but for circle radius, so a
 * $7B megasite dot reads visibly larger than a $30M hotel while a null-capital
 * development (subset/blank) sits at the 4px floor. A degenerate domain (one
 * development / all-equal amounts) renders at the midpoint radius. Null/negative
 * amounts count as 0. Pure / deterministic.
 */
export function makeDevelopmentDotRadiusScale(
  amounts: readonly (number | null | undefined)[],
): (amount: number | null | undefined) => number {
  const roots = amounts.map((a) => Math.sqrt(Math.max(0, a ?? 0)));
  const lo = roots.length ? Math.min(...roots) : 0;
  const hi = roots.length ? Math.max(...roots) : 0;
  const span = hi - lo;
  if (span <= 0) return () => (DEV_DOT_RADIUS_MIN + DEV_DOT_RADIUS_MAX) / 2;
  return (amount) => {
    const v = Math.sqrt(Math.max(0, amount ?? 0));
    const t = Math.min(1, Math.max(0, (v - lo) / span));
    return DEV_DOT_RADIUS_MIN + t * (DEV_DOT_RADIUS_MAX - DEV_DOT_RADIUS_MIN);
  };
}

/**
 * Convert canonical records to plottable GeoJSON point features. Citywide
 * records (geometry.kind === "citywide") are EXCLUDED — they carry no lat/lng
 * and must never be plotted at a misleading location (see the geometry doc in
 * lib/community-investment.ts); they surface only in the legend's "Citywide
 * commitments" note via summarizeCitywideInvestment. Pure / deterministic.
 */
export function investmentRecordsToPointFeatures(
  records: readonly CommunityInvestmentRecord[]
): InvestmentPointFeature[] {
  const features: InvestmentPointFeature[] = [];
  for (const r of records) {
    if (r.geometry.kind !== "point") continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.geometry.lng, r.geometry.lat] },
      properties: {
        id: r.id,
        recipient: r.recipient,
        funderName: r.funderName,
        funderType: r.funderType,
        amountAwarded: r.amountAwarded,
        announcedInvestment: r.announcedInvestment ?? null,
        logLine: r.logLine,
        year: r.year,
        status: r.status,
        sourceLink: r.links.find((l) => /^https?:\/\//i.test(l)) ?? "",
      },
    });
  }
  // Size DEVELOPMENT dots by announcedInvestment over the development records
  // ONLY (sqrt-domain, 4–18px). Stamped here so the mapbox paint can read a
  // ready radius without a domain-normalization it cannot express. A development
  // with null announcedInvestment (subset/blank) resolves to the 4px floor.
  const devAmounts = features
    .filter((f) => f.properties.funderType === "private_development")
    .map((f) => f.properties.announcedInvestment);
  const radiusOf = makeDevelopmentDotRadiusScale(devAmounts);
  for (const f of features) {
    if (f.properties.funderType === "private_development") {
      f.properties.radiusPx = radiusOf(f.properties.announcedInvestment);
    }
  }
  return features;
}

const FUNDER_TYPE_ORDER_STRINGS: readonly string[] = FUNDER_TYPE_ORDER;

/**
 * Whether a record's funderType is active under the current checkbox set. A
 * CANONICAL type is active iff its checkbox is on. An UNKNOWN (off-enum)
 * funderType — the same case the paint `match` and popup render grey via
 * INVESTMENT_FALLBACK_COLOR — has no checkbox of its own, so it follows the
 * "all on" state: visible exactly when every canonical checkbox is checked, and
 * hidden the moment any is unchecked. This keeps the grey fallback dot reachable
 * instead of silently filtered off the map with no control to bring it back.
 */
function funderTypeActive(funderType: string, activeSet: ReadonlySet<FunderType>): boolean {
  if (FUNDER_TYPE_ORDER_STRINGS.includes(funderType)) {
    return activeSet.has(funderType as FunderType);
  }
  return FUNDER_TYPE_ORDER.every((t) => activeSet.has(t));
}

/** Whether a record's year satisfies the (possibly unbounded) year range. */
function yearInRange(year: number | null, range: InvestmentYearRange | null): boolean {
  if (range && range.min != null && range.max != null) {
    if (year == null) return false;
    if (year < range.min || year > range.max) return false;
  }
  return true;
}

function toActiveSet(
  activeFunderTypes: ReadonlySet<FunderType> | readonly FunderType[]
): ReadonlySet<FunderType> {
  return activeFunderTypes instanceof Set
    ? activeFunderTypes
    : new Set(activeFunderTypes as readonly FunderType[]);
}

/**
 * Client-side filter over already-built point features, mirroring the vacancy
 * distress-filter pattern (components/vacancy/VacancyReportMap.tsx) that
 * rebuilds the source data with setData rather than a layer filter. A feature
 * passes when its funderType is active (see funderTypeActive — unknown types
 * follow the "all on" state) AND (the year range is unbounded, or the feature's
 * year falls inside the inclusive window). Pure / deterministic.
 */
export function filterInvestmentPointFeatures(
  features: readonly InvestmentPointFeature[],
  opts: { yearRangeId: string; activeFunderTypes: ReadonlySet<FunderType> | readonly FunderType[] }
): InvestmentPointFeature[] {
  const range = INVESTMENT_YEAR_RANGES.find((r) => r.id === opts.yearRangeId) ?? null;
  const activeSet = toActiveSet(opts.activeFunderTypes);
  return features.filter((f) => {
    const p = f.properties;
    if (!funderTypeActive(p.funderType, activeSet)) return false;
    return yearInRange(p.year, range);
  });
}

/** A FeatureCollection wrapper for GeoJSONSource.setData. Pure. */
export function investmentFeatureCollection(
  features: readonly InvestmentPointFeature[]
): GeoJSON.FeatureCollection<GeoJSON.Point, InvestmentPointProps> {
  return { type: "FeatureCollection", features: features as InvestmentPointFeature[] };
}

/**
 * Distinct funder types actually present among the plotted points, in
 * FUNDER_TYPE_ORDER — drives the legend's data-driven funderType checkboxes so
 * a type with no dots never shows a control. Mirrors presentOwnerTypesInOrder
 * in lib/owner-classify.ts. An empty input yields an empty array.
 */
export function presentFunderTypesInOrder(types: Array<string | null | undefined>): FunderType[] {
  const present = new Set<string>();
  for (const t of types) if (t) present.add(t);
  return FUNDER_TYPE_ORDER.filter((k) => present.has(k));
}

export interface CitywideInvestmentSummary {
  count: number;
  totalDollars: number;
}

/**
 * The just-enough fields of a citywide record to re-filter it client-side by the
 * active year window / funderType checkboxes (citywide records never plot, so
 * their full geometry/props are not needed). Keeps the legend's "Citywide
 * commitments" figure in lockstep with the plotted dots under the same filters.
 */
export interface CitywideInvestmentEntry {
  funderType: FunderType;
  year: number | null;
  /** Real awarded dollars, or null — NEVER a derived figure. */
  amountAwarded: number | null;
}

/** Extract the filterable fields of every citywide (non-plotting) record. Pure. */
export function citywideInvestmentEntries(
  records: readonly CommunityInvestmentRecord[]
): CitywideInvestmentEntry[] {
  const out: CitywideInvestmentEntry[] = [];
  for (const r of records) {
    if (r.geometry.kind === "citywide") {
      out.push({ funderType: r.funderType, year: r.year, amountAwarded: r.amountAwarded });
    }
  }
  return out;
}

/**
 * Count + total awarded dollars of the citywide-geometry records (the ones that
 * never plot). `totalDollars` sums only non-null amountAwarded — a plain total
 * of AWARDED dollars, never a derived received/available/remaining figure. Pure.
 */
export function summarizeCitywideInvestment(
  records: readonly CommunityInvestmentRecord[]
): CitywideInvestmentSummary {
  return summarizeCitywideEntries(citywideInvestmentEntries(records), null);
}

/**
 * Summarize citywide entries under the SAME year/funderType filter applied to
 * the plotted dots, so the legend's "Citywide commitments (N) · $X awarded" note
 * re-scopes with the active filters instead of freezing at the unfiltered total
 * (which reads as "$X in the selected year" when it is not). `opts === null`
 * summarizes everything (the unfiltered total). Pure / deterministic.
 */
export function summarizeCitywideEntries(
  entries: readonly CitywideInvestmentEntry[],
  opts: { yearRangeId: string; activeFunderTypes: ReadonlySet<FunderType> | readonly FunderType[] } | null
): CitywideInvestmentSummary {
  const range = opts ? INVESTMENT_YEAR_RANGES.find((r) => r.id === opts.yearRangeId) ?? null : null;
  const activeSet = opts ? toActiveSet(opts.activeFunderTypes) : null;
  let count = 0;
  let totalDollars = 0;
  for (const e of entries) {
    if (activeSet && !funderTypeActive(e.funderType, activeSet)) continue;
    if (!yearInRange(e.year, range)) continue;
    count += 1;
    if (e.amountAwarded != null) totalDollars += e.amountAwarded;
  }
  return { count, totalDollars };
}

export type CommunityInvestmentLayerStatus = "ready" | "unauthorized" | "unavailable" | "error";

export interface CommunityInvestmentLayerResult {
  status: CommunityInvestmentLayerStatus;
  pointFeatures: InvestmentPointFeature[];
  presentFunderTypes: FunderType[];
  /** Unfiltered citywide summary (initial legend state, all years / all types). */
  citywide: CitywideInvestmentSummary;
  /** Filterable citywide entries so the legend note re-scopes with the filters. */
  citywideEntries: CitywideInvestmentEntry[];
  /**
   * Foundation-HQ coordinates the gated route attaches (read server-side from
   * data/curated/foundation-hqs.csv). Seeds the Arcs view mode (funder HQ →
   * recipient); empty when the layer is unauthorized/unavailable or the CSV is
   * absent. The client never fetches the raw CSV — it only ever sees this array.
   */
  funderHqs: FunderHq[];
}

const EMPTY_LAYER_RESULT = (status: CommunityInvestmentLayerStatus): CommunityInvestmentLayerResult => ({
  status,
  pointFeatures: [],
  presentFunderTypes: [],
  citywide: { count: 0, totalDollars: 0 },
  citywideEntries: [],
  funderHqs: [],
});

/**
 * Fetch the gated Community Investment export and transform it into everything
 * the map layer + legend need: plotted point features (citywide excluded),
 * the present funder types, and the citywide summary. The `fetchImpl` seam
 * mirrors lib/owner-file-report-context.ts so the toggle's network behavior is
 * unit-testable without a live map.
 *
 * Status mapping: 401 → "unauthorized" (never requests parsing), any other
 * non-ok (e.g. 503 before the export is generated) → "unavailable", a thrown
 * error (network/abort) propagates to the caller's catch. On success →
 * "ready" with the transformed payload.
 */
export async function fetchCommunityInvestmentLayer(opts?: {
  source?: string | null;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<CommunityInvestmentLayerResult> {
  const doFetch = opts?.fetchImpl ?? fetch;
  const url = opts?.source
    ? `${COMMUNITY_INVESTMENT_ENDPOINT}?source=${encodeURIComponent(opts.source)}`
    : COMMUNITY_INVESTMENT_ENDPOINT;

  const res = await doFetch(url, opts?.signal ? { signal: opts.signal } : undefined);
  if (res.status === 401) return EMPTY_LAYER_RESULT("unauthorized");
  if (!res.ok) return EMPTY_LAYER_RESULT("unavailable");

  const data = (await res.json()) as CommunityInvestmentExport & { funderHqs?: FunderHq[] };
  const records = Array.isArray(data?.records) ? data.records : [];
  const pointFeatures = investmentRecordsToPointFeatures(records);
  const citywideEntries = citywideInvestmentEntries(records);
  return {
    status: "ready",
    pointFeatures,
    presentFunderTypes: presentFunderTypesInOrder(pointFeatures.map((f) => f.properties.funderType)),
    citywide: summarizeCitywideEntries(citywideEntries, null),
    citywideEntries,
    funderHqs: Array.isArray(data?.funderHqs) ? data.funderHqs : [],
  };
}
