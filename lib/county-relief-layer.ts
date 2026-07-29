import type { CountyReliefZipSummary } from "@/lib/community-investment-layer";

export const COUNTY_RELIEF_BOUNDARIES_ENDPOINT = "/data/chicago-zip-boundaries.geojson";
export const COUNTY_RELIEF_SOURCE_ID = "community-investment-county-relief";
export const COUNTY_RELIEF_FILL_LAYER_ID = "community-investment-county-relief-fill";
export const COUNTY_RELIEF_LINE_LAYER_ID = "community-investment-county-relief-line";

export const COUNTY_RELIEF_FILL_COLOR = "#0E7490";
export const COUNTY_RELIEF_LINE_COLOR = "#155E75";

export interface ZipBoundaryProperties {
  zip?: string;
}
export type ZipBoundaryFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  ZipBoundaryProperties
>;

export type ZipBoundaryFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  ZipBoundaryProperties
>;

export interface CountyReliefFeatureProperties {
  zipCode: string;
  awardCount: number;
  totalDisbursed: number;
  year: 2023;
  sourceLink: string;
  /** 0..1 within the currently mapped ZIP set; used only for fill opacity. */
  intensity: number;
}

export type CountyReliefFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  CountyReliefFeatureProperties
>;

export type CountyReliefFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  CountyReliefFeatureProperties
>;

const EMPTY_COLLECTION: CountyReliefFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

export function normalizeZipCode(raw: unknown): string | null {
  const match = String(raw ?? "").match(/\b(\d{5})\b/);
  return match ? match[1] : null;
}

/**
 * Join official Chicago ZIP polygons to the Cook County recipient aggregates.
 * Unmatched awards stay in the private source table; unmatched polygons are not
 * painted. Recipient names never enter the map feature properties.
 */
export function buildCountyReliefFeatureCollection(
  boundaries: ZipBoundaryFeatureCollection | null | undefined,
  summaries: readonly CountyReliefZipSummary[],
): CountyReliefFeatureCollection {
  if (!boundaries || !Array.isArray(boundaries.features) || summaries.length === 0) {
    return EMPTY_COLLECTION;
  }

  const byZip = new Map(summaries.map((summary) => [summary.zipCode, summary]));
  const matched: Array<{ boundary: ZipBoundaryFeature; summary: CountyReliefZipSummary }> = [];
  for (const boundary of boundaries.features) {
    const zip = normalizeZipCode(boundary.properties?.zip);
    const summary = zip ? byZip.get(zip) : null;
    if (summary) matched.push({ boundary, summary });
  }
  if (matched.length === 0) return EMPTY_COLLECTION;

  const maxCount = Math.max(...matched.map(({ summary }) => summary.awardCount), 1);
  return {
    type: "FeatureCollection",
    features: matched.map(({ boundary, summary }) => ({
      type: "Feature",
      geometry: boundary.geometry,
      properties: {
        zipCode: summary.zipCode,
        awardCount: summary.awardCount,
        totalDisbursed: summary.totalDisbursed,
        year: 2023,
        sourceLink: summary.sourceLink,
        intensity: Math.sqrt(summary.awardCount / maxCount),
      },
    })),
  };
}
