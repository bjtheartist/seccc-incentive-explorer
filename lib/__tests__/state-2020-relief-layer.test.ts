import { describe, expect, it } from "vitest";
import type { HistoricalRecoveryZipSummary } from "@/lib/community-investment-layer";
import type { ZipBoundaryFeatureCollection } from "@/lib/county-relief-layer";
import { buildState2020ReliefFeatureCollection } from "@/lib/state-2020-relief-layer";

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
    sourceId: "illinois-big",
    programName: "Business Interruption Grants Program",
    zipCode: "60617",
    awardCount: 100,
    totalDisbursed: 2_500_000,
    year: 2020,
    sourceLink: "https://example.gov/big.pdf",
    ...partial,
  };
}

describe("Illinois BIG ZIP layer", () => {
  it("joins ZIP summaries without placing recipient names in map properties", () => {
    const result = buildState2020ReliefFeatureCollection(boundaries, [summary()]);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties).toEqual({
      sourceId: "illinois-big",
      programName: "Business Interruption Grants Program",
      zipCode: "60617",
      awardCount: 100,
      totalDisbursed: 2_500_000,
      year: 2020,
      sourceLink: "https://example.gov/big.pdf",
      intensity: 1,
    });
    expect(JSON.stringify(result)).not.toContain("recipient");
  });

  it("uses square-root count intensity and ignores other recovery sources", () => {
    const result = buildState2020ReliefFeatureCollection(boundaries, [
      summary(),
      summary({
        zipCode: "60649",
        awardCount: 25,
        totalDisbursed: 500_000,
      }),
      summary({
        sourceId: "illinois-b2b",
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
    expect(buildState2020ReliefFeatureCollection(null, [summary()])).toEqual({
      type: "FeatureCollection",
      features: [],
    });
    expect(
      buildState2020ReliefFeatureCollection(boundaries, [
        summary({ sourceId: "illinois-b2b" }),
      ]),
    ).toEqual({ type: "FeatureCollection", features: [] });
  });
});
