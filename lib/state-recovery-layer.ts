import type { HistoricalRecoveryZipSummary } from "@/lib/community-investment-layer";
import type {
  ZipBoundaryFeature,
  ZipBoundaryFeatureCollection,
} from "@/lib/county-relief-layer";
import { normalizeZipCode } from "@/lib/county-relief-layer";

export const STATE_RECOVERY_SOURCE_ID = "community-investment-state-recovery";
export const STATE_RECOVERY_FILL_LAYER_ID =
  "community-investment-state-recovery-fill";
export const STATE_RECOVERY_LINE_LAYER_ID =
  "community-investment-state-recovery-line";

export const STATE_RECOVERY_FILL_COLOR = "#B45309";
export const STATE_RECOVERY_LINE_COLOR = "#92400E";

export interface StateRecoveryFeatureProperties {
  sourceId: "illinois-b2b";
  programName: string;
  zipCode: string;
  awardCount: number;
  totalDisbursed: number;
  year: number;
  sourceLink: string;
  /** 0..1 within the currently mapped ZIP set; used only for fill opacity. */
  intensity: number;
}

export type StateRecoveryFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  StateRecoveryFeatureProperties
>;

export type StateRecoveryFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  StateRecoveryFeatureProperties
>;

const EMPTY_COLLECTION: StateRecoveryFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/**
 * Join official Chicago ZIP polygons to Illinois B2B aggregates. Recipient
 * names remain behind the authenticated, on-demand ZIP drilldown.
 */
export function buildStateRecoveryFeatureCollection(
  boundaries: ZipBoundaryFeatureCollection | null | undefined,
  summaries: readonly HistoricalRecoveryZipSummary[],
): StateRecoveryFeatureCollection {
  if (!boundaries || !Array.isArray(boundaries.features) || summaries.length === 0) {
    return EMPTY_COLLECTION;
  }

  const byZip = new Map(
    summaries
      .filter((summary) => summary.sourceId === "illinois-b2b")
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
        sourceId: "illinois-b2b",
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
