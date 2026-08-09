import { describe, expect, it } from "vitest";
import { loadZoningSourceLedger } from "@/lib/zoning-legislation-data";

describe("committed zoning source artifacts", () => {
  const { legislation, mapSnapshot, mapDelta, zbaSnapshot, zbaDelta } =
    loadZoningSourceLedger();

  it("reconciles every eLMS search page and discloses related-record exclusions", () => {
    for (const search of legislation.coverage.searches) {
      expect(search.fetchedCount).toBe(search.publishedCount);
      expect(search.normalizedMatches + search.excludedRelatedRecords).toBe(
        search.publishedCount,
      );
    }
    expect(legislation.coverage.total).toBe(legislation.matters.length);
    expect(new Set(legislation.matters.map((matter) => matter.matterId)).size).toBe(
      legislation.matters.length,
    );
  });

  it("keeps pending matters distinct from adopted matters", () => {
    const lifecycleTotal = Object.values(legislation.coverage.byLifecycle).reduce(
      (sum, count) => sum + count,
      0,
    );
    expect(lifecycleTotal).toBe(legislation.coverage.total);
    expect(legislation.coverage.byLifecycle.pending).toBeGreaterThan(0);
    expect(legislation.coverage.byLifecycle.adopted).toBeGreaterThan(0);
    expect(
      legislation.matters.every(
        (matter) =>
          matter.lifecycle !== "adopted" ||
          matter.subStatus?.toLowerCase().includes("passed") === true,
      ),
    ).toBe(true);
  });

  it("stores map fingerprints rather than republishing inferred geometry", () => {
    expect(mapSnapshot.featureCount).toBe(mapSnapshot.records.length);
    expect(new Set(mapSnapshot.records.map((row) => row.globalId)).size).toBe(
      mapSnapshot.featureCount,
    );
    for (const row of mapSnapshot.records) {
      expect(row.attributeFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(row.geometryFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(row).not.toHaveProperty("geometry");
      expect(row).not.toHaveProperty("permittedUse");
    }
  });

  it("marks the first map snapshot as a baseline rather than invented changes", () => {
    expect(mapDelta.comparedFrom).toBeNull();
    expect(mapDelta.comparedThrough).toBe(mapSnapshot.source.sourceUpdatedThrough);
    expect(mapDelta.changes).toEqual([]);
    expect(mapDelta.counts).toEqual({
      added: 0,
      removed: 0,
      attributesChanged: 0,
      geometryChanged: 0,
    });
  });

  it("stores every published ZBA record without republishing geometry", () => {
    expect(zbaSnapshot.featureCount).toBe(zbaSnapshot.records.length);
    expect(new Set(zbaSnapshot.records.map((row) => row.globalId)).size).toBe(
      zbaSnapshot.featureCount,
    );
    for (const row of zbaSnapshot.records) {
      expect(row.attributeFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(row.geometryFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(row).not.toHaveProperty("geometry");
      expect(row).not.toHaveProperty("currentAuthorization");
    }
    expect(
      Object.values(zbaSnapshot.coverage.byCaseType).reduce(
        (sum, count) => sum + count,
        0,
      ),
    ).toBe(zbaSnapshot.featureCount);
    expect(zbaSnapshot.coverage.withoutPublishedJudgment).toBeGreaterThan(0);
  });

  it("does not invent ZBA freshness or changes for the first baseline", () => {
    expect(zbaSnapshot.source.sourceUpdatedThrough).toBeNull();
    expect(zbaSnapshot.source.freshnessNote).toContain("does not publish");
    expect(zbaDelta.comparedFromFeatureCount).toBeNull();
    expect(zbaDelta.comparedThroughFeatureCount).toBe(zbaSnapshot.featureCount);
    expect(zbaDelta.changes).toEqual([]);
    expect(zbaDelta.counts).toEqual({
      added: 0,
      removed: 0,
      attributesChanged: 0,
      geometryChanged: 0,
    });
  });
});
