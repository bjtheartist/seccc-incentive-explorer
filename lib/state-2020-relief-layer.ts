import type { HistoricalRecoveryZipSummary } from "@/lib/community-investment-layer";
import type {
  ZipBoundaryFeature,
  ZipBoundaryFeatureCollection,
} from "@/lib/county-relief-layer";
import { normalizeZipCode } from "@/lib/county-relief-layer";

export const STATE_2020_RELIEF_SOURCE_ID =
  "community-investment-state-2020-relief";
export const STATE_2020_RELIEF_FILL_LAYER_ID =
  "community-investment-state-2020-relief-fill";
export const STATE_2020_RELIEF_LINE_LAYER_ID =
  "community-investment-state-2020-relief-line";

export const STATE_2020_RELIEF_FILL_COLOR = "#7C3AED";
export const STATE_2020_RELIEF_LINE_COLOR = "#5B21B6";

export interface State2020ReliefFeatureProperties {
  sourceId: "illinois-big";
  programName: string;
  zipCode: string;
  awardCount: number;
  totalDisbursed: number;
  year: number;
  sourceLink: string;
  /** 0..1 within the currently mapped ZIP set; used only for fill opacity. */
  intensity: number;
}

export type State2020ReliefFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  State2020ReliefFeatureProperties
>;

export type State2020ReliefFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  State2020ReliefFeatureProperties
>;

const EMPTY_COLLECTION: State2020ReliefFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/**
 * Join official Chicago ZIP polygons to Illinois BIG aggregates. Recipient
 * names remain behind the authenticated, on-demand ZIP drilldown.
 */
export function buildState2020ReliefFeatureCollection(
  boundaries: ZipBoundaryFeatureCollection | null | undefined,
  summaries: readonly HistoricalRecoveryZipSummary[],
): State2020ReliefFeatureCollection {
  if (!boundaries || !Array.isArray(boundaries.features) || summaries.length === 0) {
    return EMPTY_COLLECTION;
  }

  const byZip = new Map(
    summaries
      .filter((summary) => summary.sourceId === "illinois-big")
      .map((summary) => [summary.zipCode, summary]),
  );
  const matched: Array<{
    boundary: ZipBoundaryFeature;
    summary: HistoricalRecoveryZipSummary;
  }> = [];
  for (const boundary of boundaries.features) {
    const zip = normalizeZipCode(boundary.properties?.zip);
    const summary = zip ? byZip.get(zip) : null;
    if (summary) matched.push({ boundary, summary });
  }
  if (matched.length === 0) return EMPTY_COLLECTION;

  const maxCount = Math.max(
    ...matched.map(({ summary }) => summary.awardCount),
    1,
  );
  return {
    type: "FeatureCollection",
    features: matched.map(({ boundary, summary }) => ({
      type: "Feature",
      geometry: boundary.geometry,
      properties: {
        sourceId: "illinois-big",
        programName: summary.programName,
        zipCode: summary.zipCode,
        awardCount: summary.awardCount,
        totalDisbursed: summary.totalDisbursed,
        year: summary.year,
        sourceLink: summary.sourceLink,
        intensity: Math.sqrt(summary.awardCount / maxCount),
      },
    })),
  };
}
