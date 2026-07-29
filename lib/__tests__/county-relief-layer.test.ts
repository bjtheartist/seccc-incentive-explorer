import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCountyReliefFeatureCollection,
  normalizeZipCode,
  type ZipBoundaryFeatureCollection,
} from "@/lib/county-relief-layer";

const boundaries: ZipBoundaryFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { zip: "60617" },
      geometry: {
        type: "Polygon",
        coordinates: [[[-87.6, 41.7], [-87.5, 41.7], [-87.5, 41.8], [-87.6, 41.7]]],
      },
    },
    {
      type: "Feature",
      properties: { zip: "60649" },
      geometry: {
        type: "Polygon",
        coordinates: [[[-87.6, 41.8], [-87.5, 41.8], [-87.5, 41.9], [-87.6, 41.8]]],
      },
    },
  ],
};

describe("county relief ZIP layer", () => {
  it("normalizes only source-backed five-digit ZIP values", () => {
    expect(normalizeZipCode("60617")).toBe("60617");
    expect(normalizeZipCode("ZIP 60649")).toBe("60649");
    expect(normalizeZipCode("6061")).toBeNull();
    expect(normalizeZipCode(null)).toBeNull();
  });

  it("joins summaries to boundaries without exposing recipient names", () => {
    const result = buildCountyReliefFeatureCollection(boundaries, [
      {
        sourceId: "cook-source-2023",
        programName: "Cook County 2023 Source Grant",
        zipCode: "60617",
        awardCount: 25,
        totalDisbursed: 350_000,
        year: 2023,
        sourceLink: "https://example.com/source.pdf",
      },
    ]);

    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties).toEqual({
      zipCode: "60617",
      awardCount: 25,
      totalDisbursed: 350_000,
      year: 2023,
      sourceLink: "https://example.com/source.pdf",
      intensity: 1,
    });
    expect(JSON.stringify(result)).not.toContain("recipient");
  });

  it("uses a stable square-root intensity based on award count", () => {
    const result = buildCountyReliefFeatureCollection(boundaries, [
      {
        sourceId: "cook-source-2023",
        programName: "Cook County 2023 Source Grant",
        zipCode: "60617",
        awardCount: 100,
        totalDisbursed: 1_500_000,
        year: 2023,
        sourceLink: "",
      },
      {
        sourceId: "cook-source-2023",
        programName: "Cook County 2023 Source Grant",
        zipCode: "60649",
        awardCount: 25,
        totalDisbursed: 400_000,
        year: 2023,
        sourceLink: "",
      },
    ]);
    expect(result.features.map((feature) => feature.properties.intensity)).toEqual([1, 0.5]);
  });

  it("fails closed for missing geometry or unmatched ZIPs", () => {
    expect(buildCountyReliefFeatureCollection(null, [])).toEqual({
      type: "FeatureCollection",
      features: [],
    });
    expect(buildCountyReliefFeatureCollection(boundaries, [
      {
        sourceId: "cook-source-2023",
        programName: "Cook County 2023 Source Grant",
        zipCode: "99999",
        awardCount: 1,
        totalDisbursed: 10_000,
        year: 2023,
        sourceLink: "",
      },
    ])).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("ships the official Chicago ZIP boundary artifact used by the overlay", () => {
    const source = JSON.parse(
      readFileSync(path.join(process.cwd(), "public/data/chicago-zip-boundaries.geojson"), "utf8"),
    ) as ZipBoundaryFeatureCollection & {
      metadata?: { datasetId?: string; sourceUrl?: string };
    };
    expect(source.metadata?.datasetId).toBe("unjd-c2ca");
    expect(source.metadata?.sourceUrl).toContain("data.cityofchicago.org");
    expect(source.features).toHaveLength(59);
    expect(new Set(source.features.map((feature) => feature.properties?.zip)).size).toBe(59);
  });
});
