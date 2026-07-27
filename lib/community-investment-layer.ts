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
  logLine: string | null;
  year: number | null;
  status: InvestmentStatus;
  /** First http(s) source link, or "" when the record carries none. */
  sourceLink: string;
}

export type InvestmentPointFeature = GeoJSON.Feature<GeoJSON.Point, InvestmentPointProps>;

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
        logLine: r.logLine,
        year: r.year,
        status: r.status,
        sourceLink: r.links.find((l) => /^https?:\/\//i.test(l)) ?? "",
      },
    });
  }
  return features;
}

/**
 * Client-side filter over already-built point features, mirroring the vacancy
 * distress-filter pattern (components/vacancy/VacancyReportMap.tsx) that
 * rebuilds the source data with setData rather than a layer filter. A feature
 * passes when its funderType is active AND (the year range is unbounded, or the
 * feature's year falls inside the inclusive window). Pure / deterministic.
 */
export function filterInvestmentPointFeatures(
  features: readonly InvestmentPointFeature[],
  opts: { yearRangeId: string; activeFunderTypes: ReadonlySet<FunderType> | readonly FunderType[] }
): InvestmentPointFeature[] {
  const range = INVESTMENT_YEAR_RANGES.find((r) => r.id === opts.yearRangeId) ?? null;
  const activeSet =
    opts.activeFunderTypes instanceof Set
      ? opts.activeFunderTypes
      : new Set(opts.activeFunderTypes as readonly FunderType[]);
  return features.filter((f) => {
    const p = f.properties;
    if (!activeSet.has(p.funderType)) return false;
    if (range && range.min != null && range.max != null) {
      if (p.year == null) return false;
      if (p.year < range.min || p.year > range.max) return false;
    }
    return true;
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
 * Count + total awarded dollars of the citywide-geometry records (the ones that
 * never plot). `totalDollars` sums only non-null amountAwarded — a plain total
 * of AWARDED dollars, never a derived received/available/remaining figure. Pure.
 */
export function summarizeCitywideInvestment(
  records: readonly CommunityInvestmentRecord[]
): CitywideInvestmentSummary {
  let count = 0;
  let totalDollars = 0;
  for (const r of records) {
    if (r.geometry.kind === "citywide") {
      count += 1;
      if (r.amountAwarded != null) totalDollars += r.amountAwarded;
    }
  }
  return { count, totalDollars };
}

export type CommunityInvestmentLayerStatus = "ready" | "unauthorized" | "unavailable" | "error";

export interface CommunityInvestmentLayerResult {
  status: CommunityInvestmentLayerStatus;
  pointFeatures: InvestmentPointFeature[];
  presentFunderTypes: FunderType[];
  citywide: CitywideInvestmentSummary;
}

const EMPTY_LAYER_RESULT = (status: CommunityInvestmentLayerStatus): CommunityInvestmentLayerResult => ({
  status,
  pointFeatures: [],
  presentFunderTypes: [],
  citywide: { count: 0, totalDollars: 0 },
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

  const data = (await res.json()) as CommunityInvestmentExport;
  const records = Array.isArray(data?.records) ? data.records : [];
  const pointFeatures = investmentRecordsToPointFeatures(records);
  return {
    status: "ready",
    pointFeatures,
    presentFunderTypes: presentFunderTypesInOrder(pointFeatures.map((f) => f.properties.funderType)),
    citywide: summarizeCitywideInvestment(records),
  };
}
