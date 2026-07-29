import { describe, expect, it } from "vitest";
import type { HistoricalRecoveryZipSummary } from "@/lib/community-investment-layer";
import type { ZipBoundaryFeatureCollection } from "@/lib/county-relief-layer";
import { buildStateRecoveryFeatureCollection } from "@/lib/state-recovery-layer";

const boundaries: ZipBoundaryFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { zip: "60617" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-87.6, 41.7],
            [-87.5, 41.7],
            [-87.5, 41.8],
            [-87.6, 41.7],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { zip: "60649" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-87.6, 41.8],
            [-87.5, 41.8],
            [-87.5, 41.9],
            [-87.6, 41.8],
          ],
        ],
      },
    },
  ],
};

function summary(
  partial: Partial<HistoricalRecoveryZipSummary> = {},
): HistoricalRecoveryZipSummary {
  return {
    sourceId: "illinois-b2b",
    programName: "Illinois Back to Business Grant Program",
    zipCode: "60617",
    awardCount: 100,
    totalDisbursed: 2_500_000,
    year: 2022,
    sourceLink: "https://example.gov/b2b.pdf",
    ...partial,
  };
}

describe("Illinois B2B ZIP layer", () => {
  it("joins ZIP summaries without placing recipient names in map properties", () => {
    const result = buildStateRecoveryFeatureCollection(boundaries, [summary()]);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties).toEqual({
      sourceId: "illinois-b2b",
      programName: "Illinois Back to Business Grant Program",
      zipCode: "60617",
      awardCount: 100,
      totalDisbursed: 2_500_000,
      year: 2022,
      sourceLink: "https://example.gov/b2b.pdf",
      intensity: 1,
    });
    expect(JSON.stringify(result)).not.toContain("recipient");
  });

  it("uses square-root count intensity and ignores other recovery sources", () => {
    const result = buildStateRecoveryFeatureCollection(boundaries, [
      summary(),
      summary({
        zipCode: "60649",
        awardCount: 25,
        totalDisbursed: 500_000,
      }),
      summary({
        sourceId: "cook-source-2023",
        zipCode: "60649",
        awardCount: 999,
      }),
    ]);
    expect(result.features.map((feature) => feature.properties.intensity)).toEqual([
      1,
      0.5,
    ]);
  });

  it("fails closed when boundaries or matching summaries are missing", () => {
    expect(buildStateRecoveryFeatureCollection(null, [summary()])).toEqual({
      type: "FeatureCollection",
      features: [],
    });
    expect(
      buildStateRecoveryFeatureCollection(boundaries, [
        summary({ sourceId: "cook-source-2023" }),
      ]),
    ).toEqual({ type: "FeatureCollection", features: [] });
  });
});
