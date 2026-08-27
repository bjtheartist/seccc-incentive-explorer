import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeCclbaSourceCoverage } from "@/lib/drawn-area-vacancy";
import {
  assertStaticFallbackCclbaPublication,
  STATIC_FALLBACK_LIMIT,
  STATIC_FALLBACK_TYPE_QUOTAS,
} from "@/lib/vacancy-static-fallback";

const artifact = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "public/data/vacant-properties.json"),
    "utf8",
  ),
) as GeoJSON.FeatureCollection & {
  cclbaSourceCoverage?: unknown;
};

describe("committed vacancy static fallback artifact", () => {
  it("contains the complete located CCLBA snapshot with coherent evidence", () => {
    const coverage = normalizeCclbaSourceCoverage(
      artifact.cclbaSourceCoverage,
    );
    expect(coverage?.status).toBe("available");
    if (!coverage || coverage.status !== "available") {
      throw new Error("Committed fallback lacks available CCLBA coverage");
    }

    const rows = artifact.features.map((feature) => ({
      id: feature.properties?.id,
      source: feature.properties?.source,
      source_row_id: feature.properties?.sourceRowId,
      source_dataset_id: feature.properties?.sourceDatasetId,
      source_url: feature.properties?.sourceUrl,
      source_retrieved_at: feature.properties?.sourceRetrievedAt,
    }));
    expect(() =>
      assertStaticFallbackCclbaPublication(rows, coverage),
    ).not.toThrow();

    const cclbaFeatures = artifact.features.filter(
      (feature) => feature.properties?.source === "cclba",
    );
    expect(cclbaFeatures).toHaveLength(coverage.locatedChicagoTotal);
    for (const feature of cclbaFeatures) {
      expect(feature.geometry?.type).toBe("Point");
      expect(feature.properties?.pin).toMatch(/^\d{14}$/);
      expect(Array.isArray(feature.properties?.zoneMatches)).toBe(true);
      expect(feature.properties?.incentiveCount).toBe(
        feature.properties?.zoneMatches.length,
      );
    }
  });

  it("stays within the published bound while representing every present class", () => {
    expect(artifact.features).toHaveLength(STATIC_FALLBACK_LIMIT);
    for (const [propertyType, quota] of Object.entries(
      STATIC_FALLBACK_TYPE_QUOTAS,
    )) {
      const matching = artifact.features.filter(
        (feature) => feature.properties?.propertyType === propertyType,
      );
      if (matching.length > 0) expect(matching.length).toBeGreaterThanOrEqual(quota);
    }
  });
});
